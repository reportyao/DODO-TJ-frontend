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

    console.log('[GetInvitedUsers] Received request:', { session_token: session_token ? 'present' : 'missing' });

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    // 验证用户 session
    const { userId } = await validateSession(session_token);
    
    console.log('[GetInvitedUsers] User validated:', userId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // 修复: 兼容 referred_by_id 和 referrer_id 两个字段
    // 2. 获取一级好友 (referred_by_id = userId OR referrer_id = userId)
    const level1ByReferred = await fetch(
      `${supabaseUrl}/rest/v1/users?referred_by_id=eq.${userId}&select=id,phone_number,first_name,last_name,avatar_url,created_at`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        }
      }
    );

    const level1ByReferrer = await fetch(
      `${supabaseUrl}/rest/v1/users?referrer_id=eq.${userId}&select=id,phone_number,first_name,last_name,avatar_url,created_at`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!level1ByReferred.ok) {
      throw new Error('获取一级好友失败');
    }

    const level1ByReferredData = await level1ByReferred.json();
    const level1ByReferrerData = level1ByReferrer.ok ? await level1ByReferrer.json() : [];
    
    // 合并并去重
    const level1Map = new Map();
    [...level1ByReferredData, ...level1ByReferrerData].forEach(u => {
      level1Map.set(u.id, u);
    });
    const level1Users = Array.from(level1Map.values());

    // 3. 获取二级好友
    const level1Ids = level1Users?.map((u: any) => u.id) || []
    let level2Users: any[] = []
    if (level1Ids.length > 0) {
      const level2ByReferred = await fetch(
        `${supabaseUrl}/rest/v1/users?referred_by_id=in.(${level1Ids.join(',')})&select=id,phone_number,first_name,last_name,avatar_url,created_at,referred_by_id`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const level2ByReferrer = await fetch(
        `${supabaseUrl}/rest/v1/users?referrer_id=in.(${level1Ids.join(',')})&select=id,phone_number,first_name,last_name,avatar_url,created_at,referred_by_id`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const level2ByReferredData = level2ByReferred.ok ? await level2ByReferred.json() : [];
      const level2ByReferrerData = level2ByReferrer.ok ? await level2ByReferrer.json() : [];
      
      // 合并并去重
      const level2Map = new Map();
      [...level2ByReferredData, ...level2ByReferrerData].forEach(u => {
        level2Map.set(u.id, u);
      });
      level2Users = Array.from(level2Map.values());
    }

    // 4. 获取三级好友
    const level2Ids = level2Users.map((u: any) => u.id)
    let level3Users: any[] = []
    if (level2Ids.length > 0) {
      const level3ByReferred = await fetch(
        `${supabaseUrl}/rest/v1/users?referred_by_id=in.(${level2Ids.join(',')})&select=id,phone_number,first_name,last_name,avatar_url,created_at,referred_by_id`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const level3ByReferrer = await fetch(
        `${supabaseUrl}/rest/v1/users?referrer_id=in.(${level2Ids.join(',')})&select=id,phone_number,first_name,last_name,avatar_url,created_at,referred_by_id`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const level3ByReferredData = level3ByReferred.ok ? await level3ByReferred.json() : [];
      const level3ByReferrerData = level3ByReferrer.ok ? await level3ByReferrer.json() : [];
      
      // 合并并去重
      const level3Map = new Map();
      [...level3ByReferredData, ...level3ByReferrerData].forEach(u => {
        level3Map.set(u.id, u);
      });
      level3Users = Array.from(level3Map.values());
    }

    // 5. 整合数据并计算统计
    const allInvitedUsers = [...(level1Users || []), ...level2Users, ...level3Users]
      .map((u: any) => {
        // 确定层级
        let userLevel = 0
        if (level1Users?.some((l1: any) => l1.id === u.id)) userLevel = 1
        else if (level2Users.some((l2: any) => l2.id === u.id)) userLevel = 2
        else if (level3Users.some((l3: any) => l3.id === u.id)) userLevel = 3

        // 构建显示名称：优先使用 first_name + last_name，其次 phone_number 脱敏显示，最后使用 User + ID
        let displayName = '';
        if (u.first_name || u.last_name) {
          displayName = [u.first_name, u.last_name].filter(Boolean).join(' ');
        } else if (u.phone_number) {
          // 脱敏显示手机号：保留前3位和后4位
          const phone = u.phone_number;
          displayName = phone.length > 7 ? phone.slice(0, 3) + '****' + phone.slice(-4) : phone;
        } else {
          displayName = `User${u.id.slice(-4)}`;
        }

        return {
          id: u.id,
          username: displayName,
          phone_number: u.phone_number,
          first_name: u.first_name,
          last_name: u.last_name,
          avatar_url: u.avatar_url,
          created_at: u.created_at,
          level: userLevel,
          commission_earned: 0, // TODO: 查询佣金
          total_spent: 0, // TODO: 查询总消费
        }
      })

    console.log('[GetInvitedUsers] Success, found users:', allInvitedUsers.length);

    return new Response(
      JSON.stringify({ success: true, data: allInvitedUsers }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[GetInvitedUsers] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errMsg, error_code: 'ERR_SERVER_ERROR' }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
    )
  }
})
