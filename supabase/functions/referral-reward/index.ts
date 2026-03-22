import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * ============================================================
 * referral-reward Edge Function
 * ============================================================
 * 
 * 功能：处理邀请奖励发放（区别于 handle-purchase-commission 的购买佣金）
 * 
 * 使用场景：
 *   - LOTTERY_PURCHASE: 抽奖购买时触发邀请奖励
 *   - COIN_EXCHANGE: 积分兑换时触发邀请奖励
 *   - DEPOSIT: 充值时触发邀请奖励
 * 
 * 与 handle-purchase-commission 的区别：
 *   - handle-purchase-commission: 购买订单佣金，发到积分钱包(LUCKY_COIN)
 *   - referral-reward: 邀请奖励，发到现金钱包(TJS)
 * 
 * 安全机制：
 *   - 防重复：from_user_id + user_id + transaction_type + level 唯一性检查
 *   - 乐观锁：wallet.version 防止并发余额覆盖
 *   - 佣金率从 commission_settings 表动态读取
 * ============================================================
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

interface ReferralRewardRequest {
  user_id: string
  transaction_type: 'LOTTERY_PURCHASE' | 'COIN_EXCHANGE' | 'DEPOSIT'
  amount: number
  currency: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { user_id, transaction_type, amount, currency }: ReferralRewardRequest = await req.json()

    // 【参数校验】确保必要参数存在
    if (!user_id || !transaction_type || !amount || amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid parameters' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // ============================================================
    // Step 1: 获取用户推荐关系
    // 【兼容修复】同时查询 referred_by_id 和 referrer_id
    // ============================================================
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('referred_by_id, referrer_id')
      .eq('id', user_id)
      .single()

    // 优先使用 referred_by_id（新字段），回退到 referrer_id（旧字段）
    const referrerId = user?.referred_by_id || user?.referrer_id
    
    if (userError || !user || !referrerId) {
      return new Response(
        JSON.stringify({ success: true, message: 'No referrer found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ============================================================
    // Step 2: 从数据库读取佣金配置
    // 【BUG修复】原代码 var/const 作用域问题导致回退配置可能不生效
    // ============================================================
    let commissionRates: Record<number, number> = {}
    
    const { data: commissionConfig, error: configError } = await supabaseClient
      .from('commission_settings')
      .select('*')
      .eq('is_active', true)
      .order('level', { ascending: true })
    
    if (configError || !commissionConfig || commissionConfig.length === 0) {
      console.error('Failed to load commission config:', configError)
      // 配置加载失败时使用默认配置
      commissionRates = {
        1: 0.10, // 一级 10%
        2: 0.05, // 二级 5%
        3: 0.02  // 三级 2%
      }
    } else {
      // 使用数据库配置
      commissionConfig.forEach(config => {
        commissionRates[config.level] = parseFloat(config.rate)
      })
    }

    // ============================================================
    // Step 3: 遍历三级推荐链，计算奖励
    // ============================================================
    const rewards: Array<{
      referrer_id: string
      level: number
      amount: number
    }> = []

    let currentReferrerId = referrerId
    let level = 1

    while (currentReferrerId && level <= 3) {
      const rate = commissionRates[level]
      if (!rate || rate <= 0) {
        // 该级别没有配置佣金率，跳过但继续查找下一级
        const { data: referrer } = await supabaseClient
          .from('users')
          .select('referred_by_id, referrer_id')
          .eq('id', currentReferrerId)
          .single()
        currentReferrerId = referrer?.referred_by_id || referrer?.referrer_id || null
        level++
        continue
      }

      const commissionAmount = Math.round(amount * rate * 100) / 100  // 保留两位小数

      // 【安全校验】佣金金额必须大于 0
      if (commissionAmount > 0) {
        rewards.push({
          referrer_id: currentReferrerId,
          level,
          amount: commissionAmount
        })
      }

      // 查找下一级推荐人
      const { data: referrer } = await supabaseClient
        .from('users')
        .select('referred_by_id, referrer_id')
        .eq('id', currentReferrerId)
        .single()

      currentReferrerId = referrer?.referred_by_id || referrer?.referrer_id || null
      level++
    }

    // ============================================================
    // Step 4: 逐级发放奖励
    // ============================================================
    const results = []
    for (const reward of rewards) {
      // 【防重复检查】确保同一笔交易不会重复发放
      const { data: existingReward } = await supabaseClient
        .from('commissions')
        .select('id')
        .or(`and(from_user_id.eq.${user_id},user_id.eq.${reward.referrer_id}),and(referee_id.eq.${user_id},referrer_id.eq.${reward.referrer_id})`)
        .eq('transaction_type', transaction_type)
        .eq('level', reward.level)
        .maybeSingle()

      if (existingReward) {
        console.log(`Reward already exists for user ${user_id}, referrer ${reward.referrer_id}, type ${transaction_type}, level ${reward.level}. Skipping.`)
        continue
      }

      // 创建 Commission 记录
      const { data: commission, error: commissionError } = await supabaseClient
        .from('commissions')
        .insert({
          user_id: reward.referrer_id,       // 获得奖励的用户（上级）
          from_user_id: user_id,             // 产生奖励的用户（下级）
          referrer_id: reward.referrer_id,   // 兼容字段
          referee_id: user_id,               // 兼容字段
          source_user_id: user_id,           // 兼容字段
          beneficiary_id: reward.referrer_id,// 兼容字段
          level: reward.level,
          amount: reward.amount,
          currency: currency || 'TJS',
          transaction_type: transaction_type,
          type: 'REFERRAL_REWARD',
          status: 'settled'
        })
        .select()
        .single()

      if (commissionError) {
        console.error('Failed to create commission:', commissionError)
        continue
      }

      // ============================================================
      // 【钱包更新】发放到现金钱包(TJS)
      // 使用乐观锁 + 重试机制防止并发余额覆盖
      // ============================================================
      const walletCurrency = currency || 'TJS'
      const { data: wallet, error: walletError } = await supabaseClient
        .from('wallets')
        .select('id, balance, version')
        .eq('user_id', reward.referrer_id)
        .eq('type', 'TJS')
        .eq('currency', walletCurrency)
        .single()

      if (wallet && !walletError) {
        let updateSuccess = false
        let retries = 3
        let currentWallet = wallet

        while (retries > 0 && !updateSuccess) {
          const currentBalance = parseFloat(currentWallet.balance || '0')
          const newBalance = currentBalance + reward.amount
          const currentVersion = currentWallet.version || 1

          const { error: updateError, data: updatedWallet } = await supabaseClient
            .from('wallets')
            .update({
              balance: newBalance,
              version: currentVersion + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', currentWallet.id)
            .eq('version', currentVersion)  // 乐观锁
            .select()
            .single()

          if (!updateError && updatedWallet) {
            updateSuccess = true

            // 记录钱包交易流水
            await supabaseClient
              .from('wallet_transactions')
              .insert({
                wallet_id: wallet.id,
                type: 'REFERRAL_REWARD',
                amount: reward.amount,
                balance_before: currentBalance,
                balance_after: newBalance,
                currency: walletCurrency,
                status: 'COMPLETED',
                description: `L${reward.level}邀请奖励`,
                processed_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                metadata: {
                  referee_id: user_id,
                  level: reward.level,
                  transaction_type: transaction_type
                }
              })

            // 发送通知
            await supabaseClient
              .from('notifications')
              .insert({
                user_id: reward.referrer_id,
                type: 'REFERRAL_REWARD',
                title: '邀请奖励到账',
                content: `您的${reward.level}级好友消费,您获得了 ${reward.amount.toFixed(2)} ${walletCurrency} 奖励`,
                is_read: false
              })

            results.push({
              referrer_id: reward.referrer_id,
              level: reward.level,
              amount: reward.amount,
              status: 'success'
            })
          } else {
            retries--
            if (retries > 0) {
              // 重新读取最新钱包数据
              const { data: freshWallet } = await supabaseClient
                .from('wallets')
                .select('id, balance, version')
                .eq('id', currentWallet.id)
                .single()
              if (freshWallet) {
                currentWallet = freshWallet
              } else {
                console.error('Failed to refresh wallet for retry')
                break
              }
            }
          }
        }

        if (!updateSuccess) {
          console.error(`Failed to update wallet after 3 retries for user ${reward.referrer_id}`)
        }
      } else {
        console.error('Wallet not found for user:', reward.referrer_id, 'type: TJS, currency:', walletCurrency)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        rewards: results,
        message: `Successfully distributed ${results.length} rewards`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error in referral-reward function:', error)
    return new Response(
      JSON.stringify({ error: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
