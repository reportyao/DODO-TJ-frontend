/**
 * TezBarakat 管理员通知系统 - 飞书发送器
 * 
 * 功能: 将通知消息发送到飞书
 * 支持: 飞书流程触发器(简单 key-value) 和 飞书群机器人(卡片)
 * 
 * @author Manus AI
 * @version 1.5.0
 * @date 2026-02-03
 * @changelog 修复消息格式,避免重复添加标题和时间戳
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 事件类型到标题的映射
const EVENT_TYPE_TITLES: Record<string, string> = {
  'new_deposit_request': '🔔 充值审核提醒',
  'new_withdrawal_request': '💰 提现审核提醒',
  'new_group_buy_join': '🛒 拼团动态',
  'new_lottery_purchase': '🎰 积分商城动态',
}

// 事件类型到卡片颜色的映射
const EVENT_TYPE_COLORS: Record<string, string> = {
  'new_deposit_request': 'blue',
  'new_withdrawal_request': 'orange',
  'new_group_buy_join': 'green',
  'new_lottery_purchase': 'purple',
}

// 后台管理地址
const ADMIN_URL = 'https://tezbarakat.com/admin'

interface FeishuRequest {
  webhook_url: string
  message: string
  event_type?: string
  event_data?: Record<string, any>
  use_card?: boolean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('[admin-dispatch-feishu] 收到发送请求')

  try {
    const { webhook_url, message, event_type, event_data, use_card = true }: FeishuRequest = await req.json()

    if (!webhook_url) {
      throw new Error('Missing webhook_url')
    }

    if (!message) {
      throw new Error('Missing message')
    }

    console.log('[admin-dispatch-feishu] Webhook URL:', webhook_url.substring(0, 50) + '...')
    console.log('[admin-dispatch-feishu] 事件类型:', event_type)

    // 判断 webhook 类型
    const isFlowTrigger = webhook_url.includes('/flow/api/trigger-webhook/')
    const isBotWebhook = webhook_url.includes('/open-apis/bot/')

    console.log('[admin-dispatch-feishu] Webhook 类型:', isFlowTrigger ? '流程触发器' : '群机器人')

    let payload: any

    if (isFlowTrigger) {
      // 飞书流程触发器 - 发送简单 key-value 数据
      payload = buildFlowTriggerPayload(message, event_type)
    } else if (isBotWebhook) {
      // 飞书群机器人 - 发送卡片或文本消息
      if (use_card !== false) {
        payload = buildInteractiveCard(message, event_type, event_data)
      } else {
        payload = buildTextMessage(message)
      }
    } else {
      // 默认使用流程触发器格式
      console.log('[admin-dispatch-feishu] 未识别的 webhook 类型,使用流程触发器格式')
      payload = buildFlowTriggerPayload(message, event_type)
    }

    console.log('[admin-dispatch-feishu] 发送数据:', JSON.stringify(payload).substring(0, 500) + '...')

    // 发送到飞书
    const response = await fetch(webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    // 飞书返回 code: 0 表示成功
    if (result.code !== 0 && result.StatusCode !== 0) {
      console.error('[admin-dispatch-feishu] 飞书返回错误:', result)
      return new Response(
        JSON.stringify({
          success: false,
          error: result.msg || result.StatusMessage || 'Feishu API error',
          response: result,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[admin-dispatch-feishu] 发送成功')

    return new Response(
      JSON.stringify({
        success: true,
        response: result,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[admin-dispatch-feishu] 错误:', errMsg)

    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * 构建飞书流程触发器的数据格式
 * 发送简单的 key-value 数据,由流程中的"发送飞书消息"节点引用
 * 
 * 飞书流程配置:
 * - 消息标题: 引用 title
 * - 消息内容: 引用 content
 * - 卡片按钮: 开启后,跳转链接引用 admin_url
 */
function buildFlowTriggerPayload(
  message: string,
  eventType?: string
): any {
  const title = EVENT_TYPE_TITLES[eventType || ''] || '📢 TezBarakat 通知'
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' })
  
  // 清理消息内容,确保格式正确
  // 将 \n 转换为实际换行符
  const cleanMessage = message
    .replace(/\\n/g, '\n')  // 将字符串 \n 转换为实际换行
    .trim()
  
  // 检查消息是否已经包含标题(由 notification-hub 格式化)
  // 如果是,直接使用消息内容,不再添加额外的标题和时间戳
  const hasTitle = cleanMessage.startsWith('🔔') || 
                   cleanMessage.startsWith('💰') || 
                   cleanMessage.startsWith('🛒') || 
                   cleanMessage.startsWith('🎰') ||
                   cleanMessage.startsWith('📢')
  
  let content: string
  
  if (hasTitle) {
    // 消息已经由 notification-hub 格式化,直接使用
    content = cleanMessage
  } else {
    // 消息未格式化,添加时间戳和系统标识
    content = `${cleanMessage}

━━━━━━━━━━━━━━━━
⏰ ${timestamp}
📱 TezBarakat 管理系统`
  }

  // 返回简单的 key-value 数据
  // 飞书流程可以直接引用这些字段
  return {
    title: title,
    content: content,
    admin_url: ADMIN_URL,
    event_type: eventType || 'notification',
    timestamp: timestamp,
  }
}

/**
 * 构建纯文本消息(群机器人)
 */
function buildTextMessage(message: string): any {
  return {
    msg_type: 'text',
    content: {
      text: message,
    },
  }
}

/**
 * 构建交互式卡片消息(群机器人)
 */
function buildInteractiveCard(
  message: string,
  eventType?: string,
  eventData?: Record<string, any>
): any {
  const title = EVENT_TYPE_TITLES[eventType || ''] || '📢 TezBarakat 通知'
  const color = EVENT_TYPE_COLORS[eventType || ''] || 'blue'

  // 构建卡片元素
  const elements: any[] = []

  // 添加消息内容 - 使用 lark_md 格式
  const formattedMessage = message
    .replace(/\\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: formattedMessage,
    },
  })

  // 添加分割线
  elements.push({ tag: 'hr' })

  // 添加操作按钮 (针对需要审核的事件)
  if (eventType === 'new_deposit_request' || eventType === 'new_withdrawal_request') {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '📋 前往后台处理',
          },
          type: 'primary',
          url: ADMIN_URL,
        },
      ],
    })
  }

  // 添加时间戳备注
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' })
  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `TezBarakat 管理系统 · ${timestamp}`,
      },
    ],
  })

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: title,
        },
        template: color,
      },
      elements: elements,
    },
  }
}
