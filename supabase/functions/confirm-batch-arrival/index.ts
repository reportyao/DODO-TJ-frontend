/**
 * 确认批次到货 Edge Function
 * 
 * 功能：确认批次到货，逐个核对订单状态，生成提货码，发送通知
 * 权限：仅管理员可调用
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { generatePickupCode, calculatePickupCodeExpiry } from '../_shared/pickupCode.ts'
import { 
  sendBatchArrivedNotification, 
  sendBatchItemMissingNotification, 
  sendBatchItemDamagedNotification 
} from '../_shared/batchNotification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

interface OrderArrivalStatus {
  order_item_id: string
  arrival_status: 'NORMAL' | 'MISSING' | 'DAMAGED'
  arrival_notes?: string
}

interface ConfirmArrivalRequest {
  batch_id: string
  order_statuses: OrderArrivalStatus[]
  arrival_photos?: string[]
  arrival_notes?: string
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

    const body: ConfirmArrivalRequest = await req.json()
    const { 
      batch_id, 
      order_statuses, 
      arrival_photos, 
      arrival_notes, 
      admin_id,
      send_notification = true 
    } = body

    if (!batch_id || !order_statuses || order_statuses.length === 0 || !admin_id) {
      return new Response(
        JSON.stringify({ success: false, error: '缺少必要参数' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 获取批次信息
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

    // 检查批次状态
    if (batch.status !== 'IN_TRANSIT_TAJIKISTAN') {
      return new Response(
        JSON.stringify({ success: false, error: '只能确认运输中（塔国段）的批次到货' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 获取默认自提点
    const { data: defaultPickupPoint, error: pickupPointError } = await supabase
      .from('pickup_points')
      .select('id, name, name_i18n, address, address_i18n')
      .eq('is_default', true)
      .single()

    if (pickupPointError || !defaultPickupPoint) {
      console.warn('No default pickup point found, using first active one')
      const { data: anyPickupPoint } = await supabase
        .from('pickup_points')
        .select('id, name, name_i18n, address, address_i18n')
        .eq('is_active', true)
        .limit(1)
        .single()
      
      if (!anyPickupPoint) {
        return new Response(
          JSON.stringify({ success: false, error: '没有可用的自提点' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const pickupPoint = defaultPickupPoint || await supabase
      .from('pickup_points')
      .select('id, name, name_i18n, address, address_i18n')
      .eq('is_active', true)
      .limit(1)
      .single()
      .then(r => r.data)

    const results = {
      normal: 0,
      missing: 0,
      damaged: 0,
      pickup_codes_generated: 0,
      notifications_sent: 0,
      errors: [] as string[],
    }

    // 处理每个订单的到货状态
    for (const orderStatus of order_statuses) {
      try {
        // 获取订单项详情
        const { data: orderItem, error: itemError } = await supabase
          .from('batch_order_items')
          .select('*')
          .eq('id', orderStatus.order_item_id)
          .eq('batch_id', batch_id)
          .single()

        if (itemError || !orderItem) {
          results.errors.push(`订单项 ${orderStatus.order_item_id} 不存在`)
          continue
        }

        // 更新订单项的到货状态
        const updateItemData: Record<string, any> = {
          arrival_status: orderStatus.arrival_status,
          arrival_notes: orderStatus.arrival_notes || null,
        }

        // 如果正常到货，生成提货码
        if (orderStatus.arrival_status === 'NORMAL') {
          results.normal++
          
          try {
            const pickupCode = await generatePickupCode(supabase)
            const expiresAt = calculatePickupCodeExpiry(30)
            
            updateItemData.pickup_code = pickupCode
            updateItemData.pickup_code_generated_at = new Date().toISOString()
            updateItemData.pickup_code_expires_at = expiresAt

            // 更新原订单表的提货码
            if (orderItem.order_type === 'FULL_PURCHASE') {
              // 【R20修复】补充 pickup_status 和 expires_at，与 LOTTERY_PRIZE/GROUP_BUY 保持一致
              await supabase
                .from('full_purchase_orders')
                .update({
                  pickup_code: pickupCode,
                  pickup_status: 'PENDING_PICKUP',
                  logistics_status: 'READY_FOR_PICKUP',
                  pickup_point_id: pickupPoint?.id,
                  expires_at: expiresAt,
                })
                .eq('id', orderItem.order_id)
            } else if (orderItem.order_type === 'LOTTERY_PRIZE') {
              await supabase
                .from('prizes')
                .update({
                  pickup_code: pickupCode,
                  pickup_status: 'PENDING_PICKUP',
                  logistics_status: 'READY_FOR_PICKUP',
                  pickup_point_id: pickupPoint?.id,
                  expires_at: expiresAt,
                })
                .eq('id', orderItem.order_id)
            } else if (orderItem.order_type === 'GROUP_BUY') {
              await supabase
                .from('group_buy_results')
                .update({
                  pickup_code: pickupCode,
                  pickup_status: 'PENDING_PICKUP',
                  logistics_status: 'READY_FOR_PICKUP',
                  pickup_point_id: pickupPoint?.id,
                  expires_at: expiresAt,
                })
                .eq('id', orderItem.order_id)
            }

            results.pickup_codes_generated++

            // 发送到货通知
            if (send_notification && orderItem.user_id && pickupPoint) {
              try {
                const sent = await sendBatchArrivedNotification(
                  supabase,
                  orderItem.user_id,
                  orderItem.product_name,
                  orderItem.product_name_i18n,
                  pickupCode,
                  pickupPoint.name,
                  pickupPoint.name_i18n,
                  pickupPoint.address,
                  pickupPoint.address_i18n,
                  expiresAt
                )
                if (sent) {
                  updateItemData.notification_sent = true
                  updateItemData.notification_sent_at = new Date().toISOString()
                  results.notifications_sent++
                }
              } catch (notifyError: unknown) {
                console.error('Failed to send arrival notification:', notifyError)
              }
            }

          } catch (pickupCodeError: unknown) {
            console.error('Failed to generate pickup code:', pickupCodeError)
            results.errors.push(`订单 ${orderItem.order_id} 生成提货码失败`)
          }

        } else if (orderStatus.arrival_status === 'MISSING') {
          results.missing++
          
          // 发送缺货通知
          if (send_notification && orderItem.user_id) {
            try {
              const sent = await sendBatchItemMissingNotification(
                supabase,
                orderItem.user_id,
                orderItem.product_name,
                orderItem.product_name_i18n
              )
              if (sent) {
                updateItemData.notification_sent = true
                updateItemData.notification_sent_at = new Date().toISOString()
                results.notifications_sent++
              }
            } catch (notifyError: unknown) {
              console.error('Failed to send missing notification:', notifyError)
            }
          }

        } else if (orderStatus.arrival_status === 'DAMAGED') {
          results.damaged++
          
          // 发送损坏通知
          if (send_notification && orderItem.user_id) {
            try {
              const sent = await sendBatchItemDamagedNotification(
                supabase,
                orderItem.user_id,
                orderItem.product_name,
                orderItem.product_name_i18n
              )
              if (sent) {
                updateItemData.notification_sent = true
                updateItemData.notification_sent_at = new Date().toISOString()
                results.notifications_sent++
              }
            } catch (notifyError: unknown) {
              console.error('Failed to send damaged notification:', notifyError)
            }
          }
        }

        // 更新订单项
        await supabase
          .from('batch_order_items')
          .update(updateItemData)
          .eq('id', orderStatus.order_item_id)

      } catch (error: unknown) {
        console.error('Error processing order status:', error)
        results.errors.push(`处理订单项 ${orderStatus.order_item_id} 失败`)
      }
    }

    // 更新批次状态为已到达
    const { error: updateBatchError } = await supabase
      .from('shipment_batches')
      .update({
        status: 'ARRIVED',
        arrived_at: new Date().toISOString(),
        arrival_photos: arrival_photos || [],
        arrival_notes: arrival_notes || null,
        confirmed_by: admin_id,
        confirmed_at: new Date().toISOString(),
        normal_orders: results.normal,
        missing_orders: results.missing,
        damaged_orders: results.damaged,
      })
      .eq('id', batch_id)

    if (updateBatchError) {
      console.error('Update batch error:', updateBatchError)
      return new Response(
        JSON.stringify({ success: false, error: '更新批次状态失败' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: results,
        message: `批次到货确认完成：正常 ${results.normal} 个，缺货 ${results.missing} 个，损坏 ${results.damaged} 个`,
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
