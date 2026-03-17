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
      const depositAmount = Number(depositRequest.amount)

      // ============================================================
      // 【业务重构】每次充值赠送（移除首充限制）
      // 只要满足 min_deposit_amount 即可获得赠送
      // ============================================================
      let bonusAmount = 0
      let bonusPercent = 0

      // 获取充值赠送配置（数据库 key 保持 first_deposit_bonus 不变，避免破坏现有数据）
      console.log('检查充值赠送配置...')
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

        console.log('充值赠送配置:', config)

        // 【修改】移除首充限制：不再检查 isFirstDeposit 和 first_deposit_bonus_claimed
        // 只要 enabled 且金额达标即可获得赠送
        if (config.enabled && depositAmount >= config.min_deposit_amount) {
          bonusPercent = config.bonus_percent
          bonusAmount = Math.min(
            depositAmount * (config.bonus_percent / 100),
            config.max_bonus_amount
          )
          console.log('充值赠送金额:', bonusAmount)
        }
      }

      // ============================================================
      // 【业务重构】调用 process_deposit_with_bonus RPC 函数
      // 核心修复: 本金入 TJS 钱包，赠送入 LUCKY_COIN 钱包
      // 替代原有的手动更新 wallets 表逻辑
      // ============================================================
      console.log('调用 process_deposit_with_bonus RPC...')
      const { data: rpcResult, error: rpcError } = await supabaseClient.rpc(
        'process_deposit_with_bonus',
        {
          p_request_id: requestId,
          p_user_id: depositRequest.user_id,
          p_deposit_amount: depositAmount,
          p_bonus_amount: bonusAmount,
          p_order_number: depositRequest.order_number,
        }
      )

      console.log('RPC 结果:', { rpcResult, rpcError })

      if (rpcError) {
        console.error('process_deposit_with_bonus RPC 调用失败:', rpcError)
        // 【P5修复】RPC 失败时回滚 deposit_request 状态为 PENDING
        await supabaseClient
          .from('deposit_requests')
          .update({ status: 'PENDING', processed_by: null, processed_at: null, updated_at: new Date().toISOString() })
          .eq('id', requestId)
        console.log('已回滚 deposit_request 状态为 PENDING')
        throw new Error(`充值处理失败: ${rpcError.message}`)
      }

      if (!rpcResult || !rpcResult.success) {
        const errorMsg = rpcResult?.error || '未知错误'
        console.error('process_deposit_with_bonus 业务错误:', errorMsg)
        // 【P5修复】RPC 业务失败时回滚 deposit_request 状态为 PENDING
        await supabaseClient
          .from('deposit_requests')
          .update({ status: 'PENDING', processed_by: null, processed_at: null, updated_at: new Date().toISOString() })
          .eq('id', requestId)
        console.log('已回滚 deposit_request 状态为 PENDING')
        throw new Error(`充值处理失败: ${errorMsg}`)
      }

      const newTjsBalance = rpcResult.tjs_new_balance
      const newLcBalance = rpcResult.lc_new_balance

      // 发送通知给用户
      console.log('发送通知...')
      const { error: notifyError } = await supabaseClient.from('notifications').insert({
        user_id: depositRequest.user_id,
        type: 'PAYMENT_SUCCESS',
        title: '充值成功',
        title_i18n: {
          zh: '充值成功',
          ru: 'Пополнение успешно',
          tg: 'Пуркунӣ бомуваффақият',
        },
        content: bonusAmount > 0 
          ? `您的充值申请已审核通过,金额${depositAmount} ${depositRequest.currency}已到账，赠送+${bonusAmount} 积分`
          : `您的充值申请已审核通过,金额${depositAmount} ${depositRequest.currency}已到账`,
        message_i18n: bonusAmount > 0 ? {
          zh: `您的充值申请已审核通过，金额 ${depositAmount} ${depositRequest.currency} 已到账，赠送 +${bonusAmount} 积分`,
          ru: `Ваш запрос на пополнение одобрен. ${depositAmount} ${depositRequest.currency} зачислено, бонус +${bonusAmount} баллов`,
          tg: `Дархости пуркунии шумо тасдиқ шуд. ${depositAmount} ${depositRequest.currency} ворид шуд, мукофот +${bonusAmount} хол`,
        } : {
          zh: `您的充值申请已审核通过，金额 ${depositAmount} ${depositRequest.currency} 已到账`,
          ru: `Ваш запрос на пополнение одобрен. ${depositAmount} ${depositRequest.currency} зачислено`,
          tg: `Дархости пуркунии шумо тасдиқ шуд. ${depositAmount} ${depositRequest.currency} ворид шуд`,
        },
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

        // 如果有赠送，发送赠送通知
        // 【修改】通知类型从 first_deposit_bonus 改为 deposit_bonus（语义更准确）
        // 但保持 notification_type 为 first_deposit_bonus 以兼容现有 Telegram 模板
        if (bonusAmount > 0) {
          await supabaseClient.from('notification_queue').insert({
            user_id: depositRequest.user_id,
            type: 'first_deposit_bonus',
            payload: {
              deposit_amount: depositAmount,
              bonus_amount: bonusAmount,
              bonus_percent: bonusPercent,
              total_amount: depositAmount + bonusAmount,
            },
            telegram_chat_id: null,
            notification_type: 'first_deposit_bonus',
            title: '充值赠送到账',
            message: '',
            data: {
              deposit_amount: depositAmount,
              bonus_amount: bonusAmount,
              bonus_percent: bonusPercent,
              total_amount: depositAmount + bonusAmount,
            },
            priority: 1,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          console.log('充值赠送通知已加入队列');
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
        title_i18n: {
          zh: '充值失败',
          ru: 'Ошибка пополнения',
          tg: 'Хатои пуркунӣ',
        },
        content: `您的充值申请已被拒绝${adminNote ? `,原因: ${adminNote}` : ''}`,
        message_i18n: {
          zh: `您的充值申请已被拒绝${adminNote ? `，原因：${adminNote}` : ''}`,
          ru: `Ваш запрос на пополнение отклонён${adminNote ? `. Причина: ${adminNote}` : ''}`,
          tg: `Дархости пуркунии шумо рад карда шуд${adminNote ? `. Сабаб: ${adminNote}` : ''}`,
        },
        related_id: requestId,
        related_type: 'DEPOSIT_REQUEST',
      })

      // 发送 Telegram 通知 - 充值被拒绝（使用专用的充值拒绝模板，支持多语言）
      try {
        // 拒绝原因多语言处理
        const defaultReasonI18n = {
          zh: '审核未通过',
          ru: 'Не прошло проверку',
          tg: 'Аз санҷиш нагузашт',
        };
        const failureReason = adminNote || defaultReasonI18n.tg;

        await supabaseClient.from('notification_queue').insert({
          user_id: depositRequest.user_id,
          type: 'wallet_deposit_rejected',
          payload: {
            transaction_amount: depositRequest.amount,
            failure_reason: failureReason,
          },
          telegram_chat_id: null,
          notification_type: 'wallet_deposit_rejected',
          title: '充值申请被拒绝',
          message: '',
          data: {
            transaction_amount: depositRequest.amount,
            failure_reason: failureReason,
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
    // 记录操作日志
    await supabaseClient.rpc('log_edge_function_action', {
      p_function_name: 'approve-deposit',
      p_action: action === 'APPROVED' ? 'APPROVE_DEPOSIT' : 'REJECT_DEPOSIT',
      p_user_id: adminUserId,
      p_target_type: 'deposit_request',
      p_target_id: requestId,
      p_details: {
        admin_id: adminUserId,
        user_id: depositRequest.user_id,
        amount: depositRequest.amount,
        currency: depositRequest.currency,
        order_number: depositRequest.order_number,
        admin_note: adminNote || null,
      },
      p_status: 'success',
      p_error_message: null,
    }).then(({ error: logErr }) => { if (logErr) console.error('Failed to write audit log:', logErr); })
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
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('审核充值申请错误:', errMsg)
    // 记录失败日志（尽力而为）
    try {
      const logClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await logClient.rpc('log_edge_function_action', {
        p_function_name: 'approve-deposit',
        p_action: 'DEPOSIT_REVIEW_ERROR',
        p_user_id: req.headers.get('x-admin-id') || null,
        p_target_type: 'deposit_request',
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
