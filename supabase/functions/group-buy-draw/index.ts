import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// 使用环境变量获取Supabase配置
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Helper function to create response with CORS headers
function createResponse(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// 辅助函数：将user_id（可能是telegram_id或UUID）转换为UUID
async function resolveUserIdToUUID(supabase: any, userId: string): Promise<string | null> {
  // 检查是否是UUID格式
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(userId)) {
    // 已经是UUID，验证用户存在
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
    return user?.id || null;
  } else {
    // 是telegram_id，查找对应的UUID
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', userId)
      .single();
    return user?.id || null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { session_id } = await req.json();

    if (!session_id) {
      return createResponse({ success: false, error: 'Session ID is required' }, 400);
    }

    // 1. Get session information
    const { data: session, error: sessionError } = await supabase
      .from('group_buy_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (sessionError || !session) {
      return createResponse({ success: false, error: 'Session not found' }, 404);
    }

    // Check if already drawn
    if (session.status === 'SUCCESS' || session.drawn_at) {
      return createResponse({ success: false, error: 'Session already drawn' }, 400);
    }

    // 2. Get all orders
    const { data: orders, error: ordersError } = await supabase
      .from('group_buy_orders')
      .select('*')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (ordersError || !orders || orders.length === 0) {
      return createResponse({ success: false, error: 'No orders found' }, 404);
    }

    // 3. 计算时间戳总和（处理order_timestamp为null的情况）
    const timestampSum = orders.reduce((sum, order) => {
      // 如果order_timestamp为null，使用created_at的时间戳
      const timestamp = order.order_timestamp || new Date(order.created_at).getTime();
      return sum + BigInt(timestamp);
    }, BigInt(0));
    const totalParticipants = orders.length;

    // 4. 使用时间戳算法确定中奖索引
    const winningIndex = Number(timestampSum % BigInt(totalParticipants));
    const winnerOrder = orders[winningIndex];

    // 4.1 解析中奖者的UUID
    const winnerUUID = await resolveUserIdToUUID(supabase, winnerOrder.user_id);
    if (!winnerUUID) {
      console.error('Failed to resolve winner UUID for user_id:', winnerOrder.user_id);
      return createResponse({ success: false, error: 'Failed to resolve winner user' }, 500);
    }

    // 5. 更新拼团会话状态（使用UUID）
    const { error: updateSessionError } = await supabase
      .from('group_buy_sessions')
      .update({
        status: 'SUCCESS',
        completed_at: new Date().toISOString(),
        drawn_at: new Date().toISOString(),
        winner_id: winnerUUID,
        winning_timestamp_sum: timestampSum.toString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session_id);

    if (updateSessionError) {
      console.error('Failed to update session:', updateSessionError);
      return createResponse({ success: false, error: 'Failed to update session status' }, 500);
    }

    // 6. 更新中奖订单状态
    await supabase
      .from('group_buy_orders')
      .update({ 
        status: 'WON',
        updated_at: new Date().toISOString()
      })
      .eq('id', winnerOrder.id);

    // 7. 创建开奖结果记录
    const claimExpiresAt = new Date();
    claimExpiresAt.setDate(claimExpiresAt.getDate() + 30);
    
    // 【关键】使用正确的user_id字段（group_buy_results表需要user_id字段）
    const { data: result, error: resultError } = await supabase
      .from('group_buy_results')
      .insert({
        session_id: session_id,
        product_id: session.product_id,
        user_id: winnerUUID, // 添加user_id字段
        winner_id: winnerUUID,
        winner_order_id: winnerOrder.id,
        total_participants: totalParticipants,
        timestamp_sum: timestampSum.toString(),
        winning_index: winningIndex,
        pickup_status: 'PENDING_CLAIM',
        status: 'PENDING', // 添加status字段
        expires_at: claimExpiresAt.toISOString(),
        algorithm_data: {
          orders: orders.map((o) => ({
            user_id: o.user_id,
            order_number: o.order_number,
            timestamp: o.order_timestamp || new Date(o.created_at).getTime(),
          })),
          calculation: {
            timestamp_sum: timestampSum.toString(),
            total_participants: totalParticipants,
            winning_index: winningIndex,
            formula: 'winning_index = timestamp_sum % total_participants',
          },
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (resultError) {
      console.error('Failed to create result:', resultError);
      // 继续处理，但记录错误
    } else {
      console.log('Created group_buy_result:', result?.id);
    }

    // 8. 【关键逻辑】处理中奖者 - 中奖者的余额已经在参与时扣除，现在执行发货流程
    // 中奖者不需要额外扣款，因为参与时已经扣除了TJS余额
    // 只需要更新订单状态为等待发货
    console.log(`Winner ${winnerUUID} - balance already deducted during participation, ready for delivery`);

    // 9. 【关键逻辑】处理未中奖者 - 退回到积分钱包（LUCKY_COIN）
    // 【业务规则】拼团成功时，未中奖用户的参与资金退还为积分（LUCKY_COIN），不是余额（TJS）
    // 只有拼团超时（未成功）时才退回 TJS 余额（由 group-buy-timeout-check 处理）
    for (const order of orders) {
      if (order.id !== winnerOrder.id) {
        // 【幂等性保护】检查订单是否已经退款，防止重复退款
        if (order.status === 'REFUNDED') {
          console.log(`Order ${order.id} already refunded, skipping`);
          continue;
        }

        // 解析用户UUID
        const userUUID = await resolveUserIdToUUID(supabase, order.user_id);
        
        if (userUUID) {
          const refundAmount = Number(order.amount);
          
          // 获取用户的积分钱包（type='LUCKY_COIN', currency='POINTS'）
          let { data: lcWallet } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', userUUID)
            .eq('type', 'LUCKY_COIN')
            .single();

          // 如果积分钱包不存在，创建一个
          // 【重要】currency 必须为 'POINTS'，与 auth-telegram 创建钱包时保持一致
          if (!lcWallet) {
            const { data: newWallet, error: createWalletError } = await supabase
              .from('wallets')
              .insert({
                user_id: userUUID,
                type: 'LUCKY_COIN',
                currency: 'POINTS',
                balance: 0,
                version: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .select()
              .single();

            if (createWalletError) {
              console.error(`Failed to create LUCKY_COIN wallet for user ${userUUID}:`, createWalletError);
              continue;
            }
            lcWallet = newWallet;
          }

          if (lcWallet) {
            // 【修复】使用乐观锁 + 3次重试机制（与 group-buy-timeout-check 保持一致）
            let updateSuccess = false;
            let retries = 3;
            let currentWallet = lcWallet;

            while (retries > 0 && !updateSuccess) {
              const newBalance = Number(currentWallet.balance) + refundAmount;
              
              const { data: updatedRows, error: updateWalletError } = await supabase
                .from('wallets')
                .update({ 
                  balance: newBalance,
                  updated_at: new Date().toISOString(),
                  version: currentWallet.version + 1
                })
                .eq('id', currentWallet.id)
                .eq('version', currentWallet.version)
                .select();

              if (!updateWalletError && updatedRows && updatedRows.length > 0) {
                updateSuccess = true;
                // 创建积分流水记录
                await supabase.from('wallet_transactions').insert({
                  wallet_id: currentWallet.id,
                  type: 'GROUP_BUY_REFUND',
                  amount: refundAmount,
                  balance_before: Number(currentWallet.balance),
                  balance_after: newBalance,
                  status: 'COMPLETED',
                  description: `拼团未中奖，退回积分 - ${session.session_code}`,
                  reference_id: order.id,
                  processed_at: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                });
                break;
              }

              console.warn(`[GroupBuyDraw] Optimistic lock failed for user ${userUUID} (attempt ${4 - retries}/3)`);
              retries--;

              if (retries > 0) {
                // 重新获取钱包最新状态
                const { data: freshWallet } = await supabase
                  .from('wallets')
                  .select('*')
                  .eq('id', currentWallet.id)
                  .single();
                if (freshWallet) {
                  currentWallet = freshWallet;
                } else {
                  break;
                }
              }
            }

            if (!updateSuccess) {
              console.error(`[GroupBuyDraw] Failed to refund user ${userUUID} after 3 retries`);
              continue;
            }

            console.log(`Refunded ${refundAmount} LUCKY_COIN (points) to user ${userUUID}`);
            
            // 更新订单退款信息（使用 refund_lucky_coins 字段记录积分退款金额）
            await supabase
              .from('group_buy_orders')
              .update({
                status: 'REFUNDED',
                refund_lucky_coins: refundAmount,
                refunded_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id);
          } else {
            console.error(`LUCKY_COIN wallet not found for user ${userUUID}`);
            continue;
          }

          // 发送Telegram通知（未中奖，退回积分）
          try {
            const { data: product } = await supabase
              .from('group_buy_products')
              .select('name, image_url')
              .eq('id', session.product_id)
              .single();

            // 获取更新后的积分钱包余额用于通知展示
            const { data: updatedLcWallet } = await supabase
              .from('wallets')
              .select('balance')
              .eq('user_id', userUUID)
              .eq('type', 'LUCKY_COIN')
              .single();

            // 插入通知队列
            await supabase.from('notification_queue').insert({
              user_id: userUUID,
              type: 'group_buy_refund',
              payload: {
                product_name: product?.name || 'Unknown Product',
                session_code: session.session_code,
                refund_amount: refundAmount,
                refund_type: 'LUCKY_COIN',  // 标记退款类型为积分
                points_balance: Number(updatedLcWallet?.balance || 0),
              },
              phone_number: null,  // 由通知发送器查询用户的 phone_number
              notification_type: 'group_buy_points_refund',
              title: '拼团积分退还通知',
              channel: 'whatsapp',
              message: '',
              data: {
                product_name: product?.name || 'Unknown Product',
                session_code: session.session_code,
                refund_amount: refundAmount,
                refund_type: 'LUCKY_COIN',
                points_balance: Number(updatedLcWallet?.balance || 0),
              },
              priority: 2,
              status: 'pending',
              scheduled_at: new Date().toISOString(),
              retry_count: 0,
              max_retries: 3,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
            console.error('Failed to queue notification:', error);
          }
        }
      }
    }

    // 10. 发送中奖通知
    try {
      const { data: product } = await supabase
        .from('group_buy_products')
        .select('name, image_url')
        .eq('id', session.product_id)
        .single();

      // 插入通知队列
      await supabase.from('notification_queue').insert({
        user_id: winnerUUID,
        type: 'group_buy_win',
        payload: {
          product_name: product?.name || 'Unknown Product',
          session_code: session.session_code,
          won_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' }),
        },
        phone_number: null,  // 由通知发送器查询用户的 phone_number
        notification_type: 'group_buy_win',
        title: '拼团成功通知',
        channel: 'whatsapp',
        message: '',
        data: {
          product_name: product?.name || 'Unknown Product',
          session_code: session.session_code,
          won_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' }),
        },
        priority: 1,
        status: 'pending',
        scheduled_at: new Date().toISOString(),
        retry_count: 0,
        max_retries: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Failed to queue win notification:', error);
    }

    // 11. Update product sold quantity (with retry)
    let drawStockUpdateSuccess = false;
    for (let stockRetry = 0; stockRetry < 3; stockRetry++) {
      try {
        const { error: incrementError } = await supabase.rpc('increment_sold_quantity', {
          product_id: session.product_id,
          amount: 1
        });
        
        if (incrementError) {
          console.error(`Failed to increment sold_quantity (attempt ${stockRetry + 1}/3):`, incrementError);
        } else {
          drawStockUpdateSuccess = true;
          console.log(`Incremented sold_quantity for product ${session.product_id}`);
          break;
        }
      } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`increment_sold_quantity exception (attempt ${stockRetry + 1}/3):`, error);
      }

      if (stockRetry < 2) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!drawStockUpdateSuccess) {
      console.error(`⚠️ CRITICAL: Failed to update stock for product ${session.product_id} after 3 retries. Session: ${session.id}. Manual intervention required.`);
    }

    return createResponse({
      success: true,
      data: {
        winner_id: winnerUUID,
        winning_index: winningIndex,
        total_participants: totalParticipants,
        timestamp_sum: timestampSum.toString(),
        result_id: result?.id,
        result,
      },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Group buy draw error:', error);
    return createResponse({ success: false, error: errMsg }, 500);
  }
});
