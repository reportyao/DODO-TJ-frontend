/**
 * ============================================================================
 * 批量发放佣金 Edge Function (bulk-payout-commissions)
 * ============================================================================
 *
 * 功能概述:
 *   管理员批量将 pending 状态的佣金记录发放到用户钱包。
 *   【修复 v4】佣金发放到 LUCKY_COIN 积分钱包（而非 TJS 现金钱包）。
 *
 * 钱包类型标准（重要）:
 *   - 现金钱包: type='TJS', currency='TJS'
 *   - 积分钱包: type='LUCKY_COIN', currency='POINTS'
 *
 * 业务规则:
 *   - 余额(TJS)增加: 仅限用户充值、地推代充、首充奖励
 *   - 积分(LUCKY_COIN)增加: 佣金、转盘抽奖、晒单奖励等
 *
 * 变更历史:
 *   v1: 初始版本
 *   v3 (2026-03-05): 资金安全修复
 *     - 修复: 添加乐观锁防止并发更新导致余额错误
 *     - 修复: wallet_transactions 使用 wallet_id 而非 user_id
 *     - 修复: 添加 balance_before 字段到交易记录
 *   v4 (2026-03-07): 钱包类型修复
 *     - 修复: 佣金发放从 TJS 现金钱包改为 LUCKY_COIN 积分钱包
 *     - 新增: 如果用户没有 LUCKY_COIN 钱包则自动创建
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
        
        // 【修复 v4】查询 LUCKY_COIN 积分钱包（而非 TJS 现金钱包）
        // 佣金应发放到积分钱包，与 handle-purchase-commission 保持一致
        let { data: wallet, error: walletError } = await supabaseClient
          .from('wallets')
          .select('id, balance, version')
          .eq('user_id', beneficiaryId)
          .eq('type', 'LUCKY_COIN')
          .single()

        // 【修复 v4】如果用户没有 LUCKY_COIN 钱包，自动创建
        if (walletError || !wallet) {
          console.log(`LUCKY_COIN wallet not found for user ${beneficiaryId}, creating...`)
          const { data: newWallet, error: createError } = await supabaseClient
            .from('wallets')
            .insert({
              user_id: beneficiaryId,
              type: 'LUCKY_COIN',
              currency: 'POINTS',
              balance: 0,
              version: 1,
            })
            .select('id, balance, version')
            .single()

          if (createError || !newWallet) {
            fail_count++
            errors.push({ commission_id, error: `Failed to create LUCKY_COIN wallet: ${createError?.message}` })
            continue
          }
          wallet = newWallet
          console.log(`Created LUCKY_COIN wallet for user ${beneficiaryId}`)
        }

        const currentBalance = parseFloat(wallet.balance || '0')
        const commissionAmount = parseFloat(commission.amount)
        const newBalance = currentBalance + commissionAmount
        const currentVersion = wallet.version || 1

        // 使用乐观锁更新钱包余额
        const { error: updateWalletError, data: updatedWallet } = await supabaseClient
          .from('wallets')
          .update({ 
            balance: newBalance,
            version: currentVersion + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', wallet.id)
          .eq('version', currentVersion)
          .select()
          .single()

        if (updateWalletError || !updatedWallet) {
          fail_count++
          errors.push({ commission_id, error: 'Failed to update wallet (possible concurrent conflict)' })
          continue
        }

        // 创建钱包交易记录
        const { error: transactionError } = await supabaseClient
          .from('wallet_transactions')
          .insert({
            wallet_id: wallet.id,
            type: 'COMMISSION_PAYOUT',
            amount: commissionAmount,
            balance_before: currentBalance,
            balance_after: newBalance,
            status: 'COMPLETED',
            description: `L${commission.level} referral commission payout`,
            related_id: commission_id,
            processed_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          })

        if (transactionError) {
          // 回滚钱包余额（使用乐观锁检查 version）
          await supabaseClient
            .from('wallets')
            .update({ 
              balance: currentBalance,
              version: currentVersion + 2,
              updated_at: new Date().toISOString()
            })
            .eq('id', wallet.id)
            .eq('version', currentVersion + 1)

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
