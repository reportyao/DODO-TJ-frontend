import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { order_id, order_type, pickup_point_id, user_id, session_token } = await req.json()

    console.log('[update-pickup-point] Request:', { order_id, order_type, pickup_point_id, user_id })

    if (!order_id || !pickup_point_id || !user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 【A39修复】验证 session_token，防止伪造 user_id 修改他人自提点
    if (!session_token) {
      return new Response(
        JSON.stringify({ success: false, error: '未授权：缺少 session_token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const { data: sessionRows, error: sessionError } = await supabase
      .from('user_sessions')
      .select('user_id')
      .eq('session_token', session_token)
      .eq('is_active', true)
      .single()
    if (sessionError || !sessionRows) {
      return new Response(
        JSON.stringify({ success: false, error: '未授权：session_token 无效或已过期' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (sessionRows.user_id !== user_id) {
      return new Response(
        JSON.stringify({ success: false, error: '未授权：user_id 与 session 不匹配' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 验证自提点是否启用
    const { data: pickupPoint, error: pickupPointError } = await supabase
      .from('pickup_points')
      .select('id, is_active')
      .eq('id', pickup_point_id)
      .single()

    if (pickupPointError || !pickupPoint) {
      console.error('[update-pickup-point] Pickup point error:', pickupPointError)
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid pickup point' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!pickupPoint.is_active) {
      return new Response(
        JSON.stringify({ success: false, error: 'Pickup point is disabled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 根据订单类型确定表名和所有权字段
    let tableName = 'prizes'
    let ownerField = 'user_id'
    
    if (order_type === 'full_purchase') {
      tableName = 'full_purchase_orders'
      ownerField = 'user_id'
    } else if (order_type === 'group_buy') {
      tableName = 'group_buy_results'
      ownerField = 'winner_id'
    } else if (order_type === 'prize') {
      tableName = 'prizes'
      ownerField = 'user_id'
    }

    console.log('[update-pickup-point] Querying:', { tableName, ownerField, order_id, user_id })

    // 验证订单所有权
    const { data: orderCheck, error: orderCheckError } = await supabase
      .from(tableName)
      .select('id')
      .eq('id', order_id)
      .eq(ownerField, user_id)
      .maybeSingle()

    console.log('[update-pickup-point] Order check result:', { orderCheck, orderCheckError })

    if (orderCheckError) {
      console.error('[update-pickup-point] Order check error:', orderCheckError)
      return new Response(
        JSON.stringify({ success: false, error: `Database error: ${orderCheckError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!orderCheck) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Order not found or access denied',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 更新自提点
    const { error: updateError } = await supabase
      .from(tableName)
      .update({ pickup_point_id })
      .eq('id', order_id)

    if (updateError) {
      console.error('[update-pickup-point] Update error:', updateError)
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[update-pickup-point] Update successful')

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[update-pickup-point] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
