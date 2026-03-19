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
  const now = new Date();
  
  if (expiresAt < now) {
    throw new Error('未授权：会话已过期');
  }

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

/**
 * 延长提货码有效期
 * 支持两种类型：
 * - lottery: 积分商城中奖（prizes表）
 * - group_buy: 拼团中奖（group_buy_results表）
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { session_token, prize_id, order_type = 'lottery' } = body

    console.log('[ExtendPickup] Received request:', { 
      prize_id,
      order_type,
      session_token: session_token ? 'present' : 'missing'
    });

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    if (!prize_id) {
      throw new Error('缺少奖品ID');
    }

    // 验证用户 session
    const { userId } = await validateSession(session_token);
    
    console.log('[ExtendPickup] User validated:', { userId });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let prize: any = null;
    let tableName: string;
    let userIdField: string;
    let userIdValue: string;

    // 根据order_type确定表名和用户ID字段
    if (order_type === 'group_buy') {
      tableName = 'group_buy_results';
      userIdField = 'winner_id';
      userIdValue = userId; // 【迁移修复】统一使用 UUID
    } else {
      tableName = 'prizes';
      userIdField = 'user_id';
      userIdValue = userId; // 积分商城使用users.id
    }

    // 1. 验证奖品是否属于该用户
    const { data: prizeData, error: prizeError } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', prize_id)
      .eq(userIdField, userIdValue)
      .single();

    if (prizeError || !prizeData) {
      console.error('[ExtendPickup] Prize not found:', prizeError);
      throw new Error('奖品不存在或不属于您');
    }

    prize = prizeData;

    // 2. 检查是否已经提货
    if (prize.pickup_status === 'PICKED_UP') {
      throw new Error('该奖品已提货，无需延期');
    }

    // 3. 检查是否有提货码
    if (!prize.pickup_code) {
      throw new Error('请先确认领取奖品');
    }

    // 4. 计算新的过期时间（在当前过期时间基础上延长30天）
    let newExpiresAt: Date;
    if (prize.expires_at) {
      newExpiresAt = new Date(prize.expires_at);
    } else {
      newExpiresAt = new Date();
    }
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    // 5. 更新过期时间
    const { data: updatedPrize, error: updateError } = await supabase
      .from(tableName)
      .update({
        expires_at: newExpiresAt.toISOString(),
        pickup_status: 'PENDING_PICKUP', // 如果之前是EXPIRED，重置为PENDING_PICKUP
      })
      .eq('id', prize_id)
      .select()
      .single();

    if (updateError) {
      console.error('[ExtendPickup] Update error:', updateError);
      throw new Error('延期失败');
    }

    // 6. 记录操作日志
    const { error: logError } = await supabase
      .from('pickup_logs')
      .insert({
        prize_id: prize_id,
        pickup_code: prize.pickup_code,
        pickup_point_id: prize.pickup_point_id,
        operation_type: 'EXTEND',
        notes: `用户申请延期${order_type === 'group_buy' ? '拼团' : '积分商城'}奖品，新过期时间：${newExpiresAt.toISOString()}`,
      });

    if (logError) {
      console.error('[ExtendPickup] Log error:', logError);
      // 不影响主流程，继续
    }

    console.log('[ExtendPickup] Success:', { newExpiresAt });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          expires_at: newExpiresAt.toISOString(),
          message: '延期成功，有效期延长30天'
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ExtendPickup] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
