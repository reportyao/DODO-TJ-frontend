/**
 * ============================================================
 * exchange-balance Edge Function（余额兑换积分）
 * ============================================================
 * 
 * 功能：用户将现金余额(TJS)兑换为积分(LUCKY_COIN)
 * 
 * 核心流程：
 *   1. 验证用户会话 (session_token)
 *   2. 调用 exchange_balance_atomic RPC 事务函数
 *   3. 事务内完成：扣减现金 + 增加积分 + 记录流水
 * 
 * 安全机制：
 *   - exchange_balance_atomic 使用 FOR UPDATE 行锁防止并发
 *   - 可用余额 = balance - frozen_balance，不会兑换冻结金额
 *   - 兑换比例 1:1（TJS → LUCKY_COIN）
 * 
 * 触发器：
 *   - 兑换成功后会触发 trigger_commission_for_exchange
 *   - 自动给上级推荐人发放佣金
 * ============================================================
 */

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

  // 查询 user_sessions 表验证 session (不使用关联查询避免类型冲突)
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
    // 从 body 中获取 session_token 和 amount
    const body = await req.json()
    const { session_token, amount } = body

    console.log('[Exchange] Received request:', { session_token: session_token ? 'present' : 'missing', amount });

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    if (!amount || amount <= 0) {
      throw new Error('兑换金额必须大于0');
    }

    // 验证用户 session
    const { userId } = await validateSession(session_token);
    
    console.log('[Exchange] User validated:', userId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // 创建 Supabase 客户端
    const supabaseClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // ========== 调用原子化 RPC 函数 ==========
    // 替代原来的多步操作，使用数据库事务保证原子性
    const { data: result, error: rpcError } = await supabaseClient
      .rpc('exchange_balance_atomic', {
        p_user_id: userId,
        p_amount: amount
      });

    if (rpcError) {
      console.error('[Exchange] RPC error:', rpcError);
      throw new Error('兑换操作失败，请稍后重试');
    }

    if (!result.success) {
      console.error('[Exchange] RPC returned error:', result.error);
      throw new Error(result.error);
    }

    console.log('[Exchange] Success via RPC, new balances:', {
      source: result.new_balance,
      target: result.lucky_coin_balance
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: '兑换成功',
        new_balance: result.new_balance,
        lucky_coin_balance: result.lucky_coin_balance
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Exchange] Error:', error)
    const errorMessage = errMsg || '兑换失败，请稍后重试';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    )
  }
})
