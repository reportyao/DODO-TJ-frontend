import { mapErrorCode } from '../_shared/errorResponse.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// mapErrorCode 已迁移到共享模块


// 通用的 session 验证函数
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌');
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('服务器配置错误');
  }

  // 查询 user_sessions 表验证 session
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

  // 检查 session 是否过期
  const expiresAt = new Date(session.expires_at);
  const now = new Date();
  
  if (expiresAt < now) {
    throw new Error('未授权：会话已过期');
  }

  return {
    userId: session.user_id,
    session: session
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const body = await req.json()
    const { ticket_id, price, session_token } = body

    console.log('[CreateResale] Request:', { ticket_id, price, session_token: session_token ? 'present' : 'missing' })

    // 验证用户身份
    let userId: string
    
    if (session_token) {
      const { userId: validatedUserId } = await validateSession(session_token)
      userId = validatedUserId
    } else {
      // session_token 是必须的认证方式
      throw new Error('未授权：缺少 session_token')
    }

    console.log('[CreateResale] Validated user:', userId)

    if (!ticket_id || !price) {
      throw new Error('缺少必要参数：ticket_id, price')
    }

    // 查询参与记录信息（统一使用 lottery_entries 表）
    const { data: entry, error: entryError } = await supabaseClient
      .from('lottery_entries')
      .select('*, lotteries(*)')
      .eq('id', ticket_id)
      .eq('user_id', userId)
      .single()
    
    if (entryError || !entry) {
      throw new Error('票据不存在或不属于您')
    }

    const ticketData = entry

    // 检查是否已经在转售中 (使用 resales 表)
    const { data: existingResale } = await supabaseClient
      .from('resales')
      .select('id')
      .eq('ticket_id', ticket_id)
      .eq('status', 'ACTIVE')
      .maybeSingle()

    if (existingResale) {
      throw new Error('该票据已在转售中')
    }

    // 计算原价
    const originalPrice = ticketData.lotteries?.ticket_price || price

    // 创建转售商品 (使用 resales 表)
    const { data: resaleItem, error: resaleError } = await supabaseClient
      .from('resales')
      .insert({
        ticket_id: ticket_id,
        seller_id: userId,
        lottery_id: ticketData.lottery_id,
        original_price: originalPrice,
        resale_price: price,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (resaleError) {
      console.error('[CreateResale] Create error:', resaleError)
      throw new Error('创建转售商品失败: ' + resaleError.message)
    }

    console.log('[CreateResale] Created:', resaleItem.id)

    return new Response(
      JSON.stringify({
        success: true,
        data: resaleItem,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[CreateResale] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errMsg, error_code: mapErrorCode(errMsg) }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
