import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

/**
 * 定时清理卡滞的 PENDING 全款购买订单
 *
 * 业务逻辑：
 * 在 create-full-purchase-order 中，订单先以 PENDING 状态创建，然后调用
 * process_mixed_payment RPC 进行扣款。如果 RPC 调用期间发生超时或网络异常，
 * 订单可能永久停留在 PENDING 状态。
 *
 * 本函数处理这种异常情况：
 * 1. 查找所有 PENDING 状态且创建时间超过 30 分钟的全款订单
 * 2. 检查是否有对应的钱包交易记录（判断是否已实际扣款）
 * 3. 如果未扣款：直接标记为 CANCELLED
 * 4. 如果已扣款但订单仍为 PENDING：标记为 REFUND_PENDING 等待人工处理
 *
 * 该函数应由 Supabase Cron 定时调用（建议每 10 分钟一次）
 */

// PENDING 订单超时阈值：30 分钟
const STALE_THRESHOLD_MINUTES = 30;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date();
    const threshold = new Date(now.getTime() - STALE_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    // 1. 查找所有超时的 PENDING 全款订单
    const { data: staleOrders, error: queryError } = await supabase
      .from('full_purchase_orders')
      .select('id, user_id, lottery_id, order_number, total_amount, currency, created_at, metadata')
      .eq('status', 'PENDING')
      .lt('created_at', threshold)
      .order('created_at', { ascending: true });

    if (queryError) {
      throw new Error(`查询超时订单失败: ${queryError.message}`);
    }

    if (!staleOrders || staleOrders.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No stale PENDING orders found',
          processed: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`[CleanupStaleOrders] Found ${staleOrders.length} stale PENDING orders (older than ${STALE_THRESHOLD_MINUTES} min)`);

    const results: Array<{
      order_id: string;
      order_number: string;
      action: string;
      reason: string;
    }> = [];

    for (const order of staleOrders) {
      try {
        // 2. 检查是否有对应的钱包交易记录（判断是否已实际扣款）
        // process_mixed_payment 会创建 wallet_transactions 记录
        const { data: transactions, error: txError } = await supabase
          .from('wallet_transactions')
          .select('id, type, amount')
          .eq('reference_id', order.id)
          .limit(1);

        if (txError) {
          console.error(`[CleanupStaleOrders] Failed to check transactions for order ${order.id}:`, txError);
          continue;
        }

        const hasPayment = transactions && transactions.length > 0;

        if (!hasPayment) {
          // 3. 未扣款：直接标记为 CANCELLED
          const { error: cancelError } = await supabase
            .from('full_purchase_orders')
            .update({
              status: 'CANCELLED',
              updated_at: now.toISOString(),
              metadata: {
                ...(order.metadata || {}),
                cancel_reason: 'STALE_PENDING_NO_PAYMENT',
                cancelled_by: 'cleanup-stale-orders',
                cancelled_at: now.toISOString(),
              },
            })
            .eq('id', order.id)
            .eq('status', 'PENDING'); // 乐观锁

          if (cancelError) {
            console.error(`[CleanupStaleOrders] Failed to cancel order ${order.id}:`, cancelError);
            results.push({
              order_id: order.id,
              order_number: order.order_number,
              action: 'CANCEL_FAILED',
              reason: cancelError.message,
            });
          } else {
            console.log(`[CleanupStaleOrders] Order ${order.id} cancelled (no payment found)`);
            results.push({
              order_id: order.id,
              order_number: order.order_number,
              action: 'CANCELLED',
              reason: 'No payment transaction found, order stale for > 30 min',
            });
          }
        } else {
          // 4. 已扣款但订单仍为 PENDING：标记为 REFUND_PENDING 等待人工处理
          const { error: refundError } = await supabase
            .from('full_purchase_orders')
            .update({
              status: 'REFUND_PENDING',
              updated_at: now.toISOString(),
              metadata: {
                ...(order.metadata || {}),
                refund_reason: 'STALE_PENDING_WITH_PAYMENT',
                flagged_by: 'cleanup-stale-orders',
                flagged_at: now.toISOString(),
              },
            })
            .eq('id', order.id)
            .eq('status', 'PENDING'); // 乐观锁

          if (refundError) {
            console.error(`[CleanupStaleOrders] Failed to flag order ${order.id}:`, refundError);
            results.push({
              order_id: order.id,
              order_number: order.order_number,
              action: 'FLAG_FAILED',
              reason: refundError.message,
            });
          } else {
            console.log(`[CleanupStaleOrders] Order ${order.id} flagged as REFUND_PENDING (payment exists but order stuck)`);
            results.push({
              order_id: order.id,
              order_number: order.order_number,
              action: 'FLAGGED_REFUND_PENDING',
              reason: 'Payment transaction exists but order stuck in PENDING > 30 min',
            });
          }
        }

        // 5. 发送通知给用户
        try {
          const productTitle = order.metadata?.product_title || '商品';
          await supabase.from('notifications').insert({
            id: crypto.randomUUID(),
            user_id: order.user_id,
            type: 'ORDER_STATUS',
            title: '订单状态更新',
            title_i18n: {
              zh: '订单状态更新',
              ru: 'Обновление статуса заказа',
              tg: 'Навсозии ҳолати фармоиш',
            },
            content: hasPayment
              ? `您的订单"${productTitle}"支付异常，已标记为待退款，客服将尽快处理`
              : `您的订单"${productTitle}"因超时未支付已自动取消`,
            message_i18n: {
              zh: hasPayment
                ? `您的订单"${productTitle}"支付异常，已标记为待退款，客服将尽快处理`
                : `您的订单"${productTitle}"因超时未支付已自动取消`,
              ru: hasPayment
                ? `Заказ «${productTitle}» отмечен для возврата из-за ошибки оплаты`
                : `Заказ «${productTitle}» автоматически отменён из-за истечения срока оплаты`,
              tg: hasPayment
                ? `Фармоиши «${productTitle}» барои баргардонидан қайд шуд`
                : `Фармоиши «${productTitle}» бо сабаби гузаштани мӯҳлат бекор карда шуд`,
            },
            related_id: order.id,
            related_type: 'full_purchase_order',
            is_read: false,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          });
        } catch (notifError) {
          console.error(`[CleanupStaleOrders] Failed to send notification for order ${order.id}:`, notifError);
        }
      } catch (orderError) {
        console.error(`[CleanupStaleOrders] Error processing order ${order.id}:`, orderError);
        results.push({
          order_id: order.id,
          order_number: order.order_number,
          action: 'ERROR',
          reason: orderError instanceof Error ? orderError.message : String(orderError),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length} stale orders`,
        processed: results.length,
        threshold_minutes: STALE_THRESHOLD_MINUTES,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[CleanupStaleOrders] Error:', errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
