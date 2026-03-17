// Telegram Bot 定时通知处理器
// 定期处理通知队列，确保通知及时发送

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 调用通知发送器
async function callNotificationSender(supabaseUrl: string, serviceKey: string): Promise<any> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/telegram-notification-sender`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        batchSize: 100 // 每次处理100条通知
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error calling notification sender:', error);
    throw error;
  }
}

// 清理过期的会话
async function cleanupExpiredSessions(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('bot_sessions')
      .delete()
      .lt('expires_at', new Date().toISOString());

    if (error) {
      throw error;
    }

    return data?.length || 0;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error cleaning up expired sessions:', error);
    return 0;
  }
}

// 清理旧的消息记录 (保留30天)
async function cleanupOldMessages(supabase: any): Promise<number> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('bot_messages')
      .delete()
      .lt('created_at', thirtyDaysAgo);

    if (error) {
      throw error;
    }

    return data?.length || 0;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error cleaning up old messages:', error);
    return 0;
  }
}

// 清理失败的通知 (保留7天)
async function cleanupFailedNotifications(supabase: any): Promise<number> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('notification_queue')
      .delete()
      .eq('status', 'failed')
      .lt('created_at', sevenDaysAgo);

    if (error) {
      throw error;
    }

    return data?.length || 0;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error cleaning up failed notifications:', error);
    return 0;
  }
}

// 检查彩票开奖提醒
async function checkLotteryDrawReminders(supabase: any): Promise<number> {
  try {
    // 查找10分钟后开奖的彩票
    const tenMinutesLater = new Date(Date.now() + 10 * 60 * 1000);
    const elevenMinutesLater = new Date(Date.now() + 11 * 60 * 1000);

    const { data: lotteries } = await supabase
      .from('lotteries')
      .select(`
        id,
        title,
        draw_time,
        lottery_entries(
          user_id,
          numbers,
          users(telegram_id)
        )
      `)
      .eq('status', 'ACTIVE')
      .gte('draw_time', tenMinutesLater.toISOString())
      .lt('draw_time', elevenMinutesLater.toISOString());

    if (!lotteries || lotteries.length === 0) {
      return 0;
    }

    let notificationsCreated = 0;

    for (const lottery of lotteries) {
      for (const entry of lottery.lottery_entries) {
        if (entry.users?.telegram_id) {
          // 获取用户的Bot设置
          const { data: settings } = await supabase
            .from('bot_user_settings')
            .select('telegram_chat_id')
            .eq('user_id', entry.user_id)
            .single();

          if (settings) {
            // 创建开奖提醒通知
            await supabase
              .from('notification_queue')
              .insert({
                user_id: entry.user_id,
                telegram_chat_id: settings.telegram_chat_id,
                notification_type: 'lottery_draw_soon',
                type: 'lottery_draw_soon',
                title: 'Lottery Draw Reminder',
                message: 'Your lottery is about to draw',
                data: {
                  lottery_id: lottery.id,
                  lottery_title: lottery.title,
                  product_name: lottery.title,
                  ticket_number: entry.numbers
                },
                payload: {
                  lottery_id: lottery.id,
                  lottery_title: lottery.title,
                  product_name: lottery.title,
                  ticket_number: entry.numbers
                },
                status: 'pending',
                priority: 2,
                scheduled_at: new Date().toISOString()
              });

            notificationsCreated++;
          }
        }
      }
    }

    return notificationsCreated;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error checking lottery draw reminders:', error);
    return 0;
  }
}

// 生成每日活跃用户摘要 (可选功能)
async function generateDailySummary(supabase: any): Promise<number> {
  try {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    
    // 检查是否已经生成过今日摘要
    const { data: existingSummary } = await supabase
      .from('notification_queue')
      .select('id')
      .eq('notification_type', 'daily_summary')
      .gte('created_at', today.toISOString().split('T')[0])
      .single();

    if (existingSummary) {
      return 0; // 已经生成过了
    }

    // 获取启用每日摘要的用户
    const { data: usersWithSummary } = await supabase
      .from('bot_user_settings')
      .select('user_id, telegram_chat_id, language_code')
      .eq('daily_summary', true)
      .eq('notifications_enabled', true);

    if (!usersWithSummary || usersWithSummary.length === 0) {
      return 0;
    }

    let summariesCreated = 0;

    for (const userSettings of usersWithSummary) {
      // 获取用户昨日活动数据
      const { data: userStats } = await supabase
        .from('lottery_entries')
        .select('id, purchase_price')
        .eq('user_id', userSettings.user_id)
        .gte('created_at', yesterday.toISOString())
        .lt('created_at', today.toISOString());

      const totalSpent = userStats?.reduce((sum: number, entry: any) => sum + parseFloat(entry.purchase_price), 0) || 0;
      const ticketCount = userStats?.length || 0;

      if (ticketCount > 0) {
        // 创建每日摘要通知
        await supabase
          .from('notification_queue')
          .insert({
            user_id: userSettings.user_id,
            telegram_chat_id: userSettings.telegram_chat_id,
            notification_type: 'daily_summary',
            title: '每日摘要',
            message: '您的每日活动摘要',
            data: {
              date: yesterday.toISOString().split('T')[0],
              ticket_count: ticketCount,
              total_spent: totalSpent
            },
            priority: 3, // 低优先级
            scheduled_at: new Date(today.getTime() + 9 * 60 * 60 * 1000).toISOString() // 延迟到上午9点发送
          });

        summariesCreated++;
      }
    }

    return summariesCreated;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error generating daily summary:', error);
    return 0;
  }
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting cron job execution at:', new Date().toISOString());

    const results = {
      timestamp: new Date().toISOString(),
      tasks: {} as Record<string, any>
    };

    // 1. 处理通知队列
    try {
      console.log('Processing notification queue...');
      const notificationResult = await callNotificationSender(supabaseUrl, supabaseServiceKey);
      results.tasks.notifications = notificationResult;
      console.log('Notification processing result:', notificationResult);
    } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
      console.error('Failed to process notifications:', error);
      results.tasks.notifications = { error: errMsg };
    }

    // 2. 检查彩票开奖提醒
    try {
      console.log('Checking lottery draw reminders...');
      const remindersCreated = await checkLotteryDrawReminders(supabase);
      results.tasks.lotteryReminders = { created: remindersCreated };
      console.log(`Created ${remindersCreated} lottery draw reminders`);
    } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
      console.error('Failed to check lottery reminders:', error);
      results.tasks.lotteryReminders = { error: errMsg };
    }

    // 3. 清理任务 (每小时执行一次)
    const currentHour = new Date().getHours();
    if (currentHour % 1 === 0) { // 每小时执行
      try {
        console.log('Running cleanup tasks...');
        
        // 清理过期会话
        const expiredSessions = await cleanupExpiredSessions(supabase);
        
        // 清理旧消息 (仅在凌晨2点执行)
        let oldMessages = 0;
        if (currentHour === 2) {
          oldMessages = await cleanupOldMessages(supabase);
        }
        
        // 清理失败通知 (仅在凌晨3点执行)
        let failedNotifications = 0;
        if (currentHour === 3) {
          failedNotifications = await cleanupFailedNotifications(supabase);
        }

        results.tasks.cleanup = {
          expiredSessions,
          oldMessages,
          failedNotifications
        };
        
        console.log(`Cleanup completed: ${expiredSessions} sessions, ${oldMessages} messages, ${failedNotifications} notifications`);
      } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
        console.error('Failed to run cleanup tasks:', error);
        results.tasks.cleanup = { error: errMsg };
      }
    }

    // 4. 生成每日摘要 (每天早上8点执行)
    if (currentHour === 8) {
      try {
        console.log('Generating daily summaries...');
        const summariesCreated = await generateDailySummary(supabase);
        results.tasks.dailySummary = { created: summariesCreated };
        console.log(`Created ${summariesCreated} daily summaries`);
      } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
        console.error('Failed to generate daily summaries:', error);
        results.tasks.dailySummary = { error: errMsg };
      }
    }

    console.log('Cron job completed successfully:', results);

    return new Response(JSON.stringify({
      success: true,
      message: 'Cron job executed successfully',
      results: results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Cron job error:', error);
    
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Cron job failed',
      message: errMsg,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});