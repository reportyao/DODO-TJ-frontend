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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 获取管理员认证
    const adminId = req.headers.get('x-admin-id')
    const authHeader = req.headers.get('Authorization')
    
    let adminUserId: string | null = null
    
    // 方式1: 通过 x-admin-id 头部认证（管理后台使用）
    if (adminId) {
      console.log('Authenticating with x-admin-id:', adminId);
      // 验证管理员是否存在且有效
      const { data: adminUser, error: adminError } = await supabaseClient
        .from('admin_users')
        .select('id, status, is_active')
        .eq('id', adminId)
        .single()
      
      console.log('Admin user query result:', { adminUser, adminError });
      
      if (adminError) {
        console.error('Admin query error:', adminError);
        throw new Error('管理员查询失败: ' + adminError.message)
      }
      
      if (!adminUser) {
        throw new Error('管理员不存在')
      }
      
      // 检查管理员状态 - 兼容 status='active' 或 is_active=true
      const isActive = adminUser.status === 'active' || adminUser.is_active === true;
      if (!isActive) {
        throw new Error('管理员账户已禁用')
      }
      
      adminUserId = adminUser.id
    }
    // 方式2: 通过 Supabase Auth token 认证（兼容旧方式）
    else if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
      
      if (!userError && user) {
        adminUserId = user.id
      }
    }
    
    if (!adminUserId) {
      console.error('Authentication failed: no valid admin ID or auth token');
      return new Response(
        JSON.stringify({
          success: false,
          error: '未授权：请提供有效的管理员认证',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      )
    }

    const { requestId, action, adminNote, transferProofImages, transferReference } = await req.json()

    // 验证参数
    if (!requestId) {
      throw new Error('请求ID不能为空')
    }

    if (!action || !['APPROVED', 'REJECTED', 'COMPLETED'].includes(action)) {
      throw new Error('无效的审核操作')
    }

    // 获取提现申请
    const { data: withdrawalRequest, error: requestError } = await supabaseClient
      .from('withdrawal_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (requestError || !withdrawalRequest) {
      throw new Error('未找到提现申请')
    }

    // 检查申请状态
    if (action === 'APPROVED' && withdrawalRequest.status !== 'PENDING') {
      throw new Error('该申请已被处理')
    }

    if (action === 'COMPLETED' && withdrawalRequest.status !== 'APPROVED') {
      throw new Error('该申请尚未审核通过')
    }

    // 获取用户余额钱包
    const { data: wallet, error: walletError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', withdrawalRequest.user_id)
      .eq('type', 'TJS')
      .eq('currency', withdrawalRequest.currency)
      .single()

    if (walletError || !wallet) {
      throw new Error('未找到用户钱包')
    }

    const withdrawAmount = parseFloat(withdrawalRequest.amount)
    const currentBalance = parseFloat(wallet.balance) || 0
    const currentFrozenBalance = parseFloat(wallet.frozen_balance) || 0
    const currentTotalWithdrawals = parseFloat(wallet.total_withdrawals) || 0

    if (action === 'APPROVED') {
      /**
       * 审核通过 - 直接扣除余额
       * 
       * 流程说明：
       * 1. 用户提交提现申请时，余额被冻结
       * 2. 管理员审核通过时，直接扣除余额（不再等待 COMPLETED 状态）
       * 3. 前端显示的余额会立即减少
       */
      
      // 计算可用余额（总余额减去已冻结的金额）
      const availableBalance = currentBalance - currentFrozenBalance
      
      console.log('Withdrawal APPROVED check:', {
        withdrawAmount,
        currentBalance,
        currentFrozenBalance,
        availableBalance
      })
      
      // 检查余额是否足够
      if (currentBalance < withdrawAmount) {
        throw new Error(`余额不足，当前余额: ${currentBalance}，提现金额: ${withdrawAmount}`)
      }
      
      // 直接扣除余额，同时清除冻结金额
      // 【资金安全修复 v3】添加乐观锁防止并发更新导致余额错误
      const newBalance = currentBalance - withdrawAmount
      // 从冻结余额中扣除（如果有冻结的话）
      const amountToUnfreeze = Math.min(currentFrozenBalance, withdrawAmount)
      const newFrozenBalance = Math.max(0, currentFrozenBalance - amountToUnfreeze)
      
      const { error: deductError, data: updatedWallet } = await supabaseClient
        .from('wallets')
        .update({
          balance: newBalance,
          frozen_balance: newFrozenBalance,
          total_withdrawals: currentTotalWithdrawals + withdrawAmount,
          version: (wallet.version || 1) + 1,  // 乐观锁: 版本号+1
          updated_at: new Date().toISOString(),
        })
        .eq('id', wallet.id)
        .eq('version', wallet.version || 1)  // 乐观锁: 只有版本号匹配才能更新
        .select()
        .single()

      if (deductError || !updatedWallet) {
        console.error('扣除余额失败(可能是并发冲突):', deductError)
        throw new Error('扣除余额失败，请重试（可能存在并发操作）')
      }

      const { error: updateError } = await supabaseClient
        .from('withdrawal_requests')
        .update({
          status: 'APPROVED',
          admin_id: adminUserId,
          admin_note: adminNote || null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)

      if (updateError) {
        console.error('更新申请状态失败:', updateError)
        throw new Error('审核失败')
      }

      // 创建钱包交易记录 - 审核通过时就扣款
      // 【修复 v3】添加 balance_before 字段，确保流水记录完整
      await supabaseClient.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        type: 'WITHDRAWAL',
        amount: -withdrawAmount,
        balance_before: currentBalance,  // 新增: 记录扣款前余额
        balance_after: newBalance,
        status: 'COMPLETED',
        description: `提现审核通过 - 订单号: ${withdrawalRequest.order_number}`,
        related_id: requestId,
        processed_at: new Date().toISOString(),
      })

      // 发送通知给用户
      await supabaseClient.from('notifications').insert({
        user_id: withdrawalRequest.user_id,
        type: 'PAYMENT_SUCCESS',
        title: '提现审核通过',
        content: `您的提现申请已审核通过，金额${withdrawalRequest.amount} ${withdrawalRequest.currency}已扣除，正在处理转账中`,
        related_id: requestId,
        related_type: 'WITHDRAWAL_REQUEST',
      })

      // Send Telegram notification
      try {
        await supabaseClient.functions.invoke('send-telegram-notification', {
          body: {
            user_id: withdrawalRequest.user_id,
            type: 'wallet_withdraw_pending',
            data: {
              transaction_amount: withdrawalRequest.amount,
              current_balance: newBalance,
            },
            priority: 2,
          },
        });
      } catch (error) {
        console.error('Failed to send Telegram notification:', error);
      }
    } else if (action === 'REJECTED') {
      // 审核拒绝 - 解冻余额，返还给用户
      // 【资金安全修复 v3】添加乐观锁防止并发更新
      const amountToUnfreeze = Math.min(currentFrozenBalance, withdrawAmount)
      
      const { error: unfreezeError, data: unfrozenWallet } = await supabaseClient
        .from('wallets')
        .update({
          frozen_balance: Math.max(0, currentFrozenBalance - withdrawAmount),
          version: (wallet.version || 1) + 1,  // 乐观锁: 版本号+1
          updated_at: new Date().toISOString(),
        })
        .eq('id', wallet.id)
        .eq('version', wallet.version || 1)  // 乐观锁: 只有版本号匹配才能更新
        .select()
        .single()

      if (unfreezeError || !unfrozenWallet) {
        console.error('解冻余额失败(可能是并发冲突):', unfreezeError)
        throw new Error('解冻余额失败，请重试（可能存在并发操作）')
      }

      const { error: updateError } = await supabaseClient
        .from('withdrawal_requests')
        .update({
          status: 'REJECTED',
          admin_id: adminUserId,
          admin_note: adminNote || null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)

      if (updateError) {
        console.error('更新申请状态失败:', updateError)
        throw new Error('审核失败')
      }

      // 创建解冻交易记录
      await supabaseClient.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        type: 'WITHDRAWAL_UNFREEZE',
        amount: 0, // 解冻不改变余额
        balance_after: currentBalance,
        status: 'COMPLETED',
        description: `提现申请被拒绝，已解冻 - 订单号: ${withdrawalRequest.order_number}`,
        related_id: requestId,
      })

      // 发送通知给用户
      await supabaseClient.from('notifications').insert({
        user_id: withdrawalRequest.user_id,
        type: 'PAYMENT_FAILED',
        title: '提现失败',
        content: `您的提现申请已被拒绝${adminNote ? `,原因: ${adminNote}` : ''},金额已解冻`,
        related_id: requestId,
        related_type: 'WITHDRAWAL_REQUEST',
      })

      // Send Telegram notification
      try {
        await supabaseClient.functions.invoke('send-telegram-notification', {
          body: {
            user_id: withdrawalRequest.user_id,
            type: 'wallet_withdraw_failed',
            data: {
              transaction_amount: withdrawalRequest.amount,
              failure_reason: adminNote || '审核未通过',
              current_balance: currentBalance,
            },
            priority: 2,
          },
        });
      } catch (error) {
        console.error('Failed to send Telegram notification:', error);
      }
    } else if (action === 'COMPLETED') {
      /**
       * 转账完成 - 只更新状态，不再扣款
       * 
       * 流程说明：
       * 1. 余额已在 APPROVED 状态时扣除
       * 2. COMPLETED 只是标记转账已完成，不再扣款
       */
      
      const { error: updateError } = await supabaseClient
        .from('withdrawal_requests')
        .update({
          status: 'COMPLETED',
          transfer_proof_images: transferProofImages || null,
          transfer_reference: transferReference || null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)

      if (updateError) {
        console.error('更新申请状态失败:', updateError)
        throw new Error('更新失败')
      }

      // 发送通知给用户
      await supabaseClient.from('notifications').insert({
        user_id: withdrawalRequest.user_id,
        type: 'PAYMENT_SUCCESS',
        title: '提现成功',
        content: `您的提现已完成，金额${withdrawalRequest.amount} ${withdrawalRequest.currency}已转账到账`,
        related_id: requestId,
        related_type: 'WITHDRAWAL_REQUEST',
      })

      // Send Telegram notification
      try {
        await supabaseClient.functions.invoke('send-telegram-notification', {
          body: {
            user_id: withdrawalRequest.user_id,
            type: 'wallet_withdraw_completed',
            data: {
              transaction_amount: withdrawalRequest.amount,
              estimated_arrival: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' }),
            },
            priority: 2,
          },
        });
      } catch (error) {
        console.error('Failed to send Telegram notification:', error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: action === 'APPROVED' ? '审核通过' : action === 'REJECTED' ? '已拒绝' : '转账完成',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('审核提现申请错误:', error)
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
