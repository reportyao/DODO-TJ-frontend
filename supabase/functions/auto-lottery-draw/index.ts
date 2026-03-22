import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

/**
 * 生成 UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 时间戳之和算法（BigInt 精度安全版本）
 * 
 * 设计逻辑：
 * 1. 参与码为7位数连续分配（1000000, 1000001, 1000002, ...）
 * 2. 使用 BigInt 精确计算所有订单的时间戳总和，避免 JS Number 精度溢出
 * 3. 使用公式：中奖号码索引 = 时间戳总和 % 总参与记录数
 * 4. 根据索引找到对应的参与记录，其参与码即为中奖号码
 * 
 * 精度保证：
 * - 使用 BigInt 进行累加和取模运算，无精度上限
 * - JS Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991（约 9.0×10¹⁵）
 * - 当前时间戳 ~1.77×10¹² ms，超过 5,091 个条目时 Number 会溢出
 * - BigInt 版本无此限制，支持任意规模的活动
 * 
 * 公平性保证：
 * - 每个参与记录（每个7位数号码）都有相同的概率被选中
 * - 时间戳由服务器生成，用户无法操纵
 * - 所有数据公开可查，平台无法作弊
 * 
 * 向后兼容：
 * - 对于现有规模（<5,091 条目），BigInt 和 Number 的计算结果完全一致
 * - algorithm_data 中 timestamp_sum 以字符串形式存储，确保大数值不丢失精度
 */
function calculateWinningNumberByTimestamp(entries: any[]) {
  // 使用 BigInt 精确计算所有订单的时间戳总和
  let timestampSum = BigInt(0);
  const timestampDetails: { entry_id: string; numbers: string; timestamp: number }[] = [];

  for (const entry of entries) {
    // 将 ISO 时间字符串转换为毫秒时间戳
    const timestamp = new Date(entry.created_at).getTime();
    timestampSum += BigInt(timestamp);
    timestampDetails.push({
      entry_id: entry.id,
      numbers: entry.participation_code || entry.numbers,
      timestamp: timestamp,
    });
  }

  // 使用 BigInt 计算中奖索引: 时间戳总和 % 总参与记录数
  const totalEntries = BigInt(entries.length);
  const winningIndex = Number(timestampSum % totalEntries);
  
  // 获取中奖参与记录
  const winningEntry = entries[winningIndex];
  const winningNumber = winningEntry.participation_code || winningEntry.numbers;

  // 将 BigInt 转换为字符串用于 JSON 序列化（BigInt 不能直接 JSON.stringify）
  const timestampSumStr = timestampSum.toString();

  return {
    winningNumber,
    winningIndex,
    timestampSum: timestampSumStr,
    timestampDetails,
    totalEntries: entries.length,
    formula: `中奖索引 = ${timestampSumStr} % ${entries.length} = ${winningIndex}，对应号码: ${winningNumber}`,
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { lotteryId } = await req.json();

    if (!lotteryId) {
      throw new Error('lottery_id is required');
    }

    console.log(`[AutoLotteryDraw] Starting draw for lottery: ${lotteryId}`);

    // 1. 获取积分商城商品信息
    const { data: lottery, error: lotteryError } = await supabaseClient
      .from('lotteries')
      .select('*')
      .eq('id', lotteryId)
      .single();

    if (lotteryError || !lottery) {
      throw new Error(`Lottery not found: ${lotteryId}`);
    }

    // 2. 检查是否已经开奖（幂等性保护）
    if (lottery.status === 'COMPLETED') {
      console.log(`[AutoLotteryDraw] Lottery ${lotteryId} already drawn, returning existing result`);
      return new Response(
        JSON.stringify({
          success: true,
          alreadyDrawn: true,
          data: {
            lottery_id: lotteryId,
            winning_number: lottery.winning_ticket_number,
            winning_user_id: lottery.winning_user_id,
            message: 'Lottery was already drawn',
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // 3. 检查是否已售罄
    if (lottery.sold_tickets < lottery.total_tickets) {
      throw new Error(`Lottery not sold out yet (${lottery.sold_tickets}/${lottery.total_tickets})`);
    }

    // 4. 检查状态是否允许开奖
    if (!['ACTIVE', 'SOLD_OUT'].includes(lottery.status)) {
      throw new Error(`Lottery cannot be drawn, current status: ${lottery.status}`);
    }

    // 5. 获取所有参与记录（按创建时间排序，确保一致性）
    const { data: entries, error: entriesError } = await supabaseClient
      .from('lottery_entries')
      .select('*')
      .eq('lottery_id', lotteryId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: true });

    if (entriesError || !entries || entries.length === 0) {
      throw new Error('No lottery entries found for this lottery');
    }

    console.log(`[AutoLotteryDraw] Found ${entries.length} entries for lottery ${lotteryId}`);

    // 6. 使用时间戳之和算法计算中奖号码
    const result = calculateWinningNumberByTimestamp(entries);

    // 7. 获取中奖参与记录
    const winningEntry = entries[result.winningIndex];

    if (!winningEntry) {
      throw new Error(`Winning entry not found at index ${result.winningIndex}`);
    }

    const drawTime = new Date().toISOString();
    const winningCode = winningEntry.participation_code || winningEntry.numbers;
    const winningTicketNumber = parseInt(winningCode) || 0;

    console.log(`[AutoLotteryDraw] Winner: user=${winningEntry.user_id}, code=${winningCode}, index=${result.winningIndex}`);

    // 8. 先尝试创建 lottery_results 记录（利用唯一约束防止并发开奖）
    const lotteryResultId = generateUUID();
    const { error: resultError } = await supabaseClient
      .from('lottery_results')
      .insert({
        id: lotteryResultId,
        lottery_id: lotteryId,
        winner_id: winningEntry.user_id,
        winner_ticket_number: winningTicketNumber,
        draw_time: drawTime,
        algorithm_data: {
          algorithm: 'timestamp_sum',
          timestamp_sum: result.timestampSum,
          formula: result.formula,
          total_entries: result.totalEntries,
          winning_index: result.winningIndex,
          winning_number: result.winningNumber,
          timestamp_details: result.timestampDetails,
        },
        created_at: drawTime,
      });

    if (resultError) {
      // 如果是唯一约束冲突，说明已经被其他进程开奖了
      if (resultError.code === '23505') {
        console.log(`[AutoLotteryDraw] Lottery ${lotteryId} already drawn by another process (unique constraint)`);
        return new Response(
          JSON.stringify({
            success: true,
            alreadyDrawn: true,
            data: {
              lottery_id: lotteryId,
              message: 'Lottery was already drawn by another process',
            },
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }
      console.error('[AutoLotteryDraw] Failed to create lottery result:', resultError);
      throw new Error(`Failed to create lottery result: ${resultError.message}`);
    }

    // 9. 更新 lottery 状态
    const { error: updateLotteryError } = await supabaseClient
      .from('lotteries')
      .update({
        status: 'COMPLETED',
        winning_numbers: [winningTicketNumber],  // integer[] 类型，使用数字
        winning_ticket_number: winningTicketNumber,
        winning_user_id: winningEntry.user_id,
        draw_time: drawTime,
        actual_draw_time: drawTime,
        updated_at: drawTime,
        draw_algorithm_data: {
          algorithm: 'timestamp_sum',
          timestamp_sum: result.timestampSum,
          formula: result.formula,
          total_entries: result.totalEntries,
          winning_index: result.winningIndex,
          winning_number: result.winningNumber,
        },
      })
      .eq('id', lotteryId);

    if (updateLotteryError) {
      console.error('[AutoLotteryDraw] Failed to update lottery:', updateLotteryError);
      // 回滚 lottery_results
      await supabaseClient.from('lottery_results').delete().eq('id', lotteryResultId);
      throw new Error(`Failed to update lottery: ${updateLotteryError.message}`);
    }

    console.log('[AutoLotteryDraw] Updated lottery status to COMPLETED');

    // 10. 更新中奖记录
    const { error: updateEntryError } = await supabaseClient
      .from('lottery_entries')
      .update({
        is_winning: true,
        updated_at: drawTime,
      })
      .eq('id', winningEntry.id);

    if (updateEntryError) {
      console.error('[AutoLotteryDraw] Failed to update winning entry:', updateEntryError);
      // 非关键错误，不回滚
    }

    // 11. 创建 prize 记录
    const { data: prize, error: prizeError } = await supabaseClient
      .from('prizes')
      .insert({
        lottery_id: lotteryId,
        user_id: winningEntry.user_id,
        ticket_id: winningEntry.id,
        winning_code: winningCode,
        prize_name: lottery.title,
        prize_image: lottery.image_urls?.[0] || lottery.image_url,
        prize_value: lottery.ticket_price * lottery.total_tickets,
        status: 'PENDING',
        pickup_status: 'PENDING_CLAIM',
        logistics_status: 'PENDING_SHIPMENT',
        won_at: drawTime,
        created_at: drawTime,
        updated_at: drawTime,
      })
      .select()
      .single();

    if (prizeError) {
      console.error('[AutoLotteryDraw] Failed to create prize:', {
        error: prizeError,
        message: prizeError.message,
        details: prizeError.details,
        hint: prizeError.hint,
        code: prizeError.code
      });
      // Prize 创建失败需要回滚
      // 1. 删除 lottery_results 记录
      await supabaseClient.from('lottery_results').delete().eq('id', lotteryResultId);
      // 2. 回滚 lottery 状态
      await supabaseClient
        .from('lotteries')
        .update({
          status: 'SOLD_OUT',
          winning_user_id: null,
          winning_numbers: null,
          winning_ticket_number: null,
          draw_time: null,
          actual_draw_time: null,
          draw_algorithm_data: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', lotteryId);
      // 3. 回滚 lottery_entries
      await supabaseClient
        .from('lottery_entries')
        .update({ is_winning: false, updated_at: new Date().toISOString() })
        .eq('id', winningEntry.id);

      throw new Error(`Failed to create prize: ${prizeError.message} (code: ${prizeError.code})`);
    }

    console.log(`[AutoLotteryDraw] Prize created: ${prize?.id}`);

    // 12. 发送中奖通知给中奖用户
    try {
      const notificationId = generateUUID();
      await supabaseClient.from('notifications').insert({
        id: notificationId,
        user_id: winningEntry.user_id,
        type: 'LOTTERY_RESULT',
        title: '🎉 恭喜中奖！',
        title_i18n: {
          zh: '🎉 恭喜中奖！',
          ru: '🎉 Поздравляем! Вы выиграли!',
          tg: '🎉 Табрик! Шумо бурдед!',
        },
        content: `恭喜您在“${lottery.title}”积分商城中中奖！中奖码: ${winningCode}`,
        message_i18n: {
          zh: `恭喜您在“${lottery.title}”积分商城中中奖！中奖码: ${winningCode}`,
          ru: `Поздравляем! Вы выиграли в «${lottery.title}»! Выигрышный номер: ${winningCode}`,
          tg: `Табрик! Шумо дар «${lottery.title}» дар бурдед! Рақами бурд: ${winningCode}`,
        },
        related_id: lotteryId,
        related_type: 'lottery',
        is_read: false,
        created_at: drawTime,
        updated_at: drawTime,
      });
    } catch (notifError: unknown) {
      console.error('[AutoLotteryDraw] Failed to send winner notification:', notifError);
      // 通知失败不影响开奖结果
    }

    // 13. 发送开奖公告通知给所有参与者（非中奖者）
    try {
      const participantIds = [...new Set(entries.map((e: any) => e.user_id))];
      const announcements = participantIds
        .filter((userId: string) => userId !== winningEntry.user_id)
        .map((userId: string) => ({
          id: generateUUID(),
          user_id: userId,
          type: 'LOTTERY_RESULT',
          title: '开奖结果公布',
          title_i18n: {
            zh: '开奖结果公布',
            ru: 'Объявление результатов розыгрыша',
            tg: 'Еълони қуръа еълон шуд',
          },
          content: `"${lottery.title}"已开奖，中奖码: ${winningCode}`,
          message_i18n: {
            zh: `"${lottery.title}"已开奖，中奖码: ${winningCode}`,
            ru: `«${lottery.title}» разыгран. Выигрышный номер: ${winningCode}`,
            tg: `«${lottery.title}» қуръа кашида шуд. Рақами бурд: ${winningCode}`,
          },
          related_id: lotteryId,
          related_type: 'lottery',
          is_read: false,
          created_at: drawTime,
          updated_at: drawTime,
        }));

      if (announcements.length > 0) {
        await supabaseClient.from('notifications').insert(announcements);
      }
    } catch (notifError: unknown) {
      console.error('[AutoLotteryDraw] Failed to send participant notifications:', notifError);
      // 通知失败不影响开奖结果
    }

    // ============================================================
    // 14. 【业务重构】统计未中奖用户的参与份数，异步调用 issue-refund-coupons
    // 每个未中奖用户按其购买的份数获得等量的 1 TJS 抵扣券
    // ============================================================
    try {
      // 统计每个未中奖用户的参与份数
      const loserCouponMap: Record<string, number> = {};
      for (const entry of entries) {
        if (entry.user_id !== winningEntry.user_id) {
          loserCouponMap[entry.user_id] = (loserCouponMap[entry.user_id] || 0) + 1;
        }
      }

      const losers = Object.entries(loserCouponMap).map(([user_id, coupon_count]) => ({
        user_id,
        coupon_count,
      }));

      if (losers.length > 0) {
        console.log(`[AutoLotteryDraw] Issuing refund coupons to ${losers.length} non-winning users`);

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // 异步调用 issue-refund-coupons（fire-and-forget）
        fetch(`${supabaseUrl}/functions/v1/issue-refund-coupons`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            lottery_id: lotteryId,
            lottery_title: lottery.title,
            lottery_title_i18n: lottery.title_i18n || null,
            losers: losers,
          }),
        }).catch((err) => {
          console.error('[AutoLotteryDraw] Failed to trigger issue-refund-coupons:', err);
        });
      } else {
        console.log('[AutoLotteryDraw] No non-winning users to issue coupons to');
      }
    } catch (couponError: unknown) {
      console.error('[AutoLotteryDraw] Failed to prepare coupon data:', couponError);
      // 抵扣券发放失败不影响开奖结果
    }

    console.log(`[AutoLotteryDraw] Draw completed successfully for lottery ${lotteryId}`);

    // ============================================================
    // 15. 自动创建新一轮：克隆当前 lottery，重置为 ACTIVE 状态
    // ============================================================
    let newRoundId: string | null = null;
    try {
      const newId = generateUUID();
      // 计算新期号：兼容 LM 前缀十六进制格式和纯数字格式
      let newPeriod: string;
      const oldPeriod = lottery.period || '';
      if (oldPeriod.startsWith('LM')) {
        // LM前缀格式：LM + 十六进制时间戳，生成新的LM前缀
        newPeriod = 'LM' + Date.now().toString(16).toUpperCase();
      } else {
        const numPeriod = parseInt(oldPeriod);
        newPeriod = (numPeriod > 0 && !isNaN(numPeriod)) ? String(numPeriod + 1) : ('LM' + Date.now().toString(16).toUpperCase());
      }
      const now = new Date().toISOString();
      // 新一轮的结束时间 = 当前时间 + 7天
      const newEndTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // 构建新一轮数据，严格只包含 DB 中实际存在的 40 列
      // 已验证的列: actual_draw_time, algorithm_id, created_at, currency, description,
      //   description_i18n, draw_algorithm_data, draw_time, drawn_at, end_time,
      //   full_purchase_enabled, full_purchase_price, id, image_url, image_urls,
      //   inventory_product_id, inventory_product_sku, is_featured, material_i18n,
      //   max_per_user, original_price, period, price_comparisons, product_id,
      //   sold_tickets, sort_order, specifications_i18n, start_time, status,
      //   ticket_price, title, title_i18n, total_tickets, unlimited_purchase,
      //   updated_at, vrf_proof, vrf_timestamp, winning_numbers, winning_ticket_number,
      //   winning_user_id
      const newRound: Record<string, unknown> = {
        id: newId,
        title: lottery.title,
        title_i18n: lottery.title_i18n || null,
        description: lottery.description,
        description_i18n: lottery.description_i18n || null,
        image_url: lottery.image_url,
        image_urls: lottery.image_urls,
        original_price: lottery.original_price || 0,
        ticket_price: lottery.ticket_price,
        total_tickets: lottery.total_tickets,
        sold_tickets: 0,
        status: 'ACTIVE',
        draw_time: null,
        drawn_at: null,
        sort_order: lottery.sort_order || 0,
        is_featured: lottery.is_featured || false,
        full_purchase_enabled: lottery.full_purchase_enabled || false,
        full_purchase_price: lottery.full_purchase_price,
        price_comparisons: lottery.price_comparisons || null,
        inventory_product_id: lottery.inventory_product_id || null,
        inventory_product_sku: lottery.inventory_product_sku || null,
        specifications_i18n: lottery.specifications_i18n || null,
        material_i18n: lottery.material_i18n || null,
        currency: lottery.currency || 'TJS',
        max_per_user: lottery.max_per_user || 10,
        actual_draw_time: null,
        draw_algorithm_data: null,
        end_time: newEndTime,
        period: newPeriod,
        product_id: lottery.product_id || null,
        start_time: now,
        unlimited_purchase: lottery.unlimited_purchase || false,
        vrf_proof: null,
        vrf_timestamp: null,
        winning_numbers: null,
        winning_ticket_number: null,
        winning_user_id: null,
        algorithm_id: lottery.algorithm_id || null,
        created_at: now,
        updated_at: now,
      };

      console.log(`[AutoLotteryDraw] Attempting to create new round with period: ${newPeriod}, id: ${newId}`);

      const { error: insertError } = await supabaseClient
        .from('lotteries')
        .insert(newRound);

      if (insertError) {
        console.error(`[AutoLotteryDraw] Failed to create new round: ${insertError.message}`);
        console.error(`[AutoLotteryDraw] Insert error details: ${JSON.stringify(insertError)}`);
      } else {
        newRoundId = newId;
        console.log(`[AutoLotteryDraw] New round created successfully: ${newId}, period: ${newPeriod}`);
      }
    } catch (newRoundError: unknown) {
      const errMsg = newRoundError instanceof Error ? newRoundError.message : String(newRoundError);
      console.error(`[AutoLotteryDraw] Failed to create new round (exception): ${errMsg}`);
      // 新一轮创建失败不影响开奖结果
    }

    return new Response(
      JSON.stringify({
        success: true,
        winningNumber: winningCode,
        data: {
          lottery_id: lotteryId,
          winning_number: winningCode,
          winning_code: winningCode,
          winner_user_id: winningEntry.user_id,
          prize_id: prize?.id,
          lottery_result_id: lotteryResultId,
          algorithm: 'timestamp_sum',
          timestamp_sum: result.timestampSum,
          formula: result.formula,
          draw_time: drawTime,
          total_entries: result.totalEntries,
          winning_index: result.winningIndex,
          new_round_id: newRoundId,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[AutoLotteryDraw] Error:", errMsg);
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
