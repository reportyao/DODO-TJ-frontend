/**
 * ============================================================
 * deposit-request Edge Function（用户充值申请）
 * ============================================================
 * 
 * 功能：用户提交充值申请，等待管理员审核
 * 
 * 核心流程：
 *   1. 验证用户身份（session_token 或 Authorization header）
 *   2. 校验充值金额范围（10~50000 TJS）
 *   3. 创建 PENDING 状态的充值申请记录
 *   4. 管理员在后台审核通过后调用 approve_deposit_atomic 入账
 * 
 * 认证方式：
 *   - 优先: body.session_token（PWA 模式）
 *   - 兼容: Authorization header（Supabase Auth，将来移除）
 * 
 * 安全机制：
 *   - 服务端校验金额范围，防止绕过前端直接调用 API
 *   - 只创建申请记录，不直接操作钱包余额
 *   - 幂等性保护：基于 idempotency_key 防止重复提交
 * ============================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

/** 标准化错误响应，包含 error_code 用于前端国际化 */
function errorResponse(errorCode: string, fallbackMessage: string, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error: fallbackMessage, error_code: errorCode }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
  )
}

// 通用的 session 验证函数（与其他 Edge Functions 保持一致）
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw { code: 'ERR_MISSING_TOKEN', message: '未授权：缺少认证令牌' };
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw { code: 'ERR_SERVER_CONFIG', message: '服务器配置错误' };
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
  );

  if (!sessionResponse.ok) {
    throw { code: 'ERR_SESSION_VALIDATE_FAILED', message: '验证会话失败' };
  }

  const sessions = await sessionResponse.json();
  if (sessions.length === 0) {
    throw { code: 'ERR_INVALID_SESSION', message: '未授权：会话不存在或已失效' };
  }

  const session = sessions[0];
  const expiresAt = new Date(session.expires_at);
  if (expiresAt < new Date()) {
    throw { code: 'ERR_SESSION_EXPIRED', message: '未授权：会话已过期' };
  }

  return { userId: session.user_id };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestBody = await req.json()

    // ============================================================
    // 1. 认证：优先 session_token，向后兼容 Authorization header
    // ============================================================
    let userId: string;

    if (requestBody.session_token) {
      const result = await validateSession(requestBody.session_token);
      userId = result.userId;
    } else {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return errorResponse('ERR_MISSING_SESSION', '未授权：缺少 session_token', 401)
      }

      const supabaseClientWithAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      )

      const { data: { user: authUser }, error: userError } = await supabaseClientWithAuth.auth.getUser()
      
      if (userError || !authUser) {
        return errorResponse('ERR_INVALID_TOKEN', '未授权：无效的认证令牌', 401)
      }

      userId = authUser.id
    }

    // 使用 service role client 进行数据库操作
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { 
      amount, 
      currency, 
      paymentMethod, 
      paymentProofImages, 
      paymentReference, 
      payerName, 
      payerAccount,
      payerPhone,
      idempotency_key,
    } = requestBody

    // ============================================================
    // 1.5 幂等性检查：防止重复提交
    // ============================================================
    if (idempotency_key) {
      const { data: existingRequest } = await supabaseClient
        .from('deposit_requests')
        .select('id, status, order_number')
        .eq('idempotency_key', idempotency_key)
        .maybeSingle()

      if (existingRequest) {
        return new Response(
          JSON.stringify({ success: true, data: existingRequest, message: '充值申请已提交,请等待审核', deduplicated: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    }

    // 验证用户是否存在
    const { data: existingUser, error: userCheckError } = await supabaseClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()

    if (userCheckError || !existingUser) {
      return errorResponse('ERR_USER_NOT_FOUND', '用户不存在', 404)
    }

    // 验证参数
    if (!amount || amount <= 0) {
      return errorResponse('ERR_DEPOSIT_AMOUNT_INVALID', '充值金额必须大于0')
    }

    const MIN_DEPOSIT = 10;
    const MAX_DEPOSIT = 50000;
    if (amount < MIN_DEPOSIT) {
      return errorResponse('ERR_DEPOSIT_AMOUNT_TOO_LOW', `充值金额不能低于最低限额 ${MIN_DEPOSIT} TJS`)
    }
    if (amount > MAX_DEPOSIT) {
      return errorResponse('ERR_DEPOSIT_AMOUNT_TOO_HIGH', `充值金额不能超过最高限额 ${MAX_DEPOSIT} TJS`)
    }

    if (!paymentMethod) {
      return errorResponse('ERR_PAYMENT_METHOD_REQUIRED', '请选择支付方式')
    }

    // 生成订单号
    const orderNumber = `DP${Date.now()}`

    // 创建充值申请
    const insertData: Record<string, unknown> = {
      user_id: userId,
      order_number: orderNumber,
      amount: amount,
      currency: currency || 'TJS',
      payment_method: paymentMethod,
      payment_proof_images: paymentProofImages || null,
      payment_reference: paymentReference || null,
      payer_name: payerName || null,
      payer_account: payerAccount || null,
      payer_phone: payerPhone || null,
      status: 'PENDING',
    }

    // 如果有幂等性key，存入记录
    if (idempotency_key) {
      insertData.idempotency_key = idempotency_key
    }

    const { data: depositRequest, error: insertError } = await supabaseClient
      .from('deposit_requests')
      .insert(insertData)
      .select()
      .single()

    if (insertError) {
      console.error('[deposit-request] Insert failed:', insertError.message)
      return errorResponse('ERR_DEPOSIT_CREATE_FAILED', '创建充值申请失败', 500)
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: depositRequest,
        message: '充值申请已提交,请等待审核',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const errCode = err.code || 'ERR_SERVER_ERROR';
    const errMsg = err.message || (error instanceof Error ? error.message : String(error));
    console.error('[deposit-request] Error:', errCode, errMsg)
    return errorResponse(errCode, errMsg, errCode.includes('UNAUTHORIZED') || errCode.includes('SESSION') || errCode.includes('TOKEN') ? 401 : 400)
  }
})
