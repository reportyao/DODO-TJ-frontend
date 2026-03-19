import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
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
    // 使用 service role key 以绕过 RLS
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 支持 GET 参数或 POST body
    let status = 'ACTIVE'
    let limit = 20
    let offset = 0
    let sortBy = 'latest'

    if (req.method === 'GET') {
      const url = new URL(req.url)
      status = url.searchParams.get('status') || 'ACTIVE'
      limit = parseInt(url.searchParams.get('limit') || '20')
      offset = parseInt(url.searchParams.get('offset') || '0')
      sortBy = url.searchParams.get('sortBy') || 'latest'
    } else if (req.method === 'POST') {
      try {
        const body = await req.json()
        status = body.status || 'ACTIVE'
        limit = body.limit || 20
        offset = body.offset || 0
        sortBy = body.sortBy || 'latest'
      } catch (e: unknown) {
        // 忽略 body 解析错误，使用默认值
      }
    }

    console.log('[ListResale] Params:', { status, limit, offset, sortBy })

    // 使用正确的 resales 表查询转售商品列表
    let query = supabaseClient
      .from('resales')
      .select(`
        *,
        lotteries (*),
        seller:users!resales_seller_id_fkey (
          id,
          phone_number,
          first_name,
          last_name,
          avatar_url
        ),
        entry:lottery_entries!resales_ticket_id_fkey (
          id,
          numbers
        )
      `)
      .range(offset, offset + limit - 1)

    // 根据状态过滤
    if (status === 'ACTIVE') {
      query = query.eq('status', 'ACTIVE')
    } else if (status !== 'ALL') {
      query = query.eq('status', status)
    }

    // 根据排序方式排序
    switch (sortBy) {
      case 'price_low':
        query = query.order('resale_price', { ascending: true })
        break
      case 'price_high':
        query = query.order('resale_price', { ascending: false })
        break
      case 'discount':
        // 折扣最大 = 原价-售价 最大
        query = query.order('created_at', { ascending: false }) // Supabase 不支持计算字段排序，前端处理
        break
      default:
        query = query.order('created_at', { ascending: false })
    }

    const { data: resaleItems, error: resaleError } = await query

    if (resaleError) {
      console.error('[ListResale] Query error:', resaleError)
      throw new Error('获取转售商品列表失败: ' + resaleError.message)
    }

    console.log('[ListResale] Found items:', resaleItems?.length || 0)

    return new Response(
      JSON.stringify({
        success: true,
        data: resaleItems || [],
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ListResale] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
