/**
 * ============================================================================
 * B2B 购物车管理 Edge Function
 * ============================================================================
 *
 * 功能: 批发商购物车的增删改查操作
 *
 * 支持的操作 (通过 action 字段区分):
 *   - get:    获取当前用户的购物车列表（含商品详情）
 *   - add:    添加商品到购物车（如已存在则累加数量）
 *   - update: 更新购物车中某商品的数量
 *   - remove: 从购物车中移除某商品
 *   - clear:  清空购物车
 *
 * 权限: 仅已认证的批发商可操作
 *
 * 请求方式: POST
 * 请求体:
 *   { action: 'get' }
 *   { action: 'add', product_id: string, quantity: number }
 *   { action: 'update', product_id: string, quantity: number }
 *   { action: 'remove', product_id: string }
 *   { action: 'clear' }
 *
 * 响应:
 *   get:    { success: true, cart: [...], total_amount: number }
 *   add:    { success: true, cart_item: {...} }
 *   update: { success: true, cart_item: {...} }
 *   remove: { success: true }
 *   clear:  { success: true }
 * ============================================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSessionWithUser } from '../_shared/auth.ts'

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
  auth: { autoRefreshToken: false, persistSession: false },
})

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// 操作处理函数
// ============================================================================

/**
 * 获取购物车列表（含商品详情和小计）
 */
async function handleGetCart(userId: string) {
  // 获取购物车项
  const { data: cartItems, error: cartError } = await supabase
    .from('shopping_carts')
    .select('id, product_id, quantity, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (cartError) {
    return jsonResponse({ success: false, error: '获取购物车失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  if (!cartItems || cartItems.length === 0) {
    return jsonResponse({ success: true, cart: [], total_amount: 0, item_count: 0 })
  }

  // 批量获取商品详情
  const productIds = cartItems.map((item: { product_id: string }) => item.product_id)
  const { data: products, error: productsError } = await supabase
    .from('inventory_products')
    .select('id, name, name_i18n, image_url, wholesale_price, retail_price, stock, min_order_quantity, unit_measure, sku, status, currency')
    .in('id', productIds)

  if (productsError) {
    return jsonResponse({ success: false, error: '获取商品信息失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  const productMap = new Map()
  for (const p of (products || [])) {
    productMap.set(p.id, p)
  }

  // 组装购物车数据
  let totalAmount = 0
  const cart = cartItems.map((item: { id: string; product_id: string; quantity: number; created_at: string; updated_at: string }) => {
    const product = productMap.get(item.product_id)
    const subtotal = product ? product.wholesale_price * item.quantity : 0
    totalAmount += subtotal

    return {
      cart_id: item.id,
      product_id: item.product_id,
      quantity: item.quantity,
      subtotal,
      product: product ? {
        name: product.name,
        name_i18n: product.name_i18n,
        image_url: product.image_url,
        wholesale_price: product.wholesale_price,
        retail_price: product.retail_price,
        stock: product.stock ?? 0,
        min_order_quantity: product.min_order_quantity ?? 1,
        unit_measure: product.unit_measure ?? '件',
        sku: product.sku,
        status: product.status,
        currency: product.currency ?? 'TJS',
      } : null,
      // 标记商品是否仍然可购买
      is_available: product ? product.status === 'ACTIVE' && (product.stock ?? 0) >= item.quantity : false,
    }
  })

  return jsonResponse({
    success: true,
    cart,
    total_amount: totalAmount,
    item_count: cart.length,
  })
}

/**
 * 添加商品到购物车
 */
async function handleAddToCart(userId: string, productId: string, quantity: number) {
  if (!productId) {
    return jsonResponse({ success: false, error: '商品ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }
  if (!quantity || quantity < 1) {
    return jsonResponse({ success: false, error: '数量必须大于0', error_code: 'ERR_QUANTITY_INVALID' }, 400)
  }

  // 验证商品是否存在且有效
  const { data: product, error: productError } = await supabase
    .from('inventory_products')
    .select('id, name, status, stock, min_order_quantity')
    .eq('id', productId)
    .maybeSingle()

  if (productError || !product) {
    return jsonResponse({ success: false, error: '商品不存在', error_code: 'ERR_PRODUCT_NOT_FOUND' }, 404)
  }

  if (product.status !== 'ACTIVE') {
    return jsonResponse({ success: false, error: '商品已下架', error_code: 'ERR_PRODUCT_NOT_FOUND' }, 400)
  }

  // 校验最小起订量（添加时就提示，避免结算时才报错）
  const minQty = product.min_order_quantity || 1
  if (quantity < minQty) {
    return jsonResponse({
      success: false,
      error: `该商品最小起订量为 ${minQty}`,
      error_code: 'ERR_MIN_ORDER_QUANTITY',
      min_order_quantity: minQty,
    }, 400)
  }

  // 检查购物车中是否已存在该商品
  const { data: existing } = await supabase
    .from('shopping_carts')
    .select('id, quantity')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle()

  if (existing) {
    // 已存在，累加数量
    const newQuantity = existing.quantity + quantity
    const { data: updated, error: updateError } = await supabase
      .from('shopping_carts')
      .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id, product_id, quantity')
      .single()

    if (updateError) {
      return jsonResponse({ success: false, error: '更新购物车失败', error_code: 'ERR_SERVER_ERROR' }, 500)
    }

    return jsonResponse({ success: true, cart_item: updated, message: '已更新数量' })
  } else {
    // 不存在，新增
    const { data: inserted, error: insertError } = await supabase
      .from('shopping_carts')
      .insert({ user_id: userId, product_id: productId, quantity })
      .select('id, product_id, quantity')
      .single()

    if (insertError) {
      return jsonResponse({ success: false, error: '添加到购物车失败', error_code: 'ERR_SERVER_ERROR' }, 500)
    }

    return jsonResponse({ success: true, cart_item: inserted, message: '已添加到购物车' })
  }
}

/**
 * 更新购物车商品数量
 */
async function handleUpdateCart(userId: string, productId: string, quantity: number) {
  if (!productId) {
    return jsonResponse({ success: false, error: '商品ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }
  if (!quantity || quantity < 1) {
    return jsonResponse({ success: false, error: '数量必须大于0', error_code: 'ERR_QUANTITY_INVALID' }, 400)
  }

  const { data: updated, error: updateError } = await supabase
    .from('shopping_carts')
    .update({ quantity, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('product_id', productId)
    .select('id, product_id, quantity')
    .maybeSingle()

  if (updateError) {
    return jsonResponse({ success: false, error: '更新失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  if (!updated) {
    return jsonResponse({ success: false, error: '购物车中未找到该商品', error_code: 'ERR_PRODUCT_NOT_FOUND' }, 404)
  }

  return jsonResponse({ success: true, cart_item: updated })
}

/**
 * 从购物车移除商品
 */
async function handleRemoveFromCart(userId: string, productId: string) {
  if (!productId) {
    return jsonResponse({ success: false, error: '商品ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  const { error: deleteError } = await supabase
    .from('shopping_carts')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId)

  if (deleteError) {
    return jsonResponse({ success: false, error: '移除失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({ success: true, message: '已从购物车移除' })
}

/**
 * 清空购物车
 */
async function handleClearCart(userId: string) {
  const { error: clearError } = await supabase
    .from('shopping_carts')
    .delete()
    .eq('user_id', userId)

  if (clearError) {
    return jsonResponse({ success: false, error: '清空失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({ success: true, message: '购物车已清空' })
}

// ============================================================================
// 主入口
// ============================================================================

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: '仅支持 POST 方法', error_code: 'ERR_METHOD_NOT_ALLOWED' }, 405)
  }

  try {
    // 验证用户身份
    const authHeader = req.headers.get('Authorization') ?? ''
    const sessionToken = authHeader.replace('Bearer ', '').trim()

    if (!sessionToken) {
      return jsonResponse({ success: false, error: '未授权', error_code: 'ERR_MISSING_TOKEN' }, 401)
    }

    const { userId } = await validateSessionWithUser(supabase, sessionToken)

    // 验证批发商身份
    const { data: wholesaler } = await supabase
      .from('wholesaler_profiles')
      .select('id, status')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .maybeSingle()

    if (!wholesaler) {
      return jsonResponse({ success: false, error: '您不是已认证的批发商', error_code: 'ERR_NOT_WHOLESALER' }, 403)
    }

    // 解析请求体
    const body = await req.json().catch(() => ({}))
    const { action, product_id, quantity } = body as {
      action?: string
      product_id?: string
      quantity?: number
    }

    // 路由到对应处理函数
    switch (action) {
      case 'get':
        return await handleGetCart(userId)
      case 'add':
        return await handleAddToCart(userId, product_id || '', quantity || 1)
      case 'update':
        return await handleUpdateCart(userId, product_id || '', quantity || 1)
      case 'remove':
        return await handleRemoveFromCart(userId, product_id || '')
      case 'clear':
        return await handleClearCart(userId)
      default:
        return jsonResponse({
          success: false,
          error: `无效的操作: ${action}。支持的操作: get, add, update, remove, clear`,
          error_code: 'ERR_INVALID_ACTION',
        }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误'
    console.error('[B2BCart] 未捕获异常:', error)

    if (message.includes('未授权') || message.includes('会话')) {
      return jsonResponse({ success: false, error: message, error_code: 'ERR_INVALID_SESSION' }, 401)
    }

    return jsonResponse({ success: false, error: message, error_code: 'ERR_SERVER_ERROR' }, 500)
  }
})
