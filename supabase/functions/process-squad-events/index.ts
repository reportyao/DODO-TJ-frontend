/**
 * ============================================================================
 * 异步事件处理 Worker (process-squad-events) v3
 * ============================================================================
 *
 * 功能概述:
 *   消费 event_queue 表中的待处理事件，直接执行数据库操作完成实际业务处理。
 *   支持自动重试（指数退避）和死信队列。
 *
 * v3 重大变更（相比 v2）:
 *   - 所有事件处理器从 HTTP 调用其他 Edge Functions 改为直接内联数据库操作
 *   - 彻底消除了 Edge Function 之间调用的 JWT 认证问题
 *   - 减少了网络请求开销，提升了处理速度和可靠性
 *
 * 触发方式:
 *   1. Supabase Database Webhook: 当 event_queue 表有新 INSERT 时自动触发
 *   2. Supabase Cron Job: 每分钟定时触发，处理可能遗漏的事件
 *   3. 手动调用: POST /functions/v1/process-squad-events
 *
 * 处理流程:
 *   1. 从 event_queue 中取出一批 pending 状态的事件（默认 10 条）
 *   2. 先释放超时的锁（防止 Worker 崩溃导致事件卡住）
 *   3. 逐个处理事件，根据 event_type 路由到对应的处理函数
 *   4. 处理成功: 标记为 completed
 *   5. 处理失败: 如果还有重试机会，重置为 pending（指数退避）
 *                如果重试次数耗尽，转入 dead_letter_queue
 *
 * 支持的事件类型:
 *   - COMMISSION:      三级分销佣金计算和发放（内联实现）
 *   - AI_REWARD:       AI 对话奖励配额增加（内联实现）
 *   - FIRST_GROUP_BUY: 首次拼团邀请人奖励（内联实现）
 *   - NOTIFICATION:    写入 notification_queue 表
 *
 * 幂等性保证:
 *   - COMMISSION: 检查 commissions 表是否已存在相同 order_id + user_id + level 的记录
 *   - FIRST_GROUP_BUY: 检查 invite_rewards 表是否已存在相同 inviter_id + invitee_id 的记录
 *   - AI_REWARD: 通过 event_queue 的 idempotency_key 在事件队列层面保证
 *   - NOTIFICATION: 通过 session_code 检查 notification_queue 防重复
 *
 * 并发安全:
 *   - 使用 locked_by + locked_at 字段实现乐观锁
 *   - 多个 Worker 实例可以安全并发运行
 *   - 超时 5 分钟的锁会被自动释放
 * ============================================================================
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  dequeueEvents,
  markEventCompleted,
  markEventFailed,
  releaseStaleEvents,
  EventType,
} from '../_shared/eventQueue.ts';
import type { QueuedEvent } from '../_shared/eventQueue.ts';

// ============================================================================
// 环境变量
// ============================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// 【迁移修复】佣金通知已迁移到通知队列，不再需要 Telegram Bot Token

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// ============================================================================
// 辅助函数：创建 Supabase 客户端
// ============================================================================

/**
 * 创建带有 service_role 权限的 Supabase 客户端
 * 所有事件处理器共享同一个客户端实例以减少开销
 */
function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
}

// ============================================================================
// 辅助函数：佣金通知发送
// 【迁移修复】从 Telegram 直发迁移到写入 notification_queue
// ============================================================================

/**
 * 佣金通知的多语言翻译模板
 */
const commissionTranslations: Record<string, (amount: number, level: number) => string> = {
  zh: (amount: number, level: number) => `🎉 恭喜！您获得了 ${amount} 积分的佣金。来自您的 L${level} 朋友的购买。`,
  ru: (amount: number, level: number) => `🎉 Поздравляем! Вы получили комиссию ${amount} баллов от покупки вашего друга уровня L${level}.`,
  tg: (amount: number, level: number) => `🎉 Табрик! Шумо аз хариди дӯсти сатҳи L${level} комиссияи ${amount} балл гирифтед.`,
};

/**
 * 发送佣金通知消息（写入通知队列）
 * 【迁移修复】从 Telegram 直发改为写入 notification_queue
 * 
 * 失败时只记录日志，不抛出异常（不阻断佣金发放流程）。
 *
 * @param supabase - Supabase 客户端
 * @param userId - 接收通知的用户 ID
 * @param amount - 佣金金额
 * @param level - 佣金级别（1/2/3）
 */
async function sendCommissionNotification(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  level: number,
): Promise<void> {
  try {
    // 查询用户的 phone_number 和语言偏好
    const { data: userData, error } = await supabase
      .from('users')
      .select('phone_number, preferred_language')
      .eq('id', userId)
      .single();

    if (error || !userData?.phone_number) {
      console.log(`[Worker] User not found or no phone_number: ${userId}`);
      return;
    }

    const lang = userData.preferred_language || 'ru';
    const messageFunc = commissionTranslations[lang] || commissionTranslations['ru'];
    const message = messageFunc(amount, level);

    const now = new Date().toISOString();
    // 写入通知队列
    const { error: insertError } = await supabase
      .from('notification_queue')
      .insert({
        user_id: userId,
        phone_number: userData.phone_number,
        type: 'commission_earned',
        notification_type: 'commission_earned',
        title: '',
        message: message,
        payload: { amount, level },
        data: { amount, level },
        status: 'pending',
        priority: 2,
        scheduled_at: now,
        created_at: now,
        updated_at: now,
      });

    if (insertError) {
      console.error('[Worker] Failed to queue commission notification:', insertError);
    } else {
      console.log(`[Worker] Commission notification queued for user ${userId}`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Failed to queue commission notification:', errMsg);
    // 不抛出异常，通知失败不影响佣金发放
  }
}

// ============================================================================
// 事件处理器：COMMISSION（三级分销佣金）
// ============================================================================

/**
 * 处理推荐佣金事件（内联实现）
 *
 * 完整复刻 handle-purchase-commission 的核心逻辑，直接操作数据库：
 *   1. 获取佣金配置（commission_settings 表）
 *   2. 查询用户的推荐关系链（最多 3 级）
 *   3. 检查是否已发放过佣金（防重复）
 *   4. 计算佣金金额并写入 commissions 表
 *   5. 更新推荐人的积分钱包余额（LUCKY_COIN 钱包）
   *   6. 发送佣金通知（写入通知队列）
 *
 * 幂等性: 通过 commissions 表的 order_id + user_id + level 唯一性检查
 *
 * @param event - 队列事件，payload 包含 { order_id, user_id, order_amount }
 */
async function handleCommission(event: QueuedEvent): Promise<void> {
  const { order_id, user_id, order_amount } = event.payload as any;
  const supabase = createServiceClient();

  console.log(`[Worker] Processing COMMISSION: order=${order_id}, user=${user_id}, amount=${order_amount}`);

  // 步骤 1: 获取佣金配置
  const { data: settings, error: settingsError } = await supabase
    .from('commission_settings')
    .select('level, rate, is_active, trigger_condition, min_payout_amount')
    .eq('is_active', true)
    .order('level', { ascending: true });

  if (settingsError) {
    throw new Error(`Failed to fetch commission settings: ${settingsError.message}`);
  }

  if (!settings || settings.length === 0) {
    console.log('[Worker] COMMISSION: No active commission settings found, skipping');
    return; // 没有佣金配置，正常结束
  }

  // 步骤 2: 获取购买用户的推荐关系
  // 兼容旧数据：同时查询 referred_by_id 和 referrer_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('referred_by_id, referrer_id')
    .eq('id', user_id)
    .single();

  if (userError) {
    throw new Error(`Failed to fetch user referral data: ${userError.message}`);
  }

  // 优先使用 referred_by_id，如果为空则使用 referrer_id
  const referrerId = userData?.referred_by_id || userData?.referrer_id;

  if (!referrerId) {
    console.log(`[Worker] COMMISSION: User ${user_id} has no referrer, skipping`);
    return; // 没有推荐人，正常结束
  }

  // 步骤 3: 遍历三级推荐链，计算并发放佣金
  const commissions: any[] = [];
  let currentUserId = referrerId;
  let level = 1;

  for (const setting of settings) {
    if (!currentUserId || level > 3) break;
    if (setting.level !== level) continue;

    const rate = parseFloat(setting.rate);
    const minPayoutAmount = parseFloat(setting.min_payout_amount || '0');
    const commissionAmount = order_amount * rate;

    // 检查是否达到最低发放金额
    if (commissionAmount < minPayoutAmount) {
      console.log(`[Worker] Commission ${commissionAmount} below minimum ${minPayoutAmount} for level ${level}`);
      const { data: nextUser } = await supabase
        .from('users')
        .select('referred_by_id, referrer_id')
        .eq('id', currentUserId)
        .single();
      currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id;
      level++;
      continue;
    }

    // 防重复检查：检查该订单是否已经给该用户发放过该级别的佣金
    const { data: existingCommission } = await supabase
      .from('commissions')
      .select('id')
      .eq('order_id', order_id)
      .eq('user_id', currentUserId)
      .eq('level', level)
      .maybeSingle();

    if (existingCommission) {
      console.log(`[Worker] Commission already exists for order ${order_id}, user ${currentUserId}, level ${level}. Skipping.`);
      const { data: nextUser } = await supabase
        .from('users')
        .select('referred_by_id, referrer_id')
        .eq('id', currentUserId)
        .single();
      currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id;
      level++;
      continue;
    }

    // 插入佣金记录
    const { data: commission, error: commissionError } = await supabase
      .from('commissions')
      .insert({
        user_id: currentUserId,
        from_user_id: user_id,
        source_user_id: user_id,
        beneficiary_id: currentUserId,
        level: level,
        rate: rate,
        percent: rate * 100,
        source_amount: order_amount,
        amount: commissionAmount,
        order_id: order_id,
        related_order_id: order_id,
        type: 'REFERRAL_COMMISSION',
        status: 'settled',
      })
      .select()
      .single();

    if (commissionError) {
      throw new Error(`Failed to insert commission: ${commissionError.message}`);
    }

    commissions.push(commission);

    // 将佣金发放到上级用户的积分钱包（LUCKY_COIN）
    // 【资金安全修复 v3】查询 version 字段用于乐观锁
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, balance, version')
      .eq('user_id', currentUserId)
      .eq('type', 'LUCKY_COIN')
      .eq('currency', 'POINTS')
      .single();

    if (walletError) {
      // 如果找不到积分钱包，尝试创建一个
      // 【重要】currency 必须为 'POINTS'，与 auth-register 统一
      console.log(`[Worker] No LUCKY_COIN wallet found for user ${currentUserId}, creating one`);
      const { error: createError } = await supabase
        .from('wallets')
        .insert({
          user_id: currentUserId,
          type: 'LUCKY_COIN',
          currency: 'POINTS',  // 统一标准: 积分钱包 currency='POINTS'
          balance: commissionAmount,
          version: 1,
        });

      if (createError) {
        throw new Error(`Failed to create wallet: ${createError.message}`);
      }
      console.log(`[Worker] Created new LUCKY_COIN wallet for user ${currentUserId} with balance ${commissionAmount}`);
    } else {
      // 更新积分钱包余额
      // 【资金安全修复 v3】添加乐观锁防止并发更新导致余额错误
      // 场景: 多个下级同时购买，同时触发佣金发放，可能导致余额覆盖
      const currentBalance = parseFloat(wallet.balance || '0');
      const newBalance = currentBalance + commissionAmount;
      const currentVersion = wallet.version || 1;

      const { error: updateError, data: updatedWallet } = await supabase
        .from('wallets')
        .update({
          balance: newBalance,
          version: currentVersion + 1,  // 乐观锁: 版本号+1
          updated_at: new Date().toISOString(),
        })
        .eq('id', wallet.id)
        .eq('version', currentVersion)  // 乐观锁: 只有版本号匹配才能更新
        .select()
        .single();

      if (updateError || !updatedWallet) {
        // 【资金安全修复 v4】乐观锁失败，使用 3 次重试机制
        let retrySuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          console.warn(`[Worker] Optimistic lock failed, retry attempt ${attempt}/3...`);
          const { data: freshWallet } = await supabase
            .from('wallets')
            .select('id, balance, version')
            .eq('user_id', currentUserId)
            .eq('type', 'LUCKY_COIN')
            .eq('currency', 'POINTS')
            .single();

          if (!freshWallet) {
            throw new Error(`Failed to find wallet for retry`);
          }

          const retryBalance = parseFloat(freshWallet.balance || '0') + commissionAmount;
          const { error: retryError, data: retryData } = await supabase
            .from('wallets')
            .update({
              balance: retryBalance,
              version: (freshWallet.version || 1) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', freshWallet.id)
            .eq('version', freshWallet.version || 1)
            .select()
            .single();

          if (!retryError && retryData) {
            retrySuccess = true;
            console.log(`[Worker] Updated LUCKY_COIN wallet (after retry ${attempt}) for user ${currentUserId}, new balance: ${retryBalance}`);
            break;
          }
        }
        if (!retrySuccess) {
          throw new Error(`Failed to update wallet balance after 3 retries for user ${currentUserId}`);
        }
      } else {
        console.log(`[Worker] Updated LUCKY_COIN wallet for user ${currentUserId}, new balance: ${newBalance}`);
      }
    }

    // 发送 Telegram 佣金通知（失败不阻断流程）
    await sendCommissionNotification(supabase, currentUserId, commissionAmount, level);

    // 查找下一级推荐人
    const { data: nextUser, error: nextUserError } = await supabase
      .from('users')
      .select('referred_by_id, referrer_id')
      .eq('id', currentUserId)
      .single();

    if (nextUserError) {
      console.error(`[Worker] Failed to fetch next user: ${nextUserError.message}`);
      break;
    }

    currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id;
    level++;
  }

  console.log(`[Worker] COMMISSION completed: order=${order_id}, commissions_created=${commissions.length}`);
}

// ============================================================================
// 事件处理器：AI_REWARD（AI 对话奖励）
// ============================================================================

/**
 * 处理 AI 对话奖励事件（内联实现）
 *
 * 完整复刻 ai-add-bonus 的核心逻辑，直接操作数据库：
 *   1. 获取或创建今日的 ai_chat_quota 记录
 *   2. 原子性地增加 bonus_quota（优先使用 RPC，回退到直接更新）
 *
 * 注意: 在 group-buy-squad v2 中，我们将 groupSize 次调用合并为一次，
 * 总量 = groupSize × 10。当 groupSize > 10 时 amount 会超过 100，
 * 但由于我们直接操作数据库，不再受 ai-add-bonus 的 1-100 限制。
 *
 * @param event - 队列事件，payload 包含 { user_id, amount, reason }
 */
async function handleAiReward(event: QueuedEvent): Promise<void> {
  const { user_id, amount, reason } = event.payload as any;
  const supabase = createServiceClient();

  console.log(`[Worker] Processing AI_REWARD: user=${user_id}, amount=${amount}, reason=${reason}`);

  const today = new Date().toISOString().split('T')[0];

  // 步骤 1: 获取或创建今日配额
  const { data: existingQuota } = await supabase
    .from('ai_chat_quota')
    .select('*')
    .eq('user_id', user_id)
    .eq('date', today)
    .maybeSingle();

  if (!existingQuota) {
    // 获取最近一天的 bonus_quota（已包含之前所有继承的值）
    const { data: latestRecord } = await supabase
      .from('ai_chat_quota')
      .select('bonus_quota')
      .eq('user_id', user_id)
      .neq('date', today)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestBonus = latestRecord?.bonus_quota || 0;
    console.log(`[Worker] AI_REWARD: Latest bonus for user ${user_id}: ${latestBonus}`);

    // 创建新的今日配额记录，继承最近一天的bonus + 新奖励
    const { error: createError } = await supabase
      .from('ai_chat_quota')
      .insert({
        user_id: user_id,
        date: today,
        base_quota: 10,
        bonus_quota: latestBonus + amount,
        used_quota: 0,
      });

    if (createError) {
      throw new Error(`Failed to create ai_chat_quota: ${createError.message}`);
    }
    console.log(`[Worker] AI_REWARD: Created new quota with bonus=${latestBonus + amount} (inherited=${latestBonus}, new=${amount}) for user ${user_id}`);
  } else {
    // 步骤 2: 尝试使用 RPC 原子性增加 bonus_quota
    const { error: rpcError } = await supabase.rpc('increment_ai_quota_bonus', {
      p_user_id: user_id,
      p_date: today,
      p_amount: amount,
    });

    if (rpcError) {
      // RPC 不存在或失败，回退到直接更新
      console.log(`[Worker] RPC increment_ai_quota_bonus failed, falling back to direct update: ${rpcError.message}`);
      const newBonusQuota = (existingQuota.bonus_quota || 0) + amount;
      const { error: updateError } = await supabase
        .from('ai_chat_quota')
        .update({ bonus_quota: newBonusQuota })
        .eq('id', existingQuota.id);

      if (updateError) {
        throw new Error(`Failed to update ai_chat_quota: ${updateError.message}`);
      }
    }
    console.log(`[Worker] AI_REWARD: Updated bonus quota +${amount} for user ${user_id}`);
  }

  console.log(`[Worker] AI_REWARD completed: user=${user_id}, total_awarded=${amount}`);
}

// ============================================================================
// 事件处理器：FIRST_GROUP_BUY（首次拼团邀请人奖励）
// ============================================================================

/**
 * 处理首次拼团奖励事件（内联实现）
 *
 * 完整复刻 handle-first-group-buy-reward 的核心逻辑，直接操作数据库：
 *   1. 检查用户是否有邀请人
 *   2. 检查是否已发放过首次拼团奖励（防重复）
 *   3. 检查是否确实是首次拼团（PAID 订单数 <= 1）
 *   4. 给邀请人增加 2 次抽奖机会（通过 RPC add_user_spin_count）
 *   5. 记录邀请奖励到 invite_rewards 表
 *
 * 幂等性: 通过 invite_rewards 表的 inviter_id + invitee_id + reward_type 检查
 *
 * @param event - 队列事件，payload 包含 { user_id, order_id }
 */
async function handleFirstGroupBuy(event: QueuedEvent): Promise<void> {
  const { user_id, order_id } = event.payload as any;
  const supabase = createServiceClient();

  console.log(`[Worker] Processing FIRST_GROUP_BUY: user=${user_id}, order=${order_id}`);

  // 步骤 1: 检查用户是否有邀请人
  // 兼容旧数据：同时查询 referred_by_id 和 referrer_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, referred_by_id, referrer_id')
    .eq('id', user_id)
    .single();

  if (userError || !userData) {
    console.log(`[Worker] FIRST_GROUP_BUY: User ${user_id} not found, skipping`);
    return;
  }

  const inviterId = userData.referred_by_id || userData.referrer_id;

  if (!inviterId) {
    console.log(`[Worker] FIRST_GROUP_BUY: User ${user_id} has no inviter, skipping`);
    return;
  }

  // 步骤 2: 检查是否已经发放过首次拼团奖励（防重复）
  const { data: existingReward } = await supabase
    .from('invite_rewards')
    .select('id')
    .eq('inviter_id', inviterId)
    .eq('invitee_id', user_id)
    .eq('reward_type', 'first_group_buy')
    .maybeSingle();

  if (existingReward) {
    console.log(`[Worker] FIRST_GROUP_BUY: Reward already processed for inviter=${inviterId}, invitee=${user_id}`);
    return;
  }

  // 步骤 3: 检查用户的拼团订单数量（确认是否为首次）
  // 查询用户的拼团订单
  let ordersQuery = supabase
    .from('group_buy_orders')
    .select('id')
    .eq('status', 'PAID')
    .eq('user_id', user_id)
    .limit(3);

  const { data: orders } = await ordersQuery;

  // 如果已有多个已支付订单，说明不是首次
  // 注意：当前订单可能已经在列表中，所以检查 <= 1
  const isFirstGroupBuy = orders && orders.length <= 1;

  if (!isFirstGroupBuy) {
    console.log(`[Worker] FIRST_GROUP_BUY: User ${user_id} has ${orders?.length} orders, not first group buy`);
    return;
  }

  // 步骤 4: 给邀请人增加 2 次抽奖机会
  const { error: spinError } = await supabase.rpc('add_user_spin_count', {
    p_user_id: inviterId,
    p_count: 2,
    p_source: 'group_buy_reward',
  });

  if (spinError) {
    throw new Error(`Failed to add spin count to inviter: ${spinError.message}`);
  }

  // 步骤 5: 记录邀请奖励
  const { error: rewardError } = await supabase.from('invite_rewards').insert({
    inviter_id: inviterId,
    invitee_id: user_id,
    reward_type: 'first_group_buy',
    spin_count_awarded: 2,
    lucky_coins_awarded: 0,
    is_processed: true,
    processed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });

  if (rewardError) {
    throw new Error(`Failed to insert invite_reward: ${rewardError.message}`);
  }

  console.log(
    `[Worker] FIRST_GROUP_BUY completed: Awarded 2 spins to inviter ${inviterId} for user ${user_id}'s first group buy`,
  );
}

// ============================================================================
// 事件处理器：NOTIFICATION（中奖通知）
// ============================================================================

/**
 * 处理中奖通知事件
 *
 * 直接写入 notification_queue 表（与原 group-buy-squad v1 的逻辑完全一致）。
 * notification_queue 表中的记录会被通知发送器消费并发送。
 *
 * 幂等性: 通过 session_code 检查 notification_queue 防重复
 *
 * @param event - 队列事件，payload 包含通知的完整数据
 */
async function handleNotification(event: QueuedEvent): Promise<void> {
  const payload = event.payload as any;
  const { user_id, type, product_name, session_code, won_at, is_squad_buy } = payload;
  const supabase = createServiceClient();

  console.log(`[Worker] Processing NOTIFICATION: user=${user_id}, type=${type}`);

  const now = new Date();

  // 防重复: 检查是否已经为该 session 发送过通知
  const { data: existingNotification } = await supabase
    .from('notification_queue')
    .select('id')
    .eq('user_id', user_id)
    .eq('type', 'group_buy_win')
    .contains('payload', { session_code })
    .maybeSingle();

  if (existingNotification) {
    console.log(`[Worker] NOTIFICATION already exists for session_code=${session_code}, skipping`);
    return;
  }

  // 写入 notification_queue（与原 v1 代码完全一致）
  const { error } = await supabase.from('notification_queue').insert({
    user_id: user_id,
    type: 'group_buy_win',
    payload: {
      product_name,
      session_code,
      won_at,
      is_squad_buy,
    },
    phone_number: null,  // 由通知发送器查询用户的 phone_number
    notification_type: 'group_buy_win',
    title: '包团成功通知',
    message: '',
    data: {
      product_name,
      session_code,
      won_at: now.toISOString(),
      is_squad_buy,
    },
    status: 'pending',
    scheduled_at: now.toISOString(),
    created_at: now.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to insert notification: ${error.message}`);
  }

  console.log(`[Worker] NOTIFICATION completed: user=${user_id}, session_code=${session_code}`);
}

// ============================================================================
// 事件路由器
// ============================================================================

/**
 * 事件路由器：根据 event_type 将事件分发到对应的处理函数
 *
 * 每种事件类型对应一个独立的处理函数，处理函数内部包含完整的业务逻辑。
 * 如果遇到未知的事件类型，会抛出异常（最终进入死信队列）。
 *
 * @param event - 从 event_queue 中取出的事件
 * @throws 当事件类型未知或处理失败时抛出异常
 */
async function routeEvent(event: QueuedEvent): Promise<void> {
  switch (event.event_type) {
    case EventType.COMMISSION:
      await handleCommission(event);
      break;
    case EventType.AI_REWARD:
      await handleAiReward(event);
      break;
    case EventType.FIRST_GROUP_BUY:
      await handleFirstGroupBuy(event);
      break;
    case EventType.NOTIFICATION:
      await handleNotification(event);
      break;
    default:
      throw new Error(`Unknown event type: ${event.event_type}`);
  }
}

// ============================================================================
// 主处理函数
// ============================================================================

Deno.serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startTime = Date.now();
  const workerId = `worker-${startTime}-${Math.random().toString(36).substring(2, 8)}`;

  console.log(`[Worker] ${workerId} started`);

  try {
    const supabase = createServiceClient();

    // 步骤 1: 释放超时的锁（防止 Worker 崩溃导致事件卡住）
    const released = await releaseStaleEvents(supabase);
    if (released > 0) {
      console.log(`[Worker] Released ${released} stale locked events`);
    }

    // 步骤 2: 从队列中取出一批待处理事件
    const events = await dequeueEvents(supabase, 10, workerId);

    if (events.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No pending events' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[Worker] Dequeued ${events.length} events: ${events.map((e) => e.event_type).join(', ')}`);

    // 步骤 3: 逐个处理事件
    const results: Array<{ id: string; type: string; status: string; error?: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await routeEvent(event);
        await markEventCompleted(supabase, event.id);
        results.push({ id: event.id, type: event.event_type, status: 'completed' });
        succeeded++;
      } catch (err: unknown) {
    const errMsg = err instanceof Error ? errMsg : String(err);
        const errorMessage = err instanceof Error ? errMsg : String(err);
        console.error(`[Worker] Failed to process event ${event.id} (${event.event_type}): ${errorMessage}`);
        await markEventFailed(supabase, event.id, errorMessage);
        results.push({ id: event.id, type: event.event_type, status: 'failed', error: errorMessage });
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Worker] ${workerId} completed: processed=${events.length}, succeeded=${succeeded}, failed=${failed}, duration=${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        worker_id: workerId,
        processed: events.length,
        succeeded,
        failed,
        duration_ms: duration,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? errMsg : String(err);
    const errorMessage = err instanceof Error ? errMsg : String(err);
    console.error(`[Worker] ${workerId} fatal error: ${errorMessage}`);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
