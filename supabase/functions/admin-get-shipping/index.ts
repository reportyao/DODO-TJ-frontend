import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

/**
 * 管理后台: 获取所有发货申请列表
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

    // 检查是否是管理员
    const { data: userData, error: userError } = await supabaseClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (userError || !userData || userData.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required')
    }

    // 获取查询参数
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20')
    const offset = (page - 1) * pageSize

    // 构建查询
    let query = supabaseClient
      .from('shipping')
      .select(`
        *,
        user:users!shipping_user_id_fkey(
          id,
          phone_number,
          first_name,
          last_name
        ),
        prize:prizes!shipping_prize_id_fkey(
          id,
          prize_name,
          prize_image,
          winning_code,
          lottery:lotteries(
            id,
            title,
            image_url
          )
        )
      `, { count: 'exact' })
      .order('requested_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data: shippings, error: shippingsError, count } = await query

    if (shippingsError) {
      throw new Error(`Failed to fetch shippings: ${shippingsError.message}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: shippings || [],
        pagination: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize)
        }
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
