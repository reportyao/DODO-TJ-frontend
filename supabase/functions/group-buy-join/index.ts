/**
 * ============================================================================
 * 普通参团 Edge Function (group-buy-join)
 * ============================================================================
 *
 * 功能概述:
 *   用户参与拼团，支付一份价格加入现有或新建的拼团会话。
 *   当会话人数满员时，自动触发开奖。
 *
 * 架构说明 (v2 - 异步解耦版):
 *   步骤 1-3: 并行查询商品、用户、钱包信息（纯读操作，安全并行）
 *   步骤 4-5: 查找或创建拼团会话
 *   步骤 6-9: 核心交易逻辑（扣款、创建流水、创建订单、更新参与人数）
 *   步骤 10:  检查是否满员并触发开奖（同步，因为前端需要 draw_result）
 *   步骤 11:  异步事件入队（写入 event_queue 表）
 *     - 推荐佣金事件 (COMMISSION)
 *     - AI 对话奖励事件 (AI_REWARD)
 *     - 首次拼团奖励事件 (FIRST_GROUP_BUY)
 *   步骤 12:  返回成功结果
 *
 * 变更历史:
 *   v1 (2026-01-xx): 初始版本，步骤 11-13 同步调用其他 Edge Functions
 *   v2 (2026-02-09): 解耦优化 + 并行查询
 *     - 步骤 1-3 并行化（节省 ~100ms）
 *     - 步骤 11-13 改为写入事件队列异步处理（节省 ~1-3s）
 *
 * API 契约 (与 v1 完全一致，前端无需修改):
 *   请求: POST { product_id, user_id, session_id?, session_code? }
 *   成功响应: { success: true, data: { order_id, session_id, ... } }
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

// CORS headers（与 group-buy-squad 保持一致）
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

/** 生成唯一订单号（GB 前缀 = Group Buy，区分于包团的 SB 前缀） */
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `GB${timestamp}${random}`;
}

/** 生成 6 位会话码（与 group-buy-squad 保持一致） */
function generateSessionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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
    const { product_id, session_id, session_code, user_id } = await req.json();

    // ============================================
    // 步骤 0: 参数校验
    // ============================================
    if (!product_id || !user_id) {
      return createResponse({ success: false, error: 'Product ID and User ID are required' }, 400);
    }

    console.log(`[GroupBuyJoin] Starting: product=${product_id}, user=${user_id}, session=${session_id || session_code || 'new'}`);

    // ============================================
    // 步骤 1-2-3: 并行查询商品、用户、钱包信息
    // ============================================
    // 【优化】将三个独立的数据库查询并行执行，节省 ~100ms 响应时间。
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

    // 兼容不同的字段名（与 group-buy-squad 保持一致）
    const stockQuantity = product.stock ?? product.stock_quantity ?? 0;
    const soldQuantity = product.sold_quantity ?? 0;
    const pricePerPerson = Number(product.price_per_person) || Number(product.group_price) || 0;
    const timeoutHours = product.timeout_hours ?? product.duration_hours ?? 24;
    const groupSize = product.group_size ?? product.max_participants ?? 3;
    const productTitle = product.title ?? product.name_i18n ?? { zh: product.name };

    if (stockQuantity <= soldQuantity) {
      return createResponse({ success: false, error: 'Product out of stock' }, 400);
    }

    // 【修复】验证价格必须大于 0
    if (!pricePerPerson || pricePerPerson <= 0) {
      return createResponse({ success: false, error: 'Product price configuration error' }, 400);
    }

    // --- 校验用户 ---
    const { data: user, error: userError } = userResult;
    if (userError || !user) {
      console.error('User query error:', userError, 'user_id:', user_id);
      return createResponse({ success: false, error: 'User not found' }, 404);
    }

    // --- 校验钱包 ---
    const { data: wallet, error: walletError } = walletResult;
    if (walletError || !wallet) {
      console.error('Wallet query error:', walletError, 'user_id:', user_id);
      return createResponse({ success: false, error: 'Wallet not found' }, 404);
    }

    const availableBalance = Number(wallet.balance) - Number(wallet.frozen_balance || 0);
    if (availableBalance < pricePerPerson) {
      return createResponse({ 
        success: false, 
        error: 'Insufficient balance',
        required: pricePerPerson,
        current: availableBalance
      }, 400);
    }

    // ============================================
    // 步骤 4: 查找或创建拼团会话
    // ============================================
    let targetSession = null;

    if (session_id || session_code) {
      // 4a. 加入现有会话
      let sessionQuery = supabase
        .from('group_buy_sessions')
        .select('*')
        .in('status', ['ACTIVE', 'active'])
        .gt('expires_at', new Date().toISOString());
      
      if (session_id) {
        sessionQuery = sessionQuery.eq('id', session_id);
      } else if (session_code) {
        sessionQuery = sessionQuery.eq('session_code', session_code);
      }
      
      const { data: existingSession, error: sessionError } = await sessionQuery.single();

      if (sessionError || !existingSession) {
        return createResponse({ success: false, error: 'Session not found or expired' }, 404);
      }

      // 兼容不同的字段名
      const maxParticipants = existingSession.max_participants ?? existingSession.required_participants ?? groupSize;

      // 检查会话是否已满
      if (existingSession.current_participants >= maxParticipants) {
        return createResponse({ success: false, error: 'Session is full' }, 400);
      }

      // 检查用户是否已加入此会话
      // 【修复】同时检查UUID和telegram_id，兼容历史数据和新数据
      const { data: existingOrders } = await supabase
        .from('group_buy_orders')
        .select('id')
        .eq('session_id', existingSession.id)
        .or(`user_id.eq.${user.id},user_id.eq.${user.telegram_id}`);

      if (existingOrders && existingOrders.length > 0) {
        return createResponse({ success: false, error: 'You have already joined this session' }, 400);
      }

      targetSession = existingSession;
    } else {
      // 4b. 创建新会话
      const newSessionCode = generateSessionCode();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + timeoutHours);

      const { data: newSession, error: createSessionError } = await supabase
        .from('group_buy_sessions')
        .insert({
          product_id: product.id,
          session_code: newSessionCode,
          status: 'ACTIVE',
          current_participants: 0,
          group_size: groupSize,
          max_participants: groupSize,
          required_participants: groupSize,
          initiator_id: user.id,
          started_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (createSessionError) {
        console.error('Failed to create session:', createSessionError);
        return createResponse({ success: false, error: 'Failed to create session: ' + createSessionError.message }, 500);
      }

      targetSession = newSession;
    }

    // ============================================
    // 步骤 5: 生成订单号
    // ============================================
    const orderNumber = generateOrderNumber();

    // ============================================
    // 步骤 6: 扣款（使用乐观锁，与 group-buy-squad 一致）
    // ============================================
    const newBalance = Number(wallet.balance) - pricePerPerson;
    const { error: updateWalletError, data: updatedWallet } = await supabase
      .from('wallets')
      .update({ 
        balance: newBalance,
        updated_at: new Date().toISOString(),
        version: wallet.version + 1
      })
      .eq('id', wallet.id)
      .eq('version', wallet.version) // 乐观锁
      .select()
      .single();

    if (updateWalletError || !updatedWallet) {
      console.error('Failed to update wallet:', updateWalletError);
      return createResponse({ success: false, error: 'Failed to deduct balance, please try again (concurrent modification detected)' }, 500);
    }

    // ============================================
    // 步骤 7: 创建支出流水记录
    // ============================================
    await supabase
      .from('wallet_transactions')
      .insert({
        wallet_id: wallet.id,
        type: 'GROUP_BUY_PURCHASE',
        amount: -pricePerPerson,
        balance_before: Number(wallet.balance),
        balance_after: newBalance,
        status: 'COMPLETED',
        description: `拼团参与 - ${productTitle?.zh || productTitle?.en || '拼团参与'}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    // ============================================
    // 步骤 8: 创建订单
    // ============================================
    const { data: order, error: createOrderError } = await supabase
      .from('group_buy_orders')
      .insert({
        session_id: targetSession.id,
        user_id: user.id, // 使用 UUID，已删除外键约束
        product_id: product.id,
        order_number: orderNumber,
        order_timestamp: Date.now(),
        amount: pricePerPerson,
        status: 'PAID',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createOrderError) {
      console.error('Failed to create order:', createOrderError);
      // 【P1 修复】使用 RPC 原子操作回滚钱包余额
      // 旧代码使用 balance: Number(wallet.balance) 快照值回滚，存在并发覆盖风险
      // 新代码使用 balance = balance + amount 原子操作，安全可靠
      try {
        const { data: revertResult, error: revertError } = await supabase.rpc('revert_wallet_deduction', {
          p_wallet_id: wallet.id,
          p_amount: pricePerPerson,
          p_description: '拼团订单创建失败，退回扣款 - ' + (createOrderError.message || 'unknown error'),
        });
        if (revertError) {
          console.error('[GroupBuyJoin] CRITICAL: Failed to revert wallet deduction via RPC:', revertError);
        } else if (revertResult && !revertResult.success) {
          console.error('[GroupBuyJoin] CRITICAL: Revert RPC returned failure:', revertResult.error);
        } else {
          console.log('[GroupBuyJoin] Wallet deduction reverted successfully via RPC');
        }
      } catch (revertEx: unknown) {
        console.error('[GroupBuyJoin] CRITICAL: Exception during wallet revert:', revertEx);
      }
      return createResponse({ success: false, error: 'Failed to create order: ' + createOrderError.message }, 500);
    }

    // ============================================
    // 步骤 9: 更新会话参与人数
    // ============================================
    const maxParticipants = targetSession.max_participants ?? targetSession.required_participants ?? groupSize;
    const newParticipantCount = targetSession.current_participants + 1;
    const { error: updateSessionError } = await supabase
      .from('group_buy_sessions')
      .update({ 
        current_participants: newParticipantCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', targetSession.id);

    if (updateSessionError) {
      console.error('Failed to update session:', updateSessionError);
    }

    // ============================================
    // 步骤 10: 检查是否满员并触发开奖
    // ============================================
    // 注意: 开奖必须同步执行，因为前端需要 draw_result 来展示结果
    let drawResult = null;
    if (newParticipantCount >= maxParticipants) {
      try {
        const drawResponse = await supabase.functions.invoke('group-buy-draw', {
          body: { session_id: targetSession.id }
        });
        
        if (drawResponse.data?.success) {
          drawResult = drawResponse.data;
        }
      } catch (drawError: unknown) {
        console.error('Failed to trigger draw:', drawError);
        // 开奖失败不中断流程，会由超时检查或手动触发处理
      }
    }

    // ============================================
    // 步骤 11: 将非核心业务逻辑写入事件队列（异步处理）
    // ============================================
    // 【解耦优化 v2】
    // 原步骤 11-13 的同步调用已替换为事件队列写入。
    // 这些事件将由 process-squad-events Worker 异步消费处理。
    //
    // 优势:
    //   1. 主请求响应时间减少 ~1-3 秒
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
      const orderId = order.id;
      const sessionId = targetSession.id;

      // ----------------------------------------
      // 11.1 推荐佣金事件 (COMMISSION)
      // 原逻辑: 先查询 referred_by_id，如果有推荐人则调用 handle-purchase-commission
      // 现逻辑: 直接写入 COMMISSION 事件，Worker 调用 handle-purchase-commission 时
      //         该函数内部会自行检查推荐关系，无推荐人时自动跳过
      // 幂等性: 由 handle-purchase-commission 内部的防重复检查保证
      //         (检查 commissions 表中是否已存在 order_id + user_id + level 的记录)
      // ----------------------------------------
      events.push({
        event_type: EventType.COMMISSION,
        source: 'group-buy-join',
        payload: {
          order_id: orderId,
          user_id: user.id,
          order_amount: pricePerPerson,
        },
        idempotency_key: generateIdempotencyKey('join', EventType.COMMISSION, orderId),
        session_id: sessionId,
        user_id: user.id,
      });

      // ----------------------------------------
      // 11.2 AI 对话奖励事件 (AI_REWARD)
      // 原逻辑: 调用 ai-add-bonus，增加 10 次 AI 对话配额
      // 现逻辑: 写入一个事件，Worker 处理时调用 ai-add-bonus
      // 幂等性: 由 idempotency_key 保证同一订单不会重复发放
      // ----------------------------------------
      events.push({
        event_type: EventType.AI_REWARD,
        source: 'group-buy-join',
        payload: {
          user_id: user.id,
          amount: 10,
          reason: 'group_buy_participation',
        },
        idempotency_key: generateIdempotencyKey('join', EventType.AI_REWARD, orderId),
        session_id: sessionId,
        user_id: user.id,
      });

      // ----------------------------------------
      // 11.3 首次拼团奖励事件 (FIRST_GROUP_BUY)
      // 原逻辑: 调用 handle-first-group-buy-reward，给邀请人增加 2 次抽奖机会
      // 现逻辑: 写入一个事件，Worker 处理时调用 handle-first-group-buy-reward
      // 幂等性: 由 handle-first-group-buy-reward 内部的 invite_rewards 表防重复保证
      // ----------------------------------------
      events.push({
        event_type: EventType.FIRST_GROUP_BUY,
        source: 'group-buy-join',
        payload: {
          user_id: user.id,
          order_id: orderId,
        },
        idempotency_key: generateIdempotencyKey('join', EventType.FIRST_GROUP_BUY, orderId),
        session_id: sessionId,
        user_id: user.id,
      });

      // ----------------------------------------
      // 批量写入事件队列
      // 使用 enqueueEvents 一次性写入所有事件，减少数据库往返
      // ----------------------------------------
      const enqueueResult = await enqueueEvents(supabase, events);

      if (enqueueResult.success) {
        console.log(`[GroupBuyJoin] ✅ Enqueued ${enqueueResult.enqueued} async events for order ${orderId}`);
      } else {
        // 事件入队失败不影响主流程（与 v1 中 try-catch 的行为一致）
        console.error(`[GroupBuyJoin] ⚠️ Failed to enqueue some events:`, enqueueResult.errors);
      }
    } catch (enqueueError: unknown) {
      // 事件入队的整体异常处理
      // 即使全部入队失败，主流程（扣款、创建订单）已经完成
      // 这些异步事件可以后续通过人工方式补偿
      console.error('[GroupBuyJoin] ⚠️ Event queue write failed:', enqueueError);
    }

    // ============================================
    // 步骤 12: 返回成功结果
    // ============================================
    // 【重要】响应格式与 v1 完全一致，前端无需任何修改
    console.log(`[GroupBuyJoin] ✅ Join completed! Order: ${order.id}, Session: ${targetSession.id}`);

    return createResponse({
      success: true,
      data: {
        order_id: order.id,
        order_number: orderNumber,
        session_id: targetSession.id,
        session_code: targetSession.session_code,
        current_participants: newParticipantCount,
        max_participants: maxParticipants,
        is_full: newParticipantCount >= maxParticipants,
        draw_result: drawResult,
      }
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Group buy join error:', error);
    return createResponse({ success: false, error: errMsg }, 500);
  }
});
