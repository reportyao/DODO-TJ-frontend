import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSessionWithUser } from '../_shared/auth.ts'
import { calculatePickupCodeExpiry, generatePickupCode } from '../_shared/pickupCode.ts'
import { enqueueEvent, EventType } from '../_shared/eventQueue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function runInBackground(task: PromiseLike<unknown>, label: string) {
  const wrapped = Promise.resolve(task).catch((error) => {
    console.error(`[CreateFullPurchaseOrder] Background task failed: ${label}`, error)
  })

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
  if (runtime?.waitUntil) {
    runtime.waitUntil(wrapped)
  } else {
    void wrapped
  }
}

function createOrderNumber() {
  return `FP${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function mapErrorCode(errorMessage: string) {
  if (errorMessage.includes('未授权')) return 'UNAUTHORIZED'
  if (errorMessage.includes('缺少商品ID')) return 'MISSING_LOTTERY_ID'
  if (errorMessage.includes('商品不存在')) return 'LOTTERY_NOT_FOUND'
  if (errorMessage.includes('该商品当前不可购买')) return 'LOTTERY_INACTIVE'
  if (errorMessage.includes('该商品不支持全款购买')) return 'FULL_PURCHASE_DISABLED'
  if (errorMessage.includes('库存不足') || errorMessage.includes('商品已售罄')) return 'OUT_OF_STOCK'
  if (errorMessage.includes('商品价格配置异常')) return 'INVALID_PRICE'
  if (errorMessage.includes('总资产不足') || errorMessage.includes('INSUFFICIENT_BALANCE')) return 'INSUFFICIENT_BALANCE'
  if (errorMessage.includes('自提点不存在')) return 'PICKUP_POINT_NOT_FOUND'
  if (errorMessage.includes('该自提点当前不可用')) return 'PICKUP_POINT_INACTIVE'
  if (errorMessage.includes('创建订单失败')) return 'ORDER_CREATE_FAILED'
  if (errorMessage.includes('支付失败')) return 'PAYMENT_FAILED'
  if (errorMessage.includes('库存更新失败')) return 'INVENTORY_UPDATE_FAILED'
  if (errorMessage.includes('库存已变动')) return 'INVENTORY_CONFLICT'
  return 'UNKNOWN_ERROR'
}

function getHttpStatusForErrorCode(errorCode: string) {
  switch (errorCode) {
    case 'UNAUTHORIZED':
      return 401
    case 'MISSING_LOTTERY_ID':
    case 'INVALID_PRICE':
    case 'PICKUP_POINT_NOT_FOUND':
    case 'PICKUP_POINT_INACTIVE':
      return 400
    case 'LOTTERY_NOT_FOUND':
      return 404
    case 'LOTTERY_INACTIVE':
    case 'FULL_PURCHASE_DISABLED':
    case 'OUT_OF_STOCK':
    case 'INSUFFICIENT_BALANCE':
    case 'INVENTORY_CONFLICT':
      return 409
    case 'ORDER_CREATE_FAILED':
    case 'PAYMENT_FAILED':
    case 'INVENTORY_UPDATE_FAILED':
    default:
      return 500
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  const startedAt = Date.now()

  try {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('服务器配置错误')
    }

    const body = await req.json()
    const {
      lottery_id,
      pickup_point_id,
      user_id: requestedUserId,
      session_token,
      useCoupon,
      idempotency_key,
    } = body

    console.log('[CreateFullPurchaseOrder] Received request:', {
      lottery_id,
      pickup_point_id,
      requestedUserId,
      useCoupon,
      hasSessionToken: Boolean(session_token),
      hasIdempotencyKey: Boolean(idempotency_key),
    })

    let token = session_token
    if (!token) {
      const authHeader = req.headers.get('authorization')
      if (authHeader) {
        token = authHeader.replace('Bearer ', '')
      }
    }

    if (!token) {
      throw new Error('未授权：缺少 session_token')
    }

    if (!lottery_id) {
      throw new Error('缺少商品ID')
    }

    const { userId } = await validateSessionWithUser(supabase as never, token)

    if (requestedUserId && requestedUserId !== userId) {
      throw new Error('未授权：用户身份不匹配')
    }

    if (idempotency_key) {
      const { data: existingLog, error: logLookupError } = await supabase
        .from('edge_function_logs')
        .select('id, details')
        .eq('function_name', 'create-full-purchase-order')
        .eq('action', 'FULL_PURCHASE')
        .eq('user_id', userId)
        .eq('status', 'success')
        .contains('details', { idempotency_key })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (logLookupError) {
        console.error('[CreateFullPurchaseOrder] Idempotency lookup failed:', logLookupError)
      }

      if (existingLog?.details?.result_data) {
        console.log(`[CreateFullPurchaseOrder] Idempotency hit: ${idempotency_key}`)
        return jsonResponse({
          success: true,
          message: '全款购买已成功处理（重复请求）',
          data: existingLog.details.result_data,
        })
      }
    }

    const { data: lottery, error: lotteryError } = await supabase
      .from('lotteries')
      .select('id, title, title_i18n, image_url, image_urls, currency, status, full_purchase_enabled, inventory_product_id, sold_tickets, total_tickets, full_purchase_price, original_price, ticket_price')
      .eq('id', lottery_id)
      .single()

    if (lotteryError || !lottery) {
      console.error('[CreateFullPurchaseOrder] Lottery not found:', lotteryError)
      throw new Error('商品不存在')
    }

    if (lottery.status !== 'ACTIVE') {
      throw new Error('该商品当前不可购买')
    }

    if (lottery.full_purchase_enabled === false) {
      throw new Error('该商品不支持全款购买')
    }

    const [inventoryResult, pickupPointResult] = await Promise.all([
      lottery.inventory_product_id
        ? supabase
            .from('inventory_products')
            .select('id, stock, original_price, status')
            .eq('id', lottery.inventory_product_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
      pickup_point_id
        ? supabase
            .from('pickup_points')
            .select('id, status')
            .eq('id', pickup_point_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (inventoryResult.error) {
      console.error('[CreateFullPurchaseOrder] Inventory product error:', inventoryResult.error)
      throw new Error('获取库存商品信息失败')
    }

    if (pickupPointResult.error || (pickup_point_id && !pickupPointResult.data)) {
      throw new Error('自提点不存在')
    }

    if (pickupPointResult.data && pickupPointResult.data.status !== 'ACTIVE') {
      throw new Error('该自提点当前不可用')
    }

    const inventoryProduct = inventoryResult.data
    if (inventoryProduct) {
      if ((inventoryProduct.stock ?? 0) <= 0) {
        throw new Error('库存不足，无法全款购买')
      }
    } else if ((lottery.sold_tickets ?? 0) >= (lottery.total_tickets ?? 0)) {
      throw new Error('商品已售罄')
    }

    let fullPrice = Number(lottery.full_purchase_price ?? 0)
    if (!fullPrice && inventoryProduct?.original_price) {
      fullPrice = Number(inventoryProduct.original_price)
    }
    if (!fullPrice) {
      fullPrice = Number(lottery.original_price ?? 0) || Number(lottery.ticket_price ?? 0) * Number(lottery.total_tickets ?? 0)
    }

    if (!fullPrice || fullPrice <= 0) {
      throw new Error('商品价格配置异常，请联系客服')
    }

    // 余额、积分与优惠券统一交由 process_mixed_payment 在单个事务中检查并加锁，
    // 避免这里的预查询与 RPC 内部重复读取同一批 wallets/coupons 造成额外耗时和竞态窗口。

    const pickupCode = await generatePickupCode(supabase as never)
    const expiresAtIso = calculatePickupCodeExpiry(30)
    const orderId = crypto.randomUUID()
    const orderNumber = createOrderNumber()
    const deliveryMethod = pickup_point_id ? 'PICKUP' : 'DELIVERY'

    const orderPayload = {
      id: orderId,
      user_id: userId,
      lottery_id,
      order_number: orderNumber,
      total_amount: fullPrice,
      currency: lottery.currency,
      status: 'PENDING',
      pickup_point_id: pickup_point_id || null,
      pickup_code: pickupCode,
      expires_at: expiresAtIso,
      metadata: {
        product_title: lottery.title,
        product_title_i18n: lottery.title_i18n,
        product_image: lottery.image_urls?.[0] || lottery.image_url || null,
        original_price: lottery.original_price,
        ticket_price: lottery.ticket_price,
        total_tickets: lottery.total_tickets,
        inventory_product_id: lottery.inventory_product_id,
        full_purchase_price: fullPrice,
        delivery_method: deliveryMethod,
      },
    }

    const { error: orderError } = await supabase
      .from('full_purchase_orders')
      .insert(orderPayload)

    if (orderError) {
      console.error('[CreateFullPurchaseOrder] Create order error:', orderError)
      throw new Error('创建订单失败')
    }

    const { data: paymentResult, error: paymentError } = await supabase.rpc('process_mixed_payment', {
      p_user_id: userId,
      p_lottery_id: lottery_id,
      p_order_id: orderId,
      p_total_amount: fullPrice,
      p_use_coupon: Boolean(useCoupon),
      p_order_type: 'FULL_PURCHASE',
    })

    if (paymentError) {
      console.error('[CreateFullPurchaseOrder] process_mixed_payment RPC error:', paymentError)
      await supabase
        .from('full_purchase_orders')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', orderId)
      throw new Error(`支付失败: ${paymentError.message}`)
    }

    if (!paymentResult?.success) {
      const errorMsg = paymentResult?.error || 'UNKNOWN_PAYMENT_ERROR'
      console.error('[CreateFullPurchaseOrder] process_mixed_payment business error:', errorMsg)
      await supabase
        .from('full_purchase_orders')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', orderId)
      throw new Error(`支付失败: ${errorMsg}`)
    }

    if (inventoryProduct) {
      const newStock = Number(inventoryProduct.stock) - 1
      const { data: updatedInventory, error: updateInventoryError } = await supabase
        .from('inventory_products')
        .update({
          stock: newStock,
          updated_at: new Date().toISOString(),
        })
        .eq('id', inventoryProduct.id)
        .eq('stock', inventoryProduct.stock)
        .select('id')
        .maybeSingle()

      if (updateInventoryError) {
        console.error('[CreateFullPurchaseOrder] Update inventory error:', updateInventoryError)
        await supabase
          .from('full_purchase_orders')
          .update({
            status: 'REFUND_PENDING',
            metadata: {
              ...orderPayload.metadata,
              refund_reason: 'INVENTORY_UPDATE_FAILED',
              refund_detail: updateInventoryError.message,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderId)
        throw new Error('库存更新失败，订单已标记为待退款，请联系客服')
      }

      if (!updatedInventory) {
        await supabase
          .from('full_purchase_orders')
          .update({
            status: 'REFUND_PENDING',
            metadata: {
              ...orderPayload.metadata,
              refund_reason: 'INVENTORY_OPTIMISTIC_LOCK_CONFLICT',
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderId)
        throw new Error('库存已变动，订单已标记为待退款，请联系客服')
      }

      runInBackground(
        supabase.from('inventory_transactions').insert({
          inventory_product_id: inventoryProduct.id,
          transaction_type: 'FULL_PURCHASE',
          quantity: -1,
          stock_before: inventoryProduct.stock,
          stock_after: newStock,
          related_order_id: orderId,
          related_lottery_id: lottery_id,
          notes: `全款购买订单 ${orderNumber}`,
        }),
        'inventory_transaction_log',
      )
    }

    await supabase
      .from('full_purchase_orders')
      .update({
        status: 'COMPLETED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)

    const tjsDeducted = Number(paymentResult.tjs_deducted ?? 0)
    if (tjsDeducted > 0) {
      runInBackground(
        enqueueEvent(supabase, {
          event_type: EventType.COMMISSION,
          source: 'create-full-purchase-order',
          payload: {
            order_id: orderId,
            user_id: userId,
            order_amount: tjsDeducted,
          },
          idempotency_key: `full-purchase:commission:${orderId}`,
          session_id: token,
          user_id: userId,
        }),
        'commission_enqueue',
      )
    }

    runInBackground(
      supabase.from('pickup_logs').insert({
        prize_id: orderId,
        pickup_code: pickupCode,
        pickup_point_id: pickup_point_id || null,
        operation_type: 'FULL_PURCHASE',
        notes: '用户全款购买商品，生成提货码',
      }),
      'pickup_log_insert',
    )

    const resultData = {
      order_id: orderId,
      order_number: orderNumber,
      pickup_code: pickupCode,
      expires_at: expiresAtIso,
      payment_detail: paymentResult,
    }

    if (idempotency_key) {
      runInBackground(
        supabase.rpc('log_edge_function_action', {
          p_function_name: 'create-full-purchase-order',
          p_action: 'FULL_PURCHASE',
          p_user_id: userId,
          p_target_type: 'lottery',
          p_target_id: lottery_id,
          p_details: {
            order_id: orderId,
            total_amount: fullPrice,
            use_coupon: Boolean(useCoupon),
            idempotency_key,
            duration_ms: Date.now() - startedAt,
            result_data: resultData,
          },
          p_status: 'success',
          p_error_message: null,
        }),
        'audit_log_success',
      )
    }

    console.log('[CreateFullPurchaseOrder] Success:', {
      orderId,
      orderNumber,
      pickupCode,
      totalAmount: fullPrice,
      inventoryProductId: inventoryProduct?.id ?? null,
      paymentDetail: paymentResult,
      durationMs: Date.now() - startedAt,
    })

    return jsonResponse({ success: true, data: resultData })
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    const errorCode = mapErrorCode(errMsg)
    const httpStatus = getHttpStatusForErrorCode(errorCode)
    console.error('[CreateFullPurchaseOrder] Error:', errMsg, '| code:', errorCode, '| http:', httpStatus)
    return jsonResponse({ success: false, error: errMsg, error_code: errorCode }, httpStatus)
  }
})
