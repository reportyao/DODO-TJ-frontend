/**
 * ============================================================================
 * B2B 订单管理 Edge Function
 * ============================================================================
 *
 * 功能: B2B 订单的查询和状态管理
 *
 * 支持的操作 (通过 action 字段区分):
 *
 * 【批发商端操作】
 *   - list:   获取我的订单列表（分页）
 *   - detail: 获取单个订单详情（含明细）
 *
 * 【管理后台操作】（需要 admin 认证）
 *   - admin_list:           获取所有订单列表
 *   - admin_confirm_payment: 确认收款（送货上门后司机收到货款）
 *   - admin_set_delivery:   设置预计送达时间
 *   - admin_update_status:  更新订单状态
 *
 * 订单状态流转:
 *   pending → processing → delivering → delivered → paid (完成)
 *                                                 ↘ cancelled
 *
 *   pending:     待处理（刚下单）
 *   processing:  处理中（仓库备货）
 *   delivering:  配送中（已出库，在途）
 *   delivered:   已送达（等待收款确认）
 *   paid:        已完成（确认收款）
 *   cancelled:   已取消
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
// 批发商端操作
// ============================================================================

/**
 * 获取批发商的订单列表
 */
async function handleListOrders(userId: string, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize

  // 获取总数
  const { count } = await supabase
    .from('b2b_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  // 获取订单列表
  const { data: orders, error } = await supabase
    .from('b2b_orders')
    .select('id, order_number, total_amount, item_count, total_quantity, status, payment_status, estimated_delivery_date, delivery_address, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (error) {
    return jsonResponse({ success: false, error: '获取订单列表失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({
    success: true,
    orders: orders || [],
    pagination: {
      page,
      page_size: pageSize,
      total: count || 0,
      total_pages: Math.ceil((count || 0) / pageSize),
    },
  })
}

/**
 * 获取单个订单详情（含明细）
 */
async function handleOrderDetail(userId: string, orderId: string) {
  if (!orderId) {
    return jsonResponse({ success: false, error: '订单ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  // 获取主订单
  const { data: order, error: orderError } = await supabase
    .from('b2b_orders')
    .select('*')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle()

  if (orderError || !order) {
    return jsonResponse({ success: false, error: '订单不存在', error_code: 'ERR_ORDER_NOT_FOUND' }, 404)
  }

  // 获取订单明细
  const { data: items, error: itemsError } = await supabase
    .from('b2b_order_items')
    .select('id, product_id, quantity, unit_price, subtotal, snapshot_data, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (itemsError) {
    return jsonResponse({ success: false, error: '获取订单明细失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({
    success: true,
    order: {
      ...order,
      items: items || [],
    },
  })
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
 */
async function handleAdminListOrders(page: number, pageSize: number, status?: string) {
  const offset = (page - 1) * pageSize

  let query = supabase
    .from('b2b_orders')
    .select('id, order_number, user_id, total_amount, item_count, total_quantity, status, payment_status, payment_method, estimated_delivery_date, delivery_address, delivery_note, admin_note, created_at, updated_at', { count: 'exact' })

  if (status) {
    query = query.eq('status', status)
  }

  const { data: orders, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (error) {
    return jsonResponse({ success: false, error: '获取订单列表失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  // 批量获取批发商信息
  const userIds = [...new Set((orders || []).map((o: { user_id: string }) => o.user_id))]
  const { data: wholesalers } = await supabase
    .from('wholesaler_profiles')
    .select('user_id, company_name, contact_phone')
    .in('user_id', userIds)

  const wholesalerMap = new Map()
  for (const w of (wholesalers || [])) {
    wholesalerMap.set(w.user_id, w)
  }

  // 组装订单数据（附带批发商信息）
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
 * 管理后台：确认收款
 * 送货上门后，司机收到货款，管理后台确认
 */
async function handleAdminConfirmPayment(adminId: string, orderId: string) {
  if (!orderId) {
    return jsonResponse({ success: false, error: '订单ID不能为空', error_code: 'ERR_PARAMS_MISSING' }, 400)
  }

  const { data: order, error: orderError } = await supabase
    .from('b2b_orders')
    .select('id, status, payment_status')
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

  // 先查询当前订单状态，避免状态跳跃（如从 pending 直接跳到 delivering）
  const { data: currentOrder, error: queryError } = await supabase
    .from('b2b_orders')
    .select('id, status')
    .eq('id', orderId)
    .maybeSingle()

  if (queryError || !currentOrder) {
    return jsonResponse({ success: false, error: '订单不存在', error_code: 'ERR_ORDER_NOT_FOUND' }, 404)
  }

  // 只在 pending/processing 状态时自动推进到 delivering
  // 如果已经是 delivering/delivered/paid 状态，只更新送达时间不改状态
  const updateData: Record<string, unknown> = {
    estimated_delivery_date: estimatedDate,
    updated_at: new Date().toISOString(),
  }
  if (currentOrder.status === 'pending' || currentOrder.status === 'processing') {
    updateData.status = 'delivering'
  }

  const { error: updateError } = await supabase
    .from('b2b_orders')
    .update(updateData)
    .eq('id', orderId)

  if (updateError) {
    return jsonResponse({ success: false, error: '设置送达时间失败', error_code: 'ERR_SERVER_ERROR' }, 500)
  }

  return jsonResponse({ success: true, message: '已设置预计送达时间' })
}

/**
 * 管理后台：更新订单状态
 */
async function handleAdminUpdateStatus(adminId: string, orderId: string, newStatus: string, adminNote?: string) {
  const validStatuses = ['pending', 'processing', 'delivering', 'delivered', 'paid', 'cancelled']
  if (!validStatuses.includes(newStatus)) {
    return jsonResponse({
      success: false,
      error: `无效的状态: ${newStatus}。有效状态: ${validStatuses.join(', ')}`,
      error_code: 'ERR_INVALID_ACTION',
    }, 400)
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  if (adminNote) {
    updateData.admin_note = adminNote
  }

  if (newStatus === 'paid') {
    updateData.payment_status = 'paid'
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
    // 批发商端操作
    // ========================================================================
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

    switch (action) {
      case 'list':
        return await handleListOrders(userId, page || 1, page_size || 20)
      case 'detail':
        return await handleOrderDetail(userId, order_id || '')
      default:
        return jsonResponse({
          success: false,
          error: `无效的操作: ${action}。批发商支持: list, detail`,
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
