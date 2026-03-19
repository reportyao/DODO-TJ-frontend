import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-admin-id',
}

/**
 * 管理后台: 更新发货状态
 * 需要管理员权限
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 获取管理员认证
    const adminId = req.headers.get('x-admin-id')
    const authHeader = req.headers.get('authorization')
    
    let adminUserId: string | null = null
    
    // 方式1: 通过 x-admin-id 头部认证（管理后台使用）
    if (adminId) {
      const { data: adminUser, error: adminError } = await supabaseClient
        .from('admin_users')
        .select('id, status')
        .eq('id', adminId)
        .single()
      
      if (adminError || !adminUser || adminUser.status !== 'active') {
        throw new Error('管理员认证失败')
      }
      adminUserId = adminUser.id
    }
    // 方式2: 通过 Supabase Auth token 认证（兼容旧方式）
    else if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
      
      if (!authError && user) {
        // 检查是否是管理员
        const { data: userData } = await supabaseClient
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single()
        
        if (userData?.role === 'admin') {
          adminUserId = user.id
        }
      }
    }
    
    if (!adminUserId) {
      throw new Error('Unauthorized: Admin access required')
    }

    const {
      shippingId,
      status,
      trackingNumber,
      shippingCompany,
      shippingMethod,
      adminNotes
    } = await req.json()

    if (!shippingId || !status) {
      throw new Error('Missing required fields')
    }

    // 更新shipping记录
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    }

    if (trackingNumber) updateData.tracking_number = trackingNumber
    if (shippingCompany) updateData.shipping_company = shippingCompany
    if (shippingMethod) updateData.shipping_method = shippingMethod
    if (adminNotes) updateData.admin_notes = adminNotes

    if (status === 'SHIPPED') {
      updateData.shipped_at = new Date().toISOString()
    } else if (status === 'DELIVERED') {
      updateData.delivered_at = new Date().toISOString()
    }

    const { data: shipping, error: updateError } = await supabaseClient
      .from('shipping')
      .update(updateData)
      .eq('id', shippingId)
      .select()
      .single()

    if (updateError) {
      throw new Error(`Failed to update shipping: ${updateError.message}`)
    }

    // 创建shipping历史记录
    await supabaseClient
      .from('shipping_history')
      .insert({
        shipping_id: shippingId,
        status,
        description: adminNotes || `状态更新为: ${status}`,
        operator_id: adminUserId,
        created_at: new Date().toISOString()
      })

    // 如果状态是SHIPPED或DELIVERED，更新prize状态
    if (status === 'SHIPPED' || status === 'DELIVERED') {
      const prizeStatus = status === 'SHIPPED' ? 'SHIPPED' : 'DELIVERED'
      await supabaseClient
        .from('prizes')
        .update({
          status: prizeStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', shipping.prize_id)
    }

    // 发送Bot通知
    if (shipping.user_id) {
      // 获取用户手机号
      const { data: user } = await supabaseClient
        .from('users')
        .select('phone_number')
        .eq('id', shipping.user_id)
        .single()

      if (user?.phone_number) {
        let notificationType = ''
        const notificationData: any = {
          order_id: shipping.id,
          product_name: shipping.product_name || '商品',
          tracking_number: trackingNumber || shipping.tracking_number
        }

        // 根据状态选择通知类型（只推送关键节点：到达塔国、到达自提点）
        if (status === 'in_transit_tajikistan' || status === 'arrived_tajikistan') {
          // 到达塔吉克斯坦通知
          notificationType = 'order_arrived_tajikistan'
        } else if (status === 'ready_for_pickup') {
          // 到达自提点通知
          notificationType = 'order_ready_pickup'
          notificationData.pickup_location = shipping.pickup_location || '自提点'
          notificationData.pickup_code = shipping.pickup_code
        } else if (status === 'picked_up' || status === 'DELIVERED') {
          // 订单完成通知
          notificationType = 'order_completed'
        }
        // 注意：不再推送 SHIPPED 和 in_transit_china 状态的通知

        // 只在关键节点发送通知
        if (notificationType) {
          await supabaseClient
            .from('notification_queue')
            .insert({
              user_id: shipping.user_id,
              type: notificationType,
              payload: notificationData,
              phone_number: user.phone_number,
              notification_type: notificationType,
              title: '订单物流更新',
              message: `您的订单状态已更新`,
              data: notificationData,
              priority: 1,
              status: 'pending',
              scheduled_at: new Date().toISOString(),
              retry_count: 0,
              max_retries: 3,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: shipping
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
