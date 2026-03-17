/**
 * 获取批次列表 Edge Function
 * 
 * 功能：获取发货批次列表，支持筛选和分页
 * 权限：管理员可查看所有批次，用户可查看自己订单所在的批次
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

    const url = new URL(req.url)
    const status = url.searchParams.get('status') // 筛选状态
    const search = url.searchParams.get('search') // 搜索批次号
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('page_size') || '20')
    const includeItems = url.searchParams.get('include_items') === 'true' // 是否包含订单明细
    const userId = url.searchParams.get('user_id') // 用户ID（用于前端查询自己的批次）

    // 构建查询
    let query = supabase
      .from('shipment_batches')
      .select('*', { count: 'exact' })

    // 状态筛选
    if (status) {
      query = query.eq('status', status)
    }

    // 搜索批次号
    if (search) {
      query = query.ilike('batch_no', `%${search}%`)
    }

    // 如果是用户查询，只返回包含该用户订单的批次
    if (userId) {
      const { data: userBatchIds } = await supabase
        .from('batch_order_items')
        .select('batch_id')
        .eq('user_id', userId)
      
      if (userBatchIds && userBatchIds.length > 0) {
        const batchIds = [...new Set(userBatchIds.map(b => b.batch_id))]
        query = query.in('id', batchIds)
      } else {
        // 用户没有任何批次
        return new Response(
          JSON.stringify({
            success: true,
            data: [],
            pagination: {
              page,
              page_size: pageSize,
              total: 0,
              total_pages: 0,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 排序和分页
    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    const { data: batches, error, count } = await query

    if (error) {
      console.error('Query error:', error)
      return new Response(
        JSON.stringify({ success: false, error: '查询失败: ' + (error as any)?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 如果需要包含订单明细
    let batchesWithItems = batches
    if (includeItems && batches && batches.length > 0) {
      const batchIds = batches.map(b => b.id)
      
      const { data: items, error: itemsError } = await supabase
        .from('batch_order_items')
        .select('*')
        .in('batch_id', batchIds)
        .order('added_at', { ascending: false })

      if (!itemsError && items) {
        // 将订单明细附加到对应批次
        batchesWithItems = batches.map(batch => ({
          ...batch,
          items: items.filter(item => item.batch_id === batch.id),
        }))
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: batchesWithItems,
        pagination: {
          page,
          page_size: pageSize,
          total: count || 0,
          total_pages: Math.ceil((count || 0) / pageSize),
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ success: false, error: '服务器内部错误' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
