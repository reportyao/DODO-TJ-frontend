import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { validateSessionWithUser } from '../_shared/auth.ts'
import { mapErrorCode, getHttpStatusForErrorCode } from '../_shared/errorResponse.ts'

/**
 * 回滚已分配的彩票
 * 【BUG修复】同时回滚 lottery_entries 和 lotteries.sold_tickets
 * 修复了两个问题：
 * 1. 旧版使用 tickets.map(t => t.id) 但 allocate_lottery_tickets RPC 不返回 id 字段
 *    改为使用 order_id 删除，更可靠
 * 2. 旧版只删除 lottery_entries 但不回滚 sold_tickets
 *    现在同时减少 lotteries.sold_tickets
 */
async function rollbackAllocatedTickets(
  supabaseUrl: string,
  serviceRoleKey: string,
  tickets: any[],
  context?: {
    userId?: string;
    lotteryId?: string;
    orderId?: string;
  }
) {
  if (!tickets || tickets.length === 0) {
    return;
  }

  const ticketCount = tickets.length;
  const lotteryId = context?.lotteryId;
  const orderId = context?.orderId;
  console.log(`Rolling back ${ticketCount} tickets for lottery=${lotteryId}, order=${orderId}`);

  try {
    // 【修复】优先使用 order_id 删除（因为 allocate_lottery_tickets RPC 不返回 id 字段）
    let deleteUrl: string;
    if (orderId) {
      deleteUrl = `${supabaseUrl}/rest/v1/lottery_entries?order_id=eq.${orderId}`;
    } else {
      // 回退方案：尝试使用 ticket id（如果有的话）
      const ticketIds = tickets.map((t) => t.id).filter(Boolean);
      if (ticketIds.length === 0) {
        console.error('Cannot rollback: no order_id and no ticket ids available');
        logOrphanedTickets([], 'No identifiers available for rollback', context);
        return;
      }
      deleteUrl = `${supabaseUrl}/rest/v1/lottery_entries?id=in.(${ticketIds.join(',')})`;
    }

    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error('Failed to delete tickets during rollback:', errorText);
      logOrphanedTickets([], `Rollback delete failed: ${errorText}`, context);
    } else {
      console.log(`Successfully deleted ${ticketCount} lottery entries`);
    }

    // 【修复】回滚 lotteries.sold_tickets，保持与 lottery_entries 数量一致
    if (lotteryId && ticketCount > 0) {
      const updateResponse = await fetch(
        `${supabaseUrl}/rest/v1/rpc/rollback_lottery_sold_tickets`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_lottery_id: lotteryId,
            p_quantity: ticketCount,
          }),
        }
      );

      if (!updateResponse.ok) {
        // RPC 失败，回退到读-改-写方式（PostgREST PATCH 不支持表达式）
        console.warn('rollback_lottery_sold_tickets RPC failed, falling back to read-modify-write');
        try {
          const getResp = await fetch(
            `${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}&select=sold_tickets`,
            {
              headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
              },
            }
          );
          if (getResp.ok) {
            const lotteries = await getResp.json();
            if (lotteries[0]) {
              const newSoldTickets = Math.max(0, lotteries[0].sold_tickets - ticketCount);
              await fetch(
                `${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}`,
                {
                  method: 'PATCH',
                  headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    sold_tickets: newSoldTickets,
                    updated_at: new Date().toISOString(),
                  }),
                }
              );
              console.log(`Rolled back sold_tickets: ${lotteries[0].sold_tickets} -> ${newSoldTickets}`);
            }
          }
        } catch (patchErr) {
          console.error('Failed to rollback sold_tickets via fallback:', patchErr);
          logOrphanedTickets([], `sold_tickets rollback failed: ${patchErr}`, context);
        }
      } else {
        console.log(`Successfully rolled back sold_tickets by ${ticketCount}`);
      }
    }
  } catch (error) {
    console.error('Error during ticket rollback:', error);
    logOrphanedTickets(
      [],
      `Rollback exception: ${error instanceof Error ? error.message : String(error)}`,
      context
    );
  }
}

/**
 * 记录孤儿彩票（需要人工处理）
 */
function logOrphanedTickets(
  ticketIds: string[],
  error: string,
  context?: {
    userId?: string;
    lotteryId?: string;
    orderId?: string;
  }
) {
  const logEntry = {
    level: 'ERROR',
    type: 'ORPHANED_TICKETS',
    ticket_ids: ticketIds,
    ticket_count: ticketIds.length,
    error_message: error,
    context: context || {},
    timestamp: new Date().toISOString(),
    action_required: 'Manual cleanup required - delete these tickets from lottery_entries table',
  };

  console.error('[ORPHANED_TICKETS_ALERT]', JSON.stringify(logEntry));
  
  console.error(`⚠️ ORPHANED TICKETS DETECTED:
  - Ticket IDs: ${ticketIds.join(', ')}
  - Error: ${error}
  - User ID: ${context?.userId || 'unknown'}
  - Lottery ID: ${context?.lotteryId || 'unknown'}
  - Order ID: ${context?.orderId || 'unknown'}
  - Timestamp: ${logEntry.timestamp}
  - Action: Please manually delete these tickets from lottery_entries table`);
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }


  try {
    // 获取 Supabase 配置
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');

    if (!serviceRoleKey || !supabaseUrl) {
      throw new Error('服务器配置错误');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 【BUG修复】一元夺宝不允许使用抵扣券，强制忽略前端传入的 useCoupon 参数
    const { lotteryId, quantity, paymentMethod, session_token, useCoupon: _useCouponIgnored, idempotency_key } = await req.json();
    // 强制设为 false：iTJS抵扣券仅适用于全款购买，不适用于一元夺宝
    const useCoupon = false;

    if (!lotteryId || !quantity || !paymentMethod) {
      throw new Error('缺少必要参数');
    }

    if (quantity <= 0 || quantity > 100) {
      throw new Error('数量无效：必须在1到100之间');
    }

    if (idempotency_key) {
      const { data: existingLogs, error: idempotencyError } = await supabaseAdmin
        .from('edge_function_logs')
        .select('details')
        .eq('function_name', 'lottery-purchase')
        .eq('status', 'success')
        .filter('details->>idempotency_key', 'eq', idempotency_key)
        .limit(1);

      if (!idempotencyError && existingLogs && existingLogs.length > 0) {
        const cachedResult = existingLogs[0].details?.result_data;
        console.log('Idempotency hit, returning cached result for key:', idempotency_key);
        return new Response(JSON.stringify({ data: cachedResult, idempotency_hit: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    let sessionToken = session_token;
    if (!sessionToken) {
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        sessionToken = authHeader.replace('Bearer ', '');
      }
    }

    if (!sessionToken) {
      throw new Error('未授权：缺少会话令牌');
    }

    const validatedSession = await validateSessionWithUser(supabaseAdmin, sessionToken);
    const user = validatedSession.user as Record<string, any>;
    const userId = validatedSession.userId;

    const [
      { data: lottery, error: lotteryError },
      { count: userEntryCount, error: userEntriesError },
      { data: walletRows, error: walletError },
    ] = await Promise.all([
      supabaseAdmin
        .from('lotteries')
        .select('*')
        .eq('id', lotteryId)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('lottery_entries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('lottery_id', lotteryId),
      supabaseAdmin
        .from('wallets')
        .select('type, balance')
        .eq('user_id', userId)
        .in('type', ['TJS', 'LUCKY_COIN']),
    ]);

    if (lotteryError) {
      throw new Error(`查询商品失败: ${lotteryError.message}`);
    }

    if (!lottery) {
      throw new Error('商品不存在');
    }

    if (userEntriesError) {
      throw new Error(`查询购买记录失败: ${userEntriesError.message}`);
    }

    if (walletError) {
      throw new Error(`查询钱包失败: ${walletError.message}`);
    }

    if (lottery.status !== 'ACTIVE') {
      throw new Error(`商品未在售中，当前状态: ${lottery.status}`);
    }

    if (lottery.sold_tickets + quantity > lottery.total_tickets) {
      throw new Error('库存不足');
    }

    const existingEntryCount = userEntryCount || 0;
    if (!lottery.unlimited_purchase && lottery.max_per_user) {
      if (existingEntryCount + quantity > lottery.max_per_user) {
        throw new Error(`超出每人最大购买限制: ${lottery.max_per_user}`);
      }
    }

    const totalAmount = lottery.ticket_price * quantity;
    if (!totalAmount || totalAmount <= 0) {
      throw new Error('价格配置无效');
    }

    const tjsBalance = (walletRows || []).reduce((balance, wallet: any) => {
      if (wallet.type !== 'TJS') return balance;
      return parseFloat(wallet.balance || '0') || 0;
    }, 0);
    const lcBalance = (walletRows || []).reduce((balance, wallet: any) => {
      if (wallet.type !== 'LUCKY_COIN') return balance;
      return parseFloat(wallet.balance || '0') || 0;
    }, 0);
    const couponValue = 0;

    const totalAvailable = tjsBalance + lcBalance + couponValue;
    if (totalAvailable < totalAmount) {
      throw new Error(`余额不足。可用: ${totalAvailable.toFixed(2)} (TJS: ${tjsBalance.toFixed(2)}, 积分: ${lcBalance.toFixed(2)}, 优惠券: ${couponValue.toFixed(2)}), 需要: ${totalAmount.toFixed(2)}`);
    }

    // 生成订单号
    const orderNumber = `LT${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // 创建订单
    const orderData = {
      user_id: userId,
      order_number: orderNumber,
      type: 'LOTTERY_PURCHASE',
      total_amount: totalAmount,
      currency: lottery.currency,
      payment_method: paymentMethod,
      lottery_id: lotteryId,
      quantity: quantity,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const createOrderResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(orderData),
    });

    if (!createOrderResponse.ok) {
      const errorText = await createOrderResponse.text();
      throw new Error(`创建订单失败: ${errorText}`);
    }

    const orders = await createOrderResponse.json();
    const order = orders[0];

    // ✅ 使用原子性RPC函数分配ticket_number，防止并发冲突
    const allocateResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/allocate_lottery_tickets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_lottery_id: lotteryId,
        p_user_id: userId,
        p_quantity: quantity,
        p_order_id: order.id,
      }),
    });

    if (!allocateResponse.ok) {
      const errorText = await allocateResponse.text();
      // 回滚订单
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      throw new Error(`分配票失败: ${errorText}`);
    }

    const allocatedTickets = await allocateResponse.json();
    const participationCodes = allocatedTickets.map((t: any) => t.participation_code);

    // ============================================================
    // 【业务重构】调用 process_mixed_payment RPC 进行混合支付
    // 替代原有的手动 wallet PATCH 更新逻辑
    // 支付优先级: 抵扣券 → TJS余额 → LUCKY_COIN积分
    // ============================================================
    const paymentRpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/process_mixed_payment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_lottery_id: lotteryId,
        p_order_id: order.id,
        p_total_amount: totalAmount,
        p_use_coupon: useCoupon || false,
        p_order_type: 'LOTTERY_PURCHASE'
      }),
    });

    if (!paymentRpcResponse.ok) {
      const errorText = await paymentRpcResponse.text();
      console.error('process_mixed_payment RPC HTTP error:', errorText);
      // 回滚已分配的彩票和订单
      await rollbackAllocatedTickets(supabaseUrl, serviceRoleKey, allocatedTickets, {
        userId,
        lotteryId,
        orderId: order.id,
      });
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      throw new Error(`支付失败: ${errorText}`);
    }

    const paymentResult = await paymentRpcResponse.json();
    console.log('process_mixed_payment result:', paymentResult);

    // 检查 RPC 业务逻辑结果
    if (!paymentResult || !paymentResult.success) {
      const paymentError = paymentResult?.error || '未知支付错误';
      console.error('process_mixed_payment business error:', paymentError);
      // 回滚已分配的彩票和订单
      await rollbackAllocatedTickets(supabaseUrl, serviceRoleKey, allocatedTickets, {
        userId,
        lotteryId,
        orderId: order.id,
      });
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      throw new Error(`支付失败: ${paymentError}`);
    }

    const paidAt = new Date().toISOString();
    const [orderStatusResponse, updatedLotteryResponse] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'PAID',
          paid_at: paidAt,
          updated_at: paidAt,
        }),
      }),
      fetch(`${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}&select=sold_tickets,total_tickets`, {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }),
    ]);

    if (!orderStatusResponse.ok) {
      console.error('Failed to update lottery order status:', await orderStatusResponse.text());
    }

    if (!updatedLotteryResponse.ok) {
      throw new Error(`查询最新库存失败: ${await updatedLotteryResponse.text()}`);
    }

    const updatedLotteries = await updatedLotteryResponse.json();
    const updatedLottery = updatedLotteries[0];
    const isSoldOut = updatedLottery && updatedLottery.sold_tickets >= updatedLottery.total_tickets;

    // 如果售罄，更新状态和开奖时间
    if (isSoldOut) {
      const drawTime = new Date(Date.now() + 180 * 1000); // 180秒后开奖
      await fetch(`${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'SOLD_OUT',
          draw_time: drawTime.toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });

      // 异步调用售罄检测函数
      fetch(`${supabaseUrl}/functions/v1/check-lottery-sold-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ lotteryId: lotteryId }),
      }).catch((err) => {
        console.error('Failed to trigger sold-out check:', err);
      });
    }

    // 处理推荐佣金
    // 【佣金基数修复】佣金只按余额消费部分(tjs_deducted)计算，不包含积分消费和抵扣券
    const tjsDeducted = paymentResult.tjs_deducted || 0;
    const hasReferrer = user.referred_by_id || user.referrer_id;
    if (hasReferrer && tjsDeducted > 0) {
      fetch(`${supabaseUrl}/functions/v1/handle-purchase-commission`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_id: order.id,
          user_id: userId,
          order_amount: tjsDeducted
        }),
      })
        .then(async (commissionResponse) => {
          if (!commissionResponse.ok) {
            console.error('Failed to process commission:', await commissionResponse.text());
          }
        })
        .catch((commissionError: unknown) => {
          console.error('Commission processing error:', commissionError);
        });
    }

    // 【修改】计算支付后的剩余余额（从 RPC 返回值中获取）
    const remainingTjsBalance = tjsBalance - (paymentResult.tjs_deducted || 0);
    const remainingLcBalance = lcBalance - (paymentResult.lc_deducted || 0);

    // 返回购买结果
    const result = {
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      order: {
        id: order.id,
        order_number: order.order_number,
        total_amount: totalAmount,
        status: 'PAID',
      },
      lottery_entries: allocatedTickets,
      ticket_numbers: allocatedTickets
        .map((ticket: any) => ticket?.ticket_number)
        .filter(Boolean),
      participation_codes: participationCodes,
      remaining_balance: remainingTjsBalance,
      remaining_lc_balance: remainingLcBalance,
      payment_detail: {
        coupon_deducted: paymentResult.coupon_deducted || 0,
        tjs_deducted: paymentResult.tjs_deducted || 0,
        lc_deducted: paymentResult.lc_deducted || 0,
      },
      is_sold_out: isSoldOut,
    };

    // 记录操作日志（包含 idempotency_key）
    if (idempotency_key) {
      await fetch(`${supabaseUrl}/rest/v1/rpc/log_edge_function_action`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_function_name: 'lottery-purchase',
          p_action: 'LOTTERY_PURCHASE',
          p_user_id: userId,
          p_target_type: 'lottery',
          p_target_id: lotteryId,
          p_details: {
            quantity,
            payment_method: paymentMethod,
            total_amount: totalAmount,
            order_id: order.id,
            use_coupon: useCoupon || false,
            idempotency_key: idempotency_key,
            result_data: result,
          },
          p_status: 'success',
          p_error_message: null,
        }),
      }).catch(err => console.error('Failed to write audit log:', err));
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Lottery purchase error:', errMsg);
    const errorCode = mapErrorCode(errMsg);
    const httpStatus = getHttpStatusForErrorCode(errorCode);

    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
        error_code: errorCode,
      }),
      {
        status: httpStatus,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
