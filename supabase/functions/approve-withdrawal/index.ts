/**
 * ============================================================
 * approve-withdrawal Edge Function（提现审核）
 * ============================================================
 * 
 * 功能：管理员审核用户提现申请
 * 
 * 支持操作：
 *   - APPROVED: 审核通过，立即扣除余额 + 解冻
 *   - REJECTED: 审核拒绝，解冻冻结金额
 *   - COMPLETED: 转账完成，更新状态（不再扣款）
 * 
 * 资金安全机制：
 *   - 乐观锁（wallet.version）防止并发余额覆盖
 *   - 状态检查（eq('status', 'PENDING')）防止重复审批
 *   - APPROVED 失败时自动回滚钱包余额
 *   - 完整的钱包流水记录（balance_before/after）
 * 
 * 认证方式：
 *   - x-admin-id header（管理后台）
 *   - Authorization header（Supabase Auth 兼容）
 * ============================================================
 */

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

      const { data: updatedRequest, error: updateError } = await supabaseClient
        .from('withdrawal_requests')
        .update({
          status: 'APPROVED',
          admin_id: adminUserId,
          admin_note: adminNote || null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('status', 'PENDING') // 关键：只更新状态为 PENDING 的记录，防止并发审批
        .select()
        .maybeSingle()

      if (updateError || !updatedRequest) {
        // 【资金安全修复】状态更新失败，回滚钱包余额
        console.error('更新提现申请状态失败，正在回滚钱包余额:', updateError)
        try {
          const rollbackVersion = (wallet.version || 1) + 1; // 扣款时已经 +1
          await supabaseClient
            .from('wallets')
            .update({
              balance: currentBalance,
              frozen_balance: currentFrozenBalance,
              total_withdrawals: currentTotalWithdrawals,
              version: rollbackVersion + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', wallet.id)
            .eq('version', rollbackVersion)
        } catch (rollbackError) {
          console.error('回滚钱包余额失败，需要人工介入:', rollbackError)
        }
        throw new Error(updateError ? '审核失败，余额已回滚' : '该申请已被其他管理员处理，余额已回滚')
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
        title_i18n: {
          zh: '提现审核通过',
          ru: 'Заявка на вывод одобрена',
          tg: 'Дархости баровардан тасдиқ шуд',
        },
        content: `您的提现申请已审核通过，金额${withdrawalRequest.amount} ${withdrawalRequest.currency}已扣除，正在处理转账中`,
        message_i18n: {
          zh: `您的提现申请已审核通过，金额 ${withdrawalRequest.amount} ${withdrawalRequest.currency} 已扣除，正在处理转账中`,
          ru: `Ваш запрос на вывод одобрен. ${withdrawalRequest.amount} ${withdrawalRequest.currency} списано, перевод обрабатывается`,
          tg: `Дархости баровардании шумо тасдиқ шуд. ${withdrawalRequest.amount} ${withdrawalRequest.currency} кам шуд, антиқол коркард мешавад`,
        },
        related_id: requestId,
        related_type: 'WITHDRAWAL_REQUEST',
      })

      // 发送通知到队列
      try {
        const { data: notifyUser } = await supabaseClient
          .from('users')
          .select('phone_number')
          .eq('id', withdrawalRequest.user_id)
          .single()

        if (notifyUser?.phone_number) {
          await supabaseClient.from('notification_queue').insert({
            user_id: withdrawalRequest.user_id,
            phone_number: notifyUser.phone_number,
            notification_type: 'wallet_withdraw_pending',
            title: '提现审核通过',
            message: `您的提现申请已审核通过，金额 ${withdrawalRequest.amount} ${withdrawalRequest.currency}`,
            data: {
              transaction_amount: withdrawalRequest.amount,
              current_balance: newBalance,
            },
            channel: 'whatsapp',
            priority: 2,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }
      } catch (error) {
        console.error('Failed to send notification:', error);
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

      const { data: updatedRequest, error: updateError } = await supabaseClient
        .from('withdrawal_requests')
        .update({
          status: 'REJECTED',
          admin_id: adminUserId,
          admin_note: adminNote || null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('status', 'PENDING') // 关键：只更新状态为 PENDING 的记录，防止并发审批
        .select()
        .maybeSingle()

      if (updateError) {
        console.error('更新申请状态失败:', updateError)
        throw new Error('审核失败')
      }

      if (!updatedRequest) {
        throw new Error('该申请已被其他管理员处理或状态已变更')
      }

      // 创建解冻交易记录
      // 【修复 4.1】添加 balance_before 确保流水记录完整
      await supabaseClient.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        type: 'WITHDRAWAL_UNFREEZE',
        amount: 0, // 解冻不改变余额
        balance_before: currentBalance,  // 【修复 4.1】新增: 记录解冻前余额
        balance_after: currentBalance,
        status: 'COMPLETED',
        description: `提现申请被拒绝，已解冻 - 订单号: ${withdrawalRequest.order_number}`,
        related_id: requestId,
        processed_at: new Date().toISOString(),
      })

      // 发送通知给用户
      await supabaseClient.from('notifications').insert({
        user_id: withdrawalRequest.user_id,
        type: 'PAYMENT_FAILED',
        title: '提现失败',
        title_i18n: {
          zh: '提现失败',
          ru: 'Ошибка вывода',
          tg: 'Хатои баровардан',
        },
        content: `您的提现申请已被拒绝${adminNote ? `,原因: ${adminNote}` : ''},金额已解冻`,
        message_i18n: {
          zh: `您的提现申请已被拒绝${adminNote ? `，原因：${adminNote}` : ''}，金额已解冻`,
          ru: `Ваш запрос на вывод отклонён${adminNote ? `. Причина: ${adminNote}` : ''}. Средства разморожены`,
          tg: `Дархости баровардании шумо рад карда шуд${adminNote ? `. Сабаб: ${adminNote}` : ''}. Маблағ аз карда шуд`,
        },
        related_id: requestId,
        related_type: 'WITHDRAWAL_REQUEST',
      })

      // 发送通知到队列
      try {
        const { data: notifyUser } = await supabaseClient
          .from('users')
          .select('phone_number')
          .eq('id', withdrawalRequest.user_id)
          .single()

        if (notifyUser?.phone_number) {
          await supabaseClient.from('notification_queue').insert({
            user_id: withdrawalRequest.user_id,
            phone_number: notifyUser.phone_number,
            notification_type: 'wallet_withdraw_failed',
            title: '提现申请被拒绝',
            message: `您的提现申请已被拒绝${adminNote ? `，原因: ${adminNote}` : ''}，金额已解冻`,
            data: {
              transaction_amount: withdrawalRequest.amount,
              failure_reason: adminNote || '审核未通过',
              current_balance: currentBalance,
            },
            channel: 'whatsapp',
            priority: 2,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }
      } catch (error) {
        console.error('Failed to send notification:', error);
      }
    } else if (action === 'COMPLETED') {
      /**
       * 转账完成 - 只更新状态，不再扣款
       * 
       * 流程说明：
       * 1. 余额已在 APPROVED 状态时扣除
       * 2. COMPLETED 只是标记转账已完成，不再扣款
       */
      
      const { data: updatedRequest, error: updateError } = await supabaseClient
        .from('withdrawal_requests')
        .update({
          status: 'COMPLETED',
          admin_id: adminUserId,
          admin_note: adminNote || null,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('status', 'APPROVED') // 关键：只更新状态为 APPROVED 的记录，防止并发确认
        .select()
        .maybeSingle()

      if (updateError) {
        console.error('更新申请状态失败:', updateError)
        throw new Error('确认打款失败')
      }

      if (!updatedRequest) {
        throw new Error('该申请已被其他管理员处理或状态已变更')
      }

      // 发送通知给用户
      await supabaseClient.from('notifications').insert({
        user_id: withdrawalRequest.user_id,
        type: 'PAYMENT_SUCCESS',
        title: '提现成功',
        title_i18n: {
          zh: '提现成功',
          ru: 'Вывод успешен',
          tg: 'Баровардан бомуваффақият',
        },
        content: `您的提现已完成，金额${withdrawalRequest.amount} ${withdrawalRequest.currency}已转账到账`,
        message_i18n: {
          zh: `您的提现已完成，金额 ${withdrawalRequest.amount} ${withdrawalRequest.currency} 已转账到账`,
          ru: `Ваш вывод завершён. ${withdrawalRequest.amount} ${withdrawalRequest.currency} переведено`,
          tg: `Баровардании шумо анҷом шуд. ${withdrawalRequest.amount} ${withdrawalRequest.currency} антиқол шуд`,
        },
        related_id: requestId,
        related_type: 'WITHDRAWAL_REQUEST',
      })

      // 发送通知到队列
      try {
        const { data: notifyUser } = await supabaseClient
          .from('users')
          .select('phone_number')
          .eq('id', withdrawalRequest.user_id)
          .single()

        if (notifyUser?.phone_number) {
          await supabaseClient.from('notification_queue').insert({
            user_id: withdrawalRequest.user_id,
            phone_number: notifyUser.phone_number,
            notification_type: 'wallet_withdraw_completed',
            title: '提现已完成',
            message: `您的提现已完成，金额 ${withdrawalRequest.amount} ${withdrawalRequest.currency} 已转账到账`,
            data: {
              transaction_amount: withdrawalRequest.amount,
              estimated_arrival: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Dushanbe' }),
            },
            channel: 'whatsapp',
            priority: 2,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }
      } catch (error) {
        console.error('Failed to send notification:', error);
      }
    }

    // 记录操作日志
    await supabaseClient.rpc('log_edge_function_action', {
      p_function_name: 'approve-withdrawal',
      p_action: action === 'APPROVED' ? 'APPROVE_WITHDRAWAL' : action === 'REJECTED' ? 'REJECT_WITHDRAWAL' : 'COMPLETE_WITHDRAWAL',
      p_user_id: adminUserId,
      p_target_type: 'withdrawal_request',
      p_target_id: requestId,
      p_details: {
        admin_id: adminUserId,
        user_id: withdrawalRequest.user_id,
        amount: withdrawalRequest.amount,
        currency: withdrawalRequest.currency,
        order_number: withdrawalRequest.order_number,
        withdrawal_method: withdrawalRequest.withdrawal_method,
        admin_note: adminNote || null,
      },
      p_status: 'success',
      p_error_message: null,
    }).then(({ error: logErr }) => { if (logErr) {console.error('Failed to write audit log:', logErr);} })
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
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('审核提现申请错误:', errMsg)
    try {
      const logClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await logClient.rpc('log_edge_function_action', {
        p_function_name: 'approve-withdrawal',
        p_action: 'WITHDRAWAL_REVIEW_ERROR',
        p_user_id: req.headers.get('x-admin-id') || null,
        p_target_type: 'withdrawal_request',
        p_target_id: null,
        p_details: {},
        p_status: 'error',
        p_error_message: errMsg,
      })
    } catch (_) { /* 日志写入失败不影响响应 */ }
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
