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
 * 验证prizes表记录的字段完整性
 */
function validatePrizeFields(prize: any, tableName: string): void {
  // 根据表名使用不同的必需字段列表
  // prizes 表使用 user_id + lottery_id
  // group_buy_results 表使用 winner_id + session_id + product_id
  const requiredFieldsMap: Record<string, string[]> = {
    'prizes': ['id', 'user_id', 'lottery_id'],
    'group_buy_results': ['id', 'winner_id', 'session_id', 'product_id'],
  };
  const requiredFields = requiredFieldsMap[tableName] || ['id'];
  const pickupFields = ['pickup_code', 'pickup_status', 'pickup_point_id', 'expires_at', 'claimed_at'];
  
  // 检查必需字段
  for (const field of requiredFields) {
    if (!(field in prize)) {
      throw new Error(`数据库错误: ${tableName}表缺少必需字段 ${field}`);
    }
  }
  
  // 检查提货相关字段（这些是我们刚添加的）
  for (const field of pickupFields) {
    if (!(field in prize)) {
      console.warn(`[Validation] ${tableName}表缺少字段 ${field}，可能需要执行数据库迁移`);
    }
  }
}

/**
 * 验证状态一致性
 * status: 业务流程状态 (PENDING, SHIPPING, DELIVERED, RESELLING)
 * pickup_status: 提货流程状态 (PENDING_CLAIM, PENDING_PICKUP, PICKED_UP, EXPIRED)
 */
function validateStatusConsistency(prize: any): void {
  const { status, pickup_status, pickup_code } = prize;
  
  // 规则1: 如果已提货，status应该更新
  if (pickup_status === 'PICKED_UP' && status === 'PENDING') {
    console.warn('[Validation] 状态不一致: pickup_status=PICKED_UP 但 status=PENDING');
  }
  
  // 规则2: 如果有提货码，pickup_status不应该是PENDING_CLAIM
  if (pickup_code && pickup_status === 'PENDING_CLAIM') {
    console.warn('[Validation] 状态不一致: 已有pickup_code但pickup_status=PENDING_CLAIM');
  }
  
  // 规则3: 如果选择发货，不应该有提货相关信息
  if (status === 'SHIPPING' && pickup_code) {
    console.warn('[Validation] 状态不一致: status=SHIPPING但有pickup_code');
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

// 生成唯一的6位数字提货码
async function generatePickupCode(supabase: any): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    // 生成6位随机数字
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 检查是否在prizes表中已存在
    const { data: existingPrize } = await supabase
      .from('prizes')
      .select('id')
      .eq('pickup_code', code)
      .single();
    
    // 检查是否在group_buy_results表中已存在
    const { data: existingGroupBuy } = await supabase
      .from('group_buy_results')
      .select('id')
      .eq('pickup_code', code)
      .single();
    
    // 检查是否在full_purchase_orders表中已存在
    const { data: existingFullPurchase } = await supabase
      .from('full_purchase_orders')
      .select('id')
      .eq('pickup_code', code)
      .single();
    
    if (!existingPrize && !existingGroupBuy && !existingFullPurchase) {
      return code;
    }
    
    attempts++;
  }
  
  throw new Error('生成提货码失败，请重试');
}

/**
 * 用户确认领取奖品，生成提货码
 * 支持两种类型：
 * - lottery: 积分商城中奖（prizes表）
 * - group_buy: 拼团中奖（group_buy_results表）
 * 
 * ✨ 优化点：
 * 1. 添加了字段完整性验证
 * 2. 添加了状态一致性检查
 * 3. 改进了错误处理和日志
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { session_token, prize_id, lottery_id, order_type = 'lottery', pickup_point_id } = body

    console.log('[ClaimPrize] Received request:', { 
      prize_id,
      lottery_id,
      order_type,
      pickup_point_id,
      session_token: session_token ? 'present' : 'missing'
    });

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    if (!prize_id && !lottery_id) {
      throw new Error('缺少奖品ID或抽奖ID');
    }

    // 验证用户 session
    const { userId } = await validateSession(session_token);
    
    console.log('[ClaimPrize] User validated:', { userId });

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
      userIdValue = userId; // 拼团优先使用UUID
    } else {
      tableName = 'prizes';
      userIdField = 'user_id';
      userIdValue = userId; // 积分商城使用users.id
    }

    // 1. 验证奖品是否属于该用户
    let prizeData;
    let prizeError;
    
    if (prize_id) {
      // 如果有 prize_id，直接查询
      // 【迁移修复】统一使用 UUID 匹配，不再兼容 telegram_id
      const result = await supabase
        .from(tableName)
        .select('*')
        .eq('id', prize_id)
        .eq(userIdField, userIdValue)
        .single();
      prizeData = result.data;
      prizeError = result.error;
    } else if (lottery_id) {
      // 如果只有 lottery_id，通过 lottery_id 查找
      // 【迁移修复】统一使用 UUID 匹配
      const result = await supabase
        .from(tableName)
        .select('*')
        .eq('lottery_id', lottery_id)
        .eq(userIdField, userIdValue)
        .maybeSingle();
      prizeData = result.data;
      prizeError = result.error;
      
      // 如果没有找到，需要创建一个新的 prize 记录
      if (!prizeData && !prizeError) {
        console.log('[ClaimPrize] Prize not found, creating new prize record');
        
        // 查询 lottery 信息确认用户是中奖者
        const { data: lotteryData, error: lotteryError } = await supabase
          .from('lotteries')
          .select('*')
          .eq('id', lottery_id)
          .single();
        
        if (lotteryError || !lotteryData) {
          throw new Error('抽奖不存在');
        }
        
        if (lotteryData.winning_user_id !== userId) {
          throw new Error('您不是该抽奖的中奖者');
        }
        
        // 创建新的 prize 记录
        const { data: newPrize, error: createError } = await supabase
          .from(tableName)
          .insert({
            user_id: userId,
            lottery_id: lottery_id,
            status: 'PENDING',
            pickup_status: 'PENDING_CLAIM',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (createError || !newPrize) {
          console.error('[ClaimPrize] Failed to create prize:', createError);
          throw new Error('创建奖品记录失败');
        }
        
        prizeData = newPrize;
        console.log('[ClaimPrize] Created new prize:', prizeData.id);
      }
    }

    if (prizeError || !prizeData) {
      console.error('[ClaimPrize] Prize not found:', prizeError);
      throw new Error('奖品不存在或不属于您');
    }

    prize = prizeData;

    // ✨ 新增：验证字段完整性
    try {
      validatePrizeFields(prize, tableName);
    } catch (validationError: unknown) {
      console.error('[ClaimPrize] Field validation failed:', validationError);
      throw validationError;
    }

    // ✨ 新增：验证状态一致性
    validateStatusConsistency(prize);

    // 2. 检查是否已经领取过
    if (prize.pickup_code) {
      console.log('[ClaimPrize] Prize already claimed');
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            pickup_code: prize.pickup_code,
            expires_at: prize.expires_at,
            pickup_point_id: prize.pickup_point_id,
            message: '您已领取过该奖品'
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // 3. 检查状态是否允许领取
    if (prize.pickup_status && prize.pickup_status !== 'PENDING_CLAIM') {
      throw new Error(`该奖品当前状态不允许领取 (当前状态: ${prize.pickup_status})`);
    }

    // ✨ 新增：检查status字段
    if (prize.status && !['PENDING', 'WON'].includes(prize.status)) {
      console.warn(`[ClaimPrize] Unusual prize status: ${prize.status}`);
    }

    // 4. 验证自提点是否存在
    if (pickup_point_id) {
      const { data: pickupPoint, error: pointError } = await supabase
        .from('pickup_points')
        .select('id, status')
        .eq('id', pickup_point_id)
        .single();

      if (pointError || !pickupPoint) {
        throw new Error('自提点不存在');
      }

      if (pickupPoint.status !== 'ACTIVE') {
        throw new Error('该自提点当前不可用');
      }
    }

    // 5. 生成提货码
    const pickupCode = await generatePickupCode(supabase);
    
    // 6. 设置过期时间（30天后）
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // 7. 更新奖品记录
    const updateData: any = {
      pickup_code: pickupCode,
      pickup_status: 'PENDING_PICKUP',
      pickup_point_id: pickup_point_id || null,
      expires_at: expiresAt.toISOString(),
      claimed_at: new Date().toISOString(),
      // ✨ 修复：同时更新 status 为 CLAIMED，这样管理后台的订单发货页面才能查询到
      status: 'CLAIMED',
    };

    console.log('[ClaimPrize] Updating prize status to CLAIMED and pickup_status to PENDING_PICKUP');

    const { data: updatedPrize, error: updateError } = await supabase
      .from(tableName)
      .update(updateData)
      .eq('id', prize.id)
      .select()
      .single();

    if (updateError) {
      console.error('[ClaimPrize] Update error:', updateError);
      throw new Error(`更新奖品状态失败: ${updateError.message}`);
    }

    // ✨ 新增：验证更新后的状态
    if (updatedPrize) {
      validateStatusConsistency(updatedPrize);
    }

    // 8. 记录操作日志
    const { error: logError } = await supabase
      .from('pickup_logs')
      .insert({
        prize_id: prize.id,
        pickup_code: pickupCode,
        pickup_point_id: pickup_point_id || null,
        operation_type: 'CLAIM',
        order_type: order_type,
        operator_id: userId,
        notes: `用户确认领取${order_type === 'group_buy' ? '拼团' : '积分商城'}奖品，生成提货码`,
      });

    if (logError) {
      console.error('[ClaimPrize] Log error:', logError);
      // 不影响主流程，继续
    }

    // 9. 获取自提点详情（如果有）
    let pickupPointDetails = null;
    if (pickup_point_id) {
      const { data: pointData } = await supabase
        .from('pickup_points')
        .select('id, name, name_i18n, address, address_i18n, contact_phone, business_hours')
        .eq('id', pickup_point_id)
        .single();
      pickupPointDetails = pointData;
    }

    console.log('[ClaimPrize] Success:', { pickupCode, expiresAt, status: updatedPrize?.status, pickup_status: updatedPrize?.pickup_status });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          pickup_code: pickupCode,
          expires_at: expiresAt.toISOString(),
          pickup_point_id: pickup_point_id,
          pickup_point: pickupPointDetails,
          claimed_at: new Date().toISOString(),
          status: updatedPrize?.status,
          pickup_status: updatedPrize?.pickup_status,
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ClaimPrize] Error:', error);
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
