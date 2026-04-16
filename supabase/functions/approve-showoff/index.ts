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
      const { data: adminUser, error: adminError } = await supabaseClient
        .from('admin_users')
        .select('id, status')
        .eq('id', adminId)
        .single()
      
      if (adminError || !adminUser || adminUser.status !== 'active') {
        throw new Error('管理员认证失败')
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
      throw new Error('未授权')
    }

    const { showoffId, action, rewardCoins, adminNote } = await req.json()

    // 验证参数
    if (!showoffId) {
      throw new Error('晒单ID不能为空')
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      throw new Error('无效的审核操作')
    }

    // 获取晒单记录
    const { data: showoff, error: showoffError } = await supabaseClient
      .from('showoffs')
      .select('*')
      .eq('id', showoffId)
      .single()

    if (showoffError || !showoff) {
      throw new Error('未找到晒单记录')
    }

    // 检查晒单状态
    if (showoff.status !== 'PENDING') {
      throw new Error('该晒单已被处理')
    }

    // 更新晒单状态
    const updateData: any = {
      status: action,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      admin_note: adminNote || null,
    }

    // 只有批准时才设置奖励
    if (action === 'APPROVED') {
      updateData.reward_coins = rewardCoins || 0
    }

    const { data: updatedShowoff, error: updateError } = await supabaseClient
      .from('showoffs')
      .update(updateData)
      .eq('id', showoffId)
      .eq('status', 'PENDING') // 关键：只更新状态为 PENDING 的记录，防止并发审批
      .select()
      .maybeSingle()

    if (updateError) {
      console.error('更新晒单状态失败:', updateError)
      throw new Error('审核失败')
    }

    if (!updatedShowoff) {
      throw new Error('该晒单已被其他管理员处理或状态已变更')
    }

    // 如果批准且有奖励，给用户增加积分
    if (action === 'APPROVED' && rewardCoins && rewardCoins > 0) {
      // 查询用户的积分钱包
      // 【修复 v3】查询 version 字段用于乐观锁
      const { data: wallet, error: walletError } = await supabaseClient
        .from('wallets')
        .select('*')
        .eq('user_id', showoff.user_id)
        .eq('type', 'LUCKY_COIN')
        .single()

      if (walletError || !wallet) {
        console.error('查询积分钱包失败:', walletError)
        throw new Error('未找到用户积分钱包')
      }

      // 更新钱包余额
      // 【资金安全修复 v3】添加乐观锁防止并发更新导致余额错误
      const currentBalance = parseFloat(wallet.balance)
      const newBalance = currentBalance + rewardCoins
      const currentVersion = wallet.version || 1

      const { error: updateWalletError, data: updatedWallet } = await supabaseClient
        .from('wallets')
        .update({
          balance: newBalance,
          version: currentVersion + 1,  // 乐观锁: 版本号+1
          updated_at: new Date().toISOString(),
        })
        .eq('id', wallet.id)
        .eq('version', currentVersion)  // 乐观锁: 只有版本号匹配才能更新
        .select()
        .single()

      if (updateWalletError || !updatedWallet) {
        console.error('更新积分余额失败(可能是并发冲突):', updateWalletError)
        throw new Error('更新积分余额失败，请重试')
      }

      // 创建交易记录
      // 【修复 v3】添加 balance_before 和 status 字段
      await supabaseClient.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        type: 'SHOWOFF_REWARD',
        amount: rewardCoins,
        balance_before: currentBalance,  // 新增: 记录奖励前余额
        balance_after: newBalance,
        status: 'COMPLETED',
        description: `晒单审核通过奖励 - ${rewardCoins} 积分`,
        related_id: showoffId,
        processed_at: new Date().toISOString(),
      })

      // 发送通知给用户
      await supabaseClient.from('notifications').insert({
        user_id: showoff.user_id,
        type: 'SHOWOFF_APPROVED',
        title: '晒单审核通过',
        title_i18n: {
          zh: '晒单审核通过',
          ru: 'Отзыв одобрен',
          tg: 'Шарҳи тасдиқ шуд',
        },
        content: `您的晒单已审核通过，获得 ${rewardCoins} 积分奖励！`,
        message_i18n: {
          zh: `您的晒单已审核通过，获得 ${rewardCoins} 积分奖励！`,
          ru: `Ваш отзыв одобрен. Вы получили ${rewardCoins} баллов!`,
          tg: `Шарҳи шумо тасдиқ шуд. Шумо ${rewardCoins} хол гирифтед!`,
        },
        related_id: showoffId,
        related_type: 'SHOWOFF',
      })

      // 发送通知到队列
      const { data: user } = await supabaseClient
        .from('users')
        .select('phone_number')
        .eq('id', showoff.user_id)
        .single()

      if (user?.phone_number) {
        await supabaseClient
          .from('notification_queue')
          .insert({
            user_id: showoff.user_id,
            type: 'showoff_approved',
            payload: {
              reward_amount: rewardCoins
            },
            phone_number: user.phone_number,
            notification_type: 'showoff_approved',
            title: '晒单审核通过',
            message: `您的晒单已审核通过`,
            data: {
              reward_amount: rewardCoins
            },
            channel: 'whatsapp',
            priority: 2,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
      }
    } else if (action === 'APPROVED') {
      // 批准但没有奖励
      await supabaseClient.from('notifications').insert({
        user_id: showoff.user_id,
        type: 'SHOWOFF_APPROVED',
        title: '晒单审核通过',
        title_i18n: {
          zh: '晒单审核通过',
          ru: 'Отзыв одобрен',
          tg: 'Шарҳи тасдиқ шуд',
        },
        content: '您的晒单已审核通过！',
        message_i18n: {
          zh: '您的晒单已审核通过！',
          ru: 'Ваш отзыв одобрен!',
          tg: 'Шарҳи шумо тасдиқ шуд!',
        },
        related_id: showoffId,
        related_type: 'SHOWOFF',
      })

      // 发送通知到队列
      const { data: user } = await supabaseClient
        .from('users')
        .select('phone_number')
        .eq('id', showoff.user_id)
        .single()

      if (user?.phone_number) {
        await supabaseClient
          .from('notification_queue')
          .insert({
            user_id: showoff.user_id,
            type: 'showoff_approved',
            payload: {
              reward_amount: 0
            },
            phone_number: user.phone_number,
            notification_type: 'showoff_approved',
            title: '晒单审核通过',
            message: `您的晒单已审核通过`,
            data: {
              reward_amount: 0
            },
            channel: 'whatsapp',
            priority: 2,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
      }
    } else {
      // 审核拒绝,发送通知
      await supabaseClient.from('notifications').insert({
        user_id: showoff.user_id,
        type: 'SHOWOFF_REJECTED',
        title: '晒单审核未通过',
        title_i18n: {
          zh: '晒单审核未通过',
          ru: 'Отзыв отклонён',
          tg: 'Шарҳ рад карда шуд',
        },
        content: `您的晒单审核未通过${adminNote ? `，原因: ${adminNote}` : ''}`,
        message_i18n: {
          zh: `您的晒单审核未通过${adminNote ? `，原因：${adminNote}` : ''}`,
          ru: `Ваш отзыв отклонён${adminNote ? `. Причина: ${adminNote}` : ''}`,
          tg: `Шарҳи шумо рад карда шуд${adminNote ? `. Сабаб: ${adminNote}` : ''}`,
        },
        related_id: showoffId,
        related_type: 'SHOWOFF',
      })

      // 发送通知到队列
      const { data: user } = await supabaseClient
        .from('users')
        .select('phone_number')
        .eq('id', showoff.user_id)
        .single()

      if (user?.phone_number) {
        await supabaseClient
          .from('notification_queue')
          .insert({
            user_id: showoff.user_id,
            phone_number: user.phone_number,
            notification_type: 'showoff_rejected',
            title: '晒单审核未通过',
            message: `您的晒单审核未通过`,
            data: {
              reason: adminNote || '不符合要求'
            },
            channel: 'whatsapp',
            priority: 2,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
      }
    }

    // 记录操作日志
    await supabaseClient.rpc('log_edge_function_action', {
      p_function_name: 'approve-showoff',
      p_action: action === 'APPROVED' ? 'APPROVE_SHOWOFF' : 'REJECT_SHOWOFF',
      p_user_id: adminUserId,
      p_target_type: 'showoff',
      p_target_id: showoffId,
      p_details: {
        admin_id: adminUserId,
        user_id: showoff.user_id,
        reward_coins: action === 'APPROVED' ? (rewardCoins || 0) : 0,
        admin_note: adminNote || null,
      },
      p_status: 'success',
      p_error_message: null,
    }).then(({ error: logErr }) => { if (logErr) {console.error('Failed to write audit log:', logErr);} })
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
    console.error('审核晒单错误:', errMsg)
    try {
      const logClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await logClient.rpc('log_edge_function_action', {
        p_function_name: 'approve-showoff',
        p_action: 'SHOWOFF_REVIEW_ERROR',
        p_user_id: req.headers.get('x-admin-id') || null,
        p_target_type: 'showoff',
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
