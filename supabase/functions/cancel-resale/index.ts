import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

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

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const body = await req.json()
    const { resale_item_id, session_token } = body

    console.log('[CancelResale] Request:', { resale_item_id, session_token: session_token ? 'present' : 'missing' })

    // 验证用户身份
    let userId: string
    
    if (session_token) {
      const { userId: validatedUserId } = await validateSession(session_token)
      userId = validatedUserId
    } else {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        throw new Error('未授权：缺少认证信息')
      }

      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
        authHeader.replace('Bearer ', '')
      )
      if (authError || !user) {
        throw new Error('未授权')
      }
      
      const { data: userData } = await supabaseClient
        .from('users')
        .select('id')
        .eq('telegram_id', user.id)
        .single()
      
      if (!userData) {
        throw new Error('用户不存在')
      }
      
      userId = userData.id
    }

    // 查询转售商品 (使用 resales 表)
    const { data: resaleItem, error: resaleError } = await supabaseClient
      .from('resales')
      .select('*')
      .eq('id', resale_item_id)
      .eq('seller_id', userId)
      .single()

    if (resaleError || !resaleItem) {
      throw new Error('转售商品不存在或不属于您')
    }

    // 检查状态
    if (resaleItem.status !== 'ACTIVE') {
      throw new Error('该商品已下架或已售出')
    }

    // 更新转售商品状态
    const { error: updateResaleError } = await supabaseClient
      .from('resales')
      .update({ 
        status: 'CANCELLED',
        updated_at: new Date().toISOString()
      })
      .eq('id', resale_item_id)

    if (updateResaleError) {
      throw new Error('取消转售失败: ' + updateResaleError.message)
    }

    console.log('[CancelResale] Success:', resale_item_id)

    return new Response(
      JSON.stringify({
        success: true,
        message: '取消转售成功',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[CancelResale] Error:', error)
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
