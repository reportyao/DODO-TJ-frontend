import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-admin-id',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('=== approve-deposit 开始 ===')
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 获取管理员认证
    const adminId = req.headers.get('x-admin-id')
    console.log('x-admin-id:', adminId)
    
    let adminUserId: string | null = null
    
    // 通过 x-admin-id 头部认证（管理后台使用）
    if (adminId) {
      // 验证管理员是否存在且有效
      const { data: adminUser, error: adminError } = await supabaseClient
        .from('admin_users')
        .select('id, status')
        .eq('id', adminId)
        .single()
      
      console.log('admin查询结果:', { adminUser, adminError })
      
      if (adminError || !adminUser || adminUser.status !== 'active') {
        throw new Error('管理员认证失败')
      }
      adminUserId = adminUser.id
    }
    
    if (!adminUserId) {
      throw new Error('未授权')
    }

    const { requestId, action, adminNote } = await req.json()
    console.log('请求参数:', { requestId, action, adminNote })

    // 验证参数
    if (!requestId) {
      throw new Error('请求ID不能为空')
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      throw new Error('无效的审核操作')
    }

    // 获取充值申请
    const { data: depositRequest, error: requestError } = await supabaseClient
      .from('deposit_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    console.log('充值申请查询:', { depositRequest, requestError })

    if (requestError || !depositRequest) {
      throw new Error('未找到充值申请')
    }

    // 检查申请状态
    if (depositRequest.status !== 'PENDING') {
      throw new Error('该申请已被处理')
    }

    // 更新申请状态
    console.log('准备更新状态...')
    const { error: updateError } = await supabaseClient
      .from('deposit_requests')
      .update({
        status: action,
        processed_by: adminUserId,
        admin_note: adminNote || null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)

    console.log('更新状态结果:', { updateError })

    if (updateError) {
      console.error('更新申请状态失败:', updateError)
      throw new Error(`审核失败: ${updateError.message}`)
    }

    // 如果审核通过,增加用户余额
    if (action === 'APPROVED') {
      // 获取用户余额钱包
      console.log('查询用户钱包...')
      let { data: wallet, error: walletError } = await supabaseClient
        .from('wallets')
        .select('*')
        .eq('user_id', depositRequest.user_id)
        .eq('type', 'TJS')
        .eq('currency', depositRequest.currency)
        .single()

      console.log('钱包查询结果:', { wallet, walletError })

      // 如果钱包不存在，自动创建
      if (walletError || !wallet) {
        console.log('钱包不存在，自动创建...')
        const { data: newWallet, error: createWalletError } = await supabaseClient
          .from('wallets')
          .insert({
            user_id: depositRequest.user_id,
            type: 'TJS',
            currency: depositRequest.currency,
            balance: 0,
            total_deposits: 0,
            first_deposit_bonus_claimed: false,
            first_deposit_bonus_amount: 0,
          })
          .select()
          .single()

        if (createWalletError || !newWallet) {
          console.error('创建钱包失败:', createWalletError)
          throw new Error(`创建钱包失败: ${createWalletError?.message}`)
        }

        wallet = newWallet
        console.log('钱包创建成功:', wallet)
      }

      // 检查是否为首充（total_deposits 为 0 或 null）
      const isFirstDeposit = !wallet.total_deposits || Number(wallet.total_deposits) === 0
      let bonusAmount = 0
      let bonusPercent = 0

      if (isFirstDeposit && !wallet.first_deposit_bonus_claimed) {
        // 获取首充奖励配置
        console.log('检查首充奖励配置...')
        const { data: configData } = await supabaseClient
          .from('system_config')
          .select('value')
          .eq('key', 'first_deposit_bonus')
          .single()

        if (configData?.value) {
          const config = configData.value as {
            enabled: boolean;
            bonus_percent: number;
            max_bonus_amount: number;
            min_deposit_amount: number;
          }

          console.log('首充奖励配置:', config)

          if (config.enabled && Number(depositRequest.amount) >= config.min_deposit_amount) {
            // 计算奖励金额
            bonusPercent = config.bonus_percent
            bonusAmount = Math.min(
              Number(depositRequest.amount) * (config.bonus_percent / 100),
              config.max_bonus_amount
            )
            console.log('首充奖励金额:', bonusAmount)
          }
        }
      }

      // 更新钱包余额（包含首充奖励）
      // 【资金安全修复 v3】添加乐观锁防止并发更新导致余额错误
      console.log('更新钱包余额...')
      const depositAmount = Number(depositRequest.amount)
      const totalCredited = depositAmount + bonusAmount
      const currentBalance = Number(wallet.balance)
      const newBalance = currentBalance + totalCredited
      const newTotalDeposits = Number(wallet.total_deposits || 0) + depositAmount
      
      const walletUpdateData: any = {
        balance: newBalance,
        total_deposits: newTotalDeposits,
        version: (wallet.version || 1) + 1,  // 乐观锁: 版本号+1
        updated_at: new Date().toISOString(),
      }

      // 如果有首充奖励，标记为已领取
      if (bonusAmount > 0) {
        walletUpdateData.first_deposit_bonus_claimed = true
        walletUpdateData.first_deposit_bonus_amount = bonusAmount
      }

      // 【乐观锁】通过 version 字段确保并发安全
      // 如果在查询钱包和更新钱包之间有其他操作修改了余额，
      // version 不匹配会导致更新失败，从而防止资金错误
      const { error: updateWalletError, data: updatedWallet } = await supabaseClient
        .from('wallets')
        .update(walletUpdateData)
        .eq('id', wallet.id)
        .eq('version', wallet.version || 1)  // 乐观锁: 只有版本号匹配才能更新
        .select()
        .single()

      console.log('更新钱包结果:', { updateWalletError, updatedWallet: updatedWallet ? 'ok' : 'null' })

      if (updateWalletError || !updatedWallet) {
        console.error('更新钱包余额失败(可能是并发冲突):', updateWalletError)
        throw new Error(`更新余额失败，请重试（可能存在并发操作）`)
      }

      // 创建充值交易记录
      // 【修复 v3】balance_after 使用正确的值（充值后的余额，不包含奖励）
      // 原来的 balance_after = wallet.balance + depositAmount 没有包含奖励金额，
      // 但实际上充值流水的 balance_after 应该是充值后、奖励前的余额
      const balanceAfterDeposit = currentBalance + depositAmount
      console.log('创建交易记录...')
      const { error: txError } = await supabaseClient.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        type: 'DEPOSIT',
        amount: depositAmount,
        balance_before: currentBalance,  // 新增: 记录充值前余额
        balance_after: balanceAfterDeposit,  // 修复: 使用充值后的准确余额
        status: 'COMPLETED',
        description: `充值审核通过 - 订单号: ${depositRequest.order_number}`,
        related_id: requestId,
        processed_at: new Date().toISOString(),
      })
      console.log('交易记录结果:', { txError })

      // 如果有首充奖励，创建奖励交易记录
      if (bonusAmount > 0) {
        console.log('创建首充奖励交易记录...')
        const { error: bonusTxError } = await supabaseClient.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          type: 'BONUS',
          amount: bonusAmount,
          balance_before: balanceAfterDeposit,  // 奖励前余额 = 充值后余额
          balance_after: newBalance,  // 奖励后余额 = 充值 + 奖励
          status: 'COMPLETED',
          description: `首充奖励 (${bonusPercent}%) - 订单号: ${depositRequest.order_number}`,
          related_id: requestId,
          processed_at: new Date().toISOString(),
        })
        console.log('首充奖励交易记录结果:', { bonusTxError })
      }

      // 发送通知给用户
      console.log('发送通知...')
      const { error: notifyError } = await supabaseClient.from('notifications').insert({
        user_id: depositRequest.user_id,
        type: 'PAYMENT_SUCCESS',
        title: '充值成功',
        content: bonusAmount > 0 
          ? `您的充值申请已审核通过,金额${depositAmount} ${depositRequest.currency}已到账，首充奖励+${bonusAmount} ${depositRequest.currency}`
          : `您的充值申请已审核通过,金额${depositAmount} ${depositRequest.currency}已到账`,
        related_id: requestId,
        related_type: 'DEPOSIT_REQUEST',
      })
      console.log('通知结果:', { notifyError })

      // 发送 Telegram 通知 - 充值到账
      try {
        // 插入通知队列 - 充值到账
        await supabaseClient.from('notification_queue').insert({
          user_id: depositRequest.user_id,
          type: 'wallet_deposit',
          payload: {
            transaction_amount: depositAmount,
          },
          telegram_chat_id: null,
          notification_type: 'wallet_deposit',
          title: '充值到账',
          message: '',
          data: {
            transaction_amount: depositAmount,
          },
          priority: 1,
          status: 'pending',
          scheduled_at: new Date().toISOString(),
          retry_count: 0,
          max_retries: 3,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        console.log('充值通知已加入队列');

        // 如果有首充奖励，发送首充奖励通知
        if (bonusAmount > 0) {
          await supabaseClient.from('notification_queue').insert({
            user_id: depositRequest.user_id,
            type: 'first_deposit_bonus',
            payload: {
              deposit_amount: depositAmount,
              bonus_amount: bonusAmount,
              bonus_percent: bonusPercent,
              total_amount: totalCredited,
            },
            telegram_chat_id: null,
            notification_type: 'first_deposit_bonus',
            title: '首充奖励到账',
            message: '',
            data: {
              deposit_amount: depositAmount,
              bonus_amount: bonusAmount,
              bonus_percent: bonusPercent,
              total_amount: totalCredited,
            },
            priority: 1,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          console.log('首充奖励通知已加入队列');
        }
      } catch (error) {
        console.error('Failed to queue Telegram notification:', error);
      }
    } else {
      // 审核拒绝,发送通知
      await supabaseClient.from('notifications').insert({
        user_id: depositRequest.user_id,
        type: 'PAYMENT_FAILED',
        title: '充值失败',
        content: `您的充值申请已被拒绝${adminNote ? `,原因: ${adminNote}` : ''}`,
        related_id: requestId,
        related_type: 'DEPOSIT_REQUEST',
      })

      // 发送 Telegram 通知 - 充值被拒绝（使用提现失败模板）
      try {
        await supabaseClient.from('notification_queue').insert({
          user_id: depositRequest.user_id,
          type: 'wallet_withdraw_failed',
          payload: {
            transaction_amount: depositRequest.amount,
            failure_reason: adminNote || '审核未通过',
            current_balance: 0,
          },
          telegram_chat_id: null,
          notification_type: 'wallet_withdraw_failed',
          title: '充值失败',
          message: '',
          data: {
            transaction_amount: depositRequest.amount,
            failure_reason: adminNote || '审核未通过',
            current_balance: 0,
          },
          priority: 2,
          status: 'pending',
          scheduled_at: new Date().toISOString(),
          retry_count: 0,
          max_retries: 3,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Failed to queue Telegram notification:', error);
      }
    }

    console.log('=== approve-deposit 成功 ===')
    return new Response(
      JSON.stringify({
        success: true,
        message: action === 'APPROVED' ? '审核通过' : '已拒绝',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('审核充值申请错误:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
