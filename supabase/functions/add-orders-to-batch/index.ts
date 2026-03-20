/**
 * 将订单加入批次 Edge Function
 * 
 * 功能：将选中的订单加入到指定批次
 * 支持加入运输中（IN_TRANSIT_CHINA）和已到达（ARRIVED）的批次
 * 加入已到达批次时，自动生成提货码并发送到货通知
 * 权限：仅管理员可调用
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { generatePickupCode, calculatePickupCodeExpiry } from '../_shared/pickupCode.ts'
import { sendBatchArrivedNotification } from '../_shared/batchNotification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface OrderItem {
  order_id: string
  order_type: 'FULL_PURCHASE' | 'LOTTERY_PRIZE' | 'GROUP_BUY'
}

interface AddOrdersRequest {
  batch_id: string
  orders: OrderItem[]
  admin_id: string
  send_notification?: boolean
}

// 内联通知功能（用于运输中批次的发货通知）

const notificationTemplates = {
  zh: {
    batch_shipped: (batchNo: string, estimatedDate: string) => 
      `📦 您的订单已发货！\n\n批次号：${batchNo}\n预计到达：${estimatedDate}\n\n请耐心等待，我们会在货物到达后第一时间通知您。`,
  },
  ru: {
    batch_shipped: (batchNo: string, estimatedDate: string) => 
      `📦 Ваш заказ отправлен!\n\nНомер партии: ${batchNo}\nОжидаемая дата прибытия: ${estimatedDate}\n\nПожалуйста, подождите. Мы уведомим вас сразу после прибытия товара.`,
  },
  tg: {
    batch_shipped: (batchNo: string, estimatedDate: string) => 
      `📦 Фармоиши шумо фиристода шуд!\n\nРақами партия: ${batchNo}\nСанаи интизорӣ: ${estimatedDate}\n\nЛутфан интизор шавед. Мо шуморо баъд аз расидани мол огоҳ мекунем.`,
  },
}

type NotificationLanguage = 'zh' | 'ru' | 'tg'

async function sendBatchShippedNotification(
  supabase: SupabaseClient,
  userId: string,
  batchNo: string,
  estimatedArrivalDate: string
): Promise<boolean> {
  try {
    // 获取用户信息
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('phone_number, preferred_language, first_name')
      .eq('id', userId)
      .single()

    if (userError || !userData || !userData.phone_number) {
      console.error(`Failed to get user info for ${userId}:`, userError)
      return false
    }

    const lang = (userData.preferred_language in notificationTemplates 
      ? userData.preferred_language 
      : 'zh') as NotificationLanguage

    // 格式化日期
    const date = new Date(estimatedArrivalDate)
    const localeMap: Record<string, string> = {
      zh: 'zh-CN',
      ru: 'ru-RU',
      tg: 'tg-TJ',
    }
    const formattedDate = date.toLocaleDateString(localeMap[lang] || 'zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const message = notificationTemplates[lang].batch_shipped(batchNo, formattedDate)

    // 通过 notification_queue 发送通知
    await supabase.from('notification_queue').insert({
      user_id: userId,
      phone_number: userData.phone_number,
      notification_type: 'batch_shipped',
      title: '订单已发货',
      message: message,
      data: {
        batch_no: batchNo,
        estimated_arrival_date: estimatedArrivalDate,
      },
      channel: 'whatsapp',
      priority: 2,
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    console.log(`Notification queued for user ${userId}`)
    return true
  } catch (error: unknown) {
    console.error('Error sending notification:', error)
    return false
  }
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

    const body: AddOrdersRequest = await req.json()
    const { batch_id, orders, admin_id, send_notification = true } = body

    if (!batch_id || !orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: '缺少必要参数' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 验证批次是否存在
    const { data: batch, error: batchError } = await supabase
      .from('shipment_batches')
      .select('id, batch_no, status, estimated_arrival_date')
      .eq('id', batch_id)
      .single()

    if (batchError || !batch) {
      return new Response(
        JSON.stringify({ success: false, error: '批次不存在' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 检查批次状态 - 允许运输中和已到达的批次
    const allowedStatuses = ['IN_TRANSIT_CHINA', 'ARRIVED']
    if (!allowedStatuses.includes(batch.status)) {
      return new Response(
        JSON.stringify({ success: false, error: '只能向运输中或已到达的批次添加订单' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const isArrivedBatch = batch.status === 'ARRIVED'

    // 如果是已到达批次，需要获取自提点信息用于生成提货码
    let pickupPoint: any = null
    if (isArrivedBatch) {
      const { data: defaultPickupPoint } = await supabase
        .from('pickup_points')
        .select('id, name, name_i18n, address, address_i18n')
        .eq('is_default', true)
        .single()

      if (defaultPickupPoint) {
        pickupPoint = defaultPickupPoint
      } else {
        const { data: anyPickupPoint } = await supabase
          .from('pickup_points')
          .select('id, name, name_i18n, address, address_i18n')
          .eq('is_active', true)
          .limit(1)
          .single()
        
        pickupPoint = anyPickupPoint
      }

      if (!pickupPoint) {
        return new Response(
          JSON.stringify({ success: false, error: '没有可用的自提点，无法为已到达批次生成提货码' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const results = {
      success: [] as string[],
      failed: [] as { order_id: string; error: string }[],
      notifications_sent: 0,
      pickup_codes_generated: 0,
    }

    for (const order of orders) {
      try {
        // 获取订单详情
        let orderData: any = null
        let productName = ''
        let productNameI18n: Record<string, string> = {}
        let productImage = ''
        let productSku = ''
        let userId = ''
        let userName = ''

        if (order.order_type === 'FULL_PURCHASE') {
          const { data, error } = await supabase
            .from('full_purchase_orders')
            .select(`
              id, user_id, metadata, batch_id,
              lotteries:lottery_id (title, title_i18n, image_url, inventory_product_id),
              users:user_id (first_name, phone_number)
            `)
            .eq('id', order.order_id)
            .single()

          if (error || !data) {
            results.failed.push({ order_id: order.order_id, error: '订单不存在' })
            continue
          }

          if (data.batch_id) {
            results.failed.push({ order_id: order.order_id, error: '订单已加入其他批次' })
            continue
          }

          orderData = data
          const lottery = data.lotteries as any
          const user = data.users as any
          productName = lottery?.title || data.metadata?.product_title || '未知商品'
          productNameI18n = lottery?.title_i18n || {}
          productImage = lottery?.image_url || data.metadata?.product_image
          productSku = lottery?.inventory_product_id
          userId = data.user_id
          userName = user?.first_name || user?.phone_number

        } else if (order.order_type === 'LOTTERY_PRIZE') {
          const { data, error } = await supabase
            .from('prizes')
            .select(`
              id, user_id, prize_name, batch_id,
              lotteries:lottery_id (title, title_i18n, image_url, inventory_product_id),
              users:user_id (first_name, phone_number)
            `)
            .eq('id', order.order_id)
            .single()

          if (error || !data) {
            results.failed.push({ order_id: order.order_id, error: '订单不存在' })
            continue
          }

          if (data.batch_id) {
            results.failed.push({ order_id: order.order_id, error: '订单已加入其他批次' })
            continue
          }

          orderData = data
          const lottery = data.lotteries as any
          const user = data.users as any
          productName = lottery?.title || data.prize_name || '未知商品'
          productNameI18n = lottery?.title_i18n || {}
          productImage = lottery?.image_url
          productSku = lottery?.inventory_product_id
          userId = data.user_id
          userName = user?.first_name || user?.phone_number

        } else if (order.order_type === 'GROUP_BUY') {
          // 先查询拼团结果
          const { data, error } = await supabase
            .from('group_buy_results')
            .select(`
              id, winner_id, product_id, batch_id,
              group_buy_products:product_id (name, name_i18n, image_urls)
            `)
            .eq('id', order.order_id)
            .single()

          if (error || !data) {
            results.failed.push({ order_id: order.order_id, error: '订单不存在' })
            continue
          }

          if (data.batch_id) {
            results.failed.push({ order_id: order.order_id, error: '订单已加入其他批次' })
            continue
          }

          // 单独查询用户信息（因为winner_id没有外键约束）
          let user: any = null
          if (data.winner_id) {
            const { data: userData } = await supabase
              .from('users')
              .select('first_name, phone_number')
              .eq('id', data.winner_id)
              .single()
            user = userData
          }

          orderData = data
          const product = data.group_buy_products as any
          
          if (product?.name_i18n) {
            productNameI18n = product.name_i18n
            productName = product.name_i18n.zh || product.name_i18n.ru || product.name || '未知商品'
          } else if (product?.name) {
            productName = product.name
          }
          productImage = product?.image_urls?.[0]
          productSku = data.product_id
          userId = data.winner_id
          userName = user?.first_name || user?.phone_number
        }

        // 创建批次订单关联记录
        // 如果是已到达批次，直接标记为 NORMAL（正常到货）
        const { data: insertedItem, error: insertError } = await supabase
          .from('batch_order_items')
          .insert({
            batch_id: batch_id,
            order_type: order.order_type,
            order_id: order.order_id,
            product_name: productName,
            product_name_i18n: productNameI18n,
            product_sku: productSku,
            product_image: productImage,
            quantity: 1,
            user_id: userId,
            user_name: userName,
            arrival_status: isArrivedBatch ? 'NORMAL' : 'PENDING',
          })
          .select('id')
          .single()

        if (insertError) {
          // 检查是否是唯一约束冲突
          if (insertError.code === '23505') {
            results.failed.push({ order_id: order.order_id, error: '订单已在批次中' })
          } else {
            results.failed.push({ order_id: order.order_id, error: insertError.message })
          }
          continue
        }

        if (isArrivedBatch) {
          // ========== 已到达批次：生成提货码 + 更新为 READY_FOR_PICKUP ==========
          try {
            const pickupCode = await generatePickupCode(supabase)
            const expiresAt = calculatePickupCodeExpiry(30)

            // 更新 batch_order_items 的提货码信息
            await supabase
              .from('batch_order_items')
              .update({
                pickup_code: pickupCode,
                pickup_code_generated_at: new Date().toISOString(),
                pickup_code_expires_at: expiresAt,
              })
              .eq('id', insertedItem.id)

            // 更新原订单表的提货码和物流状态
            if (order.order_type === 'FULL_PURCHASE') {
              await supabase
                .from('full_purchase_orders')
                .update({
                  batch_id: batch_id,
                  pickup_code: pickupCode,
                  logistics_status: 'READY_FOR_PICKUP',
                  pickup_point_id: pickupPoint?.id,
                })
                .eq('id', order.order_id)
            } else if (order.order_type === 'LOTTERY_PRIZE') {
              await supabase
                .from('prizes')
                .update({
                  batch_id: batch_id,
                  pickup_code: pickupCode,
                  pickup_status: 'PENDING_PICKUP',
                  logistics_status: 'READY_FOR_PICKUP',
                  pickup_point_id: pickupPoint?.id,
                  expires_at: expiresAt,
                })
                .eq('id', order.order_id)
            } else if (order.order_type === 'GROUP_BUY') {
              await supabase
                .from('group_buy_results')
                .update({
                  batch_id: batch_id,
                  pickup_code: pickupCode,
                  pickup_status: 'PENDING_PICKUP',
                  logistics_status: 'READY_FOR_PICKUP',
                  pickup_point_id: pickupPoint?.id,
                  expires_at: expiresAt,
                })
                .eq('id', order.order_id)
            }

            results.pickup_codes_generated++

            // 发送到货提货通知
            if (send_notification && userId && pickupPoint) {
              try {
                const sent = await sendBatchArrivedNotification(
                  supabase,
                  userId,
                  productName,
                  productNameI18n,
                  pickupCode,
                  pickupPoint.name,
                  pickupPoint.name_i18n,
                  pickupPoint.address,
                  pickupPoint.address_i18n,
                  expiresAt
                )
                if (sent) {
                  // 更新通知状态
                  await supabase
                    .from('batch_order_items')
                    .update({
                      notification_sent: true,
                      notification_sent_at: new Date().toISOString(),
                    })
                    .eq('id', insertedItem.id)
                  results.notifications_sent++
                }
              } catch (notifyError: unknown) {
                console.error('Failed to send arrival notification:', notifyError)
              }
            }

          } catch (pickupCodeError: unknown) {
            console.error('Failed to generate pickup code:', pickupCodeError)
            results.failed.push({ order_id: order.order_id, error: '生成提货码失败' })
            // 即使提货码生成失败，订单已加入批次，不回滚
          }

        } else {
          // ========== 运输中批次：正常流程，更新为 IN_TRANSIT_CHINA ==========
          const updateData = {
            batch_id: batch_id,
            logistics_status: 'IN_TRANSIT_CHINA',
          }

          if (order.order_type === 'FULL_PURCHASE') {
            await supabase
              .from('full_purchase_orders')
              .update(updateData)
              .eq('id', order.order_id)
          } else if (order.order_type === 'LOTTERY_PRIZE') {
            await supabase
              .from('prizes')
              .update(updateData)
              .eq('id', order.order_id)
          } else if (order.order_type === 'GROUP_BUY') {
            await supabase
              .from('group_buy_results')
              .update(updateData)
              .eq('id', order.order_id)
          }

          // 发送发货通知
          if (send_notification && userId && batch.estimated_arrival_date) {
            try {
              const sent = await sendBatchShippedNotification(
                supabase,
                userId,
                batch.batch_no,
                batch.estimated_arrival_date
              )
              if (sent) {
                results.notifications_sent++
              }
            } catch (notifyError: unknown) {
              console.error('Failed to send notification:', notifyError)
            }
          }
        }

        results.success.push(order.order_id)

      } catch (error: unknown) {
        console.error('Error processing order:', order.order_id, error)
        results.failed.push({ order_id: order.order_id, error: '处理失败' })
      }
    }

    // 更新批次的订单总数
    const { data: batchItems } = await supabase
      .from('batch_order_items')
      .select('id')
      .eq('batch_id', batch_id)
    
    if (batchItems) {
      await supabase
        .from('shipment_batches')
        .update({ total_orders: batchItems.length })
        .eq('id', batch_id)
    }

    const arrivedMsg = isArrivedBatch 
      ? `，生成提货码 ${results.pickup_codes_generated} 个` 
      : ''

    return new Response(
      JSON.stringify({
        success: true,
        data: results,
        message: `成功添加 ${results.success.length} 个订单${arrivedMsg}，失败 ${results.failed.length} 个`,
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
