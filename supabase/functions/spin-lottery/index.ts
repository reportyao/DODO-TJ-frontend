import { mapErrorCode } from '../_shared/errorResponse.ts'
/**
 * ============================================================
 * spin-lottery Edge Function（转盘抽奖）
 * ============================================================
 * 
 * 功能：处理用户转盘抽奖请求
 * 
 * 核心流程：
 *   1. 验证用户会话和抽奖次数
 *   2. 从 spin_rewards 表读取奖池配置
 *   3. 根据概率随机抽取奖励
 *   4. 调用 deduct_user_spin_count RPC 原子扣减次数
 *   5. 发放奖励（积分/AI对话次数）
 *   6. 记录抽奖日志
 * 
 * 安全机制：
 *   - deduct_user_spin_count 使用原子 UPDATE + WHERE 条件防止超扣
 *   - add_user_lucky_coins 使用 FOR UPDATE 行锁防止并发余额错误
 *   - 积分发放失败时记录错误但不回滚次数扣减（避免刷次数漏洞）
 * 
 * 注意事项：
 *   - 次数扣减在奖励发放之前执行，这是有意设计
 *   - 如果先发奖再扣次数，用户可利用网络超时重复获取奖励
 *   - 积分发放失败的极端情况由管理员手动补偿
 * ============================================================
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

    // 【参数校验】
    if (!user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // Step 1: 验证会话
    // ============================================================
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

    // ============================================================
    // Step 2: 获取用户当前抽奖次数
    // ============================================================
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

    // ============================================================
    // Step 3: 获取奖池配置
    // ============================================================
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

    // ============================================================
    // Step 4: 根据概率随机抽取奖励
    // 概率累加算法：将所有奖项概率累加，随机数落在哪个区间就选中哪个
    // ============================================================
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

    // 如果概率配置有误导致没选中，默认选最后一个（通常是"谢谢惠顾"）
    if (!selectedReward) {
      selectedReward = rewards[rewards.length - 1];
    }

    // ============================================================
    // Step 5: 原子扣减抽奖次数
    // 【重要】必须在发放奖励之前扣减次数，防止利用网络超时刷奖励
    // deduct_user_spin_count 使用 WHERE spin_count >= p_count 原子检查
    // ============================================================
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

    // ============================================================
    // Step 6: 发放奖励
    // 【注意】积分发放失败时不回滚次数扣减
    // 原因：如果回滚次数，用户可利用"故意让积分发放失败"来无限刷次数
    // 极端情况下积分未到账由管理员手动补偿
    // ============================================================
    let newBalance: number | null = null;
    let rewardDelivered = true;  // 标记奖励是否成功发放
    const isWinner = (selectedReward.reward_type === 'LUCKY_COIN' || selectedReward.reward_type === 'AI_CHAT') && selectedReward.reward_amount > 0;

    if (isWinner) {
      if (selectedReward.reward_type === 'LUCKY_COIN') {
        // 发放积分奖励（调用 add_user_lucky_coins RPC，内部有 FOR UPDATE 行锁）
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
            rewardDelivered = false;
            // 不 throw，继续记录日志
          } else {
            newBalance = await addCoinsResponse.json();
            console.log(`[Spin Lottery] Successfully added ${selectedReward.reward_amount} coins to user ${user_id}, new balance: ${newBalance}`);
          }
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error('[Spin Lottery] Error in add_user_lucky_coins:', errMsg);
          rewardDelivered = false;
        }
      } else if (selectedReward.reward_type === 'AI_CHAT') {
        // 发放AI对话次数奖励
        try {
          const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-add-bonus`, {
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
          if (!aiResponse.ok) {
            console.error('[Spin Lottery] Failed to award AI chats, status:', aiResponse.status);
            rewardDelivered = false;
          } else {
            console.log(`[Spin Lottery] Awarded ${selectedReward.reward_amount} AI chats to user ${user_id}`);
          }
        } catch (aiError: unknown) {
          console.error('Failed to award AI chats:', aiError);
          rewardDelivered = false;
        }
      }
    }

    // ============================================================
    // Step 7: 记录抽奖日志
    // 【增强】增加 reward_delivered 字段标记奖励是否成功发放
    // ============================================================
    const spinRecord: Record<string, unknown> = {
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

    // ============================================================
    // Step 8: 发送中奖通知（失败不阻断主流程）
    // ============================================================
    if (isWinner && rewardDelivered) {
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
                channel: 'whatsapp',
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

    // ============================================================
    // Step 9: 获取更新后的抽奖次数并返回结果
    // ============================================================
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
        error: errMsg || 'Internal server error', error_code: mapErrorCode(errMsg || '')
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
