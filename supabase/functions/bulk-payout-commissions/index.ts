/**
 * ============================================================================
 * 批量发放佣金 Edge Function (bulk-payout-commissions)
 * ============================================================================
 *
 * 功能概述:
 *   管理员批量将 pending 状态的佣金记录发放到用户钱包。
 *   佣金发放到 TJS 现金钱包。
 *
 * 钱包类型标准（重要）:
 *   - 现金钱包: type='TJS', currency='TJS'
 *   - 积分钱包: type='LUCKY_COIN', currency='POINTS'
 *
 * 变更历史:
 *   v1: 初始版本
 *   v3 (2026-03-05): 资金安全修复
 *     - 修复: 查询钱包时指定 type='TJS'，避免查到积分钱包
 *     - 修复: 添加乐观锁防止并发更新导致余额错误
 *     - 修复: wallet_transactions 使用 wallet_id 而非 user_id
 *     - 修复: 添加 balance_before 字段到交易记录
 * ============================================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
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

    const { commission_ids } = await req.json()

    if (!commission_ids || !Array.isArray(commission_ids) || commission_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'commission_ids array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let success_count = 0
    let fail_count = 0
    const errors: any[] = []

    for (const commission_id of commission_ids) {
      try {
        // 获取返利记录
        const { data: commission, error: commissionError } = await supabaseClient
          .from('commissions')
          .select('*')
          .eq('id', commission_id)
          .eq('status', 'pending')
          .single()

        if (commissionError || !commission) {
          fail_count++
          errors.push({ commission_id, error: 'Commission not found or not pending' })
          continue
        }

        // 确定佣金受益人ID
        // 兼容多种字段名（历史遗留问题）
        const beneficiaryId = commission.user_id || commission.referrer_id || commission.beneficiary_id
        
        if (!beneficiaryId) {
          fail_count++
          errors.push({ commission_id, error: 'No beneficiary ID found in commission record' })
          continue
        }
        
        // 【修复 v3】查询钱包时必须指定 type='TJS'
        // 原代码没有指定钱包类型，如果用户有多个钱包（TJS + LUCKY_COIN），
        // 可能会查到积分钱包，导致佣金发放到错误的钱包
        const { data: wallet, error: walletError } = await supabaseClient
          .from('wallets')
          .select('id, balance, version')  // 修复: 查询 id 和 version 用于乐观锁
          .eq('user_id', beneficiaryId)
          .eq('type', 'TJS')              // 修复: 指定现金钱包类型
          .single()

        if (walletError || !wallet) {
          fail_count++
          errors.push({ commission_id, error: 'TJS wallet not found for user' })
          continue
        }

        const currentBalance = parseFloat(wallet.balance || '0')
        const commissionAmount = parseFloat(commission.amount)
        const newBalance = currentBalance + commissionAmount
        const currentVersion = wallet.version || 1

        // 【资金安全修复 v3】使用乐观锁更新钱包余额
        // 使用 wallet.id 精确定位钱包，而非 user_id（用户可能有多个钱包）
        const { error: updateWalletError, data: updatedWallet } = await supabaseClient
          .from('wallets')
          .update({ 
            balance: newBalance,
            version: currentVersion + 1,  // 乐观锁: 版本号+1
            updated_at: new Date().toISOString()
          })
          .eq('id', wallet.id)              // 修复: 使用 wallet.id 而非 user_id
          .eq('version', currentVersion)    // 乐观锁: 只有版本号匹配才能更新
          .select()
          .single()

        if (updateWalletError || !updatedWallet) {
          fail_count++
          errors.push({ commission_id, error: 'Failed to update wallet (possible concurrent conflict)' })
          continue
        }

        // 【修复 v3】创建钱包交易记录
        // - 使用 wallet_id 而非 user_id（wallet_transactions 表的外键是 wallet_id）
        // - 添加 balance_before 字段
        const { error: transactionError } = await supabaseClient
          .from('wallet_transactions')
          .insert({
            wallet_id: wallet.id,           // 修复: 使用 wallet_id 而非 user_id
            type: 'COMMISSION_PAYOUT',      // 修复: 使用更明确的类型名
            amount: commissionAmount,
            balance_before: currentBalance,  // 新增: 记录发放前余额
            balance_after: newBalance,
            status: 'COMPLETED',
            description: `L${commission.level} referral commission payout`,
            related_id: commission_id,
            processed_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          })

        if (transactionError) {
          // 回滚钱包余额（使用新的 version）
          await supabaseClient
            .from('wallets')
            .update({ 
              balance: currentBalance,
              version: currentVersion + 2,  // 回滚时版本号再+1
              updated_at: new Date().toISOString()
            })
            .eq('id', wallet.id)

          fail_count++
          errors.push({ commission_id, error: transactionError.message })
          continue
        }

        // 更新返利状态
        const { error: updateCommissionError } = await supabaseClient
          .from('commissions')
          .update({ 
            status: 'paid',
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', commission_id)

        if (updateCommissionError) {
          fail_count++
          errors.push({ commission_id, error: updateCommissionError.message })
          continue
        }

        success_count++

      } catch (error) {
        fail_count++
        errors.push({ commission_id, error: error.message })
      }
    }

    return new Response(
      JSON.stringify({ 
        success_count, 
        fail_count,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
