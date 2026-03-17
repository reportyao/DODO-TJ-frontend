/**
 * 处理首次拼团奖励 Edge Function
 * 
 * 功能：
 * 当用户首次完成拼团支付后，给其邀请人增加2次抽奖机会
 * 
 * 触发时机：
 * 在拼团支付成功后调用此函数
 * 
 * 请求参数：
 * - user_id: 完成拼团的用户ID
 * - order_id: 拼团订单ID（可选，用于防重复）
 * 
 * 返回：
 * - success: 是否成功
 * - is_first_group_buy: 是否为首次拼团
 * - inviter_rewarded: 邀请人是否获得奖励
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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase configuration');
    }

    const { user_id, order_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. 检查用户是否有邀请人
    // 修复: 同时查询 referred_by_id 和 referrer_id 以兼容旧数据
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${user_id}&select=id,referred_by_id,referrer_id`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const userData = await userResponse.json();

    if (!userData || userData.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'User not found'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const user = userData[0];
    // 优先使用 referred_by_id，如果为空则使用 referrer_id
    const inviterId = user.referred_by_id || user.referrer_id;

    // 如果没有邀请人，直接返回
    if (!inviterId) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          is_first_group_buy: false,
          inviter_rewarded: false,
          message: 'User has no inviter'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. 检查是否已经发放过首次拼团奖励
    const existingRewardResponse = await fetch(
      `${supabaseUrl}/rest/v1/invite_rewards?inviter_id=eq.${inviterId}&invitee_id=eq.${user_id}&reward_type=eq.first_group_buy&select=id`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const existingRewards = await existingRewardResponse.json();

    if (existingRewards && existingRewards.length > 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          is_first_group_buy: false,
          inviter_rewarded: false,
          message: 'First group buy reward already processed'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. 检查用户的拼团订单数量（确认是否为首次）
    // 【修复】同时查询UUID和telegram_id，兼容历史数据中user_id可能是两种格式
    // 先获取用户的telegram_id用于双重查询
    let userTelegramId = '';
    try {
      const telegramIdResponse = await fetch(
        `${supabaseUrl}/rest/v1/users?id=eq.${user_id}&select=telegram_id`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
          }
        }
      );
      const telegramIdData = await telegramIdResponse.json();
      if (telegramIdData && telegramIdData.length > 0) {
        userTelegramId = telegramIdData[0].telegram_id;
      }
    } catch (e: unknown) {
      console.error('Failed to get telegram_id:', e);
    }

    // 构建查询URL，同时匹配UUID和telegram_id
    let ordersUrl = `${supabaseUrl}/rest/v1/group_buy_orders?status=eq.PAID&select=id&limit=3`;
    if (userTelegramId && userTelegramId !== user_id) {
      ordersUrl += `&or=(user_id.eq.${user_id},user_id.eq.${userTelegramId})`;
    } else {
      ordersUrl += `&user_id=eq.${user_id}`;
    }
    
    const ordersResponse = await fetch(ordersUrl, {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
      }
    });
    const orders = await ordersResponse.json();

    // 如果已有多个已支付订单，说明不是首次
    // 注意：当前订单可能已经在列表中，所以检查 <= 1
    const isFirstGroupBuy = orders && orders.length <= 1;

    if (!isFirstGroupBuy) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          is_first_group_buy: false,
          inviter_rewarded: false,
          message: 'Not first group buy'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. 给邀请人增加2次抽奖机会
    const addSpinResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/add_user_spin_count`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: inviterId,
          p_count: 2,
          p_source: 'group_buy_reward'
        })
      }
    );

    if (!addSpinResponse.ok) {
      throw new Error('Failed to add spin count to inviter');
    }

    // 5. 记录邀请奖励
    await fetch(
      `${supabaseUrl}/rest/v1/invite_rewards`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          inviter_id: inviterId,
          invitee_id: user_id,
          reward_type: 'first_group_buy',
          spin_count_awarded: 2,
          lucky_coins_awarded: 0,
          is_processed: true,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        })
      }
    );

    console.log(`[First Group Buy Reward] Awarded 2 spins to inviter ${inviterId} for user ${user_id}'s first group buy`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        is_first_group_buy: true,
        inviter_rewarded: true,
        spins_awarded: 2,
        message: 'First group buy reward processed successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Handle first group buy reward error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errMsg || 'Internal server error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
