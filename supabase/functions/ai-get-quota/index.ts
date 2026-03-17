import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-customer-header',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// 验证session
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
 * 获取最近一天的 bonus_quota 值（不是求和，而是取最近一天的值）
 * 因为每天的 bonus_quota 已经包含了之前继承的值 + 当天新增的奖励
 * 所以最近一天的值就是正确的累计值
 */
async function getLatestBonusQuota(userId: string, excludeDate: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // 查询该用户最近一天（排除今天）的 bonus_quota，按日期降序取第一条
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

  // 取最近一天的 bonus_quota 值
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
  console.log(`[AI-GetQuota] Creating new daily quota for user ${userId}, carrying over latest bonus: ${latestBonus}`);

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let session_token;
    try {
      const body = await req.json();
      session_token = body.session_token;
    } catch (e: unknown) {
      // 兼容某些请求可能不带body的情况
      console.warn('[AI-GetQuota] Failed to parse JSON body');
    }

    console.log('[AI-GetQuota] Received request');

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    // 1. 验证用户
    const { userId } = await validateSession(session_token);
    console.log('[AI-GetQuota] User validated:', userId);

    // 2. 获取配额
    const quota = await getOrCreateQuota(userId);
    
    const totalQuota = quota.base_quota + quota.bonus_quota;
    const remainingQuota = Math.max(0, totalQuota - quota.used_quota);

    console.log('[AI-GetQuota] Success:', { totalQuota, remainingQuota, bonus: quota.bonus_quota });

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: {
          total_quota: totalQuota,
          used_quota: quota.used_quota,
          remaining_quota: remainingQuota,
          base_quota: quota.base_quota,
          bonus_quota: quota.bonus_quota
        }
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    );

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[AI-GetQuota] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
    );
  }
});
