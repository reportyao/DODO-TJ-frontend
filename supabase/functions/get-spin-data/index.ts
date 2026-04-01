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

/** 根据错误消息映射到标准化错误码 */
function mapErrorCode(msg: string): string {
  if (msg.includes('服务器配置错误')) return 'ERR_SERVER_CONFIG';
  if (msg.includes('缺少必要参数')) return 'ERR_PARAMS_MISSING';
  if (msg.includes('数量无效')) return 'ERR_QUANTITY_INVALID';
  if (msg.includes('未授权：缺少会话令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('未授权：缺少 session_token')) return 'ERR_MISSING_SESSION';
  if (msg.includes('未授权：缺少认证令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('未授权：无效的会话令牌')) return 'ERR_INVALID_TOKEN';
  if (msg.includes('未授权：无效的认证令牌')) return 'ERR_INVALID_TOKEN';
  if (msg.includes('未授权：会话不存在或已过期')) return 'ERR_INVALID_SESSION';
  if (msg.includes('未授权：会话不存在或已失效')) return 'ERR_INVALID_SESSION';
  if (msg.includes('未授权：会话已过期')) return 'ERR_SESSION_EXPIRED';
  if (msg.includes('未授权：用户不存在')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('验证会话失败')) return 'ERR_SESSION_VALIDATE_FAILED';
  if (msg.includes('用户不存在')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('商品不存在')) return 'ERR_PRODUCT_NOT_FOUND';
  if (msg.includes('库存不足')) return 'ERR_OUT_OF_STOCK';
  if (msg.includes('价格配置无效')) return 'ERR_PRICE_CONFIG_INVALID';
  if (msg.includes('余额不足')) return 'ERR_INSUFFICIENT_BALANCE';
  if (msg.includes('积分余额不足')) return 'ERR_INSUFFICIENT_POINTS';
  if (msg.includes('未找到用户钱包')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('获取钱包信息失败')) return 'ERR_WALLET_INFO_FAILED';
  if (msg.includes('冻结余额失败')) return 'ERR_FREEZE_BALANCE_FAILED';
  if (msg.includes('创建提现请求失败')) return 'ERR_WITHDRAW_CREATE_FAILED';
  if (msg.includes('充值金额必须大于0')) return 'ERR_DEPOSIT_AMOUNT_INVALID';
  if (msg.includes('提现金额必须大于0')) return 'ERR_WITHDRAW_AMOUNT_INVALID';
  if (msg.includes('金额必须大于0')) return 'ERR_AMOUNT_INVALID';
  if (msg.includes('兑换金额必须大于0')) return 'ERR_EXCHANGE_AMOUNT_INVALID';
  if (msg.includes('无效的兑换类型')) return 'ERR_EXCHANGE_TYPE_INVALID';
  if (msg.includes('未找到源钱包')) return 'ERR_SOURCE_WALLET_NOT_FOUND';
  if (msg.includes('未找到目标钱包')) return 'ERR_TARGET_WALLET_NOT_FOUND';
  if (msg.includes('源钱包和目标钱包类型必须不同')) return 'ERR_SAME_WALLET_TYPE';
  if (msg.includes('票据不存在或不属于您')) return 'ERR_TICKET_NOT_FOUND';
  if (msg.includes('该票据已在转售中')) return 'ERR_TICKET_ALREADY_RESALE';
  if (msg.includes('转售商品不存在')) return 'ERR_RESALE_ITEM_NOT_FOUND';
  if (msg.includes('该商品已下架或已售出')) return 'ERR_RESALE_ITEM_UNAVAILABLE';
  if (msg.includes('不能购买自己的商品')) return 'ERR_CANNOT_BUY_OWN';
  if (msg.includes('未找到奖品记录')) return 'ERR_PRIZE_NOT_FOUND';
  if (msg.includes('您不是该抽奖的中奖者')) return 'ERR_NOT_WINNER';
  if (msg.includes('创建奖品记录失败')) return 'ERR_PRIZE_CREATE_FAILED';
  if (msg.includes('生成提货码失败')) return 'ERR_PICKUP_CODE_FAILED';
  if (msg.includes('您不是地推人员')) return 'ERR_NOT_PROMOTER';
  if (msg.includes('您的地推人员账号未激活')) return 'ERR_PROMOTER_INACTIVE';
  if (msg.includes('自提点不存在或不可用')) return 'ERR_PICKUP_POINT_NOT_FOUND';
  if (msg.includes('搜索关键词不能为空')) return 'ERR_SEARCH_KEYWORD_EMPTY';
  if (msg.includes('记录不存在或不属于您')) return 'ERR_RECORD_NOT_FOUND';
  if (msg.includes('卖家钱包不存在')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('买家钱包不存在')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('源钱包不存在')) return 'ERR_SOURCE_WALLET_NOT_FOUND';
  if (msg.includes('目标钱包不存在')) return 'ERR_TARGET_WALLET_NOT_FOUND';
  if (msg.includes('缺少转售商品ID')) return 'ERR_RESALE_ID_MISSING';
  if (msg.includes('缺少会话令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('目标用户ID不能为空')) return 'ERR_PARAMS_MISSING';
  if (msg.includes('获取用户信息失败')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('钱包版本冲突')) return 'ERR_CONCURRENT_OPERATION';
  if (msg.includes('扣除余额失败')) return 'ERR_FREEZE_BALANCE_FAILED';
  if (msg.includes('增加卖家余额失败')) return 'ERR_SERVER_ERROR';
  if (msg.includes('兑换操作失败')) return 'ERR_EXCHANGE_FAILED';
  if (msg.includes('兑换操作缺少目标钱包类型')) return 'ERR_EXCHANGE_WALLET_MISSING';
  if (msg.includes('无效的目标钱包类型')) return 'ERR_EXCHANGE_WALLET_MISSING';
  if (msg.includes('无效的操作')) return 'ERR_INVALID_ACTION';
  if (msg.includes('操作失败')) return 'ERR_CONCURRENT_OPERATION';
  return 'ERR_SERVER_ERROR';
}


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
