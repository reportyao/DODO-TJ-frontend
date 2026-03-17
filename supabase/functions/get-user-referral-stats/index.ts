import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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

  // 单独查询用户数据
  const userResponse = await fetch(
    `${supabaseUrl}/rest/v1/users?id=eq.${session.user_id}&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!userResponse.ok) {
    throw new Error('查询用户信息失败');
  }

  const users = await userResponse.json();
  
  if (users.length === 0) {
    throw new Error('未授权：用户不存在');
  }

  return {
    userId: session.user_id,
    user: users[0],
    session: session
  };
}

serve(async (req) => {
  // 允许 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 从 body 中获取 session_token
    const body = await req.json()
    const { session_token } = body

    console.log('[GetUserReferralStats] Received request:', { session_token: session_token ? 'present' : 'missing' });

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    // 验证用户 session
    const { userId } = await validateSession(session_token);
    
    console.log('[GetUserReferralStats] User validated:', userId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // 2. 获取统计数据
    const statsResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_user_referral_stats`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
          'Prefer': 'params=single-object'
        },
        body: JSON.stringify({
          p_user_id: userId
        })
      }
    );

    if (!statsResponse.ok) {
      const errorText = await statsResponse.text();
      console.error('[GetUserReferralStats] RPC调用失败:', errorText);
      throw new Error('获取推荐统计失败');
    }

    const stats = await statsResponse.json();

    // 3. 获取用户信息
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=id,telegram_username`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!userResponse.ok) {
      throw new Error('获取用户信息失败');
    }

    const users = await userResponse.json();
    const userInfo = users[0];

    const result = {
      ...(stats && stats[0] ? stats[0] : {}),
      total_invites: stats?.[0]?.total_invites || 0,
      total_commission: stats?.[0]?.total_commission || 0,
      first_deposit_bonus_status: 'INACTIVE',
      first_deposit_bonus_amount: 0,
      first_deposit_bonus_expire_at: null,
      activation_share_count: 0,
      activation_invite_count: 0,
    }

    console.log('[GetUserReferralStats] Success:', result);

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[GetUserReferralStats] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
    )
  }
})
