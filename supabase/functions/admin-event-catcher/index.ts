/**
 * TezBarakat 管理员通知系统 - 事件捕捉函数
 * 
 * 功能: 接收 Database Webhook 事件，验证后写入消息队列
 * 触发: Database Webhook (INSERT on deposit_requests, withdrawal_requests, etc.)
 * 
 * @author Manus AI
 * @version 1.0.0
 * @date 2026-02-03
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-event-type, x-webhook-secret',
}

// 支持的事件类型
const SUPPORTED_EVENTS = [
  'new_deposit_request',      // 新充值申请
  'new_withdrawal_request',   // 新提现申请
  'new_group_buy_join',       // 新拼团参与
  'new_lottery_purchase',     // 新积分商城购买
] as const

type EventType = typeof SUPPORTED_EVENTS[number]

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: Record<string, any>
  schema: string
  old_record?: Record<string, any>
}

serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  console.log('[admin-event-catcher] 收到请求')

  try {
    // 1. 验证 Webhook Secret (安全性检查)
    const webhookSecret = Deno.env.get('ADMIN_WEBHOOK_SECRET')
    const receivedSecret = req.headers.get('X-Webhook-Secret')
    
    // 如果配置了 Secret，则进行验证
    if (webhookSecret && receivedSecret !== webhookSecret) {
      console.error('[admin-event-catcher] Webhook Secret 验证失败')
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. 获取事件类型
    const eventType = req.headers.get('X-Event-Type') as EventType
    
    if (!eventType || !SUPPORTED_EVENTS.includes(eventType)) {
      console.error('[admin-event-catcher] 不支持的事件类型:', eventType)
      return new Response(
        JSON.stringify({ success: false, error: `Unsupported event type: ${eventType}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. 解析请求体
    const payload: WebhookPayload = await req.json()
    console.log('[admin-event-catcher] 事件类型:', eventType)
    console.log('[admin-event-catcher] 表名:', payload.table)
    console.log('[admin-event-catcher] 操作类型:', payload.type)

    // 只处理 INSERT 事件
    if (payload.type !== 'INSERT') {
      console.log('[admin-event-catcher] 忽略非 INSERT 事件')
      return new Response(
        JSON.stringify({ success: true, message: 'Ignored non-INSERT event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. 创建 Supabase 客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 5. 将事件写入消息队列
    const queueEntry = {
      event_type: eventType,
      event_data: payload.record,
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      scheduled_at: new Date().toISOString(),
    }

    const { data: queueData, error: queueError } = await supabase
      .from('admin_notification_queue')
      .insert(queueEntry)
      .select()
      .single()

    if (queueError) {
      console.error('[admin-event-catcher] 写入队列失败:', queueError.message)
      throw new Error(`Failed to enqueue event: ${queueError.message}`)
    }

    console.log('[admin-event-catcher] 事件已入队:', queueData.id)

    // 6. 立即触发队列处理器 (可选，实现实时性)
    // 这里我们异步调用，不等待结果
    const processorUrl = `${supabaseUrl}/functions/v1/admin-queue-processor`
    fetch(processorUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trigger: 'immediate', queue_id: queueData.id }),
    }).catch(err => {
      console.log('[admin-event-catcher] 触发处理器失败 (非阻塞):', err.message)
    })

    const duration = Date.now() - startTime
    console.log(`[admin-event-catcher] 处理完成，耗时: ${duration}ms`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Event enqueued successfully',
        queue_id: queueData.id,
        event_type: eventType,
        duration_ms: duration,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    const duration = Date.now() - startTime
    console.error('[admin-event-catcher] 错误:', errMsg)
    console.error('[admin-event-catcher] 堆栈:', error.stack)

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
