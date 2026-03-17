import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('[deposit-request] 开始处理请求')

  try {
    // 先尝试使用用户的token
    const authHeader = req.headers.get('Authorization')
    let userId: string | null = null
    let user: any = null

    console.log('[deposit-request] Authorization header:', authHeader ? '存在' : '不存在')

    if (authHeader) {
      // 尝试使用用户token验证
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
      
      if (!userError && authUser) {
        userId = authUser.id
        user = authUser
        console.log('[deposit-request] 从token获取到userId:', userId)
      } else {
        console.log('[deposit-request] token验证失败:', userError?.message)
      }
    }

    // 如果没有有效的认证，使用Service Role Key
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const requestBody = await req.json()
    console.log('[deposit-request] 请求体:', JSON.stringify(requestBody))

    const { 
      amount, 
      currency, 
      paymentMethod, 
      paymentProofImages, 
      paymentReference, 
      payerName, 
      payerAccount,
      payerPhone,
      userId: bodyUserId  // 从body中获取userId
    } = requestBody

    console.log('[deposit-request] 解析的字段:', {
      amount,
      currency,
      paymentMethod,
      paymentProofImages: paymentProofImages?.length || 0,
      payerName: payerName || '未提供',
      payerAccount: payerAccount || '未提供',
      payerPhone: payerPhone || '未提供',
      bodyUserId
    })

    // 如果没有从token中获取到userId，使用body中的userId
    if (!userId && bodyUserId) {
      userId = bodyUserId
      console.log('[deposit-request] 使用body中的userId:', userId)
    }

    if (!userId) {
      console.log('[deposit-request] 错误: 未授权 - 没有userId')
      throw new Error('未授权')
    }

    // 验证用户是否存在
    console.log('[deposit-request] 验证用户是否存在:', userId)
    const { data: existingUser, error: userCheckError } = await supabaseClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()

    if (userCheckError) {
      console.log('[deposit-request] 用户查询错误:', userCheckError.message)
      throw new Error('用户不存在: ' + userCheckError.message)
    }

    if (!existingUser) {
      console.log('[deposit-request] 用户不存在')
      throw new Error('用户不存在')
    }

    console.log('[deposit-request] 用户验证通过')

    // 验证参数
    if (!amount || amount <= 0) {
      console.log('[deposit-request] 错误: 充值金额无效:', amount)
      throw new Error('充值金额必须大于0')
    }

    if (!paymentMethod) {
      console.log('[deposit-request] 错误: 未选择支付方式')
      throw new Error('请选择支付方式')
    }

    // 生成订单号
    const orderNumber = `LM${Date.now()}`
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
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[deposit-request] 充值申请错误:', errMsg, error.stack)
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
