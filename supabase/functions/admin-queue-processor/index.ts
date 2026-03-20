/**
 * TezBarakat 管理员通知系统 - 队列处理器
 * 
 * 功能: 从消息队列拉取待处理任务，调用通知中心发送通知
 * 触发: Cron Job (每分钟) 或 事件捕捉器的即时触发
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

// 每次处理的最大任务数
const BATCH_SIZE = 10

// 处理超时时间 (毫秒)
const PROCESSING_TIMEOUT = 25000

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  console.log('[admin-queue-processor] 开始处理队列')

  try {
    // 创建 Supabase 客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 解析请求体，检查是否是即时触发
    let specificQueueId: string | null = null
    try {
      const body = await req.json()
      if (body.queue_id) {
        specificQueueId = body.queue_id
        console.log('[admin-queue-processor] 即时触发，处理指定任务:', specificQueueId)
      }
    } catch {
      // 没有请求体，正常的 Cron 触发
    }

    // 1. 从队列拉取待处理任务
    let query = supabase
      .from('admin_notification_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    // 如果是即时触发，只处理指定的任务
    if (specificQueueId) {
      query = supabase
        .from('admin_notification_queue')
        .select('*')
        .eq('id', specificQueueId)
        .eq('status', 'pending')
    }

    const { data: pendingTasks, error: fetchError } = await query

    if (fetchError) {
      throw new Error(`Failed to fetch pending tasks: ${fetchError.message}`)
    }

    if (!pendingTasks || pendingTasks.length === 0) {
      console.log('[admin-queue-processor] 没有待处理的任务')
      return new Response(
        JSON.stringify({ success: true, message: 'No pending tasks', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[admin-queue-processor] 找到 ${pendingTasks.length} 个待处理任务`)

    // 2. 处理每个任务
    const results = {
      processed: 0,
      success: 0,
      failed: 0,
      details: [] as Array<{ id: string; status: string; error?: string }>,
    }

    for (const task of pendingTasks) {
      // 检查是否超时
      if (Date.now() - startTime > PROCESSING_TIMEOUT) {
        console.log('[admin-queue-processor] 处理超时，停止处理剩余任务')
        break
      }

      console.log(`[admin-queue-processor] 处理任务: ${task.id}, 事件类型: ${task.event_type}`)

      try {
        // 2.1 标记为处理中
        await supabase
          .from('admin_notification_queue')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', task.id)

        // 2.2 调用通知中心
        const notificationHubUrl = `${supabaseUrl}/functions/v1/admin-notification-hub`
        const hubResponse = await fetch(notificationHubUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            queue_id: task.id,
            event_type: task.event_type,
            event_data: task.event_data,
          }),
        })

        const hubResult = await hubResponse.json()

        if (hubResponse.ok && hubResult.success) {
          // 2.3 成功：更新状态为已发送
          await supabase
            .from('admin_notification_queue')
            .update({
              status: 'sent',
              formatted_message: hubResult.message,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', task.id)

          results.success++
          results.details.push({ id: task.id, status: 'sent' })
          console.log(`[admin-queue-processor] 任务 ${task.id} 发送成功`)

        } else {
          // 2.4 失败：增加重试次数或标记为失败
          const newRetryCount = task.retry_count + 1
          const newStatus = newRetryCount >= task.max_retries ? 'failed' : 'pending'
          const errorMsg = hubResult.error || 'Unknown error'

          await supabase
            .from('admin_notification_queue')
            .update({
              status: newStatus,
              retry_count: newRetryCount,
              error_message: errorMsg,
              // 如果还能重试，延迟 5 分钟
              scheduled_at: newStatus === 'pending' 
                ? new Date(Date.now() + 5 * 60 * 1000).toISOString() 
                : task.scheduled_at,
              updated_at: new Date().toISOString(),
            })
            .eq('id', task.id)

          results.failed++
          results.details.push({ id: task.id, status: newStatus, error: errorMsg })
          console.log(`[admin-queue-processor] 任务 ${task.id} 处理失败: ${errorMsg}`)
        }

      } catch (taskError: unknown) {
        const taskErrorMsg = taskError instanceof Error ? taskError.message : String(taskError);
        // 任务处理异常
        const newRetryCount = task.retry_count + 1
        const newStatus = newRetryCount >= task.max_retries ? 'failed' : 'pending'

        await supabase
          .from('admin_notification_queue')
          .update({
            status: newStatus,
            retry_count: newRetryCount,
            error_message: taskErrorMsg,
            scheduled_at: newStatus === 'pending' 
              ? new Date(Date.now() + 5 * 60 * 1000).toISOString() 
              : task.scheduled_at,
            updated_at: new Date().toISOString(),
          })
          .eq('id', task.id)

        results.failed++
        results.details.push({ id: task.id, status: newStatus, error: taskErrorMsg })
        console.error(`[admin-queue-processor] 任务 ${task.id} 异常:`, taskErrorMsg)
      }

      results.processed++
    }

    const duration = Date.now() - startTime
    console.log(`[admin-queue-processor] 处理完成，耗时: ${duration}ms`)
    console.log(`[admin-queue-processor] 结果: 处理=${results.processed}, 成功=${results.success}, 失败=${results.failed}`)

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        duration_ms: duration,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime
    console.error('[admin-queue-processor] 错误:', errMsg)

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
