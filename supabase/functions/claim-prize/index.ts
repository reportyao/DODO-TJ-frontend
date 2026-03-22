/**
 * ============================================================
 * claim-prize Edge Function（奖品领取）
 * ============================================================
 * 
 * 功能：用户领取中奖奖品，生成提货码
 * 
 * 支持的订单类型：
 *   - lottery: 抽奖中奖（prizes 表）
 *   - group_buy: 拼团中奖（group_buy_results 表）
 *   - full_purchase: 全额购买（full_purchase_orders 表）
 * 
 * 核心流程：
 *   1. 验证用户会话
 *   2. 查找奖品记录并验证归属
 *   3. 生成唯一的6位数字提货码
 *   4. 更新状态为 CLAIMED + PENDING_PICKUP
 *   5. 记录提货日志
 * 
 * 幂等性：
 *   - 已领取的奖品会直接返回已有的提货码
 *   - 提货码跨三张表全局唯一
 * ============================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// ============================================
// 数据验证工具函数
// ============================================

/**
 * 验证表记录的字段完整性
 */
function validatePrizeFields(prize: any, tableName: string): void {
  const requiredFieldsMap: Record<string, string[]> = {
    'prizes': ['id', 'user_id', 'lottery_id'],
    'group_buy_results': ['id', 'winner_id', 'session_id', 'product_id'],
    'full_purchase_orders': ['id', 'user_id', 'lottery_id'],
  };
  const requiredFields = requiredFieldsMap[tableName] || ['id'];
  
  for (const field of requiredFields) {
    if (!(field in prize)) {
      throw new Error(`数据库错误: ${tableName}表缺少必需字段 ${field}`);
    }
  }
}

/**
 * 验证状态一致性
 */
function validateStatusConsistency(prize: any): void {
  const { pickup_status, pickup_code } = prize;
  if (pickup_code && pickup_status === 'PENDING_CLAIM') {
    console.warn('[Validation] 状态不一致: 已有pickup_code但pickup_status=PENDING_CLAIM');
  }
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

// 生成唯一的6位数字提货码
async function generatePickupCode(supabase: any): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    const { data: ep } = await supabase.from('prizes').select('id').eq('pickup_code', code).maybeSingle();
    const { data: eg } = await supabase.from('group_buy_results').select('id').eq('pickup_code', code).maybeSingle();
    const { data: ef } = await supabase.from('full_purchase_orders').select('id').eq('pickup_code', code).maybeSingle();
    
    if (!ep && !eg && !ef) return code;
    attempts++;
  }
  throw new Error('生成提货码失败，请重试');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { session_token, prize_id, lottery_id, order_type = 'lottery', pickup_point_id } = body

    console.log('[ClaimPrize] Request:', { prize_id, lottery_id, order_type, pickup_point_id });

    if (!session_token) throw new Error('缺少会话令牌');
    const { userId } = await validateSession(session_token);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let tableName: string;
    let userIdField: string;

    if (order_type === 'group_buy') {
      tableName = 'group_buy_results';
      userIdField = 'winner_id';
    } else if (order_type === 'full_purchase') {
      tableName = 'full_purchase_orders';
      userIdField = 'user_id';
    } else {
      tableName = 'prizes';
      userIdField = 'user_id';
    }

    let prizeData;
    if (prize_id) {
      const { data, error } = await supabase.from(tableName).select('*').eq('id', prize_id).eq(userIdField, userId).single();
      prizeData = data;
      if (error) throw new Error('未找到奖品记录');
    } else if (lottery_id) {
      const { data, error } = await supabase.from(tableName).select('*').eq('lottery_id', lottery_id).eq(userIdField, userId).maybeSingle();
      prizeData = data;
      
      if (!prizeData && !error && order_type === 'lottery') {
        const { data: lot } = await supabase.from('lotteries').select('*').eq('id', lottery_id).single();
        if (!lot || lot.winner_id !== userId) throw new Error('您不是该抽奖的中奖者');
        
        const { data: np, error: ce } = await supabase.from('prizes').insert({
          user_id: userId,
          lottery_id: lottery_id,
          status: 'PENDING',
          pickup_status: 'PENDING_CLAIM'
        }).select().single();
        if (ce) throw new Error('创建奖品记录失败');
        prizeData = np;
      }
    }

    if (!prizeData) throw new Error('记录不存在或不属于您');
    validatePrizeFields(prizeData, tableName);
    validateStatusConsistency(prizeData);

    if (prizeData.pickup_code) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          pickup_code: prizeData.pickup_code,
          expires_at: prizeData.expires_at,
          pickup_point_id: prizeData.pickup_point_id,
          message: '您已领取过该奖品'
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (prizeData.pickup_status && prizeData.pickup_status !== 'PENDING_CLAIM') {
      throw new Error(`当前状态不允许领取: ${prizeData.pickup_status}`);
    }

    if (pickup_point_id) {
      const { data: pp } = await supabase.from('pickup_points').select('id, status').eq('id', pickup_point_id).single();
      if (!pp || pp.status !== 'ACTIVE') throw new Error('自提点不存在或不可用');
    }

    const pickupCode = await generatePickupCode(supabase);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const updateData: any = {
      pickup_code: pickupCode,
      pickup_status: 'PENDING_PICKUP',
      pickup_point_id: pickup_point_id || prizeData.pickup_point_id || null,
      expires_at: expiresAt.toISOString(),
      claimed_at: new Date().toISOString(),
      status: 'CLAIMED',
    };

    const { data: ur, error: ue } = await supabase.from(tableName).update(updateData).eq('id', prizeData.id).select().single();
    if (ue) throw new Error(`更新状态失败: ${ue.message}`);

    await supabase.from('pickup_logs').insert({
      prize_id: prizeData.id,
      pickup_code: pickupCode,
      pickup_point_id: updateData.pickup_point_id,
      operation_type: 'CLAIM',
      order_type: order_type,
      operator_id: userId,
      notes: `用户领取${order_type === 'group_buy' ? '拼团' : (order_type === 'full_purchase' ? '全额购买' : '积分商城')}奖品`,
    });

    let ppd = null;
    if (updateData.pickup_point_id) {
      const { data: pd } = await supabase.from('pickup_points').select('*').eq('id', updateData.pickup_point_id).single();
      ppd = pd;
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        pickup_code: pickupCode,
        expires_at: expiresAt.toISOString(),
        pickup_point_id: updateData.pickup_point_id,
        pickup_point: ppd,
        status: ur?.status,
        pickup_status: ur?.pickup_status,
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})
