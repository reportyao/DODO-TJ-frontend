/**
 * promoter-deposit Edge Function
 * 
 * 地推人员代客充值接口
 * 
 * 功能：
 *   1. 验证地推人员身份（通过 session_token）
 *   2. 搜索目标用户（兼容 UUID / 手机号 / 用户名）
 *   3. 执行充值操作（调用 perform_promoter_deposit RPC 事务函数）
 *   4. 获取充值统计数据
 * 
 * 请求格式：
 *   POST /promoter-deposit
 *   body: {
 *     action: 'deposit' | 'search_user' | 'get_stats',
 *     session_token: string,
 *     // action=deposit 时需要：
 *     target_user_id?: string,
 *     amount?: number,
 *     note?: string,
 *     // action=search_user 时需要：
 *     query?: string,
 *   }
 * 
 * 认证方式：
 *   通过 body 中的 session_token 查询 user_sessions 表验证身份
 *   （与 exchange-balance 等 Edge Function 保持一致）
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// ============================================================
// 通用的 session 验证函数（与 exchange-balance 保持一致）
// ============================================================
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌')
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('服务器配置错误')
  }

  // 查询 user_sessions 表验证 session
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

  if (sessions.length === 0) {
    throw new Error('未授权：会话不存在或已失效')
  }

  const session = sessions[0]

  // 检查 session 是否过期
  const expiresAt = new Date(session.expires_at)
  const now = new Date()

  if (expiresAt < now) {
    throw new Error('未授权：会话已过期')
  }

  // 查询用户数据
  const userResponse = await fetch(
    `${supabaseUrl}/rest/v1/users?id=eq.${session.user_id}&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!userResponse.ok) {
    throw new Error('查询用户信息失败')
  }

  const users = await userResponse.json()

  if (users.length === 0) {
    throw new Error('未授权：用户不存在')
  }

  return {
    userId: session.user_id,
    user: users[0],
    session: session,
  }
}

// ============================================================
// 验证地推人员身份
// ============================================================
async function validatePromoter(supabaseClient: any, userId: string) {
  const { data, error } = await supabaseClient
    .from('promoter_profiles')
    .select('user_id, promoter_status, daily_deposit_limit')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    throw new Error('您不是地推人员，无法执行充值操作')
  }

  if (data.promoter_status !== 'active') {
    throw new Error('您的地推人员账号未激活或已被停用')
  }

  return data
}

serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, session_token } = body

    console.log('[promoter-deposit] 收到请求:', {
      action,
      session_token: session_token ? 'present' : 'missing',
    })

    // ============================================================
    // 验证 session_token
    // ============================================================
    if (!session_token) {
      throw new Error('未授权：缺少 session_token')
    }

    const { userId } = await validateSession(session_token)
    console.log('[promoter-deposit] 用户验证通过:', userId)

    // 创建 Supabase 客户端（使用 service_role_key 绕过 RLS）
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // ============================================================
    // 路由分发
    // ============================================================
    switch (action) {
      // ============================================================
      // action: search_user - 搜索目标用户
      // ============================================================
      case 'search_user': {
        const { query } = body

        if (!query || query.trim().length === 0) {
          throw new Error('搜索关键词不能为空')
        }

        // 先验证是地推人员
        await validatePromoter(supabaseClient, userId)

        // 调用 RPC 函数搜索用户
        const { data: result, error: rpcError } = await supabaseClient.rpc(
          'search_user_for_deposit',
          { p_query: query.trim() }
        )

        if (rpcError) {
          console.error('[promoter-deposit] search_user RPC error:', rpcError)
          throw new Error('搜索用户失败: ' + rpcError.message)
        }

        console.log('[promoter-deposit] search_user result:', JSON.stringify(result))

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // ============================================================
      // action: deposit - 执行充值
      // ============================================================
      case 'deposit': {
        const { target_user_id, amount, note, idempotency_key } = body

        if (!target_user_id) {
          throw new Error('目标用户ID不能为空')
        }

        // 幂等性保护：如果有提供 idempotency_key，检查是否已经处理过
        if (idempotency_key) {
          const { data: existingLog } = await supabaseClient
            .from('audit_logs')
            .select('id, details')
            .eq('action', 'PROMOTER_DEPOSIT')
            .eq('user_id', userId)
            .eq('status', 'success')
            .contains('details', { idempotency_key })
            .maybeSingle()

          if (existingLog) {
            console.log(`[promoter-deposit] Idempotency hit for key: ${idempotency_key}`)
            return new Response(
              JSON.stringify({
                success: true,
                message: '充值已成功处理（重复请求）',
                deposit_id: existingLog.details?.deposit_id
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
        }

        if (!amount || amount < 10 || amount > 500) {
          throw new Error('充值金额必须在 10-500 TJS 之间')
        }

        // 验证是地推人员
        await validatePromoter(supabaseClient, userId)

        console.log('[promoter-deposit] 执行充值:', {
          promoter_id: userId,
          target_user_id,
          amount,
          note,
        })

        // 调用核心 RPC 事务函数
        const { data: result, error: rpcError } = await supabaseClient.rpc(
          'perform_promoter_deposit',
          {
            p_promoter_id: userId,
            p_target_user_id: target_user_id,
            p_amount: amount,
            p_note: note || null,
          }
        )

        if (rpcError) {
          console.error('[promoter-deposit] deposit RPC error:', rpcError)
          throw new Error('充值失败: ' + rpcError.message)
        }

        console.log('[promoter-deposit] deposit result:', JSON.stringify(result))

        // 处理 RPC 返回的业务错误
        if (!result.success) {
          const errorMessages: Record<string, string> = {
            NOT_PROMOTER: '您不是地推人员',
            PROMOTER_INACTIVE: '您的地推账号未激活',
            SELF_DEPOSIT_FORBIDDEN: '不能给自己充值',
            INVALID_AMOUNT: '充值金额必须在 10-500 TJS 之间',
            DAILY_COUNT_EXCEEDED: '今日充值次数已达上限（10次）',
            DAILY_LIMIT_EXCEEDED: `今日充值额度不足，剩余额度: ${result.remaining || 0} TJS`,
          }

          throw new Error(
            errorMessages[result.error] || '充值失败: ' + result.error
          )
        }

        // 记录操作日志
        await supabaseClient.rpc('log_edge_function_action', {
          p_function_name: 'promoter-deposit',
          p_action: 'PROMOTER_DEPOSIT',
          p_user_id: userId,
          p_target_type: 'user',
          p_target_id: target_user_id,
          p_details: {
            promoter_id: userId,
            target_user_id,
            amount,
            note: note || null,
            deposit_id: result.deposit_id || null,
            idempotency_key: idempotency_key || null,
          },
          p_status: 'success',
          p_error_message: null,
        }).then(({ error: logErr }) => { if (logErr) console.error('Failed to write audit log:', logErr); })
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // ============================================================
      // action: get_stats - 获取充値统计
      // ============================================================
      case 'get_stats': {
        const { date } = body

        // 验证是地推人员
        await validatePromoter(supabaseClient, userId)

        // 调用 RPC 函数获取统计
        const { data: result, error: rpcError } = await supabaseClient.rpc(
          'get_promoter_deposit_stats',
          {
            p_promoter_id: userId,
            p_date: date || new Date().toISOString().split('T')[0],
          }
        )

        if (rpcError) {
          console.error('[promoter-deposit] get_stats RPC error:', rpcError)
          throw new Error('获取统计失败: ' + rpcError.message)
        }

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // ============================================================
      // action: get_history - 获取充值历史记录
      // ============================================================
      case 'get_history': {
        const { page = 1, page_size = 20 } = body

        // 验证是地推人员
        await validatePromoter(supabaseClient, userId)

        const offset = (page - 1) * page_size

        // 查询充值记录（关联目标用户信息）
        const { data: deposits, error: queryError } = await supabaseClient
          .from('promoter_deposits')
          .select(`
            id, amount, currency, status, note, bonus_amount, created_at,
            target_user:users!promoter_deposits_target_user_id_fkey(
              id, phone_number, first_name, last_name, avatar_url
            )
          `)
          .eq('promoter_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + page_size - 1)

        if (queryError) {
          console.error('[promoter-deposit] get_history error:', queryError)
          throw new Error('获取充值记录失败: ' + queryError.message)
        }

        return new Response(
          JSON.stringify({ success: true, data: deposits }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      default:
        throw new Error('未知操作: ' + action)
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[promoter-deposit] Error:", errMsg)

    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg || '服务器内部错误',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
