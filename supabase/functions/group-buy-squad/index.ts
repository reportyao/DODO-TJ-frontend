/**
 * ============================================================================
 * 一键包团 Edge Function (group-buy-squad)
 * ============================================================================
 *
 * 功能概述:
 *   用户支付 groupSize 份的价格，系统自动创建机器人订单填满拼团，
 *   用户直接中奖，多余的份额以积分形式返还。
 *
 * 架构说明 (v2 - 异步解耦版):
 *   步骤 0-12: 核心交易逻辑（同步执行，必须全部成功）
 *     - 参数校验、商品查询、防重复、余额校验
 *     - 扣款（乐观锁）、创建流水、创建 Session、创建订单
 *     - 创建开奖结果、返还积分、更新库存
 *
 *   步骤 13: 异步事件入队（一次性写入 event_queue 表）
 *     - 推荐佣金事件 (COMMISSION) × N 个订单
 *     - AI 对话奖励事件 (AI_REWARD)
 *     - 首次拼团奖励事件 (FIRST_GROUP_BUY)
 *     - 中奖通知事件 (NOTIFICATION)
 *
 *   步骤 14: 返回成功结果
 *
 *   异步 Worker (process-squad-events) 会消费 event_queue 中的事件，
 *   调用对应的 Edge Function 完成实际处理。
 *
 * 变更历史:
 *   v1 (2026-01-xx): 初始版本，步骤 13-16 同步调用其他 Edge Functions
 *   v2 (2026-02-09): 解耦优化，步骤 13-16 改为写入事件队列异步处理
 *   v3 (2026-03-05): 资金安全修复
 *     - 修复: 佣金事件只为真实用户订单创建，不再为机器人订单创建（防止虚假佣金）
 *     - 修复: 创建 LUCKY_COIN 钱包时 currency 从 'LUCKY_COIN' 改为 'POINTS'（与 auth-telegram 统一）
 *
 * API 契约 (与 v1 完全一致，前端无需修改):
 *   请求: POST { product_id: string, user_id: string }
 *   成功响应: { success: true, data: { session_id, session_code, order_id, ... } }
 *   失败响应: { success: false, error: string }
 * ============================================================================
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  enqueueEvents,
  EventType,
  generateIdempotencyKey,
} from '../_shared/eventQueue.ts';
import type { EnqueueEventParams } from '../_shared/eventQueue.ts';

// ============================================================================
// 环境变量和全局配置
// ============================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

// CORS headers（与 group-buy-join 保持一致）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// ============================================================================
// 工具函数
// ============================================================================

/** 创建带 CORS headers 的 JSON 响应 */
function createResponse(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/** 生成唯一订单号（SB 前缀 = Squad Buy，区分于普通拼团的 GB 前缀） */
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SB${timestamp}${random}`;
}

/** 生成 6 位会话码（与 group-buy-join 保持一致） */
function generateSessionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ============================================================================
// 机器人账号配置
// 在 users 表中需要预先创建这些机器人账号
// ============================================================================
const BOT_TELEGRAM_IDS = ['bot_squad_1', 'bot_squad_2'];

/**
 * 获取或创建机器人账号
 * 如果机器人账号不存在，自动创建
 */
async function ensureBotAccounts(supabase: any): Promise<string[]> {
  const botUUIDs: string[] = [];

  for (const botTelegramId of BOT_TELEGRAM_IDS) {
    // 先查找是否已存在
    let { data: botUser } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', botTelegramId)
      .single();

    if (!botUser) {
      // 创建机器人账号
      // 注意：users表的必填字段：telegram_id, referral_code, updated_at
      const botReferralCode = `BOT${botTelegramId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
      const { data: newBot, error: createError } = await supabase
        .from('users')
        .insert({
          telegram_id: botTelegramId,
          telegram_username: botTelegramId,
          first_name: 'Lucky',
          last_name: 'User',
          referral_code: botReferralCode,
          language_code: 'zh',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createError) {
        console.error(`Failed to create bot account ${botTelegramId}:`, createError);
        throw new Error(`Failed to create bot account: ${createError.message}`);
      }
      botUser = newBot;
      console.log(`[SquadBuy] Created bot account: ${botTelegramId} -> ${botUser.id}`);
    }

    botUUIDs.push(botUser.id);
  }

  return botUUIDs;
}

// ============================================================================
// 主请求处理
// ============================================================================

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { product_id, user_id } = await req.json();

    // ============================================
    // 步骤 0: 参数校验
    // ============================================
    if (!product_id || !user_id) {
      return createResponse({ success: false, error: 'Product ID and User ID are required' }, 400);
    }

    console.log(`[SquadBuy] Starting squad buy: product=${product_id}, user=${user_id}`);

    // ============================================
    // 步骤 1-2-4: 并行查询商品、用户、钱包信息
    // ============================================
    // 【二次优化】将三个独立的数据库查询并行执行，节省 ~100ms 响应时间。
    // 安全性说明:
    //   - 这三个查询都是纯读操作，不涉及任何写入
    //   - 商品查询只依赖 product_id（请求参数）
    //   - 用户查询只依赖 user_id（请求参数）
    //   - 钱包查询只依赖 user_id（请求参数）
    //   - 三者之间没有数据依赖关系，可以安全并行
    // ============================================
    const [productResult, userResult, walletResult] = await Promise.all([
      // 查询商品信息
      supabase
        .from('group_buy_products')
        .select('*')
        .eq('id', product_id)
        .in('status', ['ACTIVE', 'active'])
        .single(),
      // 查询用户信息
      supabase
        .from('users')
        .select('id, telegram_id')
        .eq('id', user_id)
        .single(),
      // 查询 TJS 钱包
      supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user_id)
        .eq('type', 'TJS')
        .single(),
    ]);

    // --- 校验商品 ---
    const { data: product, error: productError } = productResult;
    if (productError || !product) {
      console.error('Product query error:', productError);
      return createResponse({ success: false, error: 'Product not found or inactive' }, 404);
    }

    // 兼容不同的字段名（与 group-buy-join 保持一致）
    const stockQuantity = product.stock ?? product.stock_quantity ?? 0;
    const soldQuantity = product.sold_quantity ?? 0;
    const pricePerPerson = Number(product.price_per_person) || Number(product.group_price) || 0;
    const timeoutHours = product.timeout_hours ?? product.duration_hours ?? 24;
    const groupSize = product.group_size ?? product.max_participants ?? 3;
    const productTitle = product.title ?? product.name_i18n ?? { zh: product.name };

    if (stockQuantity <= soldQuantity) {
      return createResponse({ success: false, error: 'out_of_stock' }, 400);
    }
    if (pricePerPerson <= 0) {
      return createResponse({ success: false, error: 'Invalid product price' }, 400);
    }

    const totalCost = pricePerPerson * groupSize; // 包团总价
    const refundPoints = pricePerPerson * (groupSize - 1); // 退还积分

    console.log(`[SquadBuy] Product: price=${pricePerPerson}, groupSize=${groupSize}, total=${totalCost}, refund=${refundPoints}`);

    // --- 校验用户 ---
    const { data: user, error: userError } = userResult;
    if (userError || !user) {
      console.error('User query error:', userError, 'user_id:', user_id);
      return createResponse({ success: false, error: 'User not found' }, 404);
    }

    // --- 校验钱包 ---
    const { data: tjsWallet, error: walletError } = walletResult;
    if (walletError || !tjsWallet) {
      console.error('Wallet query error:', walletError, 'user_id:', user_id);
      return createResponse({ success: false, error: 'Wallet not found' }, 404);
    }

    const availableBalance = Number(tjsWallet.balance) - Number(tjsWallet.frozen_balance || 0);
    if (availableBalance < totalCost) {
      return createResponse({
        success: false,
        error: 'insufficient_balance',
        required: totalCost,
        current: availableBalance,
      }, 400);
    }

    // ============================================
    // 步骤 3: 检查用户是否已在进行中的session中（防重复）
    // 【修复】同时检查UUID和telegram_id，兼容历史数据
    // 注意: 此查询依赖步骤 2 的 user.telegram_id，因此必须在并行查询之后执行
    // ============================================
    const { data: activeOrders } = await supabase
      .from('group_buy_orders')
      .select('id, session_id, group_buy_sessions!inner(status)')
      .or(`user_id.eq.${user.id},user_id.eq.${user.telegram_id}`)
      .eq('group_buy_sessions.product_id', product_id)
      .in('group_buy_sessions.status', ['ACTIVE', 'active']);

    if (activeOrders && activeOrders.length > 0) {
      return createResponse({ success: false, error: 'already_in_active_session' }, 400);
    }

    // ============================================
    // 步骤 5: 确保机器人账号存在
    // ============================================
    const botUUIDs = await ensureBotAccounts(supabase);
    // 只取 groupSize - 1 个机器人
    const requiredBots = botUUIDs.slice(0, groupSize - 1);

    if (requiredBots.length < groupSize - 1) {
      console.error(`[SquadBuy] Not enough bot accounts: need ${groupSize - 1}, got ${requiredBots.length}`);
      return createResponse({ success: false, error: 'System configuration error' }, 500);
    }

    console.log(`[SquadBuy] Bot accounts ready: ${requiredBots.join(', ')}`);

    // ============================================
    // 步骤 6: 扣款（使用乐观锁，与 group-buy-join 一致）
    // ============================================
    const newBalance = Number(tjsWallet.balance) - totalCost;
    const { error: updateWalletError, data: updatedWallet } = await supabase
      .from('wallets')
      .update({
        balance: newBalance,
        updated_at: new Date().toISOString(),
        version: tjsWallet.version + 1,
      })
      .eq('id', tjsWallet.id)
      .eq('version', tjsWallet.version) // 乐观锁
      .select()
      .single();

    if (updateWalletError || !updatedWallet) {
      console.error('Failed to update wallet:', updateWalletError);
      return createResponse({
        success: false,
        error: 'Failed to deduct balance, please try again (concurrent modification detected)',
      }, 500);
    }

    console.log(`[SquadBuy] Deducted ${totalCost} TJS from wallet. New balance: ${newBalance}`);

    // ============================================
    // 步骤 7: 创建支出流水记录
    // ============================================
    await supabase
      .from('wallet_transactions')
      .insert({
        wallet_id: tjsWallet.id,
        type: 'GROUP_BUY_PURCHASE',
        amount: -totalCost,
        balance_before: Number(tjsWallet.balance),
        balance_after: newBalance,
        status: 'COMPLETED',
        description: `一键包团 - ${productTitle?.zh || productTitle?.en || 'Squad Buy'}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    // ============================================
    // 步骤 8: 创建拼团会话（直接设为 SUCCESS）
    // ============================================
    const sessionCode = generateSessionCode();
    const now = new Date();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + timeoutHours);

    const { data: newSession, error: createSessionError } = await supabase
      .from('group_buy_sessions')
      .insert({
        product_id: product.id,
        session_code: sessionCode,
        status: 'SUCCESS',
        current_participants: groupSize,
        group_size: groupSize,
        max_participants: groupSize,
        required_participants: groupSize,
        initiator_id: user.id,
        winner_id: user.id, // 包团用户就是中奖者
        started_at: now.toISOString(),
        completed_at: now.toISOString(),
        drawn_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        winning_timestamp_sum: (BigInt(Date.now()) * BigInt(groupSize)).toString(),
        updated_at: now.toISOString(),
      })
      .select()
      .single();

    if (createSessionError) {
      console.error('Failed to create session:', createSessionError);
      // 回滚钱包余额
      await supabase
        .from('wallets')
        .update({
          balance: Number(tjsWallet.balance),
          version: tjsWallet.version + 2,
        })
        .eq('id', tjsWallet.id);
      return createResponse({ success: false, error: 'Failed to create session: ' + createSessionError.message }, 500);
    }

    console.log(`[SquadBuy] Session created: ${newSession.id} (code: ${sessionCode})`);

    // ============================================
    // 步骤 9: 创建订单（1个真实 + N-1个机器人）
    // ============================================
    const orderTimestamp = Date.now();

    // 9.1 创建用户的真实订单（状态为 WON）
    const userOrderNumber = generateOrderNumber();
    const { data: userOrder, error: userOrderError } = await supabase
      .from('group_buy_orders')
      .insert({
        session_id: newSession.id,
        user_id: user.id,
        product_id: product.id,
        order_number: userOrderNumber,
        order_timestamp: orderTimestamp,
        amount: pricePerPerson,
        status: 'WON',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select()
      .single();

    if (userOrderError) {
      console.error('Failed to create user order:', userOrderError);
      // 回滚：删除session，恢复钱包
      await supabase.from('group_buy_sessions').delete().eq('id', newSession.id);
      await supabase
        .from('wallets')
        .update({ balance: Number(tjsWallet.balance), version: tjsWallet.version + 2 })
        .eq('id', tjsWallet.id);
      return createResponse({ success: false, error: 'Failed to create order: ' + userOrderError.message }, 500);
    }

    console.log(`[SquadBuy] User order created: ${userOrder.id} (${userOrderNumber})`);

    // 9.2 创建机器人订单（状态为 REFUNDED）
    const botOrders = [];
    for (let i = 0; i < requiredBots.length; i++) {
      const botOrderNumber = generateOrderNumber();
      const botTimestamp = orderTimestamp + i + 1; // 稍微错开时间戳

      const { data: botOrder, error: botOrderError } = await supabase
        .from('group_buy_orders')
        .insert({
          session_id: newSession.id,
          user_id: requiredBots[i],
          product_id: product.id,
          order_number: botOrderNumber,
          order_timestamp: botTimestamp,
          amount: pricePerPerson,
          status: 'REFUNDED', // 机器人订单直接标记为已退款
          refund_lucky_coins: pricePerPerson,
          refunded_at: now.toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .select()
        .single();

      if (botOrderError) {
        console.error(`Failed to create bot order ${i}:`, botOrderError);
        // 继续创建其他机器人订单，不中断流程
      } else {
        botOrders.push(botOrder);
        console.log(`[SquadBuy] Bot order ${i + 1} created: ${botOrder.id} (${botOrderNumber})`);
      }
    }

    // ============================================
    // 步骤 10: 创建开奖结果记录
    // ============================================
    const claimExpiresAt = new Date();
    claimExpiresAt.setDate(claimExpiresAt.getDate() + 30);

    const timestampSum = BigInt(orderTimestamp) * BigInt(groupSize);
    const allOrders = [userOrder, ...botOrders];

    const { data: result, error: resultError } = await supabase
      .from('group_buy_results')
      .insert({
        session_id: newSession.id,
        product_id: product.id,
        user_id: user.id, // 中奖者UUID
        winner_id: user.id, // 中奖者UUID（与 group-buy-draw 一致）
        winner_order_id: userOrder.id,
        total_participants: groupSize,
        timestamp_sum: timestampSum.toString(),
        winning_index: 0, // 用户是第一个，索引为0
        pickup_status: 'PENDING_CLAIM',
        status: 'PENDING',
        expires_at: claimExpiresAt.toISOString(),
        algorithm_data: {
          type: 'squad_buy', // 标记为包团类型
          orders: allOrders.map((o, idx) => ({
            user_id: o.user_id,
            order_number: o.order_number,
            timestamp: o.order_timestamp || orderTimestamp + idx,
            is_bot: idx > 0,
          })),
          calculation: {
            timestamp_sum: timestampSum.toString(),
            total_participants: groupSize,
            winning_index: 0,
            formula: 'squad_buy - winner is always the buyer',
          },
        },
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select()
      .single();

    if (resultError) {
      console.error('Failed to create result:', resultError);
      // 不中断流程，但记录错误
    } else {
      console.log(`[SquadBuy] Result created: ${result?.id}`);
    }

    // ============================================
    // 步骤 11: 返还积分到 LUCKY_COIN 钱包
    // ============================================
    try {
      // 获取或创建 LUCKY_COIN 钱包
      let { data: lcWallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user_id)
        .eq('type', 'LUCKY_COIN')
        .single();

      if (!lcWallet) {
        // 创建 LUCKY_COIN 钱包
        // 【重要】currency 必须为 'POINTS'，与 auth-telegram 创建钱包时保持一致
        // 数据库中钱包类型标准:
        //   - 现金钱包: type='TJS', currency='TJS'
        //   - 积分钱包: type='LUCKY_COIN', currency='POINTS'
        const { data: newLcWallet, error: createLcError } = await supabase
          .from('wallets')
          .insert({
            user_id: user_id,
            type: 'LUCKY_COIN',
            currency: 'POINTS',  // 修复: 从 'LUCKY_COIN' 改为 'POINTS'，与 auth-telegram 统一
            balance: 0,
            version: 1,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .select()
          .single();

        if (createLcError) {
          console.error('Failed to create LUCKY_COIN wallet:', createLcError);
        } else {
          lcWallet = newLcWallet;
        }
      }

      if (lcWallet) {
        const newLcBalance = Number(lcWallet.balance) + refundPoints;
        const { error: updateLcError } = await supabase
          .from('wallets')
          .update({
            balance: newLcBalance,
            updated_at: now.toISOString(),
            version: lcWallet.version + 1,
          })
          .eq('id', lcWallet.id)
          .eq('version', lcWallet.version);

        if (updateLcError) {
          console.error('Failed to update LUCKY_COIN wallet:', updateLcError);
        } else {
          // 创建积分流水记录
          await supabase
            .from('wallet_transactions')
            .insert({
              wallet_id: lcWallet.id,
              type: 'GROUP_BUY_REFUND',
              amount: refundPoints,
              balance_before: Number(lcWallet.balance),
              balance_after: newLcBalance,
              status: 'COMPLETED',
              description: `一键包团积分返还 - ${productTitle?.zh || 'Squad Buy'}`,
              reference_id: userOrder.id,
              processed_at: now.toISOString(),
              created_at: now.toISOString(),
            });

          console.log(`[SquadBuy] Refunded ${refundPoints} LUCKY_COIN to user`);
        }
      }
    } catch (lcError) {
      console.error('[SquadBuy] Failed to process LUCKY_COIN refund:', lcError);
      // 积分返还失败不影响主流程
    }

    // ============================================
    // 步骤 12: 更新库存（调用 increment_sold_quantity RPC）
    // ============================================
    let stockUpdateSuccess = false;
    for (let stockRetry = 0; stockRetry < 3; stockRetry++) {
      try {
        const { error: incrementError } = await supabase.rpc('increment_sold_quantity', {
          product_id: product.id,
          amount: 1,
        });

        if (incrementError) {
          console.error(`[SquadBuy] Failed to increment sold_quantity (attempt ${stockRetry + 1}/3):`, incrementError);
        } else {
          stockUpdateSuccess = true;
          console.log(`[SquadBuy] Incremented sold_quantity for product ${product.id}`);
          break;
        }
      } catch (stockError) {
        console.error(`[SquadBuy] increment_sold_quantity exception (attempt ${stockRetry + 1}/3):`, stockError);
      }

      // 短暂等待后重试
      if (stockRetry < 2) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!stockUpdateSuccess) {
      console.error(`[SquadBuy] ⚠️ CRITICAL: Failed to update stock for product ${product.id} after 3 retries. Session: ${newSession.id}. Manual intervention required.`);
      // 不中断流程（订单和session已创建），但记录严重错误
    }

    // ============================================
    // 步骤 13: 将非核心业务逻辑写入事件队列（异步处理）
    // ============================================
    // 【解耦优化 v2】
    // 原步骤 13-16 的同步调用已替换为事件队列写入。
    // 这些事件将由 process-squad-events Worker 异步消费处理。
    //
    // 优势:
    //   1. 主请求响应时间从 3-8 秒降至 1-2 秒
    //   2. 失败的事件可以自动重试（最多 3 次，指数退避）
    //   3. 超过重试次数的事件进入死信队列，可人工排查
    //   4. 通过 idempotency_key 确保不会重复处理
    //
    // 注意:
    //   - 佣金、AI 奖励、首次拼团奖励的到账会有 1-30 秒延迟
    //   - 这些步骤在 v1 中就已经用 try-catch 包裹，失败不影响主流程
    //   - 解耦后的行为与 v1 完全一致，只是执行时机从同步变为异步
    // ============================================
    try {
      const events: EnqueueEventParams[] = [];
      const sessionId = newSession.id;

      // ----------------------------------------
      // 13.1 推荐佣金事件 (COMMISSION)
      // 原逻辑: 先查询用户是否有推荐人，如果有则为每个订单调用 handle-purchase-commission
      // 现逻辑: 只为真实用户订单写入 COMMISSION 事件，Worker 处理时会检查推荐关系
      // 幂等性: 由 handle-purchase-commission 内部的防重复检查保证
      //         (检查 commissions 表中是否已存在 order_id + user_id + level 的记录)
      //
      // 【重要修复 v3】只为真实用户订单（userOrder）创建佣金事件
      // 机器人订单（botOrders）不应产生佣金，因为:
      //   1. 机器人没有真实付款，它们的订单状态直接是 REFUNDED
      //   2. 用户实际只付了 totalCost（groupSize 份），但佣金应该只基于 1 份真实订单
      //   3. 如果为 N 个机器人订单也创建佣金，会导致推荐人获得 N 倍虚假佣金
      // ----------------------------------------
      events.push({
        event_type: EventType.COMMISSION,
        source: 'group-buy-squad',
        payload: {
          order_id: userOrder.id,  // 修复: 只使用真实用户订单，不包含机器人订单
          user_id: user.id,
          order_amount: pricePerPerson,
        },
        idempotency_key: generateIdempotencyKey('squad', EventType.COMMISSION, userOrder.id),
        session_id: sessionId,
        user_id: user.id,
      });

      // ----------------------------------------
      // 13.2 AI 对话奖励事件 (AI_REWARD)
      // 原逻辑: 循环 groupSize 次，每次调用 ai-add-bonus 增加 10 次配额
      // 现逻辑: 合并为一个事件，total_amount = groupSize * 10
      //         Worker 处理时一次性调用 ai-add-bonus
      // 幂等性: 由 idempotency_key 保证同一 session 不会重复发放
      // ----------------------------------------
      events.push({
        event_type: EventType.AI_REWARD,
        source: 'group-buy-squad',
        payload: {
          user_id: user.id,
          amount: groupSize * 10, // 合并为一次调用，总量 = groupSize × 10
          reason: 'group_buy_participation',
        },
        idempotency_key: generateIdempotencyKey('squad', EventType.AI_REWARD, sessionId),
        session_id: sessionId,
        user_id: user.id,
      });

      // ----------------------------------------
      // 13.3 首次拼团奖励事件 (FIRST_GROUP_BUY)
      // 原逻辑: 调用 handle-first-group-buy-reward，给邀请人增加 2 次抽奖机会
      // 现逻辑: 写入一个事件，Worker 处理时调用 handle-first-group-buy-reward
      // 幂等性: 由 handle-first-group-buy-reward 内部的 invite_rewards 表防重复保证
      // ----------------------------------------
      events.push({
        event_type: EventType.FIRST_GROUP_BUY,
        source: 'group-buy-squad',
        payload: {
          user_id: user.id,
          order_id: userOrder.id,
        },
        idempotency_key: generateIdempotencyKey('squad', EventType.FIRST_GROUP_BUY, sessionId),
        session_id: sessionId,
        user_id: user.id,
      });

      // ----------------------------------------
      // 13.4 中奖通知事件 (NOTIFICATION)
      // 原逻辑: 直接写入 notification_queue 表
      // 现逻辑: 写入事件队列，Worker 处理时写入 notification_queue 表
      // 幂等性: 由 idempotency_key 保证同一 session 不会重复通知
      // ----------------------------------------
      const productName = productTitle?.zh || productTitle?.en || 'Unknown Product';
      events.push({
        event_type: EventType.NOTIFICATION,
        source: 'group-buy-squad',
        payload: {
          user_id: user.id,
          type: 'group_buy_win',
          product_name: productName,
          session_code: sessionCode,
          won_at: now.toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' }),
          is_squad_buy: true,
        },
        idempotency_key: generateIdempotencyKey('squad', EventType.NOTIFICATION, sessionId),
        session_id: sessionId,
        user_id: user.id,
      });

      // ----------------------------------------
      // 批量写入事件队列
      // 使用 enqueueEvents 一次性写入所有事件，减少数据库往返
      // ----------------------------------------
      const enqueueResult = await enqueueEvents(supabase, events);

      if (enqueueResult.success) {
        console.log(`[SquadBuy] ✅ Enqueued ${enqueueResult.enqueued} async events for session ${sessionId}`);
      } else {
        // 事件入队失败不影响主流程（与 v1 中 try-catch 的行为一致）
        // 但需要记录错误，便于排查
        console.error(`[SquadBuy] ⚠️ Failed to enqueue some events:`, enqueueResult.errors);
      }
    } catch (enqueueError) {
      // 事件入队的整体异常处理
      // 即使全部入队失败，主流程（扣款、创建订单、返还积分）已经完成
      // 这些异步事件可以后续通过人工方式补偿
      console.error('[SquadBuy] ⚠️ Event queue write failed:', enqueueError);
    }

    // ============================================
    // 步骤 14: 返回成功结果
    // ============================================
    // 【重要】响应格式与 v1 完全一致，前端无需任何修改
    console.log(`[SquadBuy] ✅ Squad buy completed successfully! Session: ${newSession.id}`);

    return createResponse({
      success: true,
      data: {
        session_id: newSession.id,
        session_code: sessionCode,
        order_id: userOrder.id,
        order_number: userOrderNumber,
        total_paid: totalCost,
        refund_points: refundPoints,
        result_id: result?.id,
      },
    });
  } catch (error) {
    console.error('[SquadBuy] Unexpected error:', error);
    return createResponse({ success: false, error: error.message }, 500);
  }
});
