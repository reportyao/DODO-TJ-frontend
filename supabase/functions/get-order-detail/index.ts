import { mapErrorCode } from '../_shared/errorResponse.ts'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// mapErrorCode 已迁移到共享模块


// 创建单例 Supabase 客户端
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  db: { schema: 'public' },
  auth: { persistSession: false },
})

// 缓存配置
const CACHE_TTL = 5 * 1000 
const MAX_CACHE_SIZE = 500 
const cache = new Map<string, { data: unknown; timestamp: number }>()

function getCached(key: string): unknown | null {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }
  if (cached) cache.delete(key)
  return null
}

function setCache(key: string, data: unknown): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(key, { data, timestamp: Date.now() })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    let requestBody: { order_id?: string; user_id?: string; session_token?: string }
    try {
      requestBody = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { order_id, session_token } = requestBody
    if (!order_id) {
      return new Response(JSON.stringify({ error: 'Missing order_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 【R17修复】验证 session_token，从 session 中获取真实 user_id
    // 原先直接信任客户端传入的 user_id 参数，存在身份伪造风险
    if (!session_token) {
      return new Response(JSON.stringify({ error: 'Missing session_token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const sessionResponse = await fetch(
      `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${session_token}&is_active=eq.true&select=user_id,expires_at&limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!sessionResponse.ok) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const sessions = await sessionResponse.json()
    if (!sessions || sessions.length === 0) {
      return new Response(JSON.stringify({ error: 'Session not found or expired' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (new Date(sessions[0].expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Session expired' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    // 从已验证的 session 中获取 user_id，而非信任客户端传入的参数
    const user_id = sessions[0].user_id

    const cacheKey = `order:${user_id}:${order_id}`
    const cachedResult = getCached(cacheKey)
    if (cachedResult) {
      return new Response(JSON.stringify(cachedResult), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' } })
    }

    let orderType: string | null = null
    let orderData: Record<string, unknown> | null = null
    let productId: string | null = null

    // 1. 查询 full_purchase_orders
    const { data: fullPurchaseOrder } = await supabase
      .from('full_purchase_orders')
      .select(`id, order_number, status, total_amount, currency, pickup_code, claimed_at, created_at, metadata, lottery_id, pickup_point_id, logistics_status, batch_id`)
      .eq('id', order_id)
      .eq('user_id', user_id)
      .maybeSingle()

    if (fullPurchaseOrder) {
      orderType = 'full_purchase'
      orderData = fullPurchaseOrder as Record<string, unknown>
      productId = orderData.lottery_id as string | null
      // 确保 metadata.type 正确设置
      if (!orderData.metadata || typeof orderData.metadata !== 'object') {
        orderData.metadata = {}
      }
      (orderData.metadata as Record<string, unknown>).type = 'full_purchase'
    }

    // 2. 查询 prizes
    if (!orderData) {
      const { data: prize } = await supabase
        .from('prizes')
        .select(`id, lottery_id, created_at, status, logistics_status, pickup_code, pickup_status, claimed_at, batch_id, pickup_point_id`)
        .eq('id', order_id)
        .eq('user_id', user_id)
        .maybeSingle()

      if (prize) {
        orderType = 'prize'
        const prizeData = prize as Record<string, unknown>
        productId = prizeData.lottery_id as string | null
        
        // 查询用户在该 lottery 上的累计购买金额（从 orders 表）
        let totalPurchaseAmount = 0
        if (prizeData.lottery_id) {
          const { data: purchaseOrders } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('user_id', user_id)
            .eq('lottery_id', prizeData.lottery_id as string)
            .in('status', ['PAID', 'COMPLETED', 'PENDING'])
          
          if (purchaseOrders && purchaseOrders.length > 0) {
            totalPurchaseAmount = purchaseOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0)
          }
        }
        
        orderData = {
          ...prizeData,
          order_number: `PRIZE-${(prizeData.id as string).substring(0, 8).toUpperCase()}`,
          total_amount: totalPurchaseAmount,
          currency: 'LUCKY_COIN',
          metadata: { type: 'prize' }
        }
      }
    }

    // 3. 查询 group_buy_results
    if (!orderData) {
      const { data: groupBuyResult } = await supabase
        .from('group_buy_results')
        .select(`id, product_id, session_id, winner_order_id, created_at, status, logistics_status, pickup_code, pickup_status, claimed_at, batch_id, pickup_point_id, algorithm_data`)
        .eq('id', order_id)
        .eq('winner_id', user_id)
        .maybeSingle()

      if (groupBuyResult) {
        orderType = 'group_buy'
        const gbResult = groupBuyResult as Record<string, unknown>
        productId = gbResult.product_id as string | null
        
        let orderAmount = 0
        if (gbResult.winner_order_id) {
          const { data: gbOrderData } = await supabase
            .from('group_buy_orders')
            .select('amount')
            .eq('id', gbResult.winner_order_id)
            .maybeSingle()
          if (gbOrderData) orderAmount = (gbOrderData as Record<string, unknown>).amount as number
        }

        const sessionId = gbResult.session_id as string | null
        orderData = {
          id: gbResult.id,
          order_number: `GB-${sessionId?.substring(0, 8).toUpperCase() || 'UNKNOWN'}`,
          status: gbResult.status,
          total_amount: orderAmount,
          currency: 'TJS',
          pickup_code: gbResult.pickup_code,
          claimed_at: gbResult.claimed_at,
          created_at: gbResult.created_at,
          metadata: {
            type: (gbResult.algorithm_data as any)?.type === 'squad_buy' ? 'auto_group_buy' : 'group_buy',
            session_id: gbResult.session_id,
            winner_order_id: gbResult.winner_order_id
          },
          lottery_id: gbResult.product_id,
          pickup_point_id: gbResult.pickup_point_id,
          logistics_status: gbResult.logistics_status,
          batch_id: gbResult.batch_id
        }
      }
    }

    // 4. 如果以上都找不到，尝试通过 group_buy_orders.id 反查 group_buy_results
    if (!orderData) {
      const { data: gbOrder } = await supabase
        .from('group_buy_orders')
        .select('id, session_id, amount, user_id')
        .eq('id', order_id)
        .maybeSingle()

      if (gbOrder) {
        // 通过 session_id 和 user_id 查找对应的 group_buy_results
        const gbOrderData = gbOrder as Record<string, unknown>
        const { data: groupBuyResult } = await supabase
          .from('group_buy_results')
          .select('id, product_id, session_id, winner_order_id, created_at, status, logistics_status, pickup_code, pickup_status, claimed_at, batch_id, pickup_point_id, algorithm_data')
          .eq('session_id', gbOrderData.session_id)
          .eq('winner_id', user_id)
          .maybeSingle()

        if (groupBuyResult) {
          orderType = 'group_buy'
          const gbResult = groupBuyResult as Record<string, unknown>
          productId = gbResult.product_id as string | null
          const sessionId = gbResult.session_id as string | null
          orderData = {
            id: gbResult.id,
            order_number: `GB-${sessionId?.substring(0, 8).toUpperCase() || 'UNKNOWN'}`,
            status: gbResult.status,
            total_amount: gbOrderData.amount || 0,
            currency: 'TJS',
            pickup_code: gbResult.pickup_code,
            claimed_at: gbResult.claimed_at,
            created_at: gbResult.created_at,
            metadata: {
              type: (gbResult.algorithm_data as any)?.type === 'squad_buy' ? 'auto_group_buy' : 'group_buy',
              session_id: gbResult.session_id,
              winner_order_id: gbResult.winner_order_id
            },
            lottery_id: gbResult.product_id,
            pickup_point_id: gbResult.pickup_point_id,
            logistics_status: gbResult.logistics_status,
            batch_id: gbResult.batch_id
          }
        }
      }
    }

    if (!orderData) {
      return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 并行查询关联数据
    const [productData, pickupPointData, shipmentBatchData, activePickupPoints] = await Promise.all([
      // 商品信息
      productId ? (async () => {
        if (orderType === 'group_buy') {
          const { data } = await supabase.from('group_buy_products').select('id, name, name_i18n, image_url, image_urls, group_price, original_price').eq('id', productId).maybeSingle()
          if (data) {
            const p = data as Record<string, unknown>
            return { title: p.name, title_i18n: p.name_i18n, image_url: p.image_url, image_urls: p.image_urls, original_price: p.group_price || p.original_price }
          }
        } else {
          const { data } = await supabase.from('lotteries').select('title, title_i18n, image_url, image_urls, original_price').eq('id', productId).maybeSingle()
          return data
        }
        return null
      })() : Promise.resolve(null),

      // 已选自提点 (增加 is_active 检查)
      orderData.pickup_point_id ? (async () => {
        const { data } = await supabase.from('pickup_points').select('id, name, name_i18n, address, address_i18n, contact_phone, is_active, photos').eq('id', orderData!.pickup_point_id).maybeSingle()
        return data
      })() : Promise.resolve(null),

      // 批次信息
      orderData.batch_id ? (async () => {
        const { data } = await supabase.from('shipment_batches').select('batch_no, china_tracking_no, tajikistan_tracking_no, estimated_arrival_date, status').eq('id', orderData!.batch_id).maybeSingle()
        return data
      })() : Promise.resolve(null),

      // 活跃自提点列表
      (async () => {
        const { data } = await supabase.from('pickup_points').select('id, name, name_i18n, address, address_i18n, contact_phone').eq('is_active', true).order('name', { ascending: true })
        return data || []
      })(),
    ])

    // 如果当前绑定的自提点已禁用，保留数据但标记为禁用状态
    let finalPickupPoint = pickupPointData
    // 不再强制设为 null，而是保留完整的自提点信息（包括 is_active 字段）
    // 让前端根据 is_active 字段决定如何显示

    const pickup_status = orderData.pickup_code ? (orderData.claimed_at ? 'PICKED_UP' : 'PENDING_PICKUP') : orderData.status

    const result = {
      ...orderData,
      pickup_status,
      order_type: orderType,
      lotteries: productData,
      pickup_point: finalPickupPoint,
      shipment_batch: shipmentBatchData,
      available_pickup_points: activePickupPoints
    }

    setCache(cacheKey, result)
    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' } })

  } catch (error: unknown) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ success: false, error: 'Internal server error', error_code: 'ERR_SERVER_ERROR' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
