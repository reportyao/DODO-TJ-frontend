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

    // 1. 查找所有超时的拼团会话
    const { data: timeoutSessions, error: sessionsError } = await supabase
      .from('group_buy_sessions')
      .select('*')
      .eq('status', 'ACTIVE')
      .lt('expires_at', new Date().toISOString());

    if (sessionsError) {
      return createResponse({ success: false, error: sessionsError.message }, 500);
    }

    if (!timeoutSessions || timeoutSessions.length === 0) {
      return createResponse({ success: true, message: 'No timeout sessions found', processed: 0 });
    }

    let processedCount = 0;
    const refundResults: any[] = [];
    const skippedResults: any[] = [];

    // 2. 处理每个超时的会话
    for (const session of timeoutSessions) {
      try {
        // 更新会话状态为TIMEOUT
        await supabase
          .from('group_buy_sessions')
          .update({ 
            status: 'TIMEOUT',
            updated_at: new Date().toISOString()
          })
          .eq('id', session.id);

        // 获取该会话的所有订单
        const { data: orders, error: ordersError } = await supabase
          .from('group_buy_orders')
          .select('*')
          .eq('session_id', session.id);

        if (ordersError || !orders) {
          console.error(`Failed to get orders for session ${session.id}:`, ordersError);
          continue;
        }

        // 【关键修复】超时退款：退回到TJS余额钱包（原路退回）
        for (const order of orders) {
          // ✅ 【修复1】检查订单状态，防止重复退款
          if (order.status === 'TIMEOUT_REFUNDED') {
            console.log(`Order ${order.id} already refunded, skip`);
            skippedResults.push({
              order_id: order.id,
              user_id: order.user_id,
              reason: 'Already refunded (status check)'
            });
            continue;
          }

          // 解析用户UUID
          const userUUID = await resolveUserIdToUUID(supabase, order.user_id);
          
          if (!userUUID) {
            console.error(`Failed to resolve user UUID for user_id: ${order.user_id}`);
            continue;
          }

          // ✅ 【修复2】检查是否已存在退款记录
          const { data: existingRefund } = await supabase
            .from('wallet_transactions')
            .select('id')
            .eq('reference_id', order.id)
            .in('type', ['GROUP_BUY_REFUND_TO_BALANCE', 'GROUP_BUY_REFUND'])
            .maybeSingle();

          if (existingRefund) {
            console.log(`Refund transaction already exists for order ${order.id}, skip`);
            skippedResults.push({
              order_id: order.id,
              user_id: userUUID,
              reason: 'Refund transaction already exists',
              existing_transaction_id: existingRefund.id
            });
            continue;
          }

          // 【修复】获取用户的TJS钱包（使用正确的type='TJS'）
          const { data: wallet } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', userUUID)
            .eq('type', 'TJS')
            .single();

          if (!wallet) {
            console.error(`TJS wallet not found for user ${userUUID}`);
            continue;
          }

          const refundAmount = Number(order.amount);
          const newBalance = Number(wallet.balance) + refundAmount;

          // ✅ 【修复3】使用乐观锁更新钱包余额，带重试机制
          let updateSuccess = false;
          let retries = 3;
          let currentWallet = wallet;

          while (retries > 0 && !updateSuccess) {
            const { data: updatedRows, error: updateError } = await supabase
              .from('wallets')
              .update({ 
                balance: Number(currentWallet.balance) + refundAmount,
                updated_at: new Date().toISOString(),
                version: currentWallet.version + 1
              })
              .eq('id', currentWallet.id)
              .eq('version', currentWallet.version)
              .select();

            if (!updateError && updatedRows && updatedRows.length > 0) {
              updateSuccess = true;
              break;
            }

            console.warn(`Failed to update wallet (attempt ${4 - retries}/3):`, updateError || 'Optimistic lock conflict (0 rows updated)');
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
            console.error(`Failed to update wallet for user ${userUUID} after 3 retries`);
            continue;
          }

          // ✅ 【修复4】创建钱包交易记录，使用 reference_id 作为幂等键
          // 【修复 4.1】使用 currentWallet（重试后最新状态）而非 wallet（初始读取）
          // 确保 balance_before/after 反映实际更新时的钱包状态
          const { error: txError } = await supabase.from('wallet_transactions').insert({
            wallet_id: currentWallet.id,
            type: 'GROUP_BUY_REFUND_TO_BALANCE',
            amount: refundAmount,
            balance_before: Number(currentWallet.balance),
            balance_after: Number(currentWallet.balance) + refundAmount,
            status: 'COMPLETED',
            description: `拼团未成功退款（退回余额） - ${session.session_code}`,
            reference_id: order.id,  // ✅ 幂等键
            processed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          });

          if (txError) {
            console.error(`Failed to create transaction for order ${order.id}:`, txError);
            // 如果是唯一约束冲突，说明已经退款过了
            if (txError.code === '23505') {
              console.log(`Transaction already exists (unique constraint), skip`);
              skippedResults.push({
                order_id: order.id,
                user_id: userUUID,
                reason: 'Transaction already exists (unique constraint)'
              });
            }
            continue;
          }

          // 更新订单状态
          await supabase
            .from('group_buy_orders')
            .update({
              status: 'TIMEOUT_REFUNDED',
              refund_amount: refundAmount,
              refunded_at: new Date().toISOString(),
            })
            .eq('id', order.id);

          refundResults.push({
            user_id: userUUID,
            order_id: order.id,
            refund_amount: refundAmount,
            refund_type: 'TJS_BALANCE'
          });

          // 发送Telegram通知（拼团超时，退回余额）
          try {
            const { data: product } = await supabase
              .from('group_buy_products')
              .select('name, image_url')
              .eq('id', session.product_id)
              .single();

            // 获取更新后的钱包余额
            const { data: updatedWallet } = await supabase
              .from('wallets')
              .select('balance')
              .eq('user_id', userUUID)
              .eq('type', 'TJS')
              .single();

            // 插入通知队列
            await supabase.from('notification_queue').insert({
              user_id: userUUID,
              type: 'group_buy_timeout',
              payload: {
                product_name: product?.name || 'Unknown Product',
                session_code: session.session_code,
                refund_amount: refundAmount,
                balance: Number(updatedWallet?.balance || 0),
              },
              phone_number: null,  // 由通知发送器查询用户的 phone_number
              notification_type: 'group_buy_timeout',
              title: '拼团超时退款通知',
              channel: 'whatsapp',
              message: '',
              data: {
                product_name: product?.name || 'Unknown Product',
                session_code: session.session_code,
                refund_amount: refundAmount,
                balance: Number(updatedWallet?.balance || 0),
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

        processedCount++;
      } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to process timeout session ${session.id}:`, error);
      }
    }

    return createResponse({
      success: true,
      message: `Processed ${processedCount} timeout sessions`,
      processed: processedCount,
      total: timeoutSessions.length,
      refund_results: refundResults,
      skipped_results: skippedResults,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Group buy timeout check error:', error);
    return createResponse({ success: false, error: errMsg }, 500);
  }
});
