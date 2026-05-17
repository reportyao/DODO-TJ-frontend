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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-session-token',
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

function normalizeQuantity(quantity: unknown): number {
  const parsed = Number(quantity)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

function isActiveProduct(status: string | null | undefined): boolean {
  return String(status || '').toUpperCase() === 'ACTIVE'
}

// ============================================================================
// 操作处理函数
// ============================================================================

/**
 * 获取购物车列表（含商品详情和小计）
 */

async function getGiftWithPurchaseState(totalAmount: number) {
  const nowIso = new Date().toISOString()
  const { data: rules, error: rulesError } = await supabase
    .from('b2b_gift_rules')
    .select('id, name, name_i18n, description, description_i18n, threshold_amount, max_gift_items, starts_at, ends_at, sort_order, created_at')
    .eq('is_active', true)
    .lte('threshold_amount', totalAmount)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .order('threshold_amount', { ascending: false })
    .order('sort_order', { ascending: true })
    .limit(1)

  if (rulesError) {
    console.error('[B2BCart] 查询满额赠送规则失败:', rulesError)
  }

  const { data: nextRules } = await supabase
    .from('b2b_gift_rules')
    .select('id, name, name_i18n, threshold_amount')
    .eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .gte('threshold_amount', totalAmount)
    .order('threshold_amount', { ascending: true })
    .limit(1)

  const selectedRule = rules?.[0] || null
  const nextRule = selectedRule || nextRules?.[0] || null
  const threshold = Number(nextRule?.threshold_amount || selectedRule?.threshold_amount || 0)
  const remainingAmount = selectedRule ? 0 : Math.max(threshold - totalAmount, 0)
  const progress = threshold > 0 ? Math.min(100, Math.round((totalAmount / threshold) * 100)) : 0

  let giftProducts: any[] = []
  if (selectedRule) {
    const { data: links, error: linkError } = await supabase
      .from('b2b_gift_rule_products')
      .select('product_id, gift_quantity, sort_order')
      .eq('rule_id', selectedRule.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (linkError) {
      console.error('[B2BCart] 查询赠品池失败:', linkError)
    }

    const productIds = (links || []).map((item: any) => item.product_id).filter(Boolean)
    if (productIds.length > 0) {
      const { data: products, error: productError } = await supabase
        .from('inventory_products')
        .select('id, name, name_i18n, image_url, sku, unit_measure, stock, status')
        .in('id', productIds)
        .eq('status', 'ACTIVE')

      if (productError) {
        console.error('[B2BCart] 查询赠品商品失败:', productError)
      }

      const productMap = new Map((products || []).map((p: any) => [p.id, p]))
      giftProducts = (links || [])
        .map((link: any) => {
          const product = productMap.get(link.product_id)
          if (!product || Number(product.stock || 0) < Number(link.gift_quantity || 1)) return null
          return {
            product_id: link.product_id,
            product_name: product.name,
            name_i18n: product.name_i18n,
            image_url: product.image_url,
            sku: product.sku,
            unit_measure: product.unit_measure,
            stock: product.stock,
            gift_quantity: Number(link.gift_quantity || 1),
            sort_order: link.sort_order,
          }
        })
        .filter(Boolean)
    }
  }

  return {
    eligible: Boolean(selectedRule && giftProducts.length > 0),
    threshold_amount: Number(selectedRule?.threshold_amount || nextRule?.threshold_amount || 0),
    rule_id: selectedRule?.id || null,
    rule_name: selectedRule?.name || nextRule?.name || null,
    rule_name_i18n: selectedRule?.name_i18n || nextRule?.name_i18n || null,
    description: selectedRule?.description || null,
    description_i18n: selectedRule?.description_i18n || null,
    max_gift_items: Number(selectedRule?.max_gift_items || 1),
    remaining_amount: remainingAmount,
    progress,
    gift_products: giftProducts,
  }
}

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
    const giftWithPurchase = await getGiftWithPurchaseState(0)
    return jsonResponse({ success: true, cart: [], total_amount: 0, item_count: 0, gift_with_purchase: giftWithPurchase })
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
      // 标记商品是否仍然可购买：需要同时满足上架、库存足够、达到最小起订量。
      is_available: product
        ? isActiveProduct(product.status)
          && (product.stock ?? 0) >= item.quantity
          && item.quantity >= (product.min_order_quantity ?? 1)
        : false,
    }
  })

  const giftWithPurchase = await getGiftWithPurchaseState(totalAmount)

  return jsonResponse({
    success: true,
    cart,
    total_amount: totalAmount,
    item_count: cart.length,
    gift_with_purchase: giftWithPurchase,
  })
}

/**
 * 添加商品到购物车
 */
async function handleAddToCart(userId: string, productId: string, quantity: number) {
  const requestedQuantity = normalizeQuantity(quantity)
  if (!productId) {
    return jsonResponse({ success: false, error: '商品ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }
  if (requestedQuantity < 1) {
    return jsonResponse({ success: false, error: '数量必须大于0', error_code: 'ERR_QUANTITY_INVALID' }, 400)
  }

  // 验证商品是否存在且有效
  const { data: product, error: productError } = await supabase
    .from('inventory_products')
    .select('id, name, status, stock, min_order_quantity, wholesale_price')
    .eq('id', productId)
    .maybeSingle()

  if (productError || !product) {
    return jsonResponse({ success: false, error: '商品不存在', error_code: 'ERR_PRODUCT_NOT_FOUND' }, 404)
  }

  if (!isActiveProduct(product.status)) {
    return jsonResponse({ success: false, error: '商品已下架', error_code: 'ERR_PRODUCT_NOT_FOUND' }, 400)
  }

  // 校验批发价是否有效（防止价格为0的商品进入购物车导致结算失败）
  if (!product.wholesale_price || product.wholesale_price <= 0) {
    return jsonResponse({ success: false, error: '该商品批发价未设置，暂时无法购买', error_code: 'ERR_INVALID_PRICE' }, 400)
  }

  // 校验最小起订量（添加时就提示，避免结算时才报错）
  const minQty = product.min_order_quantity || 1
  const availableStock = product.stock ?? 0
  if (requestedQuantity < minQty) {
    return jsonResponse({
      success: false,
      error: `该商品最小起订量为 ${minQty}`,
      error_code: 'ERR_MIN_ORDER_QUANTITY',
      min_order_quantity: minQty,
    }, 400)
  }
  if (requestedQuantity > availableStock) {
    return jsonResponse({
      success: false,
      error: `库存不足，当前库存仅 ${availableStock}`,
      error_code: 'ERR_OUT_OF_STOCK',
      stock: availableStock,
    }, 409)
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
    const newQuantity = existing.quantity + requestedQuantity
    if (newQuantity > availableStock) {
      return jsonResponse({
        success: false,
        error: `库存不足，购物车已有 ${existing.quantity}，当前库存仅 ${availableStock}`,
        error_code: 'ERR_OUT_OF_STOCK',
        stock: availableStock,
        current_quantity: existing.quantity,
      }, 409)
    }
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
      .insert({ user_id: userId, product_id: productId, quantity: requestedQuantity })
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
  const requestedQuantity = normalizeQuantity(quantity)
  if (!productId) {
    return jsonResponse({ success: false, error: '商品ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }
  if (requestedQuantity < 1) {
    return jsonResponse({ success: false, error: '数量必须大于0', error_code: 'ERR_QUANTITY_INVALID' }, 400)
  }

  const { data: product, error: productError } = await supabase
    .from('inventory_products')
    .select('id, name, status, stock, min_order_quantity')
    .eq('id', productId)
    .maybeSingle()

  if (productError || !product) {
    return jsonResponse({ success: false, error: '商品不存在', error_code: 'ERR_PRODUCT_NOT_FOUND' }, 404)
  }
  if (!isActiveProduct(product.status)) {
    return jsonResponse({ success: false, error: '商品已下架', error_code: 'ERR_PRODUCT_NOT_FOUND' }, 400)
  }
  const minQty = product.min_order_quantity || 1
  const availableStock = product.stock ?? 0
  if (requestedQuantity < minQty) {
    return jsonResponse({
      success: false,
      error: `该商品最小起订量为 ${minQty}`,
      error_code: 'ERR_MIN_ORDER_QUANTITY',
      min_order_quantity: minQty,
    }, 400)
  }
  if (requestedQuantity > availableStock) {
    return jsonResponse({
      success: false,
      error: `库存不足，当前库存仅 ${availableStock}`,
      error_code: 'ERR_OUT_OF_STOCK',
      stock: availableStock,
    }, 409)
  }

  const { data: updated, error: updateError } = await supabase
    .from('shopping_carts')
    .update({ quantity: requestedQuantity, updated_at: new Date().toISOString() })
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
    // Supabase Edge Runtime 会在进入函数代码前把 Authorization 当作 Supabase JWT 校验。
    // 本项目使用 user_sessions 表里的自定义会话令牌，因此客户端必须通过 x-session-token 传递，
    // 让 Authorization 保持 supabase-js 默认的 anon JWT，避免 Relay 层直接返回 401。
    // Authorization 仅作为 verify_jwt=false 环境下的旧版本兼容兜底。
    const customSessionHeader = req.headers.get('x-session-token') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''
    const sessionToken = (customSessionHeader || authHeader.replace(/^Bearer\s+/i, '')).trim()

    if (!sessionToken) {
      return jsonResponse({ success: false, error: '未授权', error_code: 'ERR_MISSING_TOKEN' }, 401)
    }

    const { userId } = await validateSessionWithUser(supabase, sessionToken)
    // 购物车对所有登录用户开放；批发商资质仅在后台展示与价格策略中区分。

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
