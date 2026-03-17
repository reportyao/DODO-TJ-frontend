/**
 * 获取待发货订单列表 Edge Function
 * 
 * 功能：获取所有待发货的订单（全款购买、一元购物中奖、拼团）
 * 权限：仅管理员可调用
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

interface PendingOrder {
  id: string
  order_type: 'FULL_PURCHASE' | 'LOTTERY_PRIZE' | 'GROUP_BUY'
  order_number?: string
  product_name: string
  product_name_i18n: Record<string, string>
  product_image?: string
  product_sku?: string
  user_id: string
  user_name?: string
  user_telegram_id?: string
  created_at: string
  amount?: number
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
    const orderType = url.searchParams.get('order_type') // 可选筛选
    const search = url.searchParams.get('search') // 搜索关键词
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('page_size') || '50')

    const pendingOrders: PendingOrder[] = []

    // 1. 获取待发货的全款购买订单
    if (!orderType || orderType === 'FULL_PURCHASE') {
      let query = supabase
        .from('full_purchase_orders')
        .select(`
          id,
          order_number,
          user_id,
          total_amount,
          metadata,
          created_at,
          lottery_id,
          lotteries:lottery_id (
            title,
            title_i18n,
            image_url,
            inventory_product_id
          ),
          users:user_id (
            first_name,
            telegram_username,
            telegram_id
          )
        `)
        .or('logistics_status.is.null,logistics_status.eq.PENDING_SHIPMENT')
        .is('batch_id', null)
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false })

      const { data: fullPurchaseOrders, error: fpError } = await query

      if (fpError) {
        console.error('Error fetching full purchase orders:', fpError)
      } else if (fullPurchaseOrders) {
        for (const order of fullPurchaseOrders) {
          const lottery = order.lotteries as any
          const user = order.users as any
          
          pendingOrders.push({
            id: order.id,
            order_type: 'FULL_PURCHASE',
            order_number: order.order_number,
            product_name: lottery?.title || order.metadata?.product_title || '未知商品',
            product_name_i18n: lottery?.title_i18n || order.metadata?.product_title_i18n || {},
            product_image: lottery?.image_url || order.metadata?.product_image,
            product_sku: lottery?.inventory_product_id,
            user_id: order.user_id,
            user_name: user?.first_name || user?.telegram_username || '未知用户',
            user_telegram_id: user?.telegram_id,
            created_at: order.created_at,
            amount: order.total_amount,
          })
        }
      }
    }

    // 2. 获取待发货的一元购物中奖订单
    if (!orderType || orderType === 'LOTTERY_PRIZE') {
      let query = supabase
        .from('prizes')
        .select(`
          id,
          user_id,
          lottery_id,
          prize_name,
          prize_value,
          winning_code,
          created_at,
          lotteries:lottery_id (
            title,
            title_i18n,
            image_url,
            inventory_product_id
          ),
          users:user_id (
            first_name,
            telegram_username,
            telegram_id
          )
        `)
        .or('logistics_status.is.null,logistics_status.eq.PENDING_SHIPMENT')
        .is('batch_id', null)
        .eq('status', 'CLAIMED') // 已领取但未发货
        .order('created_at', { ascending: false })

      const { data: prizeOrders, error: prizeError } = await query

      if (prizeError) {
        console.error('Error fetching prize orders:', prizeError)
      } else if (prizeOrders) {
        for (const prize of prizeOrders) {
          const lottery = prize.lotteries as any
          const user = prize.users as any
          
          pendingOrders.push({
            id: prize.id,
            order_type: 'LOTTERY_PRIZE',
            order_number: prize.winning_code,
            product_name: lottery?.title || prize.prize_name || '未知商品',
            product_name_i18n: lottery?.title_i18n || {},
            product_image: lottery?.image_url,
            product_sku: lottery?.inventory_product_id,
            user_id: prize.user_id,
            user_name: user?.first_name || user?.telegram_username || '未知用户',
            user_telegram_id: user?.telegram_id,
            created_at: prize.created_at,
            amount: prize.prize_value,
          })
        }
      }
    }

    // 3. 获取待发货的拼团中奖订单
    if (!orderType || orderType === 'GROUP_BUY') {
      let query = supabase
        .from('group_buy_results')
        .select(`
          id,
          winner_id,
          product_id,
          session_id,
          created_at,
          group_buy_products:product_id (
            title,
            description,
            image_urls,
            original_price
          ),
          users:winner_id (
            first_name,
            telegram_username,
            telegram_id
          )
        `)
        .or('logistics_status.is.null,logistics_status.eq.PENDING_SHIPMENT')
        .is('batch_id', null)
        .order('created_at', { ascending: false })

      const { data: groupBuyOrders, error: gbError } = await query

      if (gbError) {
        console.error('Error fetching group buy orders:', gbError)
      } else if (groupBuyOrders) {
        for (const order of groupBuyOrders) {
          const product = order.group_buy_products as any
          const user = order.users as any
          
          // 处理拼团商品的多语言标题（可能是JSONB格式）
          let productName = '未知商品'
          let productNameI18n: Record<string, string> = {}
          
          if (product?.title) {
            if (typeof product.title === 'object') {
              productNameI18n = product.title
              productName = product.title.zh || product.title.ru || product.title.tg || '未知商品'
            } else {
              productName = product.title
            }
          }
          
          pendingOrders.push({
            id: order.id,
            order_type: 'GROUP_BUY',
            order_number: order.session_id,
            product_name: productName,
            product_name_i18n: productNameI18n,
            product_image: product?.image_urls?.[0],
            product_sku: order.product_id,
            user_id: order.winner_id,
            user_name: user?.first_name || user?.telegram_username || '未知用户',
            user_telegram_id: user?.telegram_id,
            created_at: order.created_at,
            amount: product?.original_price,
          })
        }
      }
    }

    // 搜索过滤
    let filteredOrders = pendingOrders
    if (search) {
      const searchLower = search.toLowerCase()
      filteredOrders = pendingOrders.filter(order => 
        order.product_name.toLowerCase().includes(searchLower) ||
        order.user_name?.toLowerCase().includes(searchLower) ||
        order.order_number?.toLowerCase().includes(searchLower) ||
        order.product_sku?.toLowerCase().includes(searchLower)
      )
    }

    // 按创建时间排序
    filteredOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // 分页
    const total = filteredOrders.length
    const startIndex = (page - 1) * pageSize
    const paginatedOrders = filteredOrders.slice(startIndex, startIndex + pageSize)

    return new Response(
      JSON.stringify({
        success: true,
        data: paginatedOrders,
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.ceil(total / pageSize),
        },
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
