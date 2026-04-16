import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSessionWithUser } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}



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
  if (cached) {cache.delete(key)}
  return null
}

function setCache(key: string, data: unknown): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) {cache.delete(oldestKey)}
  }
  cache.set(key, { data, timestamp: Date.now() })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {return new Response('ok', { headers: corsHeaders })}

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

    // 【性能优化】复用共享会话校验逻辑，避免额外 REST HTTP 往返
    if (!session_token) {
      return new Response(JSON.stringify({ error: 'Missing session_token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    let user_id: string
    try {
      const validatedSession = await validateSessionWithUser(supabase as never, session_token)
      user_id = validatedSession.userId
    } catch (sessionError) {
      const errorMessage = sessionError instanceof Error ? sessionError.message : 'Invalid session'
      return new Response(JSON.stringify({ error: errorMessage }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const cacheKey = `order:${user_id}:${order_id}`
    const cachedResult = getCached(cacheKey)
    if (cachedResult) {
      return new Response(JSON.stringify(cachedResult), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' } })
    }

    let orderType: 'full_purchase' | 'prize' | null = null
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

    if (!orderData) {
      return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 并行查询订单详情必需数据；活跃自提点列表按需懒加载，避免每次详情都扫一遍 pickup_points
    const [productData, pickupPointData, shipmentBatchData] = await Promise.all([
      productId
        ? supabase.from('lotteries').select('title, title_i18n, image_url, image_urls, original_price').eq('id', productId).maybeSingle().then(({ data }) => data)
        : Promise.resolve(null),
      orderData.pickup_point_id
        ? supabase
            .from('pickup_points')
            .select('id, name, name_i18n, address, address_i18n, contact_phone, is_active, photos')
            .eq('id', orderData!.pickup_point_id)
            .maybeSingle()
            .then(({ data }) => data)
        : Promise.resolve(null),
      orderData.batch_id
        ? supabase
            .from('shipment_batches')
            .select('batch_no, china_tracking_no, tajikistan_tracking_no, estimated_arrival_date, status')
            .eq('id', orderData!.batch_id)
            .maybeSingle()
            .then(({ data }) => data)
        : Promise.resolve(null),
    ])

    const needsPickupPointOptions = !pickupPointData || pickupPointData.is_active === false
    const activePickupPoints = needsPickupPointOptions
      ? await supabase
          .from('pickup_points')
          .select('id, name, name_i18n, address, address_i18n, contact_phone')
          .eq('is_active', true)
          .order('name', { ascending: true })
          .then(({ data }) => data || [])
      : []

    // 如果当前绑定的自提点已禁用，保留数据但标记为禁用状态
    const finalPickupPoint = pickupPointData

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
