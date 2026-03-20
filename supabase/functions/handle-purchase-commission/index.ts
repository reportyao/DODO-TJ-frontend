import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * 通知发送功能：通过 notification_queue 发送佣金到账通知
 */
const translations: Record<string, Record<string, (amount: number, level: number) => string>> = {
  zh: {
    commission_earned: (amount: number, level: number) => `恭喜！您获得了 ${amount} 积分的佣金。来自您的 L${level} 朋友的购买。`,
  },
  ru: {
    commission_earned: (amount: number, level: number) => `Поздравляем! Вы получили комиссию ${amount} баллов от покупки вашего друга уровня L${level}.`,
  },
  tg: {
    commission_earned: (amount: number, level: number) => `Табрик! Шумо аз хариди дӯсти сатҳи L${level} комиссияи ${amount} балл гирифтед.`,
  },
}

async function sendCommissionNotification(userId: string, type: string, data: { amount?: number, level?: number }) {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const { data: userData, error } = await supabase
      .from('users')
      .select('phone_number, preferred_language')
      .eq('id', userId)
      .single()
    
    if (error || !userData?.phone_number) {
      console.log('User not found or no phone_number:', userId)
      return
    }
    
    const lang = userData.preferred_language || 'ru'
    const langTranslations = translations[lang] || translations['ru']
    const messageFunc = langTranslations[type]
    
    if (!messageFunc) {
      console.log('No message template for type:', type)
      return
    }
    
    const message = messageFunc(data.amount || 0, data.level || 1)
    
    // 通过 notification_queue 发送通知 [MIGRATION] 添加 channel='whatsapp'
    await supabase.from('notification_queue').insert({
      user_id: userId,
      type: 'commission_earned',
      phone_number: userData.phone_number,
      notification_type: 'commission_earned',
      title: '佣金到账',
      message: message,
      payload: { amount: data.amount, level: data.level },
      data: { amount: data.amount, level: data.level },
      channel: 'whatsapp',
      priority: 1,
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  } catch (err: unknown) {
    console.error('Failed to send commission notification:', err)
  }
}

serve(async (req) => {
  // 允许 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer' } })
  }

  try {
    const { order_id, user_id, order_amount } = await req.json()
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. 获取佣金配置（使用 commission_settings 表）
    const { data: settings, error: settingsError } = await supabaseClient
      .from('commission_settings')
      .select('level, rate, is_active, trigger_condition, min_payout_amount')
      .eq('is_active', true)
      .order('level', { ascending: true })
    
    if (settingsError) {
      console.error('Failed to fetch commission settings:', settingsError)
      throw settingsError
    }

    if (!settings || settings.length === 0) {
      console.log('No active commission settings found')
      return new Response(JSON.stringify({ message: 'No active commission settings' }), { status: 200 })
    }

    // 2. 获取购买用户的推荐关系
    // 修复: 同时查询 referred_by_id 和 referrer_id 以兼容旧数据
    const { data: userData, error: userError } = await supabaseClient
      .from('users')
      .select('referred_by_id, referrer_id')
      .eq('id', user_id)
      .single()

    if (userError) throw userError

    // 优先使用 referred_by_id，如果为空则使用 referrer_id
    const referrerId = userData?.referred_by_id || userData?.referrer_id
    
    if (!referrerId) {
      return new Response(JSON.stringify({ message: 'No referrer' }), { status: 200 })
    }

    // 3. 计算三级返佣
    const commissions = []
    let currentUserId = referrerId
    let level = 1

    // 遍历每一级
    for (const setting of settings) {
      if (!currentUserId || level > 3) break
      
      // 检查是否有对应级别的配置
      if (setting.level !== level) continue

      const rate = parseFloat(setting.rate)
      const minPayoutAmount = parseFloat(setting.min_payout_amount || '0')
      const commissionAmount = order_amount * rate
      
      // 检查是否达到最低发放金额
      if (commissionAmount < minPayoutAmount) {
        console.log(`Commission ${commissionAmount} below minimum ${minPayoutAmount} for level ${level}`)
        // 继续查找下一级
        // 修复: 同时查询两个字段
        const { data: nextUser } = await supabaseClient
          .from('users')
          .select('referred_by_id, referrer_id')
          .eq('id', currentUserId)
          .single()
        
        currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id
        level++
        continue
      }

      /**
       * 防重复检查：检查该订单是否已经给该用户发放过该级别的佣金
       */
      const { data: existingCommission } = await supabaseClient
        .from('commissions')
        .select('id')
        .eq('order_id', order_id)
        .eq('user_id', currentUserId)
        .eq('level', level)
        .maybeSingle()

      if (existingCommission) {
        console.log(`Commission already exists for order ${order_id}, user ${currentUserId}, level ${level}. Skipping.`)
        // 继续查找下一级
        const { data: nextUser } = await supabaseClient
          .from('users')
          .select('referred_by_id, referrer_id')
          .eq('id', currentUserId)
          .single()
        
        currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id
        level++
        continue
      }

      /**
       * 插入佣金记录
       * 
       * commissions 表字段说明：
       * - user_id: 获得佣金的用户ID（上级）
       * - from_user_id: 产生佣金的用户ID（下级）
       * - source_user_id: 同 from_user_id，兼容字段
       * - beneficiary_id: 同 user_id，兼容字段
       * - amount: 佣金金额
       * - source_amount: 订单金额
       * - rate: 佣金比例
       * - percent: 佣金百分比（rate * 100）
       * - level: 佣金级别（1/2/3级）
       * - type: 佣金类型（REFERRAL_COMMISSION）
       * - status: 状态（settled）
       * - order_id: 关联订单ID
       */
      // 【R19修复】先创建 pending 状态的佣金记录，钱包更新成功后再改为 settled
      // 这样如果钱包更新失败，管理员可通过 bulk-payout-commissions 重试发放
      const { data: commission, error: commissionError } = await supabaseClient
        .from('commissions')
        .insert({
          user_id: currentUserId,
          from_user_id: user_id,
          source_user_id: user_id,
          beneficiary_id: currentUserId,
          level: level,
          rate: rate,
          percent: rate * 100,
          source_amount: order_amount,
          amount: commissionAmount,
          order_id: order_id,
          related_order_id: order_id,
          type: 'REFERRAL_COMMISSION',
          status: 'pending'  // 先设为 pending，钱包更新成功后再改为 settled
        })
        .select()
        .single()

      if (commissionError) {
        console.error('Failed to insert commission:', commissionError)
        throw commissionError
      }
      
      commissions.push(commission)

      /**
       * 将佣金发放到上级用户的积分钱包
       * 
       * 钱包类型说明（重要）：
       * - 现金钱包: type='TJS', currency='TJS'
       * - 积分钱包: type='LUCKY_COIN', currency='POINTS'
       * 
       * 三级分销佣金发放到积分钱包
       */
      const { data: wallet, error: walletError } = await supabaseClient
        .from('wallets')
        .select('id, balance, version')  // 修复 v3: 查询 version 字段用于乐观锁
        .eq('user_id', currentUserId)
        .eq('type', 'LUCKY_COIN')
        .eq('currency', 'POINTS')
        .single()

      if (walletError) {
        console.error('Failed to find wallet:', walletError)
        // 如果找不到积分钱包，尝试创建一个
        // 【重要】currency 必须为 'POINTS'，与注册流程统一
        const { data: newWallet, error: createError } = await supabaseClient
          .from('wallets')
          .insert({
            user_id: currentUserId,
            type: 'LUCKY_COIN',
            currency: 'POINTS',  // 统一标准: 积分钱包 currency='POINTS'
            balance: commissionAmount,
            version: 1,
          })
          .select()
          .single()

        if (createError) {
          console.error('Failed to create wallet:', createError)
          throw createError
        }
        // 【修复】创建新钱包时也要记录流水
        await supabaseClient.from('wallet_transactions').insert({
          wallet_id: newWallet.id,
          type: 'COMMISSION',
          amount: commissionAmount,
          balance_before: 0,
          balance_after: commissionAmount,
          status: 'COMPLETED',
          description: `L${level}佣金 - 来自下级购买`,
          reference_id: order_id,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        // 【R19修复】新建钱包成功后，将 commission 状态改为 settled
        if (commission?.id) {
          await supabaseClient
            .from('commissions')
            .update({ status: 'settled', settled_at: new Date().toISOString() })
            .eq('id', commission.id)
        }
        console.log('Created new LUCKY_COIN wallet for user:', currentUserId, 'with balance:', commissionAmount)
      } else {
        // 更新积分钱包余额
        // 【资金安全修复 v4】使用乐观锁 + 3次重试机制防止并发更新导致余额错误
        // 场景: 多个下级同时购买，同时触发佣金发放，可能导致余额覆盖
        let walletUpdateSuccess = false
        let walletRetries = 3
        let currentWallet = wallet

        while (walletRetries > 0 && !walletUpdateSuccess) {
          const currentWalletBalance = parseFloat(currentWallet.balance || '0')
          const newBalance = currentWalletBalance + commissionAmount
          const currentVersion = currentWallet.version || 1

          const { error: updateError, data: updatedWallet } = await supabaseClient
            .from('wallets')
            .update({
              balance: newBalance,
              version: currentVersion + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', currentWallet.id)
            .eq('version', currentVersion)
            .select()
            .single()

          if (!updateError && updatedWallet) {
            walletUpdateSuccess = true
            // 【修复】佣金入账时创建 wallet_transactions 流水记录
            await supabaseClient.from('wallet_transactions').insert({
              wallet_id: currentWallet.id,
              type: 'COMMISSION',
              amount: commissionAmount,
              balance_before: currentWalletBalance,
              balance_after: newBalance,
              status: 'COMPLETED',
              description: `L${level}佣金 - 来自下级购买`,
              reference_id: order_id,
              processed_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            })
            // 【R19修复】钱包更新成功后，将 commission 状态改为 settled
            if (commission?.id) {
              await supabaseClient
                .from('commissions')
                .update({ status: 'settled', settled_at: new Date().toISOString() })
                .eq('id', commission.id)
            }
            console.log('Updated LUCKY_COIN wallet for user:', currentUserId, 'new balance:', newBalance)
            break
          }

          console.warn(`Optimistic lock failed (attempt ${4 - walletRetries}/3), retrying...`)
          walletRetries--

          if (walletRetries > 0) {
            const { data: freshWallet } = await supabaseClient
              .from('wallets')
              .select('id, balance, version')
              .eq('user_id', currentUserId)
              .eq('type', 'LUCKY_COIN')
              .eq('currency', 'POINTS')
              .single()

            if (freshWallet) {
              currentWallet = freshWallet
            } else {
              throw new Error('Failed to find wallet for retry')
            }
          }
        }

        if (!walletUpdateSuccess) {
          throw new Error(`Failed to update wallet balance after 3 retries for user ${currentUserId}`)
        }
      }

      // 4. 发送佣金到账通知
      try {
        await sendCommissionNotification(currentUserId, 'commission_earned', {
          amount: commissionAmount,
          level: level
        })
      } catch (msgError: unknown) {
        console.error('Failed to send commission notification:', msgError)
        // 不阻断流程
      }

      // 查找下一级
      // 修复: 同时查询两个字段
      const { data: nextUser, error: nextUserError } = await supabaseClient
        .from('users')
        .select('referred_by_id, referrer_id')
        .eq('id', currentUserId)
        .single()

      if (nextUserError) {
        console.error('Failed to fetch next user:', nextUserError)
        break
      }

      currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id
      level++
    }

    return new Response(
      JSON.stringify({ success: true, commissions }),
      { headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' }, status: 200 }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('handle_purchase_commission error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' }, status: 400 }
    )
  }
})
