import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

/**
 * 定时清理过期的 ACTIVE 夺宝商品
 *
 * 业务逻辑：
 * 1. 查找所有 status='ACTIVE' 且 end_time < now 的夺宝商品
 * 2. 将其状态更新为 'EXPIRED'
 * 3. 对已购买份额的用户进行退款（退回 TJS 余额）
 * 4. 将对应的 lottery_entries 标记为 REFUNDED
 *
 * 该函数应由 Supabase Cron 定时调用（建议每 5 分钟一次）
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date().toISOString();

    // 1. 查找所有过期的 ACTIVE 商品
    const { data: expiredLotteries, error: queryError } = await supabase
      .from('lotteries')
      .select('id, title, title_i18n, ticket_price, sold_tickets, total_tickets, end_time')
      .eq('status', 'ACTIVE')
      .lt('end_time', now)
      .order('end_time', { ascending: true });

    if (queryError) {
      throw new Error(`查询过期商品失败: ${queryError.message}`);
    }

    if (!expiredLotteries || expiredLotteries.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No expired ACTIVE lotteries found',
          processed: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`[CleanupExpiredLotteries] Found ${expiredLotteries.length} expired ACTIVE lotteries`);

    const results: Array<{
      lottery_id: string;
      title: string;
      status: string;
      refunded_users: number;
      total_refund: number;
    }> = [];

    for (const lottery of expiredLotteries) {
      try {
        // 2. 将商品状态更新为 EXPIRED
        const { error: updateError } = await supabase
          .from('lotteries')
          .update({
            status: 'EXPIRED',
            updated_at: now,
          })
          .eq('id', lottery.id)
          .eq('status', 'ACTIVE'); // 乐观锁：确保只有 ACTIVE 状态才能被更新

        if (updateError) {
          console.error(`[CleanupExpiredLotteries] Failed to update lottery ${lottery.id}:`, updateError);
          results.push({
            lottery_id: lottery.id,
            title: lottery.title,
            status: 'UPDATE_FAILED',
            refunded_users: 0,
            total_refund: 0,
          });
          continue;
        }

        // 3. 查找该商品的所有 ACTIVE 参与记录
        const { data: entries, error: entriesError } = await supabase
          .from('lottery_entries')
          .select('id, user_id, ticket_price')
          .eq('lottery_id', lottery.id)
          .eq('status', 'ACTIVE');

        if (entriesError) {
          console.error(`[CleanupExpiredLotteries] Failed to fetch entries for ${lottery.id}:`, entriesError);
          results.push({
            lottery_id: lottery.id,
            title: lottery.title,
            status: 'ENTRIES_FETCH_FAILED',
            refunded_users: 0,
            total_refund: 0,
          });
          continue;
        }

        if (!entries || entries.length === 0) {
          console.log(`[CleanupExpiredLotteries] No entries to refund for lottery ${lottery.id}`);
          results.push({
            lottery_id: lottery.id,
            title: lottery.title,
            status: 'EXPIRED_NO_REFUND',
            refunded_users: 0,
            total_refund: 0,
          });
          continue;
        }

        // 4. 按用户聚合退款金额
        const userRefundMap: Record<string, { total: number; entryIds: string[] }> = {};
        for (const entry of entries) {
          const amount = Number(entry.ticket_price) || Number(lottery.ticket_price) || 0;
          if (!userRefundMap[entry.user_id]) {
            userRefundMap[entry.user_id] = { total: 0, entryIds: [] };
          }
          userRefundMap[entry.user_id].total += amount;
          userRefundMap[entry.user_id].entryIds.push(entry.id);
        }

        let refundedUsers = 0;
        let totalRefund = 0;

        // 5. 逐用户退款
        for (const [userId, refundInfo] of Object.entries(userRefundMap)) {
          try {
            // 5a. 获取用户 TJS 钱包
            const { data: wallet, error: walletError } = await supabase
              .from('wallets')
              .select('id, balance, version')
              .eq('user_id', userId)
              .eq('type', 'TJS')
              .eq('currency', 'TJS')
              .single();

            if (walletError || !wallet) {
              console.error(`[CleanupExpiredLotteries] Wallet not found for user ${userId}`);
              continue;
            }

            // 5b. 使用乐观锁更新钱包余额
            const newBalance = Number(wallet.balance) + refundInfo.total;
            const { data: updatedWallet, error: updateWalletError } = await supabase
              .from('wallets')
              .update({
                balance: newBalance,
                version: (wallet.version || 0) + 1,
                updated_at: now,
              })
              .eq('id', wallet.id)
              .eq('version', wallet.version || 0)
              .select('id')
              .maybeSingle();

            if (updateWalletError || !updatedWallet) {
              console.error(`[CleanupExpiredLotteries] Failed to update wallet for user ${userId}:`, updateWalletError);
              continue;
            }

            // 5c. 创建钱包交易记录
            await supabase.from('wallet_transactions').insert({
              wallet_id: wallet.id,
              type: 'LOTTERY_EXPIRED_REFUND',
              amount: refundInfo.total,
              balance_before: Number(wallet.balance),
              balance_after: newBalance,
              status: 'COMPLETED',
              description: `商品过期退款 - ${lottery.title}`,
              reference_id: lottery.id,
              processed_at: now,
              created_at: now,
            });

            // 5d. 更新 lottery_entries 状态为 REFUNDED
            await supabase
              .from('lottery_entries')
              .update({
                status: 'REFUNDED',
                updated_at: now,
              })
              .in('id', refundInfo.entryIds);

            refundedUsers++;
            totalRefund += refundInfo.total;
          } catch (userError) {
            console.error(`[CleanupExpiredLotteries] Error refunding user ${userId}:`, userError);
          }
        }

        // 6. 发送通知给受影响的用户
        try {
          const notifications = Object.keys(userRefundMap).map((userId) => ({
            id: crypto.randomUUID(),
            user_id: userId,
            type: 'LOTTERY_EXPIRED',
            title: '商品已过期',
            title_i18n: {
              zh: '商品已过期',
              ru: 'Товар истёк',
              tg: 'Мӯҳлати маҳсулот гузашт',
            },
            content: `"${lottery.title}"已过期，您的购买金额 ${userRefundMap[userId].total} TJS 已退回钱包`,
            message_i18n: {
              zh: `"${lottery.title}"已过期，您的购买金额 ${userRefundMap[userId].total} TJS 已退回钱包`,
              ru: `«${lottery.title}» истёк. Ваш платёж ${userRefundMap[userId].total} TJS возвращён на кошелёк`,
              tg: `«${lottery.title}» мӯҳлат гузашт. Маблағи ${userRefundMap[userId].total} TJS ба ҳамён баргардонида шуд`,
            },
            related_id: lottery.id,
            related_type: 'lottery',
            is_read: false,
            created_at: now,
            updated_at: now,
          }));

          if (notifications.length > 0) {
            await supabase.from('notifications').insert(notifications);
          }
        } catch (notifError) {
          console.error(`[CleanupExpiredLotteries] Failed to send notifications for ${lottery.id}:`, notifError);
        }

        console.log(`[CleanupExpiredLotteries] Lottery ${lottery.id}: expired, refunded ${refundedUsers} users, total ${totalRefund} TJS`);
        results.push({
          lottery_id: lottery.id,
          title: lottery.title,
          status: 'EXPIRED_AND_REFUNDED',
          refunded_users: refundedUsers,
          total_refund: totalRefund,
        });
      } catch (lotteryError) {
        console.error(`[CleanupExpiredLotteries] Error processing lottery ${lottery.id}:`, lotteryError);
        results.push({
          lottery_id: lottery.id,
          title: lottery.title,
          status: 'ERROR',
          refunded_users: 0,
          total_refund: 0,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length} expired lotteries`,
        processed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[CleanupExpiredLotteries] Error:', errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
