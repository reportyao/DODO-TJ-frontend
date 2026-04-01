/**
 * promoter-center Edge Function
 *
 * 推广者中心数据接口 - 通过 service_role 中转调用受保护的 RPC 函数
 *
 * 功能：
 *   1. get_data   - 获取推广者中心数据（调用 get_promoter_center_data RPC）
 *   2. check_in   - 今日打卡，接触人数+1（调用 increment_contact_count RPC）
 *
 * 认证方式：
 *   通过 body 中的 session_token 查询 user_sessions 表验证身份
 *
 * 原因：
 *   get_promoter_center_data 和 increment_contact_count 为 SECURITY DEFINER 函数，
 *   已通过迁移文件撤销了 anon/public 执行权限，只授权给 service_role。
 *   前端无法直接用 anon key 调用，需通过此 Edge Function 中转。
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

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
        'Content-Type': 'application/json',
      },
    }
  )

  if (!sessionResponse.ok) {
    throw new Error('验证会话失败')
  }

  const sessions = await sessionResponse.json()

  if (!sessions || sessions.length === 0) {
    throw new Error('未授权：会话不存在或已失效')
  }

  const session = sessions[0]
  const expiresAt = new Date(session.expires_at)
  const now = new Date()

  if (expiresAt < now) {
    throw new Error('未授权：会话已过期')
  }

  return { userId: session.user_id, session }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, session_token, time_range, log_date } = body

    if (!session_token) {
      return new Response(
        JSON.stringify({ success: false, error: '未授权：缺少 session_token', error_code: 'ERR_MISSING_SESSION' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { userId } = await validateSession(session_token)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // ============================================================
    // action: get_data - 获取推广者中心数据
    // ============================================================
    if (action === 'get_data') {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_promoter_center_data`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: userId,
          p_time_range: time_range || 'week',
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[PromoterCenter] get_promoter_center_data failed:', errorText)
        throw new Error(`获取数据失败: ${errorText}`)
      }

      const result = await response.json()
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ============================================================
    // action: check_in - 今日打卡
    // ============================================================
    if (action === 'check_in') {
      const today = log_date || new Date().toISOString().split('T')[0]

      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_contact_count`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_promoter_id: userId,
          p_log_date: today,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[PromoterCenter] increment_contact_count failed:', errorText)
        throw new Error(`打卡失败: ${errorText}`)
      }

      const result = await response.json()
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: `未知操作: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[PromoterCenter] Error:', errMsg)
    return new Response(
      JSON.stringify({ success: false, error: errMsg, error_code: 'ERR_SERVER_ERROR' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
