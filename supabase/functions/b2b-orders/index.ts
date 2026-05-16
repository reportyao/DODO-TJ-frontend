/**
 * ============================================================================
 * B2B 订单管理 Edge Function (P0-7 安全输出改造版)
 * ============================================================================
 *
 * 功能: B2B 订单的查询和状态管理
 *
 * 支持的操作 (通过 action 字段区分):
 *
 * 【批发商端操作】（安全字段过滤）
 *   - list:   获取我的订单列表（分页，安全字段）
 *   - detail: 获取单个订单详情（含明细，安全字段）
 *   - cancel: 取消订单（仅 pending/processing 状态可取消，自动回补库存）
 *
 * 【管理后台操作】（需要 admin 认证）
 *   - admin_list:           获取所有订单列表
 *   - admin_confirm_payment: 确认收款（兼容旧版）
 *   - admin_set_delivery:   设置预计送达时间
 *   - admin_update_status:  更新订单状态（兼容旧版）
 *
 * P0-7 安全改造:
 *   - 批发商端只返回安全字段，不返回:
 *     admin_note, cost_total_snapshot, expected_gross_profit, cost_status,
 *     reconciliation_status, locked_at, confirmed_by, version
 *   - 订单明细不返回:
 *     cost_price_snapshot, wholesale_price_snapshot, line_expected_profit,
 *     picked_quantity, shipped_quantity (内部备货数据)
 *   - 付款流水不返回:
 *     receiver_admin_id, confirmed_by, idempotency_key
 *
 * 请求方式: POST
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

// ============================================================================
// P0-7: 安全字段过滤工具函数
// ============================================================================

/**
 * 将订单数据转换为用户侧安全输出
 * 隐藏: admin_note, cost_total_snapshot, expected_gross_profit, cost_status,
 *       reconciliation_status, locked_at, confirmed_by, version
 */
function toSafeOrder(order: Record<string, unknown>): Record<string, unknown> {
  const fulfillmentDisplayMap: Record<string, string> = {
    pending: '待确认',
    confirmed: '备货中',
    picking: '备货中',
    shortage: '备货中',
    ready_to_ship: '备货中',
    shipping: '配送中',
    delivered: '已送达',
    cancelled: '已取消',
    returned: '退货处理中',
    closed: '已完成',
  }

  const financialDisplayMap: Record<string, string> = {
    unpaid: '待付款',
    partial_paid: '部分付款',
    paid: '已付款',
    overpaid: '已付款',
    refunded: '已退款',
  }

  const fulfillmentStatus = (order.fulfillment_status as string) || 'pending'
  const financialStatus = (order.financial_status as string) || 'unpaid'

  let displayStatus = fulfillmentDisplayMap[fulfillmentStatus] || fulfillmentStatus
  if (fulfillmentStatus === 'delivered' && financialStatus === 'paid') {
    displayStatus = '已完成'
  }

  return {
    id: order.id,
    order_number: order.order_number,
    total_amount: order.total_amount,
    item_count: order.item_count,
    total_quantity: order.total_quantity,
    status: order.status,
    display_status: displayStatus,
    fulfillment_status: fulfillmentStatus,
    payment_status: order.payment_status,
    display_financial_status: financialDisplayMap[financialStatus] || '处理中',
    financial_status: financialStatus,
    receivable_total: order.receivable_total || order.total_amount,
    paid_total: order.paid_total || (order.payment_status === 'paid' ? order.total_amount : 0),
    balance_due: order.balance_due || (order.payment_status === 'paid' ? 0 : order.total_amount),
    payment_method: order.payment_method,
    estimated_delivery_date: order.estimated_delivery_date,
    delivery_address: order.delivery_address,
    delivery_note: order.delivery_note,
    created_at: order.created_at,
    updated_at: order.updated_at,
  }
}

/**
 * 将订单明细转换为用户侧安全输出
 */
function toSafeOrderItem(item: Record<string, unknown>): Record<string, unknown> {
  const itemStatusDisplayMap: Record<string, string> = {
    ordered: '待处理',
    picking: '备货中',
    shortage: '缺货',
    shipped: '已发货',
    delivered: '已签收',
    returned: '已退货',
    cancelled: '已取消',
  }

  const itemStatus = (item.item_status as string) || 'ordered'

  return {
    id: item.id,
    product_id: item.product_id,
    product_name_zh: item.product_name_zh,
    product_name_original: item.product_name_original,
    sku: item.sku,
    image_url: item.image_url,
    specifications_zh: item.specifications_zh,
    unit_measure: item.unit_measure || '件',
    unit_price: item.unit_price,
    quantity: item.quantity,
    subtotal: item.subtotal,
    is_gift: Boolean(item.is_gift),
    gift_rule_id: item.gift_rule_id || null,
    ordered_quantity: item.ordered_quantity || item.quantity,
    delivered_quantity: item.delivered_quantity || 0,
    returned_quantity: item.returned_quantity || 0,
    shortage_quantity: item.shortage_quantity || 0,
    item_status: itemStatus,
    display_item_status: itemStatusDisplayMap[itemStatus] || itemStatus,
    snapshot_data: item.snapshot_data,
    created_at: item.created_at,
  }
}

/**
 * 将付款流水转换为用户侧安全输出
 */
function toSafePaymentTransaction(tx: Record<string, unknown>): Record<string, unknown> {
  const statusDisplayMap: Record<string, string> = {
    pending: '处理中',
    confirmed: '已确认',
    rejected: '未通过',
    voided: '已作废',
  }

  const methodDisplayMap: Record<string, string> = {
    cod_cash: '现金',
    cod_transfer: '转账',
    deposit_transfer: '定金转账',
    mixed: '混合支付',
    credit_terms: '账期',
    cod: '货到付款',
    other: '其他',
  }

  return {
    id: tx.id,
    transaction_type: tx.transaction_type,
    payment_method: tx.payment_method,
    display_payment_method: methodDisplayMap[(tx.payment_method as string)] || tx.payment_method,
    amount: tx.amount,
    status: tx.status,
    display_status: statusDisplayMap[(tx.status as string)] || tx.status,
    paid_at: tx.paid_at,
    confirmed_at: tx.confirmed_at,
    created_at: tx.created_at,
  }
}

// ============================================================================
// 批发商端操作
// ============================================================================

/**
 * 获取批发商的订单列表（安全字段过滤）
 */
async function handleListOrders(userId: string, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize

  const { count } = await supabase
    .from('b2b_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const { data: orders, error } = await supabase
    .from('b2b_orders')
    .select('id, order_number, total_amount, item_count, total_quantity, status, payment_status, payment_method, estimated_delivery_date, delivery_address, delivery_note, fulfillment_status, financial_status, receivable_total, paid_total, balance_due, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (error) {
    return jsonResponse({ success: false, error: '获取订单列表失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  const safeOrders = (orders || []).map(toSafeOrder)

  return jsonResponse({
    success: true,
    orders: safeOrders,
    pagination: {
      page,
      page_size: pageSize,
      total: count || 0,
      total_pages: Math.ceil((count || 0) / pageSize),
    },
  })
}

/**
 * 获取单个订单详情（含明细，安全字段过滤）
 */
async function handleOrderDetail(userId: string, orderId: string) {
  if (!orderId) {
    return jsonResponse({ success: false, error: '订单ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  const { data: order, error: orderError } = await supabase
    .from('b2b_orders')
    .select('id, order_number, total_amount, item_count, total_quantity, status, payment_status, payment_method, estimated_delivery_date, delivery_address, delivery_note, fulfillment_status, financial_status, receivable_total, paid_total, balance_due, created_at, updated_at')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle()

  if (orderError || !order) {
    return jsonResponse({ success: false, error: '订单不存在', error_code: 'ERR_ORDER_NOT_FOUND' }, 404)
  }

  const { data: items, error: itemsError } = await supabase
    .from('b2b_order_items')
    .select('id, product_id, quantity, unit_price, subtotal, is_gift, gift_rule_id, snapshot_data, product_name_zh, product_name_original, sku, image_url, specifications_zh, unit_measure, ordered_quantity, delivered_quantity, returned_quantity, shortage_quantity, item_status, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (itemsError) {
    return jsonResponse({ success: false, error: '获取订单明细失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  // 获取用户可见的付款流水
  const { data: payments } = await supabase
    .from('b2b_payment_transactions')
    .select('id, transaction_type, payment_method, amount, status, paid_at, confirmed_at, created_at')
    .eq('order_id', orderId)
    .in('status', ['confirmed', 'pending'])
    .order('created_at', { ascending: false })

  const safeOrder = toSafeOrder(order)
  const safeItems = (items || []).map(toSafeOrderItem)
  const safePayments = (payments || []).map(toSafePaymentTransaction)

  return jsonResponse({
    success: true,
    order: {
      ...safeOrder,
      items: safeItems,
      payments: safePayments,
    },
  })
}

/**
 * 批发商取消订单
 * 仅允许取消 pending 或 processing 状态的订单，同时回补库存
 */
async function handleCancelOrder(userId: string, orderId: string) {
  if (orderId === undefined || orderId === null || orderId === '') {
    return jsonResponse({ success: false, error: '订单ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  // P0 Fix: 使用原子事务 RPC 替代非事务化多步写入
  // 原实现存在数据不一致风险（库存回补与订单状态更新不在同一事务中）
  const { data: result, error: rpcError } = await supabase
    .rpc('b2b_cancel_order_tx', {
      p_user_id: userId,
      p_order_id: orderId,
      p_reason: null,
    })

  if (rpcError) {
    console.error('[B2BOrders] 取消订单 RPC 失败:', rpcError)
    return jsonResponse({ success: false, error: '取消订单失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  const rpcResult = result as Record<string, unknown>
  if (!rpcResult?.success) {
    const statusCode = rpcResult?.error_code === 'ERR_ORDER_NOT_FOUND' ? 404
      : rpcResult?.error_code === 'ERR_INVALID_STATUS' ? 400
      : rpcResult?.error_code === 'ERR_ORDER_LOCKED' ? 409
      : 400
    return jsonResponse(rpcResult, statusCode)
  }

  return jsonResponse({ success: true, message: '订单已取消' })
}

// ============================================================================
// 管理后台操作
// ============================================================================

/**
 * 验证管理员身份
 */
async function validateAdmin(sessionToken: string): Promise<{ adminId: string } | null> {
  const { data: session } = await supabase
    .from('admin_sessions')
    .select('admin_id, expires_at, is_active')
    .eq('session_token', sessionToken)
    .eq('is_active', true)
    .maybeSingle()

  if (!session || new Date(session.expires_at) < new Date()) {
    return null
  }

  return { adminId: session.admin_id }
}

/**
 * 管理后台：获取所有订单列表
 * 注意: 后台主要通过 admin_b2b_order_list RPC 获取数据，此接口保留兼容
 */
async function handleAdminListOrders(page: number, pageSize: number, status?: string) {
  const offset = (page - 1) * pageSize

  let query = supabase
    .from('b2b_orders')
    .select('id, order_number, user_id, total_amount, item_count, total_quantity, status, payment_status, payment_method, estimated_delivery_date, delivery_address, delivery_note, admin_note, fulfillment_status, financial_status, receivable_total, paid_total, balance_due, cost_status, created_at, updated_at', { count: 'exact' })

  if (status) {
    query = query.eq('status', status)
  }

  const { data: orders, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (error) {
    return jsonResponse({ success: false, error: '获取订单列表失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  const userIds = [...new Set((orders || []).map((o: { user_id: string }) => o.user_id))]
  const { data: wholesalers } = await supabase
    .from('wholesaler_profiles')
    .select('user_id, company_name, contact_phone')
    .in('user_id', userIds)

  const wholesalerMap = new Map()
  for (const w of (wholesalers || [])) {
    wholesalerMap.set(w.user_id, w)
  }

  const enrichedOrders = (orders || []).map((order: Record<string, unknown>) => ({
    ...order,
    wholesaler: wholesalerMap.get(order.user_id as string) || null,
  }))

  return jsonResponse({
    success: true,
    orders: enrichedOrders,
    pagination: {
      page,
      page_size: pageSize,
      total: count || 0,
      total_pages: Math.ceil((count || 0) / pageSize),
    },
  })
}

/**
 * 管理后台：确认收款（兼容旧版）
 * 新版应通过 admin_b2b_record_payment + admin_b2b_confirm_payment_tx RPC
 */
async function handleAdminConfirmPayment(adminId: string, orderId: string) {
  if (!orderId) {
    return jsonResponse({ success: false, error: '订单ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  const { data: order, error: orderError } = await supabase
    .from('b2b_orders')
    .select('id, status, payment_status, total_amount, receivable_total')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !order) {
    return jsonResponse({ success: false, error: '订单不存在', error_code: 'ERR_ORDER_NOT_FOUND' }, 404)
  }

  if (order.payment_status === 'paid') {
    return jsonResponse({ success: false, error: '该订单已确认收款', error_code: 'ERR_ALREADY_PAID' }, 400)
  }

  const { error: updateError } = await supabase
    .from('b2b_orders')
    .update({
      status: 'paid',
      payment_status: 'paid',
      financial_status: 'paid',
      paid_total: order.receivable_total || order.total_amount,
      balance_due: 0,
      confirmed_at: new Date().toISOString(),
      confirmed_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  if (updateError) {
    return jsonResponse({ success: false, error: '确认收款失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({ success: true, message: '已确认收款，订单完成' })
}

/**
 * 管理后台：设置预计送达时间
 */
async function handleAdminSetDelivery(adminId: string, orderId: string, estimatedDate: string) {
  if (!orderId || !estimatedDate) {
    return jsonResponse({ success: false, error: '订单ID和预计送达时间不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  const { data: currentOrder, error: queryError } = await supabase
    .from('b2b_orders')
    .select('id, status, fulfillment_status')
    .eq('id', orderId)
    .maybeSingle()

  if (queryError || !currentOrder) {
    return jsonResponse({ success: false, error: '订单不存在', error_code: 'ERR_ORDER_NOT_FOUND' }, 404)
  }

  const updateData: Record<string, unknown> = {
    estimated_delivery_date: estimatedDate,
    updated_at: new Date().toISOString(),
  }

  if (currentOrder.status === 'pending') {
    updateData.status = 'processing'
    updateData.fulfillment_status = 'confirmed'
  }

  const { error: updateError } = await supabase
    .from('b2b_orders')
    .update(updateData)
    .eq('id', orderId)

  if (updateError) {
    return jsonResponse({ success: false, error: '设置送达时间失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({ success: true, message: '预计送达时间已设置' })
}

/**
 * 管理后台：更新订单状态（兼容旧版）
 * 新版应通过专用 RPC (admin_b2b_confirm_order, admin_b2b_ship_order 等)
 */
async function handleAdminUpdateStatus(adminId: string, orderId: string, newStatus: string, adminNote?: string) {
  if (!orderId || !newStatus) {
    return jsonResponse({ success: false, error: '订单ID和状态不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  const validStatuses = ['pending', 'processing', 'delivering', 'delivered', 'paid', 'cancelled']
  if (!validStatuses.includes(newStatus)) {
    return jsonResponse({
      success: false,
      error: `无效的状态: ${newStatus}。有效状态: ${validStatuses.join(', ')}`,
      error_code: 'ERR_INVALID_ACTION',
    }, 400)
  }

  const fulfillmentMap: Record<string, string> = {
    pending: 'pending',
    processing: 'confirmed',
    delivering: 'shipping',
    delivered: 'delivered',
    paid: 'delivered',
    cancelled: 'cancelled',
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    fulfillment_status: fulfillmentMap[newStatus] || newStatus,
    updated_at: new Date().toISOString(),
  }

  if (adminNote) {
    updateData.admin_note = adminNote
  }

  if (newStatus === 'paid') {
    updateData.payment_status = 'paid'
    updateData.financial_status = 'paid'
    updateData.confirmed_at = new Date().toISOString()
    updateData.confirmed_by = adminId
  }

  const { error: updateError } = await supabase
    .from('b2b_orders')
    .update(updateData)
    .eq('id', orderId)

  if (updateError) {
    return jsonResponse({ success: false, error: '更新状态失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({ success: true, message: `订单状态已更新为: ${newStatus}` })
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
    const customSessionHeader = req.headers.get('x-session-token') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''
    const sessionToken = (customSessionHeader || authHeader.replace(/^Bearer\s+/i, '')).trim()

    if (!sessionToken) {
      return jsonResponse({ success: false, error: '未授权', error_code: 'ERR_MISSING_TOKEN' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const { action, order_id, page, page_size, status, estimated_delivery_date, admin_note } = body as {
      action?: string
      order_id?: string
      page?: number
      page_size?: number
      status?: string
      estimated_delivery_date?: string
      admin_note?: string
    }

    // ========================================================================
    // 管理后台操作（以 admin_ 开头的 action）
    // ========================================================================
    if (action?.startsWith('admin_')) {
      const admin = await validateAdmin(sessionToken)
      if (!admin) {
        return jsonResponse({ success: false, error: '管理员认证失败', error_code: 'ERR_INVALID_SESSION' }, 401)
      }

      switch (action) {
        case 'admin_list':
          return await handleAdminListOrders(page || 1, page_size || 20, status)
        case 'admin_confirm_payment':
          return await handleAdminConfirmPayment(admin.adminId, order_id || '')
        case 'admin_set_delivery':
          return await handleAdminSetDelivery(admin.adminId, order_id || '', estimated_delivery_date || '')
        case 'admin_update_status':
          return await handleAdminUpdateStatus(admin.adminId, order_id || '', status || '', admin_note)
        default:
          return jsonResponse({ success: false, error: `未知的管理操作: ${action}`, error_code: 'ERR_INVALID_ACTION' }, 400)
      }
    }

    // ========================================================================
    // 批发商端操作（安全字段过滤）
    // ========================================================================
    const { userId } = await validateSessionWithUser(supabase, sessionToken)

    const { data: wholesaler } = await supabase
      .from('wholesaler_profiles')
      .select('id, status')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .maybeSingle()

    if (!wholesaler) {
      return jsonResponse({ success: false, error: '您不是已认证的批发商', error_code: 'ERR_NOT_WHOLESALER' }, 403)
    }

    switch (action) {
      case 'list':
        return await handleListOrders(userId, page || 1, page_size || 20)
      case 'detail':
        return await handleOrderDetail(userId, order_id || '')
      case 'cancel':
        return await handleCancelOrder(userId, order_id || '')
      default:
        return jsonResponse({
          success: false,
          error: `无效的操作: ${action}。批发商支持: list, detail, cancel`,
          error_code: 'ERR_INVALID_ACTION',
        }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误'
    console.error('[B2BOrders] 未捕获异常:', error)
    if (message.includes('未授权') || message.includes('会话')) {
      return jsonResponse({ success: false, error: message, error_code: 'ERR_INVALID_SESSION' }, 401)
    }
    return jsonResponse({ success: false, error: message, error_code: 'ERR_SERVER_ERROR' }, 500)
  }
})
