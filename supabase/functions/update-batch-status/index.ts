/**
 * 更新批次状态 Edge Function
 * 
 * 功能：更新批次状态（中国段 -> 塔国段 -> 已到达）
 * 权限：仅管理员可调用
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { sendBatchInTransitTJNotification } from '../_shared/batchNotification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

interface UpdateBatchStatusRequest {
  batch_id: string
  new_status: 'IN_TRANSIT_CHINA' | 'IN_TRANSIT_TAJIKISTAN' | 'ARRIVED' | 'CANCELLED'
  china_tracking_no?: string
  tajikistan_tracking_no?: string
  admin_note?: string
  admin_id: string
  send_notification?: boolean
}

serve(async (req) => {
  // 处理CORS预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body: UpdateBatchStatusRequest = await req.json()
    const { 
      batch_id, 
      new_status, 
      china_tracking_no, 
      tajikistan_tracking_no, 
      admin_note, 
      admin_id,
      send_notification = true 
    } = body

    if (!batch_id || !new_status || !admin_id) {
      return new Response(
        JSON.stringify({ success: false, error: '缺少必要参数' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 获取当前批次信息
    const { data: batch, error: batchError } = await supabase
      .from('shipment_batches')
      .select('*')
      .eq('id', batch_id)
      .single()

    if (batchError || !batch) {
      return new Response(
        JSON.stringify({ success: false, error: '批次不存在' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 验证状态转换是否合法
    const validTransitions: Record<string, string[]> = {
      'IN_TRANSIT_CHINA': ['IN_TRANSIT_TAJIKISTAN', 'CANCELLED'],
      'IN_TRANSIT_TAJIKISTAN': ['ARRIVED', 'CANCELLED'],
      'ARRIVED': [], // 已到达不能再转换
      'CANCELLED': [], // 已取消不能再转换
    }

    if (!validTransitions[batch.status]?.includes(new_status)) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `无法从 ${batch.status} 转换到 ${new_status}` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 准备更新数据
    const updateData: Record<string, any> = {
      status: new_status,
    }

    if (china_tracking_no !== undefined) {
      updateData.china_tracking_no = china_tracking_no
    }
    if (tajikistan_tracking_no !== undefined) {
      updateData.tajikistan_tracking_no = tajikistan_tracking_no
    }
    if (admin_note !== undefined) {
      updateData.admin_note = admin_note
    }

    // 更新批次状态
    const { data: updatedBatch, error: updateError } = await supabase
      .from('shipment_batches')
      .update(updateData)
      .eq('id', batch_id)
      .select()
      .single()

    if (updateError) {
      console.error('Update batch error:', updateError)
      return new Response(
        JSON.stringify({ success: false, error: '更新批次失败: ' + updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 更新批次中所有订单的物流状态
    const logisticsStatusMap: Record<string, string> = {
      'IN_TRANSIT_CHINA': 'IN_TRANSIT_CHINA',
      'IN_TRANSIT_TAJIKISTAN': 'IN_TRANSIT_TAJIKISTAN',
      'ARRIVED': 'READY_FOR_PICKUP', // 到达后变为待自提
      'CANCELLED': 'PENDING_SHIPMENT', // 取消后恢复为待发货
    }

    const newLogisticsStatus = logisticsStatusMap[new_status]

    // 获取批次中的所有订单
    const { data: batchItems, error: itemsError } = await supabase
      .from('batch_order_items')
      .select('order_id, order_type, user_id')
      .eq('batch_id', batch_id)

    if (itemsError) {
      console.error('Error fetching batch items:', itemsError)
    }

    // 更新各类订单的物流状态
    if (batchItems && batchItems.length > 0) {
      const fullPurchaseIds = batchItems.filter(i => i.order_type === 'FULL_PURCHASE').map(i => i.order_id)
      const prizeIds = batchItems.filter(i => i.order_type === 'LOTTERY_PRIZE').map(i => i.order_id)
      const groupBuyIds = batchItems.filter(i => i.order_type === 'GROUP_BUY').map(i => i.order_id)

      if (fullPurchaseIds.length > 0) {
        const updatePayload: Record<string, any> = { logistics_status: newLogisticsStatus }
        if (new_status === 'CANCELLED') {
          updatePayload.batch_id = null
        }
        await supabase
          .from('full_purchase_orders')
          .update(updatePayload)
          .in('id', fullPurchaseIds)
      }

      if (prizeIds.length > 0) {
        const updatePayload: Record<string, any> = { logistics_status: newLogisticsStatus }
        if (new_status === 'CANCELLED') {
          updatePayload.batch_id = null
        }
        await supabase
          .from('prizes')
          .update(updatePayload)
          .in('id', prizeIds)
      }

      if (groupBuyIds.length > 0) {
        const updatePayload: Record<string, any> = { logistics_status: newLogisticsStatus }
        if (new_status === 'CANCELLED') {
          updatePayload.batch_id = null
        }
        await supabase
          .from('group_buy_results')
          .update(updatePayload)
          .in('id', groupBuyIds)
      }

      // 如果取消批次，删除批次订单关联
      if (new_status === 'CANCELLED') {
        await supabase
          .from('batch_order_items')
          .delete()
          .eq('batch_id', batch_id)
      }
    }

    // 发送通知（仅当状态变为塔国段运输中时）
    let notificationsSent = 0
    if (send_notification && new_status === 'IN_TRANSIT_TAJIKISTAN' && batchItems) {
      const uniqueUserIds = [...new Set(batchItems.map(i => i.user_id).filter(Boolean))]
      
      for (const userId of uniqueUserIds) {
        try {
          const sent = await sendBatchInTransitTJNotification(
            supabase,
            userId,
            batch.batch_no
          )
          if (sent) {
            notificationsSent++
          }
        } catch (notifyError: unknown) {
          console.error('Failed to send notification:', notifyError)
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: updatedBatch,
        notifications_sent: notificationsSent,
        message: `批次状态已更新为 ${new_status}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ success: false, error: '服务器内部错误' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
