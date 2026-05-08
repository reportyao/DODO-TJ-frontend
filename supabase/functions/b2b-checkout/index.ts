/**
 * ============================================================================
 * B2B 批发商结算 Edge Function
 * ============================================================================
 *
 * 功能: 批发商从购物车一键下单，创建 B2B 主订单 + 订单明细
 *
 * 业务流程:
 *   1. 验证用户身份（必须是已认证的批发商）
 *   2. 读取购物车中所有商品
 *   3. 校验每个商品的库存是否充足
 *   4. 创建主订单（b2b_orders）
 *   5. 创建订单明细（b2b_order_items），包含商品快照
 *   6. 扣减库存 + 写入库存变动日志（inventory_transactions）
 *   7. 清空购物车
 *   8. 发送通知事件（通知管理后台有新订单）
 *
 * 支付方式: 货到付款（COD - Cash On Delivery）
 *   - 订单创建后 payment_status = 'pending'
 *   - 管理后台确认收款后更新为 'paid'
 *
 * 请求方式: POST
 * 请求体:
 *   {
 *     delivery_address?: string,   // 配送地址（可选，默认使用批发商注册地址）
 *     delivery_note?: string       // 配送备注
 *   }
 *
 * 响应:
 *   成功: { success: true, order: { id, order_number, total_amount, item_count } }
 *   失败: { success: false, error: string, error_code: string }
 *
 * 依赖:
 *   - _shared/auth.ts: validateSessionWithUser
 *   - _shared/eventQueue.ts: enqueueEvent
 *   - 表: wholesaler_profiles, shopping_carts, inventory_products,
 *          b2b_orders, b2b_order_items, inventory_transactions
 *
 * 注意事项:
 *   - 使用 service_role 客户端执行所有数据库操作（绕过 RLS）
 *   - 库存扣减使用乐观锁（stock >= quantity 条件更新）
 *   - 如果任何商品库存不足，整个订单回滚（不创建部分订单）
 *   - 订单号格式: B2B + 时间戳 + 4位随机字符
 * ============================================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSessionWithUser } from '../_shared/auth.ts'
import { enqueueEvent, EventType } from '../_shared/eventQueue.ts'

// ============================================================================
// CORS 头（与其他 Edge Functions 保持一致）
// ============================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false',
}

// ============================================================================
// Supabase 客户端（service_role 权限，绕过 RLS）
// ============================================================================
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 标准化 JSON 响应
 */
function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

/**
 * 生成 B2B 订单号
 * 调用数据库函数 generate_b2b_order_number() 确保格式一致且并发安全
 * 格式: B2B-YYYYMMDD-XXXXX（如 B2B-20260506-00001）
 *
 * 备用方案: 如果数据库函数调用失败，回退到本地生成
 */
async function generateOrderNumber(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('generate_b2b_order_number')
    if (!error && data) {
      return data as string
    }
  } catch (e) {
    console.warn('[B2BCheckout] 数据库订单号生成失败，使用本地生成:', e)
  }
  // 备用: 本地生成。使用时间戳 + crypto 随机值降低并发碰撞概率。
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const randomBytes = new Uint8Array(4)
  crypto.getRandomValues(randomBytes)
  const random = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `B2B-${datePart}-${Date.now().toString(36).toUpperCase()}-${random}`
}

/**
 * 后台异步任务包装器（与现有 Edge Functions 保持一致）
 */
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

// ============================================================================
// 类型定义
// ============================================================================

interface CartItem {
  id: string
  product_id: string
  quantity: number
}

interface ProductInfo {
  id: string
  name: string
  name_i18n: Record<string, string> | null
  image_url: string | null
  wholesale_price: number
  retail_price: number
  stock: number | null
  min_order_quantity: number
  unit_measure: string
  sku: string | null
  status: string | null
}

interface CheckoutRequest {
  delivery_address?: string
  delivery_note?: string
}

// ============================================================================
// 主处理逻辑
// ============================================================================

serve(async (req: Request) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // 仅允许 POST 方法
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: '仅支持 POST 方法', error_code: 'ERR_METHOD_NOT_ALLOWED' }, 405)
  }

  try {
    // ========================================================================
    // Step 1: 验证用户身份
    // ========================================================================
    const authHeader = req.headers.get('Authorization') ?? ''
    const sessionToken = authHeader.replace('Bearer ', '').trim()

    if (!sessionToken) {
      return jsonResponse({ success: false, error: '未授权：缺少认证令牌', error_code: 'ERR_MISSING_TOKEN' }, 401)
    }

    const { userId } = await validateSessionWithUser(supabase, sessionToken)

    // ========================================================================
    // Step 2: 验证批发商身份
    // ========================================================================
    const { data: wholesalerProfile, error: wholesalerError } = await supabase
      .from('wholesaler_profiles')
      .select('id, status, delivery_address, company_name')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .maybeSingle()

    if (wholesalerError) {
      console.error('[B2BCheckout] 查询批发商信息失败:', wholesalerError)
      return jsonResponse({ success: false, error: '查询批发商信息失败', error_code: 'ERR_SERVER_ERROR' }, 500)
    }

    if (!wholesalerProfile) {
      return jsonResponse({
        success: false,
        error: '您不是已认证的批发商，无法下单',
        error_code: 'ERR_NOT_WHOLESALER',
      }, 403)
    }

    // ========================================================================
    // Step 3: 解析请求体
    // ========================================================================
    const body: CheckoutRequest = await req.json().catch(() => ({}))
    const deliveryAddress = body.delivery_address || wholesalerProfile.delivery_address || ''
    const deliveryNote = body.delivery_note || ''

    if (!deliveryAddress) {
      return jsonResponse({
        success: false,
        error: '配送地址不能为空，请在个人资料中设置或在下单时提供',
        error_code: 'ERR_PARAMS_MISSING',
      }, 400)
    }

    // ========================================================================
    // Step 4: 读取购物车
    // ========================================================================
    const { data: cartItems, error: cartError } = await supabase
      .from('shopping_carts')
      .select('id, product_id, quantity')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (cartError) {
      console.error('[B2BCheckout] 读取购物车失败:', cartError)
      return jsonResponse({ success: false, error: '读取购物车失败', error_code: 'ERR_SERVER_ERROR' }, 500)
    }

    if (!cartItems || cartItems.length === 0) {
      return jsonResponse({ success: false, error: '购物车为空', error_code: 'ERR_CART_EMPTY' }, 400)
    }

    // ========================================================================
    // Step 5: 批量查询商品信息并校验库存
    // ========================================================================
    const productIds = cartItems.map((item: CartItem) => item.product_id)

    const { data: products, error: productsError } = await supabase
      .from('inventory_products')
      .select('id, name, name_i18n, image_url, wholesale_price, retail_price, stock, min_order_quantity, unit_measure, sku, status')
      .in('id', productIds)

    if (productsError) {
      console.error('[B2BCheckout] 查询商品信息失败:', productsError)
      return jsonResponse({ success: false, error: '查询商品信息失败', error_code: 'ERR_SERVER_ERROR' }, 500)
    }

    // 构建商品 Map 方便查找
    const productMap = new Map<string, ProductInfo>()
    for (const p of (products || [])) {
      productMap.set(p.id, p as ProductInfo)
    }

    // 校验每个购物车商品
    const insufficientItems: string[] = []
    const unavailableItems: string[] = []
    let totalAmount = 0
    let totalQuantity = 0

    interface OrderItemData {
      product_id: string
      quantity: number
      unit_price: number
      subtotal: number
      snapshot_data: Record<string, unknown>
    }

    const orderItems: OrderItemData[] = []

    for (const cartItem of cartItems as CartItem[]) {
      const product = productMap.get(cartItem.product_id)

      if (!product) {
        unavailableItems.push(cartItem.product_id)
        continue
      }

      if (product.status !== 'ACTIVE') {
        unavailableItems.push(product.name || cartItem.product_id)
        continue
      }

      // 校验库存
      const availableStock = product.stock ?? 0
      if (availableStock < cartItem.quantity) {
        insufficientItems.push(
          `${product.name}（需要 ${cartItem.quantity}，库存仅 ${availableStock}）`
        )
        continue
      }

      // 校验最小起订量
      if (cartItem.quantity < (product.min_order_quantity || 1)) {
        insufficientItems.push(
          `${product.name}（最小起订量为 ${product.min_order_quantity}）`
        )
        continue
      }

      // 计算小计（使用批发价）
      const unitPrice = product.wholesale_price
      const subtotal = unitPrice * cartItem.quantity
      totalAmount += subtotal
      totalQuantity += cartItem.quantity

      // 构建订单明细（包含商品快照，防止后续改价影响历史订单）
      orderItems.push({
        product_id: cartItem.product_id,
        quantity: cartItem.quantity,
        unit_price: unitPrice,
        subtotal,
        snapshot_data: {
          name: product.name,
          name_i18n: product.name_i18n,
          image_url: product.image_url,
          sku: product.sku,
          unit_measure: product.unit_measure,
          wholesale_price: product.wholesale_price,
          retail_price: product.retail_price,
        },
      })
    }

    // 如果有不可用商品，返回错误
    if (unavailableItems.length > 0) {
      return jsonResponse({
        success: false,
        error: `以下商品已下架或不存在: ${unavailableItems.join(', ')}`,
        error_code: 'ERR_PRODUCT_NOT_FOUND',
        details: unavailableItems,
      }, 400)
    }

    // 如果有库存不足的商品，返回错误
    if (insufficientItems.length > 0) {
      return jsonResponse({
        success: false,
        error: `以下商品库存不足或未达起订量: ${insufficientItems.join('; ')}`,
        error_code: 'ERR_OUT_OF_STOCK',
        details: insufficientItems,
      }, 422)
    }

    // 确保有有效的订单项
    if (orderItems.length === 0) {
      return jsonResponse({ success: false, error: '没有可下单的商品', error_code: 'ERR_CART_EMPTY' }, 400)
    }

    // 校验订单总金额必须大于 0（防止 wholesale_price 未设置导致 0 元订单）
    if (totalAmount <= 0) {
      return jsonResponse({
        success: false,
        error: '订单金额异常（部分商品批发价未设置），请联系管理员',
        error_code: 'ERR_AMOUNT_INVALID',
      }, 400)
    }

    // ========================================================================
    // Step 6: 创建主订单
    // ========================================================================
    const orderNumber = await generateOrderNumber()

    const { data: order, error: orderError } = await supabase
      .from('b2b_orders')
      .insert({
        order_number: orderNumber,
        user_id: userId,
        total_amount: totalAmount,
        item_count: orderItems.length,
        total_quantity: totalQuantity,
        status: 'pending',              // 待处理
        payment_method: 'cod',          // 货到付款
        payment_status: 'pending',      // 待付款
        delivery_address: deliveryAddress,
        delivery_note: deliveryNote,
      })
      .select('id, order_number, total_amount, item_count, total_quantity, status')
      .single()

    if (orderError || !order) {
      console.error('[B2BCheckout] 创建订单失败:', orderError)
      return jsonResponse({ success: false, error: '创建订单失败', error_code: 'ERR_ORDER_CREATE_FAILED' }, 500)
    }

    // ========================================================================
    // Step 7: 创建订单明细
    // ========================================================================
    const orderItemsToInsert = orderItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      snapshot_data: item.snapshot_data,
    }))

    const { error: itemsError } = await supabase
      .from('b2b_order_items')
      .insert(orderItemsToInsert)

    if (itemsError) {
      console.error('[B2BCheckout] 创建订单明细失败:', itemsError)
      // 回滚：删除主订单
      await supabase.from('b2b_orders').delete().eq('id', order.id)
      return jsonResponse({ success: false, error: '创建订单明细失败', error_code: 'ERR_ORDER_CREATE_FAILED' }, 500)
    }

    // ========================================================================
    // Step 8: 扣减库存 + 写入库存变动日志
    // ========================================================================
    const stockErrors: string[] = []
    const deductedItems: Array<{ product_id: string; stock_before: number; stock_after: number }> = []

    for (const item of orderItems) {
      const product = productMap.get(item.product_id)!
      const stockBefore = product.stock ?? 0
      const stockAfter = stockBefore - item.quantity

      // 使用条件更新实现乐观锁（确保 stock >= quantity）
      // 注意: B2B 模式下不使用 reserved_stock（那是一元购物预留用的）
      // 注意: Supabase JS v2 的 update() 默认不返回 count，需通过 .select() 检查是否有返回数据来判断更新是否成功
      const { data: updatedRows, error: stockError } = await supabase
        .from('inventory_products')
        .update({
          stock: stockAfter,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.product_id)
        .gte('stock', item.quantity)
        .select('id')

      if (stockError || !updatedRows || updatedRows.length === 0) {
        stockErrors.push(product.name)
        break
      }

      deductedItems.push({ product_id: item.product_id, stock_before: stockBefore, stock_after: stockAfter })

      // 写入库存变动日志
      // 注意: transaction_type 必须使用数据库 CHECK 约束中定义的值 'B2B_SALE'
      await supabase.from('inventory_transactions').insert({
        inventory_product_id: item.product_id,
        transaction_type: 'B2B_SALE',
        quantity: -item.quantity,
        stock_before: stockBefore,
        stock_after: stockAfter,
        related_order_id: order.id,
        notes: `B2B订单 ${orderNumber} 扣减库存`,
      })
    }

    // 如果有库存扣减失败（并发竞争），必须回滚已创建订单和已扣库存，避免生成不可履约订单。
    if (stockErrors.length > 0) {
      console.warn(`[B2BCheckout] 库存扣减失败，开始回滚订单 ${order.id}: ${stockErrors.join(', ')}`)

      for (const deducted of deductedItems.reverse()) {
        const { error: rollbackStockError } = await supabase
          .from('inventory_products')
          .update({ stock: deducted.stock_before, updated_at: new Date().toISOString() })
          .eq('id', deducted.product_id)
          .eq('stock', deducted.stock_after)
        if (rollbackStockError) {
          console.error('[B2BCheckout] 回滚库存失败:', deducted.product_id, rollbackStockError)
        }
      }

      await supabase.from('inventory_transactions').delete().eq('related_order_id', order.id)
      await supabase.from('b2b_order_items').delete().eq('order_id', order.id)
      const { error: rollbackOrderError } = await supabase.from('b2b_orders').delete().eq('id', order.id)
      if (rollbackOrderError) {
        console.error('[B2BCheckout] 回滚订单失败:', rollbackOrderError)
      }

      return jsonResponse({
        success: false,
        error: `部分商品库存已变化，请刷新购物车后重试: ${stockErrors.join(', ')}`,
        error_code: 'ERR_OUT_OF_STOCK',
        details: stockErrors,
      }, 409)
    }

    // ========================================================================
    // Step 9: 清空购物车
    // ========================================================================
    const { error: clearCartError } = await supabase
      .from('shopping_carts')
      .delete()
      .eq('user_id', userId)

    if (clearCartError) {
      // 购物车清空失败不影响订单，仅记录日志
      console.error('[B2BCheckout] 清空购物车失败（不影响订单）:', clearCartError)
    }

    // ========================================================================
    // Step 10: 异步发送通知（不阻塞响应）
    // ========================================================================
    runInBackground(
      enqueueEvent(supabase, {
        event_type: EventType.B2B_NEW_ORDER,
        source: 'b2b-checkout',
        payload: {
          order_id: order.id,
          order_number: orderNumber,
          user_id: userId,
          company_name: wholesalerProfile.company_name,
          total_amount: totalAmount,
          item_count: orderItems.length,
          total_quantity: totalQuantity,
        },
        idempotency_key: `b2b-checkout:${order.id}`,
        session_id: sessionToken,
        user_id: userId,
      }),
      'enqueue_new_order_event'
    )

    // ========================================================================
    // 返回成功响应
    // ========================================================================
    return jsonResponse({
      success: true,
      order: {
        id: order.id,
        order_number: order.order_number,
        total_amount: order.total_amount,
        item_count: order.item_count,
        total_quantity: order.total_quantity,
        status: order.status,
        delivery_address: deliveryAddress,
      },
      message: '订单创建成功，等待配送',
    })

  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误'
    console.error('[B2BCheckout] 未捕获异常:', error)

    // 认证相关错误
    if (message.includes('未授权') || message.includes('会话')) {
      return jsonResponse({ success: false, error: message, error_code: 'ERR_INVALID_SESSION' }, 401)
    }

    return jsonResponse({ success: false, error: message, error_code: 'ERR_SERVER_ERROR' }, 500)
  }
})
