import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

/**
 * 用户申请发货
 * 用户中奖后选择发货，填写收货地址信息
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

    // 获取用户信息
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

    if (authError || !user) {
      throw new Error('Invalid token')
    }

    const {
      prizeId,
      recipientName,
      recipientPhone,
      recipientAddress,
      recipientCity,
      recipientRegion,
      recipientPostalCode,
      recipientCountry = 'Tajikistan',
      notes
    } = await req.json()

    if (!prizeId || !recipientName || !recipientPhone || !recipientAddress) {
      throw new Error('Missing required fields')
    }

    // 1. 验证prize是否属于当前用户
    const { data: prize, error: prizeError } = await supabaseClient
      .from('prizes')
      .select('*')
      .eq('id', prizeId)
      .eq('user_id', user.id)
      .single()

    if (prizeError || !prize) {
      throw new Error('Prize not found or does not belong to you')
    }

    // 2. 检查prize状态
    if (prize.status !== 'PENDING') {
      throw new Error(`Prize status is ${prize.status}, cannot request shipping`)
    }

    // 3. 创建shipping记录
    const { data: shipping, error: shippingError } = await supabaseClient
      .from('shipping')
      .insert({
        prize_id: prizeId,
        user_id: user.id,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        recipient_address: recipientAddress,
        recipient_city: recipientCity,
        recipient_region: recipientRegion,
        recipient_postal_code: recipientPostalCode,
        recipient_country: recipientCountry,
        status: 'PENDING',
        notes: notes || null,
        requested_at: new Date().toISOString()
      })
      .select()
      .single()

    if (shippingError) {
      throw new Error(`Failed to create shipping: ${shippingError.message}`)
    }

    // 4. 更新prize状态为SHIPPING
    const { error: updatePrizeError } = await supabaseClient
      .from('prizes')
      .update({
        status: 'SHIPPING',
        processed_at: new Date().toISOString()
      })
      .eq('id', prizeId)

    if (updatePrizeError) {
      throw new Error(`Failed to update prize: ${updatePrizeError.message}`)
    }

    // 5. 创建shipping历史记录
    await supabaseClient
      .from('shipping_history')
      .insert({
        shipping_id: shipping.id,
        status: 'PENDING',
        description: '用户申请发货',
        created_at: new Date().toISOString()
      })

    // 6. 发送通知给管理员
    try {
      await supabaseClient.from('notifications').insert({
        user_id: user.id, // 这里应该是管理员ID，暂时用user_id
        type: 'SHIPPING_REQUEST',
        title: '新的发货申请',
        content: `用户申请发货: ${prize.prize_name}`,
        data: {
          prize_id: prizeId,
          shipping_id: shipping.id
        },
        is_read: false
      })
    } catch (notifError: unknown) {
      console.error('Failed to send notification:', notifError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          shipping_id: shipping.id,
          prize_id: prizeId,
          status: 'PENDING'
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
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
