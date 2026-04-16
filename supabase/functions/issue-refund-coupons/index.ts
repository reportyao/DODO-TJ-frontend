import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

/**
 * issue-refund-coupons
 * 
 * 由 auto-lottery-draw 异步调用，为未中奖用户批量发放 1 TJS 抵扣券。
 * 
 * 接收参数:
 *   - lottery_id: 彩票活动 ID
 *   - lottery_title: 彩票活动标题（用于通知消息）
 *   - lottery_title_i18n: 彩票活动多语言标题（可选）
 *   - losers: [{ user_id: string, coupon_count: number }]
 * 
 * 处理逻辑:
 *   1. 为每个未中奖用户按 coupon_count 批量插入 coupons 记录
 *   2. 向 notification_queue 插入 coupon_issued 通知
 *   3. 每张抵扣券面额 1 TJS，有效期 30 天
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { lottery_id, lottery_title, lottery_title_i18n, losers } = await req.json();

    if (!lottery_id || !losers || !Array.isArray(losers) || losers.length === 0) {
      throw new Error('Missing required parameters: lottery_id, losers');
    }

    console.log(`[IssueRefundCoupons] Starting coupon issuance for lottery: ${lottery_id}, ${losers.length} users`);

    // [B2修复] 幂等性检查：检查是否已为该活动发过抵扣券
    const { count: existingCoupons } = await supabase
      .from('coupons')
      .select('*', { count: 'exact', head: true })
      .eq('related_lottery_id', lottery_id)
      .eq('source', 'LOTTERY_REFUND');

    if (existingCoupons && existingCoupons > 0) {
      console.log(`[IssueRefundCoupons] Coupons already issued for lottery ${lottery_id} (${existingCoupons} coupons found). Skipping.`);
      return new Response(
        JSON.stringify({
          success: true,
          alreadyIssued: true,
          data: {
            lottery_id: lottery_id,
            existing_coupons: existingCoupons,
            message: 'Coupons already issued for this lottery',
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // 计算过期时间：当前时间 + 30 天
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const expiresAtStr = expiresAt.toISOString();
    const now = new Date().toISOString();

    let totalCouponsIssued = 0;
    let totalUsersProcessed = 0;
    const errors: string[] = [];

    // 批量查询所有用户的 phone_number，用于通知
    const allUserIds = losers.map((l: any) => l.user_id).filter(Boolean);
    const userPhoneMap: Record<string, string | null> = {};
    if (allUserIds.length > 0) {
      // 分批查询用户 phone_number（每批最多 100 个）
      for (let k = 0; k < allUserIds.length; k += 100) {
        const batchIds = allUserIds.slice(k, k + 100);
        const { data: usersData } = await supabase
          .from('users')
          .select('id, phone_number')
          .in('id', batchIds);
        usersData?.forEach((u: any) => {
          userPhoneMap[u.id] = u.phone_number || null;
        });
      }
    }

    // 分批处理用户，每批最多 50 个用户（避免单次 INSERT 过大）
    const BATCH_SIZE = 50;

    for (let i = 0; i < losers.length; i += BATCH_SIZE) {
      const batch = losers.slice(i, i + BATCH_SIZE);

      // 构建当前批次的所有抵扣券记录
      const couponRecords: any[] = [];
      const notificationRecords: any[] = [];

      for (const loser of batch) {
        const { user_id, coupon_count } = loser;

        if (!user_id || !coupon_count || coupon_count <= 0) {
          console.warn(`[IssueRefundCoupons] Skipping invalid loser data:`, loser);
          continue;
        }

        // 为该用户生成 coupon_count 张抵扣券
        for (let j = 0; j < coupon_count; j++) {
          couponRecords.push({
            user_id: user_id,
            amount: 1, // 每张 1 TJS
            status: 'VALID',
            source: 'LOTTERY_REFUND',
            related_lottery_id: lottery_id,
            expires_at: expiresAtStr,
            created_at: now,
            updated_at: now,
          });
        }

        // 为该用户生成一条通知（合并为一条，告知总张数）
        // 【修复 H2】补充 notification_queue 必填字段
        // 【修复 M4】添加多语言通知消息
        const lotteryTitleDisplay = lottery_title || 'Unknown';
        notificationRecords.push({
          user_id: user_id,
          phone_number: userPhoneMap[user_id] || null,
          type: 'coupon_issued',
          payload: {
            lottery_id: lottery_id,
            lottery_title: lotteryTitleDisplay,
            count: coupon_count,
            expires_at: expiresAtStr,
          },
          notification_type: 'coupon_issued',
          title: '抵扣券到账',
          message: `很遗憾您在"${lotteryTitleDisplay}"中未中奖。已为您返还 ${coupon_count} 张 1 TJS 抵扣券，有效期 30 天。`,
          data: {
            lottery_id: lottery_id,
            lottery_title: lotteryTitleDisplay,
            lottery_title_i18n: lottery_title_i18n || null,
            count: coupon_count,
            expires_at: expiresAtStr,
          },
          channel: 'whatsapp',
          priority: 2,
          status: 'pending',
          scheduled_at: now,
          retry_count: 0,
          max_retries: 3,
          created_at: now,
          updated_at: now,
        });

        totalCouponsIssued += coupon_count;
        totalUsersProcessed++;
      }

      // 批量插入抵扣券
      if (couponRecords.length > 0) {
        const { error: couponError } = await supabase
          .from('coupons')
          .insert(couponRecords);

        if (couponError) {
          const errMsg = `Batch ${Math.floor(i / BATCH_SIZE) + 1}: Failed to insert coupons: ${couponError.message}`;
          console.error(`[IssueRefundCoupons] ${errMsg}`);
          errors.push(errMsg);
          // 继续处理下一批，不中断
          continue;
        }
      }

      // 批量插入通知队列
      if (notificationRecords.length > 0) {
        const { error: notifError } = await supabase
          .from('notification_queue')
          .insert(notificationRecords);

        if (notifError) {
          console.error(`[IssueRefundCoupons] Batch ${Math.floor(i / BATCH_SIZE) + 1}: Failed to insert notifications:`, notifError);
          // 通知失败不影响抵扣券发放
        }
      }

      console.log(`[IssueRefundCoupons] Batch ${Math.floor(i / BATCH_SIZE) + 1} completed: ${couponRecords.length} coupons, ${notificationRecords.length} notifications`);
    }

    console.log(`[IssueRefundCoupons] Completed: ${totalCouponsIssued} coupons issued to ${totalUsersProcessed} users for lottery ${lottery_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          lottery_id: lottery_id,
          total_users: totalUsersProcessed,
          total_coupons: totalCouponsIssued,
          errors: errors.length > 0 ? errors : undefined,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[IssueRefundCoupons] Error:', errMsg);
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
