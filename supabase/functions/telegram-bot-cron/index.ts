/**
 * notification-cron (formerly telegram-bot-cron) - 通知定时任务
 *
 * 【迁移修复】从 Telegram Bot Cron 迁移为通用通知定时任务
 * - 移除所有 Telegram Bot API 调用
 * - 保留通知队列处理（调用 telegram-notification-sender，内部已改为 WhatsApp）
 * - 保留数据库清理任务（过期会话、旧消息、失败通知）
 * - 保留每日摘要生成
 *
 * 函数名保持 telegram-bot-cron 以兼容已配置的 Supabase cron job 调度
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 调用通知发送器（内部已迁移为 WhatsApp 发送）
async function callNotificationSender(supabaseUrl: string, serviceKey: string): Promise<any> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/telegram-notification-sender`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ batch_size: 20 }) // 每次处理 20 条，避免超时
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error calling notification sender:', errMsg);
    throw error;
  }
}

// 清理过期的 bot_sessions（兼容旧数据，新项目不再写入）
async function cleanupExpiredSessions(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('bot_sessions')
      .delete()
      .lt('expires_at', new Date().toISOString());
    if (error) throw error;
    return data?.length || 0;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error cleaning up expired sessions:', errMsg);
    return 0;
  }
}

// 清理旧 bot_messages（兼容旧数据，新项目不再写入）
async function cleanupOldMessages(supabase: any): Promise<number> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('bot_messages')
      .delete()
      .lt('created_at', thirtyDaysAgo);
    if (error) throw error;
    return data?.length || 0;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error cleaning up old messages:', errMsg);
    return 0;
  }
}

// 清理失败通知（超过7天且已失败/已跳过/已发送的通知）
// 同时恢复超时的 processing 状态记录（防止死锁）
async function cleanupFailedNotifications(supabase: any): Promise<number> {
  let cleaned = 0;

  try {
    // 1. 删除超过7天的已完成通知（failed/skipped/sent）
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: deletedOld, error: deleteError } = await supabase
      .from('notification_queue')
      .delete()
      .in('status', ['failed', 'skipped', 'sent'])
      .lt('created_at', sevenDaysAgo)
      .select('id');
    if (!deleteError) cleaned += deletedOld?.length || 0;
  } catch (err: unknown) {
    console.error('Error deleting old notifications:', err instanceof Error ? err.message : String(err));
  }

  try {
    // 2. 恢复超时的 processing 状态（防止 Edge Function 崩溃导致死锁）
    // 超过 10 分钟仍在 processing 的记录，回滚为 pending 重新处理
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recovered, error: recoverError } = await supabase
      .from('notification_queue')
      .update({
        status: 'pending',
        updated_at: new Date().toISOString(),
        error_message: 'Recovered from stuck processing state (timeout > 10 min)',
      })
      .eq('status', 'processing')
      .lt('updated_at', tenMinutesAgo)
      .select('id');
    if (!recoverError && recovered?.length > 0) {
      console.log(`[RECOVERY] Recovered ${recovered.length} stuck notifications from processing state`);
      cleaned += recovered.length;
    }
  } catch (err: unknown) {
    console.error('Error recovering stuck notifications:', err instanceof Error ? err.message : String(err));
  }

  return cleaned;
}

// 检查彩票开奖提醒（写入 notification_queue，由 WhatsApp 发送）
async function checkLotteryDrawReminders(supabase: any): Promise<number> {
  try {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    const { data: lotteries, error } = await supabase
      .from('lotteries')
      .select('id, title, draw_time')
      .eq('status', 'ACTIVE')
      .gte('draw_time', now.toISOString())
      .lte('draw_time', oneHourLater.toISOString());

    if (error || !lotteries || lotteries.length === 0) return 0;

    let remindersCreated = 0;
    for (const lottery of lotteries) {
      // 获取参与此彩票的用户
      const { data: entries } = await supabase
        .from('lottery_entries')
        .select('user_id, users!inner(phone_number, preferred_language)')
        .eq('lottery_id', lottery.id)
        .eq('status', 'ACTIVE');

      if (!entries) continue;

      for (const entry of entries) {
        const user = entry.users;
        if (!user?.phone_number) continue;

        // 检查是否已发送过此提醒
        const { data: existing } = await supabase
          .from('notification_queue')
          .select('id')
          .eq('user_id', entry.user_id)
          .eq('type', 'lottery_draw_reminder')
          .contains('data', { lottery_id: lottery.id })
          .limit(1);

        if (existing && existing.length > 0) continue;

        await supabase.from('notification_queue').insert({
          user_id: entry.user_id,
          phone_number: user.phone_number,
          type: 'lottery_draw_reminder',
          notification_type: 'lottery_draw_reminder',
          title: '开奖提醒',
          message: `您参与的彩票即将开奖`,
          data: {
            lottery_id: lottery.id,
            lottery_title: lottery.title,
            draw_time: lottery.draw_time,
          },
          priority: 2,
          status: 'pending',
          channel: 'whatsapp',
          scheduled_at: new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString(),
        });
        remindersCreated++;
      }
    }
    return remindersCreated;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error checking lottery draw reminders:', errMsg);
    return 0;
  }
}

// 生成每日摘要（写入 notification_queue，由 WhatsApp 发送）
async function generateDailySummary(supabase: any): Promise<number> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    const { data: activeUsers, error } = await supabase
      .from('users')
      .select('id, phone_number, preferred_language')
      .eq('status', 'ACTIVE')
      .not('phone_number', 'is', null)
      .eq('whatsapp_opt_in', true);

    if (error || !activeUsers) return 0;

    let summariesCreated = 0;
    for (const user of activeUsers) {
      if (!user.phone_number) continue;

      // 获取昨日参与统计
      const { count: ticketCount } = await supabase
        .from('lottery_entries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', yesterday.toISOString())
        .lt('created_at', today.toISOString());

      const { data: transactions } = await supabase
        .from('wallet_transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('type', 'DEBIT')
        .gte('created_at', yesterday.toISOString())
        .lt('created_at', today.toISOString());

      const totalSpent = transactions?.reduce((sum: number, t: any) => sum + (t.amount || 0), 0) || 0;

      if ((ticketCount || 0) === 0) continue;

      await supabase.from('notification_queue').insert({
        user_id: user.id,
        phone_number: user.phone_number,
        type: 'daily_summary',
        notification_type: 'daily_summary',
        title: '每日摘要',
        message: `您的每日活动摘要`,
        data: {
          date: yesterday.toISOString().split('T')[0],
          ticket_count: ticketCount,
          total_spent: totalSpent,
        },
        priority: 3,
        status: 'pending',
        channel: 'whatsapp',
        scheduled_at: new Date(today.getTime() + 9 * 60 * 60 * 1000).toISOString(),
      });
      summariesCreated++;
    }
    return summariesCreated;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error generating daily summary:', errMsg);
    return 0;
  }
}

serve(async (req) => {
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting cron job execution at:', new Date().toISOString());
    const results: Record<string, any> = {
      timestamp: new Date().toISOString(),
      tasks: {},
    };

    // 1. 处理通知队列（WhatsApp 发送）
    try {
      const notificationResult = await callNotificationSender(supabaseUrl, supabaseServiceKey);
      results.tasks.notifications = notificationResult;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      results.tasks.notifications = { error: errMsg };
    }

    // 2. 检查彩票开奖提醒
    try {
      const remindersCreated = await checkLotteryDrawReminders(supabase);
      results.tasks.lotteryReminders = { created: remindersCreated };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      results.tasks.lotteryReminders = { error: errMsg };
    }

    // 3. 清理任务
    const currentHour = new Date().getHours();
    try {
      const expiredSessions = await cleanupExpiredSessions(supabase);
      let oldMessages = 0;
      if (currentHour === 2) {
        oldMessages = await cleanupOldMessages(supabase);
      }
      // processing 超时恢复：每次 cron 都执行（防止死锁）
      // 旧通知清理：仅凌晨3点执行
      const failedNotifications = await cleanupFailedNotifications(supabase);
      results.tasks.cleanup = { expiredSessions, oldMessages, failedNotifications };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      results.tasks.cleanup = { error: errMsg };
    }

    // 4. 生成每日摘要（每天早上8点执行）
    if (currentHour === 8) {
      try {
        const summariesCreated = await generateDailySummary(supabase);
        results.tasks.dailySummary = { created: summariesCreated };
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        results.tasks.dailySummary = { error: errMsg };
      }
    }

    console.log('Cron job completed:', results);
    return new Response(
      JSON.stringify({ success: true, message: 'Cron job executed successfully', results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Cron job error:', errMsg);
    return new Response(
      JSON.stringify({ success: false, error: 'Cron job failed', message: errMsg, timestamp: new Date().toISOString() }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
