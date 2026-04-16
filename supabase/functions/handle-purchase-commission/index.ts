import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * ============================================================
 * handle-purchase-commission Edge Function
 * ============================================================
 * 
 * 功能：处理购买订单的三级分销佣金发放
 * 
 * 核心流程：
 *   1. 从 commission_settings 表读取佣金配置（支持动态调整）
 *   2. 沿 referred_by_id 链向上遍历最多3级推荐人
 *   3. 为每级推荐人创建佣金记录（先 pending，成功后改 settled）
 *   4. 使用乐观锁+3次重试更新积分钱包余额
 *   5. 发送佣金到账通知
 * 
 * 安全机制：
 *   - 防重复：order_id + user_id + level 唯一性检查
 *   - 乐观锁：wallet.version 防止并发余额覆盖
 *   - 两阶段状态：先 pending 后 settled，失败可通过 bulk-payout 重试
 *   - 最低金额：低于 min_payout_amount 的佣金不发放
 * 
 * 钱包类型说明（重要）：
 *   - 现金钱包: type='TJS', currency='TJS'
 *   - 积分钱包: type='LUCKY_COIN', currency='POINTS'
 *   - 佣金统一发放到积分钱包（LUCKY_COIN）
 * 
 * 调用方：
 *   - lottery-purchase（抽奖购买）
 *   - create-full-purchase-order（全额购买）
 *   - 均在支付成功后异步调用本函数
 * ============================================================
 */

/**
 * 通知发送功能：通过 notification_queue 发送佣金到账通知
 * 【迁移说明】已从 Telegram Bot 直发迁移为写入 notification_queue
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
    
    // 通过 notification_queue 发送通知（WhatsApp 渠道）
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
    // 通知失败不阻断佣金发放流程
    console.error('Failed to send commission notification:', err)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer' } })
  }

  try {
    const { order_id, user_id, order_amount } = await req.json()

    // 【参数校验】确保必要参数存在且合法
    if (!order_id || !user_id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameters' }), { status: 400 })
    }
    if (!order_amount || order_amount <= 0) {
      return new Response(JSON.stringify({ success: true, message: 'Zero amount, no commission' }), { status: 200 })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ============================================================
    // Step 1: 获取佣金配置（从 commission_settings 表动态读取）
    // ============================================================
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

    // ============================================================
    // Step 2: 获取购买用户的推荐关系
    // 【兼容修复】同时查询 referred_by_id 和 referrer_id
    // ============================================================
    const { data: userData, error: userError } = await supabaseClient
      .from('users')
      .select('referred_by_id, referrer_id')
      .eq('id', user_id)
      .single()

    if (userError) {throw userError}

    // 优先使用 referred_by_id（新字段），回退到 referrer_id（旧字段）
    const referrerId = userData?.referred_by_id || userData?.referrer_id
    
    if (!referrerId) {
      return new Response(JSON.stringify({ message: 'No referrer' }), { status: 200 })
    }

    // ============================================================
    // Step 3: 遍历三级推荐链，逐级计算和发放佣金
    // ============================================================
    const commissions = []
    let currentUserId = referrerId
    let level = 1

    for (const setting of settings) {
      if (!currentUserId || level > 3) {break}
      
      // 确保配置级别与当前遍历级别匹配
      if (setting.level !== level) {continue}

      const rate = parseFloat(setting.rate)
      const minPayoutAmount = parseFloat(setting.min_payout_amount || '0')
      const commissionAmount = order_amount * rate
      
      // 【最低金额检查】低于阈值的佣金不发放
      if (commissionAmount < minPayoutAmount) {
        console.log(`Commission ${commissionAmount} below minimum ${minPayoutAmount} for level ${level}`)
        const { data: nextUser } = await supabaseClient
          .from('users')
          .select('referred_by_id, referrer_id')
          .eq('id', currentUserId)
          .single()
        
        currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id
        level++
        continue
      }

      // ============================================================
      // 【防重复检查】order_id + user_id + level 唯一性
      // 确保同一订单不会给同一用户同一级别重复发佣金
      // ============================================================
      const { data: existingCommission } = await supabaseClient
        .from('commissions')
        .select('id')
        .eq('order_id', order_id)
        .eq('user_id', currentUserId)
        .eq('level', level)
        .maybeSingle()

      if (existingCommission) {
        console.log(`Commission already exists for order ${order_id}, user ${currentUserId}, level ${level}. Skipping.`)
        const { data: nextUser } = await supabaseClient
          .from('users')
          .select('referred_by_id, referrer_id')
          .eq('id', currentUserId)
          .single()
        
        currentUserId = nextUser?.referred_by_id || nextUser?.referrer_id
        level++
        continue
      }

      // ============================================================
      // 【两阶段提交】先创建 pending 状态的佣金记录
      // 钱包更新成功后再改为 settled
      // 如果钱包更新失败，管理员可通过 bulk-payout-commissions 重试
      // ============================================================
      const { data: commission, error: commissionError } = await supabaseClient
        .from('commissions')
        .insert({
          user_id: currentUserId,          // 获得佣金的用户（上级）
          from_user_id: user_id,           // 产生佣金的用户（下级）
          source_user_id: user_id,         // 兼容字段
          beneficiary_id: currentUserId,   // 兼容字段
          level: level,
          rate: rate,
          source_amount: order_amount,
          amount: commissionAmount,
          order_id: order_id,
          related_order_id: order_id,
          type: 'REFERRAL_COMMISSION',
          status: 'pending'                // 先 pending，成功后改 settled
        })
        .select()
        .single()

      if (commissionError) {
        console.error('Failed to insert commission:', commissionError)
        throw commissionError
      }
      
      commissions.push(commission)

      // ============================================================
      // 【钱包更新】将佣金发放到上级用户的积分钱包
      // 使用乐观锁（version 字段）+ 3次重试防止并发余额覆盖
      // ============================================================
      const { data: wallet, error: walletError } = await supabaseClient
        .from('wallets')
        .select('id, balance, version')
        .eq('user_id', currentUserId)
        .eq('type', 'LUCKY_COIN')       // 积分钱包
        .eq('currency', 'POINTS')        // 统一标准: currency='POINTS'
        .single()

      if (walletError) {
        console.error('Failed to find wallet:', walletError)
        // 积分钱包不存在则自动创建
        const { data: newWallet, error: createError } = await supabaseClient
          .from('wallets')
          .insert({
            user_id: currentUserId,
            type: 'LUCKY_COIN',
            currency: 'POINTS',
            balance: commissionAmount,
            version: 1,
          })
          .select()
          .single()

        if (createError) {
          console.error('Failed to create wallet:', createError)
          throw createError
        }

        // 创建新钱包时也要记录流水
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

        // 新建钱包成功后，将 commission 状态改为 settled
        if (commission?.id) {
          await supabaseClient
            .from('commissions')
            .update({ status: 'settled', settled_at: new Date().toISOString() })
            .eq('id', commission.id)
        }
        console.log('Created new LUCKY_COIN wallet for user:', currentUserId, 'with balance:', commissionAmount)
      } else {
        // ============================================================
        // 【乐观锁 + 3次重试】防止并发更新导致余额覆盖
        // 场景: 多个下级同时购买，同时触发佣金发放
        // 机制: 每次更新时检查 version 是否匹配，不匹配则重新读取后重试
        // ============================================================
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
            .eq('version', currentVersion)  // 乐观锁: 版本号必须匹配
            .select()
            .single()

          if (!updateError && updatedWallet) {
            walletUpdateSuccess = true

            // 记录钱包交易流水
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

            // 钱包更新成功后，将 commission 状态改为 settled
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
            // 重新读取最新钱包数据
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
          // 3次重试全部失败，commission 保持 pending 状态
          // 管理员可通过 bulk-payout-commissions 手动重试
          throw new Error(`Failed to update wallet balance after 3 retries for user ${currentUserId}`)
        }
      }

      // ============================================================
      // Step 4: 发送佣金到账通知（失败不阻断主流程）
      // ============================================================
      try {
        await sendCommissionNotification(currentUserId, 'commission_earned', {
          amount: commissionAmount,
          level: level
        })
      } catch (msgError: unknown) {
        console.error('Failed to send commission notification:', msgError)
      }

      // 查找下一级推荐人
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
