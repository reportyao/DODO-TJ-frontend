/**
 * ============================================================================
 * B2B 批发商结算 Edge Function
 * ============================================================================
 *
 * P0-3 改造目标：
 *   1. Edge Function 仅负责 HTTP、会话校验、请求归一化、通知投递和响应转换。
 *   2. 订单创建、明细写入、库存扣减、库存流水、购物车清空全部委托给
 *      b2b_create_order_from_cart_tx RPC，在数据库单事务内完成。
 *   3. 支持 Idempotency-Key，避免网络重试或重复点击导致重复下单。
 *
 * 请求方式: POST
 * 请求体:
 *   {
 *     delivery_address?: string,
 *     delivery_note?: string,
 *     idempotency_key?: string
 *   }
 *
 * 响应:
 *   成功: { success: true, order: { id, order_number, total_amount, item_count } }
 *   失败: { success: false, error: string, error_code: string }
 * ============================================================================
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { validateSessionWithUser } from '../_shared/auth.ts'
import { enqueueEvent, EventType } from '../_shared/eventQueue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-session-token, idempotency-key',
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

interface CheckoutRequest {
  delivery_address?: string | null
  delivery_note?: string | null
  idempotency_key?: string | null
  selected_gift_product_id?: string | null
}

interface CheckoutRpcResponse {
  success?: boolean
  error?: string
  error_code?: string
  details?: unknown
  order?: {
    id?: string
    order_number?: string
    total_amount?: number
    subtotal_amount?: number
    paid_total?: number
    item_count?: number
    total_quantity?: number
    status?: string
    fulfillment_status?: string
    payment_status?: string
    financial_status?: string
    delivery_address?: string
    profit_status?: string
  }
  message?: string
  idempotent_replay?: boolean
}

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
    console.error(`[B2BCheckout] Background task failed: ${label}`, error)
  })
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
  if (runtime?.waitUntil) {
    runtime.waitUntil(wrapped)
  } else {
    void wrapped
  }
}

function normalizeIdempotencyKey(req: Request, body: CheckoutRequest): string | null {
  const headerValue = req.headers.get('Idempotency-Key') ?? req.headers.get('idempotency-key')
  const bodyValue = body.idempotency_key ?? null
  const raw = (headerValue || bodyValue || '').trim()
  if (!raw) return null
  return raw.slice(0, 200)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

function mapErrorStatus(errorCode?: string): number {
  switch (errorCode) {
    case 'ERR_MISSING_TOKEN':
    case 'ERR_INVALID_SESSION':
      return 401
    case 'ERR_PARAMS_MISSING':
    case 'ERR_CART_EMPTY':
    case 'ERR_MIN_ORDER_QUANTITY':
    case 'ERR_INVALID_PRICE':
      return 400
    case 'ERR_GIFT_NOT_ELIGIBLE':
    case 'ERR_GIFT_UNAVAILABLE':
      return 400
    case 'ERR_OUT_OF_STOCK':
    case 'ERR_PRODUCT_UNAVAILABLE':
    case 'ERR_GIFT_OUT_OF_STOCK':
    case 'ERR_IDEMPOTENCY_CONFLICT':
      return 409
    default:
      return 500
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: '仅支持 POST 方法', error_code: 'ERR_METHOD_NOT_ALLOWED' }, 405)
  }

  try {
    const customSessionHeader = req.headers.get('x-session-token') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''
    const sessionToken = (customSessionHeader || authHeader.replace(/^Bearer\s+/i, '')).trim()

    if (!sessionToken) {
      return jsonResponse({ success: false, error: '未授权：缺少认证令牌', error_code: 'ERR_MISSING_TOKEN' }, 401)
    }

    const { userId, phoneNumber } = await validateSessionWithUser(supabase, sessionToken)
    const body: CheckoutRequest = await req.json().catch(() => ({}))

    const { data: wholesalerProfile, error: wholesalerError } = await supabase
      .from('wholesaler_profiles')
      .select('id, status, delivery_address, company_name')
      .eq('user_id', userId)
      .maybeSingle()

    if (wholesalerError) {
      console.error('[B2BCheckout] 查询批发商信息失败:', wholesalerError)
      return jsonResponse({ success: false, error: '查询批发商信息失败', error_code: 'ERR_SERVER_ERROR' }, 500)
    }

    const deliveryAddress = (body.delivery_address || wholesalerProfile?.delivery_address || '').trim()
    const deliveryNote = (body.delivery_note || '').trim()

    if (!deliveryAddress) {
      return jsonResponse({
        success: false,
        error: '配送地址不能为空，请在个人资料中设置或在下单时提供',
        error_code: 'ERR_PARAMS_MISSING',
      }, 400)
    }

    const idempotencyKey = normalizeIdempotencyKey(req, body)
    const requestHash = await sha256Hex(JSON.stringify({
      user_id: userId,
      delivery_address: deliveryAddress,
      delivery_note: deliveryNote,
      selected_gift_product_id: body.selected_gift_product_id || null,
    }))
    const sessionTokenHash = await sha256Hex(sessionToken)

    const { data: rpcData, error: rpcError } = await supabase.rpc('b2b_create_order_from_cart_tx', {
      p_user_id: userId,
      p_delivery_address: deliveryAddress,
      p_delivery_note: deliveryNote,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_session_token_hash: sessionTokenHash,
      p_selected_gift_product_id: body.selected_gift_product_id || null,
    })

    if (rpcError) {
      console.error('[B2BCheckout] 事务化下单 RPC 调用失败:', rpcError)
      return jsonResponse({
        success: false,
        error: '订单创建失败，请稍后重试',
        error_code: 'ERR_CHECKOUT_TX_FAILED',
        details: rpcError.message,
      }, 500)
    }

    const result = (rpcData || {}) as CheckoutRpcResponse
    if (!result.success) {
      return jsonResponse({
        success: false,
        error: result.error || '下单失败',
        error_code: result.error_code || 'ERR_CHECKOUT_FAILED',
        details: result.details,
      }, mapErrorStatus(result.error_code))
    }

    const order = result.order || {}

    runInBackground(
      enqueueEvent(supabase, {
        event_type: EventType.B2B_NEW_ORDER,
        source: 'b2b-checkout',
        payload: {
          order_id: order.id,
          order_number: order.order_number,
          user_id: userId,
          company_name: wholesalerProfile?.company_name || phoneNumber || userId,
          wholesaler_status: wholesalerProfile?.status || null,
          total_amount: order.total_amount,
          item_count: order.item_count,
          total_quantity: order.total_quantity,
          idempotent_replay: Boolean(result.idempotent_replay),
        },
        idempotency_key: `b2b-checkout:${order.id}`,
        session_id: sessionToken,
        user_id: userId,
      }),
      'enqueue_new_order_event'
    )

    return jsonResponse({
      success: true,
      order,
      idempotent_replay: Boolean(result.idempotent_replay),
      message: result.message || '订单创建成功，等待配送',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误'
    console.error('[B2BCheckout] 未捕获异常:', error)

    if (message.includes('未授权') || message.includes('会话')) {
      return jsonResponse({ success: false, error: message, error_code: 'ERR_INVALID_SESSION' }, 401)
    }

    return jsonResponse({ success: false, error: message, error_code: 'ERR_SERVER_ERROR' }, 500)
  }
})
