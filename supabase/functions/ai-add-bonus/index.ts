import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// 验证session并检查是否为管理员或内部调用
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
  const now = new Date();
  
  if (expiresAt < now) {
    throw new Error('未授权：会话已过期');
  }

  return {
    userId: session.user_id,
    session: session
  };
}

/**
 * 获取最近一天的 bonus_quota 值
 * 最近一天的值已经包含了之前所有继承的值，所以直接取即可
 */
async function getLatestBonusQuota(userId: string, excludeDate: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const response = await fetch(
    `${supabaseUrl}/rest/v1/ai_chat_quota?user_id=eq.${userId}&date=neq.${excludeDate}&select=bonus_quota,date&order=date.desc&limit=1`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  const records = await response.json();
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  return records[0].bonus_quota || 0;
}

// 获取或创建今日配额（继承最近一天的 bonus_quota）
async function getOrCreateQuota(userId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const today = new Date().toISOString().split('T')[0];
  
  // 查询今日配额
  const quotaResponse = await fetch(
    `${supabaseUrl}/rest/v1/ai_chat_quota?user_id=eq.${userId}&date=eq.${today}&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  const quotas = await quotaResponse.json();
  
  if (quotas.length > 0) {
    return quotas[0];
  }

  // 创建新配额时，继承最近一天的 bonus_quota
  const latestBonus = await getLatestBonusQuota(userId, today);
  console.log(`[AI-AddBonus] Creating new daily quota for user ${userId}, carrying over latest bonus: ${latestBonus}`);

  const createResponse = await fetch(
    `${supabaseUrl}/rest/v1/ai_chat_quota`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        user_id: userId,
        date: today,
        base_quota: 10,
        bonus_quota: latestBonus,
        used_quota: 0
      })
    }
  );

  const newQuota = await createResponse.json();
  return newQuota[0];
}

// 添加奖励配额
async function addBonusQuota(userId: string, amount: number, reason: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const today = new Date().toISOString().split('T')[0];
  
  // 确保今日配额存在（会自动继承最近一天的bonus）
  await getOrCreateQuota(userId);
  
  // 使用 RPC 调用来原子性地增加 bonus_quota
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/increment_ai_quota_bonus`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_date: today,
        p_amount: amount
      })
    }
  );

  if (!response.ok) {
    // 如果 RPC 不存在，使用直接更新
    const quota = await getOrCreateQuota(userId);
    
    await fetch(
      `${supabaseUrl}/rest/v1/ai_chat_quota?id=eq.${quota.id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bonus_quota: quota.bonus_quota + amount
        })
      }
    );
  }

  console.log(`[AI-AddBonus] Added ${amount} bonus quota for user ${userId}, reason: ${reason}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { session_token, user_id, amount, reason } = body;

    console.log('[AI-AddBonus] Received request');

    // 验证参数
    if (!user_id) {
      throw new Error('缺少 user_id 参数');
    }

    if (!amount || typeof amount !== 'number' || amount < 1 || amount > 100) {
      throw new Error('amount 必须是 1-100 之间的数字');
    }

    // 如果有 session_token，验证调用者身份
    if (session_token) {
      await validateSession(session_token);
    }

    // 添加奖励配额
    await addBonusQuota(user_id, amount, reason || 'bonus');

    console.log('[AI-AddBonus] Success');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `成功添加 ${amount} 次 AI 对话奖励`
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    );

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[AI-AddBonus] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
    );
  }
});
