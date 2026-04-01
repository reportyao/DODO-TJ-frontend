import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// 通用的 session 验证函数
async function validateSession(sessionToken: string): Promise<{ userId: string }> {
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
    const body = await req.json()
    const { user_id, session_token } = body

    // 【安全修复】验证 session_token，确保只有本人可以查看自己的邀请数据
    if (!session_token) {
      return new Response(
        JSON.stringify({ success: false, error: '未授权：缺少 session_token', error_code: 'ERR_MISSING_SESSION' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { userId: authenticatedUserId } = await validateSession(session_token);

    // 确保请求的 user_id 与 session 中的 user_id 一致，防止越权访问
    const targetUserId = user_id || authenticatedUserId;
    if (targetUserId !== authenticatedUserId) {
      return new Response(
        JSON.stringify({ success: false, error: '未授权：无权查看他人数据' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('[GetInviteData] Fetching invite data for user:', targetUserId)

    // 维护一个已出现的用户ID集合，防止重复和自引用
    const appearedUserIds = new Set<string>()
    appearedUserIds.add(targetUserId) // 首先排除当前用户自己

    const allInvitedUsers: any[] = []

    // 1. 获取一级邀请用户（直接邀请）
    // 修复: 兼容 referred_by_id 和 referrer_id 两个字段，并排除当前用户
    const { data: level1Users, error: level1Error } = await supabase
      .from('users')
      .select('id, first_name, phone_number, avatar_url, created_at')
      .or(`referred_by_id.eq.${targetUserId},referrer_id.eq.${targetUserId}`)
      .neq('id', targetUserId) // 排除当前用户自己

    if (level1Error) {
      console.error('[GetInviteData] Level 1 query error:', level1Error)
      throw level1Error
    }

    console.log('[GetInviteData] Level 1 users:', level1Users?.length || 0)

    const level1Count = level1Users?.length || 0

    // 添加一级用户到结果，并记录到已出现集合
    if (level1Users && level1Users.length > 0) {
      level1Users.forEach(u => {
        // 再次检查，确保不是当前用户
        if (u.id !== targetUserId && !appearedUserIds.has(u.id)) {
          appearedUserIds.add(u.id)
          allInvitedUsers.push({
            id: u.id,
            phone_number: u.phone_number,
            first_name: u.first_name,
            avatar_url: u.avatar_url || null,
            created_at: u.created_at,
            level: 1,
            total_spent: 0,
            commission_earned: 0,
          })
        }
      })

      // 2. 获取二级邀请用户（一级用户邀请的用户）
      const level1Ids = Array.from(appearedUserIds).filter(id => id !== targetUserId)
      
      if (level1Ids.length > 0) {
        // 修复: 需要分别查询两个字段然后合并去重，并排除已出现的用户
        const appearedIdsArray = Array.from(appearedUserIds)
        
        const { data: level2ByReferred } = await supabase
          .from('users')
          .select('id, first_name, phone_number, avatar_url, created_at')
          .in('referred_by_id', level1Ids)
          .not('id', 'in', `(${appearedIdsArray.join(',')})`) // 排除已出现的用户
        
        const { data: level2ByReferrer } = await supabase
          .from('users')
          .select('id, first_name, phone_number, avatar_url, created_at')
          .in('referrer_id', level1Ids)
          .not('id', 'in', `(${appearedIdsArray.join(',')})`) // 排除已出现的用户
        
        // 合并并去重
        const level2Map = new Map()
        if (level2ByReferred) {
          level2ByReferred.forEach(u => {
            if (!appearedUserIds.has(u.id)) {
              level2Map.set(u.id, u)
            }
          })
        }
        if (level2ByReferrer) {
          level2ByReferrer.forEach(u => {
            if (!appearedUserIds.has(u.id)) {
              level2Map.set(u.id, u)
            }
          })
        }
        const level2Users = Array.from(level2Map.values())

        console.log('[GetInviteData] Level 2 users:', level2Users?.length || 0)
        
        // 添加二级用户到结果，并记录到已出现集合
        if (level2Users && level2Users.length > 0) {
          level2Users.forEach(u => {
            if (!appearedUserIds.has(u.id)) {
              appearedUserIds.add(u.id)
              allInvitedUsers.push({
                id: u.id,
                phone_number: u.phone_number,
                first_name: u.first_name,
                avatar_url: u.avatar_url || null,
                created_at: u.created_at,
                level: 2,
                total_spent: 0,
                commission_earned: 0,
              })
            }
          })

          // 3. 获取三级邀请用户（二级用户邀请的用户）
          const level2Ids = level2Users.map(u => u.id)
          
          if (level2Ids.length > 0) {
            // 修复: 需要分别查询两个字段然后合并去重，并排除已出现的用户
            const appearedIdsArray2 = Array.from(appearedUserIds)
            
            const { data: level3ByReferred } = await supabase
              .from('users')
              .select('id, first_name, phone_number, avatar_url, created_at')
              .in('referred_by_id', level2Ids)
              .not('id', 'in', `(${appearedIdsArray2.join(',')})`) // 排除已出现的用户
            
            const { data: level3ByReferrer } = await supabase
              .from('users')
              .select('id, first_name, phone_number, avatar_url, created_at')
              .in('referrer_id', level2Ids)
              .not('id', 'in', `(${appearedIdsArray2.join(',')})`) // 排除已出现的用户
            
            // 合并并去重
            const level3Map = new Map()
            if (level3ByReferred) {
              level3ByReferred.forEach(u => {
                if (!appearedUserIds.has(u.id)) {
                  level3Map.set(u.id, u)
                }
              })
            }
            if (level3ByReferrer) {
              level3ByReferrer.forEach(u => {
                if (!appearedUserIds.has(u.id)) {
                  level3Map.set(u.id, u)
                }
              })
            }
            const level3Users = Array.from(level3Map.values())

            console.log('[GetInviteData] Level 3 users:', level3Users?.length || 0)
            
            // 添加三级用户到结果，并记录到已出现集合
            if (level3Users && level3Users.length > 0) {
              level3Users.forEach(u => {
                if (!appearedUserIds.has(u.id)) {
                  appearedUserIds.add(u.id)
                  allInvitedUsers.push({
                    id: u.id,
                    phone_number: u.phone_number,
                    first_name: u.first_name,
                    avatar_url: u.avatar_url || null,
                    created_at: u.created_at,
                    level: 3,
                    total_spent: 0,
                    commission_earned: 0,
                  })
                }
              })
            }
          }
        }
      }
    }

    // 查询每个用户的消费总额和佣金收益
    if (allInvitedUsers.length > 0) {
      const userIds = allInvitedUsers.map(u => u.id)
      
      // 查询每个用户的订单总额（消费总额）
      // 1. 抽奖订单（orders表）
      const { data: ordersData } = await supabase
        .from('orders')
        .select('user_id, total_amount')
        .in('user_id', userIds)
        .in('status', ['COMPLETED', 'SHIPPED', 'DELIVERED', 'PENDING'])
      
      // 2. 拼团订单（group_buy_orders表）
      const { data: groupBuyOrdersData } = await supabase
        .from('group_buy_orders')
        .select('user_id, amount')
        .in('user_id', userIds)
        .in('status', ['PENDING', 'COMPLETED', 'TIMEOUT_REFUNDED'])
      
      // 3. 全款购买订单（full_purchase_orders表）
      const { data: fullPurchaseOrdersData } = await supabase
        .from('full_purchase_orders')
        .select('user_id, total_amount')
        .in('user_id', userIds)
        .in('status', ['PENDING', 'COMPLETED'])
      
      // 统计每个用户的消费总额
      const userSpending: Record<string, number> = {}
      
      // 统计抽奖订单
      if (ordersData) {
        ordersData.forEach(order => {
          if (!userSpending[order.user_id]) {
            userSpending[order.user_id] = 0
          }
          userSpending[order.user_id] += Number(order.total_amount)
        })
      }
      
      // 统计拼团订单
      if (groupBuyOrdersData) {
        groupBuyOrdersData.forEach(order => {
          if (!userSpending[order.user_id]) {
            userSpending[order.user_id] = 0
          }
          userSpending[order.user_id] += Number(order.amount)
        })
      }
      
      // 统计全款购买订单
      if (fullPurchaseOrdersData) {
        fullPurchaseOrdersData.forEach(order => {
          if (!userSpending[order.user_id]) {
            userSpending[order.user_id] = 0
          }
          userSpending[order.user_id] += Number(order.total_amount)
        })
      }
      
      // 查询当前用户从每个下级用户获得的佣金
      // 只统计已结算的佣金（status='settled'）
      const { data: commissionsData } = await supabase
        .from('commissions')
        .select('from_user_id, source_user_id, amount')
        .eq('user_id', targetUserId)
        .in('from_user_id', userIds)
        .eq('status', 'settled')
      
      // 统计每个用户贡献的佣金
      const userCommissions: Record<string, number> = {}
      if (commissionsData) {
        commissionsData.forEach(commission => {
          const sourceUserId = commission.from_user_id || commission.source_user_id
          if (sourceUserId) {
            if (!userCommissions[sourceUserId]) {
              userCommissions[sourceUserId] = 0
            }
            userCommissions[sourceUserId] += Number(commission.amount)
          }
        })
      }
      
      // 更新每个用户的消费和佣金数据
      allInvitedUsers.forEach(user => {
        user.total_spent = userSpending[user.id] || 0
        user.commission_earned = userCommissions[user.id] || 0
      })
    }
    
    // 统计各级用户数量
    const level2Count = allInvitedUsers.filter(u => u.level === 2).length
    const level3Count = allInvitedUsers.filter(u => u.level === 3).length
    const totalReferrals = level1Count + level2Count + level3Count

    console.log('[GetInviteData] Total referrals:', {
      level1: level1Count,
      level2: level2Count,
      level3: level3Count,
      total: totalReferrals
    })

    // 获取佣金数据
    const { data: commissionsData } = await supabase
      .from('commissions')
      .select('amount, status')
      .eq('user_id', targetUserId)

    const totalCommission = commissionsData?.reduce((sum, c) => sum + Number(c.amount), 0) || 0
    // settled = 已发放到积分钱包, pending = 待发放
    const paidCommission = commissionsData?.filter(c => c.status === 'settled').reduce((sum, c) => sum + Number(c.amount), 0) || 0
    const pendingCommission = commissionsData?.filter(c => c.status === 'pending').reduce((sum, c) => sum + Number(c.amount), 0) || 0

    /**
     * 获取用户积分钱包余额（佣金奖励发放到 LUCKY_COIN 积分钱包）
     */
    const { data: walletData } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', targetUserId)
      .eq('type', 'LUCKY_COIN')
      .eq('currency', 'POINTS')
      .single()

    const bonusBalance = walletData?.balance || 0

    const stats = {
      total_invites: level1Count,
      total_referrals: totalReferrals,
      level1_referrals: level1Count,
      level2_referrals: level2Count,
      level3_referrals: level3Count,
      total_commission: totalCommission,
      pending_commission: pendingCommission,
      paid_commission: paidCommission,
      bonus_balance: bonusBalance,
    }

    console.log('[GetInviteData] Stats:', stats)
    console.log('[GetInviteData] Unique users returned:', allInvitedUsers.length)

    return new Response(
      JSON.stringify({ 
        success: true, 
        stats, 
        invited_users: allInvitedUsers 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[GetInviteData] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errMsg, error_code: 'ERR_SERVER_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
