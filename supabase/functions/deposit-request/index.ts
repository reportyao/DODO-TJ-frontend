import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// 通用的 session 验证函数（与其他 Edge Functions 保持一致）
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌');
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('服务器配置错误');
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
    throw new Error('验证会话失败');
  }

  const sessions = await sessionResponse.json();
  if (sessions.length === 0) {
    throw new Error('未授权：会话不存在或已失效');
  }

  const session = sessions[0];
  const expiresAt = new Date(session.expires_at);
  if (expiresAt < new Date()) {
    throw new Error('未授权：会话已过期');
  }

  return { userId: session.user_id };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('[deposit-request] 开始处理请求')

  try {
    const requestBody = await req.json()
    console.log('[deposit-request] 请求体:', JSON.stringify({
      ...requestBody,
      session_token: requestBody.session_token ? '***' : undefined
    }))

    // ============================================================
    // 1. 认证：优先 session_token，向后兼容 Authorization header
    //    【安全修复】移除了不安全的 body userId 回退机制
    // ============================================================
    let userId: string;

    if (requestBody.session_token) {
      // 新的自定义 session 认证（PWA 模式）
      const result = await validateSession(requestBody.session_token);
      userId = result.userId;
      console.log('[deposit-request] session_token 验证通过, userId:', userId)
    } else {
      // 向后兼容：尝试 Authorization header（Supabase Auth，将来移除）
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        throw new Error('未授权：缺少 session_token')
      }

      const supabaseClientWithAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
          global: {
            headers: { Authorization: authHeader },
          },
        }
      )

      const { data: { user: authUser }, error: userError } = await supabaseClientWithAuth.auth.getUser()
      
      if (userError || !authUser) {
        console.log('[deposit-request] token验证失败:', userError?.message)
        throw new Error('未授权：无效的认证令牌')
      }

      userId = authUser.id
      console.log('[deposit-request] 从 Auth token 获取到 userId:', userId)
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
    } = requestBody

    console.log('[deposit-request] 解析的字段:', {
      amount,
      currency,
      paymentMethod,
      paymentProofImages: paymentProofImages?.length || 0,
      payerName: payerName || '未提供',
      payerAccount: payerAccount || '未提供',
      payerPhone: payerPhone || '未提供',
    })

    // 验证用户是否存在
    console.log('[deposit-request] 验证用户是否存在:', userId)
    const { data: existingUser, error: userCheckError } = await supabaseClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()

    if (userCheckError || !existingUser) {
      console.log('[deposit-request] 用户不存在:', userCheckError?.message)
      throw new Error('用户不存在')
    }

    console.log('[deposit-request] 用户验证通过')

    // 验证参数
    if (!amount || amount <= 0) {
      console.log('[deposit-request] 错误: 充值金额无效:', amount)
      throw new Error('充值金额必须大于0')
    }
    // 【安全修复】服务端校验充值金额范围，防止绕过前端直接调用 API
    const MIN_DEPOSIT = 10;
    const MAX_DEPOSIT = 50000;
    if (amount < MIN_DEPOSIT) {
      console.log('[deposit-request] 错误: 充值金额低于最低限额:', amount)
      throw new Error(`充值金额不能低于最低限额 ${MIN_DEPOSIT} TJS`)
    }
    if (amount > MAX_DEPOSIT) {
      console.log('[deposit-request] 错误: 充值金额超过最高限额:', amount)
      throw new Error(`充值金额不能超过最高限额 ${MAX_DEPOSIT} TJS`)
    }

    if (!paymentMethod) {
      console.log('[deposit-request] 错误: 未选择支付方式')
      throw new Error('请选择支付方式')
    }

    // 生成订单号
    const orderNumber = `DP${Date.now()}`
    console.log('[deposit-request] 生成订单号:', orderNumber)

    // 创建充值申请
    const insertData = {
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
    console.log('[deposit-request] 插入数据:', JSON.stringify(insertData))

    const { data: depositRequest, error: insertError } = await supabaseClient
      .from('deposit_requests')
      .insert(insertData)
      .select()
      .single()

    if (insertError) {
      console.error('[deposit-request] 创建充值申请失败:', insertError.message, insertError.details, insertError.hint)
      throw new Error('创建充值申请失败: ' + insertError.message)
    }

    console.log('[deposit-request] 充值申请创建成功:', depositRequest.id)

    return new Response(
      JSON.stringify({
        success: true,
        data: depositRequest,
        message: '充值申请已提交,请等待审核',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[deposit-request] 充值申请错误:', errMsg, error instanceof Error ? error.stack : '')
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
