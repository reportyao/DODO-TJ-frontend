/**
 * 转盘抽奖 Edge Function
 * 
 * 功能：
 * 1. 验证用户抽奖次数
 * 2. 根据概率随机抽取奖励
 * 3. 扣减抽奖次数
 * 4. 发放积分奖励
 * 5. 记录抽奖日志
 * 
 * 请求参数：
 * - user_id: 用户ID
 * - session_token: 会话令牌
 * 
 * 返回：
 * - success: 是否成功
 * - reward: 中奖奖项信息
 * - remaining_spins: 剩余抽奖次数
 * - new_balance: 新的积分余额（如果中奖）
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SpinReward {
  id: string;
  reward_name: string;
  reward_name_i18n: Record<string, string>;
  reward_type: string;
  reward_amount: number;
  probability: number;
  display_order: number;
  is_jackpot: boolean;
}

Deno.serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase configuration');
    }

    const { user_id, session_token } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 验证会话（可选，根据项目需求）
    if (session_token) {
      const sessionResponse = await fetch(
        `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${session_token}&user_id=eq.${user_id}&is_active=eq.true&select=id`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
          }
        }
      );
      const sessions = await sessionResponse.json();
      if (!sessions || sessions.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 1. 获取用户当前抽奖次数
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
    
    const currentSpinCount = spinBalanceData.length > 0 ? spinBalanceData[0].spin_count : 0;

    if (currentSpinCount <= 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No spin chances available',
          error_code: 'NO_SPINS',
          remaining_spins: 0
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. 获取奖池配置
    const rewardsResponse = await fetch(
      `${supabaseUrl}/rest/v1/spin_rewards?is_active=eq.true&order=display_order.asc&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const rewards: SpinReward[] = await rewardsResponse.json();

    if (!rewards || rewards.length === 0) {
      throw new Error('No spin rewards configured');
    }

    // 3. 根据概率随机抽取奖励
    const random = Math.random();
    let cumulativeProbability = 0;
    let selectedReward: SpinReward | null = null;

    for (const reward of rewards) {
      cumulativeProbability += reward.probability;
      if (random < cumulativeProbability) {
        selectedReward = reward;
        break;
      }
    }

    // 如果没有选中任何奖励（概率配置问题），默认选择最后一个（通常是"谢谢惠顾"）
    if (!selectedReward) {
      selectedReward = rewards[rewards.length - 1];
    }

    // 4. 扣减抽奖次数
    const deductResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/deduct_user_spin_count`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: user_id,
          p_count: 1
        })
      }
    );

    const deductResult = await deductResponse.json();
    if (deductResult === false) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to deduct spin count',
          error_code: 'DEDUCT_FAILED'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. 如果中奖（非“谢谢惠顾”），发放奖励
    let newBalance: number | null = null;
    const isWinner = (selectedReward.reward_type === 'LUCKY_COIN' || selectedReward.reward_type === 'AI_CHAT') && selectedReward.reward_amount > 0;

    if (isWinner) {
      if (selectedReward.reward_type === 'LUCKY_COIN') {
        // 发放积分奖励
        try {
          const addCoinsResponse = await fetch(
            `${supabaseUrl}/rest/v1/rpc/add_user_lucky_coins`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                p_user_id: user_id,
                p_amount: selectedReward.reward_amount,
                p_description: `转盘抽奖奖励: ${selectedReward.reward_name}`
              })
            }
          );
          
          if (!addCoinsResponse.ok) {
            const errorText = await addCoinsResponse.text();
            console.error(`[Spin Lottery] Failed to add lucky coins: ${errorText}`);
            console.error(`[Spin Lottery] Response status: ${addCoinsResponse.status}`);
            // 如果是函数不存在的错误，记录详细信息
            if (errorText.includes('function') || errorText.includes('does not exist')) {
              console.error('[Spin Lottery] Database function add_user_lucky_coins may not exist. Please check database migrations.');
            }
            throw new Error(`Failed to add lucky coins: ${errorText}`);
          }
          
          newBalance = await addCoinsResponse.json();
          console.log(`[Spin Lottery] Successfully added ${selectedReward.reward_amount} coins to user ${user_id}, new balance: ${newBalance}`);
        } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
          console.error('[Spin Lottery] Error in add_user_lucky_coins:', error);
          // 积分发放失败，但不影响抽奖记录，只是newBalance为null
          // 前端会显示中奖，但余额可能不会立即更新
        }
      } else if (selectedReward.reward_type === 'AI_CHAT') {
        // 发放AI对话次数奖励
        try {
          await fetch(`${supabaseUrl}/functions/v1/ai-add-bonus`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              user_id: user_id,
              amount: selectedReward.reward_amount,
              reason: 'spin_lottery_reward'
            })
          });
          console.log(`[Spin Lottery] Awarded ${selectedReward.reward_amount} AI chats to user ${user_id}`);
        } catch (aiError: unknown) {
          console.error('Failed to award AI chats:', aiError);
        }
      }
    }

    // 6. 记录抽奖日志
    const spinRecord = {
      user_id: user_id,
      reward_id: selectedReward.id,
      reward_name: selectedReward.reward_name,
      reward_type: selectedReward.reward_type,
      reward_amount: selectedReward.reward_amount,
      is_winner: isWinner,
      spin_source: 'user_spin',
      created_at: new Date().toISOString()
    };

    await fetch(
      `${supabaseUrl}/rest/v1/spin_records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(spinRecord)
      }
    );

    // 7. 发送通知（只在中奖时发送）
    if (isWinner) {
      try {
        const userResponse = await fetch(
          `${supabaseUrl}/rest/v1/users?id=eq.${user_id}&select=phone_number`,
          {
            headers: {
              'Authorization': `Bearer ${serviceRoleKey}`,
              'apikey': serviceRoleKey,
            }
          }
        );
        const userData = await userResponse.json();
        
        if (userData.length > 0 && userData[0].phone_number) {
          await fetch(
            `${supabaseUrl}/rest/v1/notification_queue`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                user_id: user_id,
                type: 'spin_win',
                payload: {
                  prize_name: selectedReward.reward_name,
                  prize_amount: selectedReward.reward_amount
                },
                phone_number: userData[0].phone_number,
                notification_type: 'spin_win',
                title: '转盘中奖',
                message: `恭喜您在转盘抽奖中获得奖励`,
                data: {
                  prize_name: selectedReward.reward_name,
                  prize_amount: selectedReward.reward_amount
                },
                priority: 1,
                status: 'pending',
                scheduled_at: new Date().toISOString(),
                retry_count: 0,
                max_retries: 3,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
            }
          );
        }
      } catch (notifError: unknown) {
        console.error('Failed to send spin win notification:', notifError);
      }
    }

    // 8. 获取更新后的抽奖次数
    const updatedSpinBalanceResponse = await fetch(
      `${supabaseUrl}/rest/v1/user_spin_balance?user_id=eq.${user_id}&select=spin_count`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        }
      }
    );
    const updatedSpinBalance = await updatedSpinBalanceResponse.json();
    const remainingSpins = updatedSpinBalance.length > 0 ? updatedSpinBalance[0].spin_count : 0;

    // 9. 返回结果
    return new Response(
      JSON.stringify({
        success: true,
        reward: {
          id: selectedReward.id,
          name: selectedReward.reward_name,
          name_i18n: selectedReward.reward_name_i18n,
          type: selectedReward.reward_type,
          amount: selectedReward.reward_amount,
          display_order: selectedReward.display_order,
          is_jackpot: selectedReward.is_jackpot,
          is_winner: isWinner
        },
        remaining_spins: remainingSpins,
        new_balance: newBalance
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Spin lottery error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errMsg || 'Internal server error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
