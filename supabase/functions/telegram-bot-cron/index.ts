/**
 * notification-cron (formerly telegram-bot-cron) - 通知定时任务
 *
 * 【迁移修复】从 Telegram Bot Cron 迁移为通用通知定时任务
 * - 移除所有 Telegram Bot API 调用
 * - 保留通知队列处理（调用 telegram-notification-sender，内部已改为 WhatsApp）
 * - 保留数据库清理任务（过期会话、旧消息、失败通知）
 * - 【更新】移除不再支持的通知生成逻辑（开奖提醒、每日摘要），以匹配新的 WhatsApp 通知范围
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
      .lt('expires_at', new Date().toISOString())
      .select('id');
    if (error) {throw error;}
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
      .lt('created_at', thirtyDaysAgo)
      .select('id');
    if (error) {throw error;}
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
    if (!deleteError) {cleaned += deletedOld?.length || 0;}
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

    // 2. 清理任务
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
