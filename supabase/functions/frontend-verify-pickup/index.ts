/**
 * ============================================================
 * frontend-verify-pickup Edge Function（前端核销员提货核销）
 * ============================================================
 * 
 * 功能：供前端核销员（自提点工作人员）扫码/输入提货码进行核销
 * 
 * 支持的 Actions：
 *   - search:         根据提货码查询订单详情
 *   - verify:         执行核销操作
 *   - get_today_logs: 获取当前核销员今日核销记录
 * 
 * 安全机制：
 *   1. validateSession: 通过 session_token 验证用户身份
 *   2. validatePickupStaff: 验证用户是否为活跃核销员
 *   3. service_role_key: 绕过订单表 RLS 限制
 *   4. 原子性条件更新: 防止并发重复核销
 * 
 * 参考模式：
 *   - promoter-deposit (action 路由分发)
 *   - extend-pickup (validateSession)
 *   - claim-prize (三表查询)
 * ============================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// ============================================================
// 通用工具函数
// ============================================================

/**
 * 验证用户会话（复用 extend-pickup 的模式）
 * 使用 service_role_key 绕过 RLS 查询 user_sessions 表
 */
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌')
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('服务器配置错误')
  }

  const sessionResponse = await fetch(
    `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${sessionToken}&is_active=eq.true&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  )

  if (!sessionResponse.ok) {
    throw new Error('验证会话失败')
  }

  const sessions = await sessionResponse.json()
  
  if (sessions.length === 0) {
    throw new Error('未授权：会话不存在或已失效')
  }

  const session = sessions[0]
  const expiresAt = new Date(session.expires_at)
  
  if (expiresAt < new Date()) {
    throw new Error('未授权：会话已过期')
  }

  return {
    userId: session.user_id,
    session: session
  }
}

/**
 * 验证核销员身份
 * 查询 pickup_staff_profiles 表确认用户是否为活跃核销员
 */
async function validatePickupStaff(supabaseClient: any, userId: string) {
  const { data, error } = await supabaseClient
    .from('pickup_staff_profiles')
    .select('user_id, point_id, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
    
  if (error || !data) {
    throw new Error('您不是有效的核销员，请联系管理员')
  }
  
  return data
}

/**
 * 获取本地化文本（优先中文）
 */
function getLocalizedText(text: any): string {
  if (!text) return ''
  if (typeof text === 'string') return text
  return text.zh || text.ru || text.tg || ''
}

// ============================================================
// Action: search — 查询提货码
// ============================================================
async function handleSearch(supabaseClient: any, pickupCode: string, staffInfo: any) {
  console.log('[FrontendVerifyPickup] Searching for pickup code:', pickupCode)

  // 1. 查询 prizes 表（积分商城）
  const { data: prizes } = await supabaseClient
    .from('prizes')
    .select('id, prize_name, prize_image, prize_value, pickup_code, pickup_status, expires_at, claimed_at, user_id, lottery_id, pickup_point_id')
    .eq('pickup_code', pickupCode)
    .neq('pickup_status', 'PICKED_UP')  // 关键：排除已核销
    .maybeSingle()

  if (prizes) {
    // 获取用户信息
    let userInfo = null
    if (prizes.user_id) {
      const { data: userData } = await supabaseClient
        .from('users')
        .select('id, phone_number, first_name, last_name, avatar_url')
        .eq('id', prizes.user_id)
        .maybeSingle()
      userInfo = userData
    }

    // 获取抽奖信息
    let lotteryInfo = null
    if (prizes.lottery_id) {
      const { data: lotteryData } = await supabaseClient
        .from('lotteries')
        .select('title, title_i18n, image_url, original_price')
        .eq('id', prizes.lottery_id)
        .maybeSingle()
      lotteryInfo = lotteryData
    }

    // 获取自提点信息
    let pickupPointInfo = null
    if (prizes.pickup_point_id) {
      const { data: pointData } = await supabaseClient
        .from('pickup_points')
        .select('id, name, name_i18n, address, address_i18n')
        .eq('id', prizes.pickup_point_id)
        .maybeSingle()
      pickupPointInfo = pointData
    }

    return {
      success: true,
      data: {
        id: prizes.id,
        prize_name: prizes.prize_name || getLocalizedText(lotteryInfo?.title_i18n) || lotteryInfo?.title || '积分商城奖品',
        prize_image: prizes.prize_image || lotteryInfo?.image_url || '',
        prize_value: prizes.prize_value || lotteryInfo?.original_price || 0,
        pickup_code: prizes.pickup_code,
        pickup_status: prizes.pickup_status || 'PENDING_CLAIM',
        expires_at: prizes.expires_at,
        claimed_at: prizes.claimed_at,
        source_type: 'lottery',
        user: userInfo,
        pickup_point: pickupPointInfo,
        target_user_id: prizes.user_id,
      }
    }
  }

  // 2. 查询 group_buy_results 表（拼团）
  const { data: groupBuyResult } = await supabaseClient
    .from('group_buy_results')
    .select('id, pickup_code, pickup_status, logistics_status, expires_at, claimed_at, winner_id, product_id, session_id, pickup_point_id')
    .eq('pickup_code', pickupCode)
    .neq('pickup_status', 'PICKED_UP')  // 关键：排除已核销
    .maybeSingle()

  if (groupBuyResult) {
    // 获取商品信息
    let productInfo = null
    if (groupBuyResult.product_id) {
      const { data: productData } = await supabaseClient
        .from('group_buy_products')
        .select('title, title_i18n, name_i18n, image_url, original_price, group_price')
        .eq('id', groupBuyResult.product_id)
        .maybeSingle()
      productInfo = productData
    }

    // 获取用户信息
    let userInfo = null
    if (groupBuyResult.winner_id) {
      const { data: userData } = await supabaseClient
        .from('users')
        .select('id, phone_number, first_name, last_name, avatar_url')
        .eq('id', groupBuyResult.winner_id)
        .maybeSingle()
      userInfo = userData
    }

    // 获取自提点信息
    let pickupPointInfo = null
    if (groupBuyResult.pickup_point_id) {
      const { data: pointData } = await supabaseClient
        .from('pickup_points')
        .select('id, name, name_i18n, address, address_i18n')
        .eq('id', groupBuyResult.pickup_point_id)
        .maybeSingle()
      pickupPointInfo = pointData
    }

    const productName = getLocalizedText(productInfo?.name_i18n) || getLocalizedText(productInfo?.title_i18n) || getLocalizedText(productInfo?.title) || '拼团商品'

    return {
      success: true,
      data: {
        id: groupBuyResult.id,
        prize_name: productName,
        prize_image: productInfo?.image_url || '',
        prize_value: productInfo?.group_price || productInfo?.original_price || 0,
        pickup_code: groupBuyResult.pickup_code,
        pickup_status: groupBuyResult.pickup_status || groupBuyResult.logistics_status || 'PENDING_CLAIM',
        expires_at: groupBuyResult.expires_at,
        claimed_at: groupBuyResult.claimed_at,
        source_type: 'group_buy',
        user: userInfo,
        pickup_point: pickupPointInfo,
        target_user_id: groupBuyResult.winner_id,
      }
    }
  }

  // 3. 查询 full_purchase_orders 表（全款购买）
  const { data: fullPurchaseOrder } = await supabaseClient
    .from('full_purchase_orders')
    .select('id, order_number, pickup_code, pickup_status, logistics_status, expires_at, claimed_at, user_id, lottery_id, pickup_point_id, metadata')
    .eq('pickup_code', pickupCode)
    .neq('pickup_status', 'PICKED_UP')  // 关键：排除已核销
    .maybeSingle()

  if (fullPurchaseOrder) {
    // 获取用户信息
    let userInfo = null
    if (fullPurchaseOrder.user_id) {
      const { data: userData } = await supabaseClient
        .from('users')
        .select('id, phone_number, first_name, last_name, avatar_url')
        .eq('id', fullPurchaseOrder.user_id)
        .maybeSingle()
      userInfo = userData
    }

    // 获取抽奖信息
    let lotteryInfo = null
    if (fullPurchaseOrder.lottery_id) {
      const { data: lotteryData } = await supabaseClient
        .from('lotteries')
        .select('title, title_i18n, image_url, original_price')
        .eq('id', fullPurchaseOrder.lottery_id)
        .maybeSingle()
      lotteryInfo = lotteryData
    }

    // 获取自提点信息
    let pickupPointInfo = null
    if (fullPurchaseOrder.pickup_point_id) {
      const { data: pointData } = await supabaseClient
        .from('pickup_points')
        .select('id, name, name_i18n, address, address_i18n')
        .eq('id', fullPurchaseOrder.pickup_point_id)
        .maybeSingle()
      pickupPointInfo = pointData
    }

    // 从 metadata 中获取商品信息
    const metadata = fullPurchaseOrder.metadata || {}
    const productTitle = metadata.product_title || getLocalizedText(lotteryInfo?.title_i18n) || lotteryInfo?.title || '全款购买商品'
    const productImage = metadata.product_image || lotteryInfo?.image_url || ''
    const productPrice = lotteryInfo?.original_price || 0

    return {
      success: true,
      data: {
        id: fullPurchaseOrder.id,
        prize_name: productTitle,
        prize_image: productImage,
        prize_value: productPrice,
        pickup_code: fullPurchaseOrder.pickup_code,
        pickup_status: fullPurchaseOrder.pickup_status || fullPurchaseOrder.logistics_status || 'PENDING_CLAIM',
        expires_at: fullPurchaseOrder.expires_at,
        claimed_at: fullPurchaseOrder.claimed_at,
        source_type: 'full_purchase',
        user: userInfo,
        pickup_point: pickupPointInfo,
        target_user_id: fullPurchaseOrder.user_id,
      }
    }
  }

  // 未找到
  return {
    success: false,
    error: '未找到该提货码对应的订单'
  }
}

// ============================================================
// Action: verify — 执行核销
// ============================================================
async function handleVerify(
  supabaseClient: any, 
  pickupCode: string, 
  userId: string, 
  staffInfo: any,
  proofImageUrl?: string
) {
  console.log('[FrontendVerifyPickup] Verifying pickup code:', pickupCode)

  // 先查询找到对应记录
  const searchResult = await handleSearch(supabaseClient, pickupCode, staffInfo)
  
  if (!searchResult.success || !searchResult.data) {
    throw new Error(searchResult.error || '未找到该提货码对应的订单')
  }

  const orderData = searchResult.data

  // 检查状态是否允许核销
  const allowedStatuses = ['PENDING_PICKUP', 'PENDING', 'READY_FOR_PICKUP', 'PENDING_CLAIM']
  if (orderData.pickup_status && !allowedStatuses.includes(orderData.pickup_status)) {
    throw new Error(`该订单当前状态无法核销: ${orderData.pickup_status}`)
  }

  // 检查是否过期
  if (orderData.expires_at) {
    const expiresAt = new Date(orderData.expires_at)
    if (expiresAt < new Date()) {
      throw new Error('该提货码已过期，请联系管理员延期')
    }
  }

  // 确定表名
  let tableName = 'prizes'
  if (orderData.source_type === 'group_buy') {
    tableName = 'group_buy_results'
  } else if (orderData.source_type === 'full_purchase') {
    tableName = 'full_purchase_orders'
  }

  // 原子性条件更新（防止并发重复核销）
  const nowIso = new Date().toISOString()
  const updateData: any = {
    pickup_status: 'PICKED_UP',
    logistics_status: 'PICKED_UP',
    picked_up_at: nowIso,
    picked_up_by: userId,
  }

  // full_purchase_orders 额外更新 claimed_at
  if (orderData.source_type === 'full_purchase') {
    updateData.claimed_at = nowIso
  }

  // 使用原子性条件更新，兼容 null 状态的历史数据
  const { data: updatedRows, error: updateError } = await supabaseClient
    .from(tableName)
    .update(updateData)
    .eq('id', orderData.id)
    .or('pickup_status.in.(PENDING_CLAIM,PENDING_PICKUP,PENDING,READY_FOR_PICKUP),pickup_status.is.null')
    .select('id')

  if (updateError) {
    console.error('[FrontendVerifyPickup] Update error:', updateError)
    throw new Error('核销失败: ' + updateError.message)
  }

  // 检查是否真的更新了记录
  if (!updatedRows || updatedRows.length === 0) {
    throw new Error('核销失败：该提货码已被核销或状态已变更')
  }

  // 写入 pickup_logs
  const { error: logError } = await supabaseClient
    .from('pickup_logs')
    .insert({
      prize_id: orderData.id,
      pickup_code: pickupCode,
      pickup_point_id: staffInfo.point_id || null,
      operator_id: userId,
      operation_type: 'FRONTEND_VERIFY',
      order_type: orderData.source_type,
      source: 'frontend_staff',
      proof_image_url: proofImageUrl || null,
      notes: '前端核销员核销',
    })

  if (logError) {
    console.error('[FrontendVerifyPickup] Log insert error:', logError)
    // 日志写入失败不影响核销结果
  }

  // 发送通知给被核销的用户
  const targetUserId = orderData.target_user_id
  if (targetUserId) {
    const { error: notifError } = await supabaseClient
      .from('notifications')
      .insert({
        user_id: targetUserId,
        type: 'ORDER_PICKED_UP',
        title: '提货成功',
        title_i18n: { zh: '提货成功', ru: 'Товар получен', tg: 'Мол гирифта шуд' },
        content: `您的商品「${orderData.prize_name}」已成功提货。`,
        message_i18n: {
          zh: `您的商品「${orderData.prize_name}」已成功提货。`,
          ru: `Ваш товар «${orderData.prize_name}» успешно получен.`,
          tg: `Моли шумо «${orderData.prize_name}» бо муваффақият гирифта шуд.`
        },
        related_id: orderData.id,
        related_type: 'ORDER',
      })

    if (notifError) {
      console.error('[FrontendVerifyPickup] Notification insert error:', notifError)
      // 通知失败不影响核销结果
    }
  }

  console.log('[FrontendVerifyPickup] Verify success:', { orderId: orderData.id, sourceType: orderData.source_type })

  return {
    success: true,
    data: {
      message: '核销成功',
      order_id: orderData.id,
      source_type: orderData.source_type,
      prize_name: orderData.prize_name,
    }
  }
}

// ============================================================
// Action: get_today_logs — 获取今日核销记录
// ============================================================
async function handleGetTodayLogs(supabaseClient: any, userId: string) {
  // 获取今天的起始时间（UTC+5 塔吉克斯坦时区）
  const now = new Date()
  // 使用 UTC+5 计算今天的开始时间
  const offsetMs = 5 * 60 * 60 * 1000
  const localNow = new Date(now.getTime() + offsetMs)
  const todayStart = new Date(Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
    0, 0, 0, 0
  ))
  // 转回 UTC
  const todayStartUtc = new Date(todayStart.getTime() - offsetMs)

  const { data: logs, error } = await supabaseClient
    .from('pickup_logs')
    .select('id, prize_id, pickup_code, operation_type, order_type, source, notes, proof_image_url, created_at, prizes(prize_name, prize_image)')
    .eq('operator_id', userId)
    .gte('created_at', todayStartUtc.toISOString())
    .in('operation_type', ['FRONTEND_VERIFY', 'STAFF_VERIFY'])
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[FrontendVerifyPickup] Get today logs error:', error)
    throw new Error('获取今日记录失败')
  }
  // 整理日志，附加商品信息
  const enrichedLogs = (logs || []).map((log: any) => ({
    id: log.id,
    prize_id: log.prize_id,
    pickup_code: log.pickup_code,
    operation_type: log.operation_type,
    order_type: log.order_type,
    source: log.source,
    notes: log.notes,
    proof_image_url: log.proof_image_url,
    created_at: log.created_at,
    prize_name: log.prizes?.prize_name || null,
    prize_image: log.prizes?.prize_image || null,
  }))
  return {
    success: true,
    data: {
      logs: enrichedLogs,
      count: enrichedLogs.length,
    }
  }
}

// ============================================================
// 主路由
// ============================================================
serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, session_token, pickup_code, proof_image_url } = body

    console.log('[FrontendVerifyPickup] Request:', { 
      action, 
      pickup_code: pickup_code || 'N/A',
      session_token: session_token ? 'present' : 'missing' 
    })

    // 1. 验证 session
    if (!session_token) {
      throw new Error('未授权：缺少 session_token')
    }
    const { userId } = await validateSession(session_token)

    // 2. 初始化 Supabase 客户端（使用 service_role_key 绕过 RLS）
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // 3. 验证核销员身份
    const staffInfo = await validatePickupStaff(supabaseClient, userId)
    console.log('[FrontendVerifyPickup] Staff validated:', { userId, pointId: staffInfo.point_id })

    // 4. 路由分发
    let result: any

    switch (action) {
      case 'search': {
        if (!pickup_code || pickup_code.length !== 6) {
          throw new Error('请输入有效的6位提货码')
        }
        result = await handleSearch(supabaseClient, pickup_code, staffInfo)
        break
      }

      case 'verify': {
        if (!pickup_code || pickup_code.length !== 6) {
          throw new Error('请输入有效的6位提货码')
        }
        result = await handleVerify(supabaseClient, pickup_code, userId, staffInfo, proof_image_url)
        break
      }

      case 'get_today_logs': {
        result = await handleGetTodayLogs(supabaseClient, userId)
        break
      }

      default:
        throw new Error(`不支持的操作: ${action}`)
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: result.success ? 200 : 400,
      }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[FrontendVerifyPickup] Error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
