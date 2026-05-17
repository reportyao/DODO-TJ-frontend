import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { validateSessionWithUser } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ============================================================================
// 工具函数
// ============================================================================

function safeNumber(val: any): number {
  const parsed = typeof val === 'string' ? parseFloat(val) : val
  return typeof parsed === 'number' && !isNaN(parsed) ? parsed : 0
}

function safeInt(val: any): number {
  const parsed = parseInt(String(val))
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

  // 1. 查询所有激活且在时间范围内的规则
  const { data: allActiveRules, error: rulesError } = await supabase
    .from('b2b_gift_rules')
    .select('id, name, name_i18n, description, description_i18n, threshold_amount, max_gift_items, starts_at, ends_at, sort_order, created_at')
    .eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .order('threshold_amount', { ascending: true })
    .order('sort_order', { ascending: true })

  if (rulesError) {
    console.error('[B2BCart] 查询满额赠送规则失败:', rulesError)
  }

  const rules = allActiveRules || []
  
  // 2. 区分已达标规则和未达标规则
  const eligibleRules = rules.filter(r => Number(r.threshold_amount) <= totalAmount)
  const pendingRules = rules.filter(r => Number(r.threshold_amount) > totalAmount)
  const nextRule = pendingRules[0] || null

  // 3. 为每个已达标规则加载赠品池
  const results = []
  for (const rule of eligibleRules) {
    const { data: links } = await supabase
      .from('b2b_gift_rule_products')
      .select('product_id, gift_quantity, sort_order')
      .eq('rule_id', rule.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    const productIds = (links || []).map((item: any) => item.product_id).filter(Boolean)
    let giftProducts: any[] = []

    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('inventory_products')
        .select('id, name, name_i18n, image_url, sku, unit_measure, stock, status, wholesale_price')
        .in('id', productIds)
        .eq('status', 'ACTIVE')

      const productMap = new Map((products || []).map((p: any) => [p.id, p]))
      giftProducts = (links || [])
        .map((link: any) => {
          const product = productMap.get(link.product_id)
          // 检查库存是否充足
          if (!product || Number(product.stock || 0) < Number(link.gift_quantity || 1)) return null
          return {
            product_id: link.product_id,
            product_name: product.name,
            name_i18n: product.name_i18n,
            image_url: product.image_url,
            sku: product.sku,
            unit_measure: product.unit_measure,
            stock: product.stock,
            wholesale_price: product.wholesale_price || 0,
            gift_quantity: Number(link.gift_quantity || 1),
            sort_order: link.sort_order,
          }
        })
        .filter(Boolean)
    }

    if (giftProducts.length > 0) {
      results.push({
        rule_id: rule.id,
        rule_name: rule.name,
        rule_name_i18n: rule.name_i18n,
        description: rule.description,
        description_i18n: rule.description_i18n,
        threshold_amount: Number(rule.threshold_amount),
        max_gift_items: Number(rule.max_gift_items || 1),
        gift_products: giftProducts,
      })
    }
  }

  // 4. 计算下一个目标的进度
  let nextThreshold = 0
  let remainingAmount = 0
  let progress = 0

  if (nextRule) {
    nextThreshold = Number(nextRule.threshold_amount)
    remainingAmount = Math.max(nextThreshold - totalAmount, 0)
    // 进度计算逻辑：基于当前金额占下一个门槛的比例
    progress = Math.min(100, Math.round((totalAmount / nextThreshold) * 100))
  }

  return {
    eligible_count: results.length,
    rules: results,
    next_goal: nextRule ? {
      rule_id: nextRule.id,
      rule_name: nextRule.name,
      rule_name_i18n: nextRule.name_i18n,
      threshold_amount: nextThreshold,
      remaining_amount: remainingAmount,
      progress: progress
    } : null
  }
}

async function handleGetCart(userId: string) {
  // 1. 获取购物车项
  const { data: cartItems, error: cartError } = await supabase
    .from('b2b_cart_items')
    .select('id, product_id, quantity')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (cartError) throw cartError

  if (!cartItems || cartItems.length === 0) {
    return { items: [], summary: { total_quantity: 0, total_amount: 0 }, gift_with_purchase: null }
  }

  // 2. 获取商品详情
  const productIds = cartItems.map(item => item.product_id)
  const { data: products, error: productError } = await supabase
    .from('inventory_products')
    .select('id, name, name_i18n, image_url, wholesale_price, retail_price, stock, min_order_quantity, unit_measure, sku, status, currency')
    .in('id', productIds)

  if (productError) throw productError

  const productMap = new Map(products?.map(p => [p.id, p]))

  // 3. 组装数据并计算总计
  let totalAmount = 0
  let totalQuantity = 0

  const items = cartItems.map(item => {
    const product = productMap.get(item.product_id)
    const subtotal = product ? product.wholesale_price * item.quantity : 0
    
    if (product && isActiveProduct(product.status)) {
      totalAmount += subtotal
      totalQuantity += item.quantity
    }

    return {
      id: item.id,
      product_id: item.product_id,
      quantity: item.quantity,
      product_name: product?.name || '未知商品',
      name_i18n: product?.name_i18n || {},
      product_image: product?.image_url || null,
      wholesale_price: product?.wholesale_price || 0,
      retail_price: product?.retail_price || null,
      unit_measure: product?.unit_measure || '件',
      stock: product?.stock || 0,
      min_order_quantity: product?.min_order_quantity || 1,
      subtotal,
      is_available: product && isActiveProduct(product.status) && product.stock >= item.quantity,
      currency: product?.currency || 'TJS'
    }
  })

  // 4. 计算满额赠送状态
  const giftWithPurchase = await getGiftWithPurchaseState(totalAmount)

  return {
    items,
    summary: {
      total_quantity: totalQuantity,
      total_amount: totalAmount,
      currency: 'TJS'
    },
    gift_with_purchase: giftWithPurchase
  }
}

async function handleUpdateQuantity(userId: string, productId: string, quantity: number) {
  if (quantity <= 0) {
    const { error } = await supabase
      .from('b2b_cart_items')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId)
    if (error) throw error
  } else {
    // 检查库存
    const { data: product } = await supabase
      .from('inventory_products')
      .select('stock, min_order_quantity')
      .eq('id', productId)
      .single()

    if (!product) throw new Error('商品不存在')
    if (product.stock < quantity) throw new Error('库存不足')

    const { error } = await supabase
      .from('b2b_cart_items')
      .upsert({
        user_id: userId,
        product_id: productId,
        quantity: Math.max(quantity, product.min_order_quantity || 1),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,product_id' })
    
    if (error) throw error
  }

  return await handleGetCart(userId)
}

async function handleRemoveItem(userId: string, productId: string) {
  const { error } = await supabase
    .from('b2b_cart_items')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId)

  if (error) throw error
  return await handleGetCart(userId)
}

async function handleClearCart(userId: string) {
  const { error } = await supabase
    .from('b2b_cart_items')
    .delete()
    .eq('user_id', userId)

  if (error) throw error
  return { items: [], summary: { total_quantity: 0, total_amount: 0 }, gift_with_purchase: null }
}

// ============================================================================
// Server Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, error: authError } = await validateSessionWithUser(req)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', details: authError }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { action, ...params } = await req.json()

    let result
    switch (action) {
      case 'get':
        result = await handleGetCart(user.id)
        break
      case 'update_quantity':
        result = await handleUpdateQuantity(user.id, params.product_id, params.quantity)
        break
      case 'remove':
        result = await handleRemoveItem(user.id, params.product_id)
        break
      case 'clear':
        result = await handleClearCart(user.id)
        break
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[B2BCart] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
