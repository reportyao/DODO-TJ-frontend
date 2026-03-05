import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // 获取用户信息
    // 修复: 同时查询 referred_by_id 和 referrer_id 以兼容旧数据
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('referred_by_id, referrer_id')
      .eq('id', user_id)
      .single()

    // 优先使用 referred_by_id，如果为空则使用 referrer_id
    const referrerId = user?.referred_by_id || user?.referrer_id
    
    if (userError || !user || !referrerId) {
      return new Response(
        JSON.stringify({ success: true, message: 'No referrer found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 从数据库读取佣金配置
    const { data: commissionConfig, error: configError } = await supabaseClient
      .from('commission_settings')
      .select('*')
      .eq('is_active', true)
      .order('level', { ascending: true })
    
    if (configError || !commissionConfig || commissionConfig.length === 0) {
      console.error('Failed to load commission config:', configError)
      // 如果配置加载失败，使用默认配置
      const commissionRates = {
        1: 0.10, // 一级 10%
        2: 0.05, // 二级 5%
        3: 0.02  // 三级 2%
      }
    } else {
      // 使用数据库配置
      var commissionRates: Record<number, number> = {}
      commissionConfig.forEach(config => {
        commissionRates[config.level] = config.rate
      })
    }

    const rewards: Array<{
      referrer_id: string
      level: number
      amount: number
    }> = []

    // 递归查找上级推荐人(最多3级)
    let currentReferrerId = referrerId
    let level = 1

    while (currentReferrerId && level <= 3) {
      const commissionAmount = amount * commissionRates[level as keyof typeof commissionRates]
      
      rewards.push({
        referrer_id: currentReferrerId,
        level,
        amount: commissionAmount
      })

      // 查找下一级推荐人
      // 修复: 同时查询两个字段
      const { data: referrer } = await supabaseClient
        .from('users')
        .select('referred_by_id, referrer_id')
        .eq('id', currentReferrerId)
        .single()

      currentReferrerId = referrer?.referred_by_id || referrer?.referrer_id
      level++
    }

    // 发放奖励
    const results = []
    for (const reward of rewards) {
      /**
       * 防重复检查：检查是否已经给该用户发放过该类型的奖励
       * 使用 from_user_id + user_id + transaction_type + level 作为唯一标识
       * 同时检查旧字段名以兼容历史数据
       */
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

      // 1. 创建Commission记录
      // 统一字段名，与 handle-purchase-commission 保持一致
      const { data: commission, error: commissionError } = await supabaseClient
        .from('commissions')
        .insert({
          // 主字段
          user_id: reward.referrer_id,      // 获得佣金的用户
          from_user_id: user_id,            // 产生佣金的用户
          // 兼容字段
          referrer_id: reward.referrer_id,
          referee_id: user_id,
          source_user_id: user_id,
          beneficiary_id: reward.referrer_id,
          // 业务字段
          level: reward.level,
          amount: reward.amount,
          currency: currency,
          transaction_type: transaction_type,
          type: 'REFERRAL_REWARD',          // 区分与 REFERRAL_COMMISSION
          status: 'settled'                 // 统一使用 settled
        })
        .select()
        .single()

      if (commissionError) {
        console.error('Failed to create commission:', commissionError)
        continue
      }

      /**
       * 2. 更新推荐人现金钱包余额
       * 
       * 钱包类型说明（重要）：
       * - 现金钱包: type='TJS', currency='TJS'
       * - 积分钱包: type='LUCKY_COIN', currency='POINTS'
       * 
       * 佣金奖励统一发放到现金钱包
       */
      const { data: wallet, error: walletError } = await supabaseClient
        .from('wallets')
        .select('id, balance, version')  // 修复 v3: 查询 version 字段用于乐观锁
        .eq('user_id', reward.referrer_id)
        .eq('type', 'TJS')             // 现金钱包类型
        .eq('currency', currency)      // 使用请求中的货币类型
        .single()

      if (wallet && !walletError) {
        // 【资金安全修复 v3】添加乐观锁防止并发更新导致余额错误
        // 修复: 使用 wallet.id 而不是 user_id 来定位钱包，更精确
        const currentBalance = parseFloat(wallet.balance || '0')
        const newBalance = currentBalance + reward.amount
        const currentVersion = wallet.version || 1

        const { error: updateError, data: updatedWallet } = await supabaseClient
          .from('wallets')
          .update({
            balance: newBalance,
            version: currentVersion + 1,  // 乐观锁: 版本号+1
            updated_at: new Date().toISOString()
          })
          .eq('id', wallet.id)            // 修复: 使用 wallet.id 而不是 user_id
          .eq('version', currentVersion)  // 乐观锁: 只有版本号匹配才能更新
          .select()
          .single()

        if (updateError || !updatedWallet) {
          console.error('Failed to update wallet (possible concurrent conflict):', updateError)
          continue
        }

        // 3. 创建钱包交易记录
        await supabaseClient
          .from('wallet_transactions')
          .insert({
            user_id: reward.referrer_id,
            wallet_id: wallet.id,
            type: 'REFERRAL_REWARD',
            amount: reward.amount,
            currency: currency,
            status: 'COMPLETED',
            description: `L${reward.level}邀请奖励`,
            metadata: {
              referee_id: user_id,
              level: reward.level,
              transaction_type: transaction_type
            }
          })

        // 4. 发送通知
        await supabaseClient
          .from('notifications')
          .insert({
            user_id: reward.referrer_id,
            type: 'REFERRAL_REWARD',
            title: '邀请奖励到账',
            content: `您的${reward.level}级好友消费,您获得了 ${reward.amount.toFixed(2)} ${currency} 奖励`,
            is_read: false
          })

        results.push({
          referrer_id: reward.referrer_id,
          level: reward.level,
          amount: reward.amount,
          status: 'success'
        })
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

  } catch (error) {
    console.error('Error in referral-reward function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
