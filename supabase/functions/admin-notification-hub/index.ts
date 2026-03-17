/**
 * TezBarakat 管理员通知系统 - 通知中心
 * 
 * 功能: 接收事件数据，格式化消息，查询订阅关系，分发到各通知渠道
 * 触发: 由 admin-queue-processor 调用
 * 
 * @author Manus AI
 * @version 1.0.0
 * @date 2026-02-03
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 事件类型到中文名称的映射
const EVENT_TYPE_NAMES: Record<string, string> = {
  'new_deposit_request': '充值审核',
  'new_withdrawal_request': '提现审核',
  'new_group_buy_join': '拼团参与',
  'new_lottery_purchase': '积分商城购买',
}

// 事件类型到 Emoji 的映射
const EVENT_TYPE_EMOJI: Record<string, string> = {
  'new_deposit_request': '🔔',
  'new_withdrawal_request': '💰',
  'new_group_buy_join': '🛒',
  'new_lottery_purchase': '🎰',
}

interface NotificationRequest {
  queue_id: string
  event_type: string
  event_data: Record<string, any>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  console.log('[admin-notification-hub] 收到通知请求')

  try {
    // 创建 Supabase 客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 解析请求
    const { queue_id, event_type, event_data }: NotificationRequest = await req.json()
    console.log('[admin-notification-hub] 事件类型:', event_type)
    console.log('[admin-notification-hub] 队列ID:', queue_id)

    // 1. 格式化消息
    const formattedMessage = await formatMessage(supabase, event_type, event_data)
    console.log('[admin-notification-hub] 消息已格式化')

    // 2. 查询订阅该事件的渠道
    const { data: subscriptions, error: subError } = await supabase
      .from('admin_notification_subscriptions')
      .select(`
        id,
        event_type,
        priority,
        channel:admin_notification_channels (
          id,
          name,
          channel_type,
          webhook_url,
          chat_id,
          bot_token,
          is_active
        )
      `)
      .eq('event_type', event_type)
      .eq('is_active', true)

    if (subError) {
      throw new Error(`Failed to fetch subscriptions: ${subError.message}`)
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('[admin-notification-hub] 没有找到订阅该事件的渠道')
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: formattedMessage,
          channels_notified: 0,
          reason: 'No active subscriptions for this event type'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[admin-notification-hub] 找到 ${subscriptions.length} 个订阅渠道`)

    // 3. 分发到各渠道
    const dispatchResults = []
    
    for (const sub of subscriptions) {
      const channel = sub.channel as any
      
      if (!channel || !channel.is_active) {
        console.log(`[admin-notification-hub] 跳过非活跃渠道: ${channel?.name || 'unknown'}`)
        continue
      }

      console.log(`[admin-notification-hub] 发送到渠道: ${channel.name} (${channel.channel_type})`)

      try {
        let dispatchResult: any = null

        switch (channel.channel_type) {
          case 'feishu':
            dispatchResult = await dispatchToFeishu(
              supabaseUrl,
              supabaseServiceKey,
              channel,
              formattedMessage,
              event_type,
              event_data
            )
            break

          case 'telegram':
            dispatchResult = await dispatchToTelegram(
              supabaseUrl,
              supabaseServiceKey,
              channel,
              formattedMessage
            )
            break

          default:
            console.log(`[admin-notification-hub] 不支持的渠道类型: ${channel.channel_type}`)
            dispatchResult = { success: false, error: 'Unsupported channel type' }
        }

        // 记录发送日志
        await supabase
          .from('admin_notification_logs')
          .insert({
            queue_id: queue_id,
            channel_id: channel.id,
            event_type: event_type,
            channel_type: channel.channel_type,
            channel_name: channel.name,
            message: formattedMessage,
            status: dispatchResult.success ? 'success' : 'failed',
            error_message: dispatchResult.error || null,
            response_data: dispatchResult.response || null,
          })

        dispatchResults.push({
          channel_name: channel.name,
          channel_type: channel.channel_type,
          ...dispatchResult,
        })

      } catch (dispatchError: unknown) {
    const dispatchErrorMsg = dispatchError instanceof Error ? dispatchErrorMsg : String(dispatchError);
        console.error(`[admin-notification-hub] 发送到 ${channel.name} 失败:`, dispatchErrorMsg)
        
        // 记录失败日志
        await supabase
          .from('admin_notification_logs')
          .insert({
            queue_id: queue_id,
            channel_id: channel.id,
            event_type: event_type,
            channel_type: channel.channel_type,
            channel_name: channel.name,
            message: formattedMessage,
            status: 'failed',
            error_message: dispatchErrorMsg,
          })

        dispatchResults.push({
          channel_name: channel.name,
          channel_type: channel.channel_type,
          success: false,
          error: dispatchErrorMsg,
        })
      }
    }

    // 4. 统计结果
    const successCount = dispatchResults.filter(r => r.success).length
    const failCount = dispatchResults.filter(r => !r.success).length

    const duration = Date.now() - startTime
    console.log(`[admin-notification-hub] 处理完成，耗时: ${duration}ms`)
    console.log(`[admin-notification-hub] 结果: 成功=${successCount}, 失败=${failCount}`)

    // 如果所有渠道都失败，返回失败状态
    if (successCount === 0 && dispatchResults.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'All dispatch attempts failed',
          message: formattedMessage,
          channels_notified: 0,
          dispatch_results: dispatchResults,
          duration_ms: duration,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: formattedMessage,
        channels_notified: successCount,
        dispatch_results: dispatchResults,
        duration_ms: duration,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    const duration = Date.now() - startTime
    console.error('[admin-notification-hub] 错误:', errMsg)

    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
        duration_ms: duration,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * 格式化消息内容
 */
async function formatMessage(
  supabase: any,
  eventType: string,
  eventData: Record<string, any>
): Promise<string> {
  const emoji = EVENT_TYPE_EMOJI[eventType] || '📢'
  const eventName = EVENT_TYPE_NAMES[eventType] || eventType
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' })

  let message = `${emoji} 【${eventName}提醒】\n\n`

  switch (eventType) {
    case 'new_deposit_request': {
      // 获取用户信息
      let userName = eventData.user_id
      if (eventData.user_id) {
        const { data: user } = await supabase
          .from('users')
          .select('username, telegram_username, phone')
          .eq('id', eventData.user_id)
          .single()
        
        if (user) {
          userName = user.username || user.telegram_username || user.phone || eventData.user_id
        }
      }

      message += `👤 用户: ${userName}\n`
      message += `💵 金额: ${eventData.amount} ${eventData.currency || 'TJS'}\n`
      message += `💳 支付方式: ${eventData.payment_method || '未知'}\n`
      message += `📋 订单号: ${eventData.order_number || '无'}\n`
      message += `⏰ 时间: ${timestamp}\n`
      message += `\n👉 请及时登录后台审核: https://tezbarakat.com/admin`
      break
    }

    case 'new_withdrawal_request': {
      // 获取用户信息
      let userName = eventData.user_id
      if (eventData.user_id) {
        const { data: user } = await supabase
          .from('users')
          .select('username, telegram_username, phone')
          .eq('id', eventData.user_id)
          .single()
        
        if (user) {
          userName = user.username || user.telegram_username || user.phone || eventData.user_id
        }
      }

      message += `👤 用户: ${userName}\n`
      message += `💵 金额: ${eventData.amount} ${eventData.currency || 'TJS'}\n`
      message += `🏦 提现方式: ${eventData.withdrawal_method || '未知'}\n`
      message += `📋 订单号: ${eventData.order_number || '无'}\n`
      message += `⏰ 时间: ${timestamp}\n`
      message += `\n👉 请及时登录后台审核: https://tezbarakat.com/admin`
      break
    }

    case 'new_group_buy_join': {
      // 获取用户和拼团信息
      let userName = eventData.user_id
      let productName = '未知商品'
      let sessionInfo = ''

      if (eventData.user_id) {
        const { data: user } = await supabase
          .from('users')
          .select('username, telegram_username')
          .eq('id', eventData.user_id)
          .single()
        
        if (user) {
          userName = user.username || user.telegram_username || eventData.user_id
        }
      }

      if (eventData.session_id) {
        const { data: session } = await supabase
          .from('group_buy_sessions')
          .select(`
            session_code,
            current_participants,
            max_participants,
            product:group_buy_products (title)
          `)
          .eq('id', eventData.session_id)
          .single()
        
        if (session) {
          productName = session.product?.title || '未知商品'
          sessionInfo = `\n📊 进度: ${session.current_participants}/${session.max_participants}`
          message += `🔢 拼团编号: ${session.session_code}\n`
        }
      }

      message += `👤 用户: ${userName}\n`
      message += `🎁 商品: ${productName}${sessionInfo}\n`
      message += `💰 参与金额: ${eventData.amount || eventData.price || '未知'} TJS\n`
      message += `⏰ 时间: ${timestamp}`
      break
    }

    case 'new_lottery_purchase': {
      // 获取用户和抽奖信息
      let userName = eventData.user_id
      let lotteryName = '未知活动'
      let lotteryProgress = ''

      if (eventData.user_id) {
        const { data: user } = await supabase
          .from('users')
          .select('username, telegram_username')
          .eq('id', eventData.user_id)
          .single()
        
        if (user) {
          userName = user.username || user.telegram_username || eventData.user_id
        }
      }

      if (eventData.lottery_id) {
        const { data: lottery } = await supabase
          .from('lotteries')
          .select('title, sold_tickets, total_tickets')
          .eq('id', eventData.lottery_id)
          .single()
        
        if (lottery) {
          lotteryName = lottery.title || '未知活动'
          lotteryProgress = `\n📊 进度: ${lottery.sold_tickets}/${lottery.total_tickets}`
        }
      }

      message += `👤 用户: ${userName}\n`
      message += `🎁 活动: ${lotteryName}${lotteryProgress}\n`
      message += `🎫 购买数量: ${eventData.ticket_count || 1} 张\n`
      message += `💰 花费积分: ${eventData.total_cost || eventData.points_spent || '未知'}\n`
      message += `⏰ 时间: ${timestamp}`
      break
    }

    default:
      message += `📝 事件数据: ${JSON.stringify(eventData, null, 2)}\n`
      message += `⏰ 时间: ${timestamp}`
  }

  return message
}

/**
 * 发送到飞书
 */
async function dispatchToFeishu(
  supabaseUrl: string,
  supabaseServiceKey: string,
  channel: any,
  message: string,
  eventType: string,
  eventData: Record<string, any>
): Promise<{ success: boolean; error?: string; response?: any }> {
  const dispatchUrl = `${supabaseUrl}/functions/v1/admin-dispatch-feishu`
  
  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webhook_url: channel.webhook_url,
      message: message,
      event_type: eventType,
      event_data: eventData,
    }),
  })

  const result = await response.json()
  return result
}

/**
 * 发送到 Telegram
 */
async function dispatchToTelegram(
  supabaseUrl: string,
  supabaseServiceKey: string,
  channel: any,
  message: string
): Promise<{ success: boolean; error?: string; response?: any }> {
  // 直接调用 Telegram API
  const botToken = channel.bot_token || Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = channel.chat_id

  if (!botToken || !chatId) {
    return { success: false, error: 'Missing Telegram bot_token or chat_id' }
  }

  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`

  const response = await fetch(telegramApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  })

  const result = await response.json()

  if (!response.ok || !result.ok) {
    return { 
      success: false, 
      error: result.description || 'Telegram API error',
      response: result 
    }
  }

  return { success: true, response: result }
}
