import { mapErrorCode } from '../_shared/errorResponse.ts'
/**
 * 获取抽奖数据 Edge Function
 * 
 * 功能：
 * 1. 获取用户抽奖次数
 * 2. 获取奖池配置
 * 3. 获取用户邀请记录
 * 4. 获取用户抽奖历史
 * 
 * 请求参数：
 * - user_id: 用户ID
 * 
 * 返回：
 * - spin_balance: 抽奖次数信息
 * - rewards: 奖池配置
 * - invite_records: 邀请记录
 * - spin_history: 抽奖历史
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

// mapErrorCode 已迁移到共享模块


  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase configuration');
    }

    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. 获取用户抽奖次数
    const spinBalanceResponse = await fetch(
      `${supabaseUrl}/rest/v1/user_spin_balance?user_id=eq.${user_id}&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const spinBalanceData = await spinBalanceResponse.json();
    const spinBalance = spinBalanceData.length > 0 ? spinBalanceData[0] : {
      spin_count: 0,
      total_earned: 0,
      total_used: 0
    };

    // 2. 获取奖池配置
    const rewardsResponse = await fetch(
      `${supabaseUrl}/rest/v1/spin_rewards?is_active=eq.true&order=display_order.asc&select=id,reward_name,reward_name_i18n,reward_type,reward_amount,display_order,is_jackpot`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const rewards = await rewardsResponse.json();

    // 3. 获取用户邀请记录（被邀请人信息）
    // 修复: 同时查询 referred_by_id 和 referrer_id 以兼容旧数据
    const inviteRecordsResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?or=(referred_by_id.eq.${user_id},referrer_id.eq.${user_id})&select=id,phone_number,first_name,created_at&order=created_at.desc&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const invitedUsersRaw = await inviteRecordsResponse.json();
    
    // 去重（以防两个字段都有值时重复返回）
    const seenIds = new Set<string>();
    const invitedUsers = invitedUsersRaw.filter((u: any) => {
      if (seenIds.has(u.id)) return false;
      seenIds.add(u.id);
      return true;
    });

    // 4. 获取邀请奖励记录
    const inviteRewardsResponse = await fetch(
      `${supabaseUrl}/rest/v1/invite_rewards?inviter_id=eq.${user_id}&select=*&order=created_at.desc&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const inviteRewards = await inviteRewardsResponse.json();

    // 5. 获取用户抽奖历史（最近20条）
    const spinHistoryResponse = await fetch(
      `${supabaseUrl}/rest/v1/spin_records?user_id=eq.${user_id}&select=*&order=created_at.desc&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const spinHistory = await spinHistoryResponse.json();

    // 6. 获取用户的邀请码
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${user_id}&select=referral_code`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const userData = await userResponse.json();
    const referralCode = userData.length > 0 ? userData[0].referral_code : '';

    // 7. 统计邀请数据
    const totalInvited = invitedUsers.length || 0;
    const totalSpinsFromInvites = inviteRewards
      .filter((r: any) => r.reward_type === 'new_user_register')
      .reduce((sum: number, r: any) => sum + (r.spin_count_awarded || 0), 0);
    const totalSpinsFromGroupBuy = inviteRewards
      .filter((r: any) => r.reward_type === 'first_group_buy')
      .reduce((sum: number, r: any) => sum + (r.spin_count_awarded || 0), 0);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          spin_balance: {
            spin_count: spinBalance.spin_count,
            total_earned: spinBalance.total_earned,
            total_used: spinBalance.total_used
          },
          rewards: rewards,
          referral_code: referralCode,
          invite_stats: {
            total_invited: totalInvited,
            total_spins_from_invites: totalSpinsFromInvites,
            total_spins_from_group_buy: totalSpinsFromGroupBuy
          },
          invite_records: invitedUsers.map((user: any) => ({
            id: user.id,
            username: user.first_name || (user.phone_number ? user.phone_number.slice(0, 3) + '****' + user.phone_number.slice(-4) : '用户'),
            created_at: user.created_at,
            status: 'registered'
          })),
          spin_history: spinHistory.map((record: any) => ({
            id: record.id,
            reward_name: record.reward_name,
            reward_amount: record.reward_amount,
            is_winner: record.is_winner,
            created_at: record.created_at
          }))
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Get spin data error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errMsg || 'Internal server error', error_code: mapErrorCode(errMsg || '')
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
