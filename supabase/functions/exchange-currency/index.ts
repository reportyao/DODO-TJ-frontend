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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // 获取当前用户
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      throw new Error('未授权')
    }

    const { exchangeType, amount, currency } = await req.json()

    // 验证参数
    if (!exchangeType || !['BALANCE_TO_COIN', 'COIN_TO_BALANCE'].includes(exchangeType)) {
      throw new Error('无效的兑换类型')
    }

    if (!amount || amount <= 0) {
      throw new Error('兑换金额必须大于0')
    }

    const curr = currency || 'TJS'

    // 【资金安全修复 v4】修复钱包类型映射
    // 标准: 现金钱包 type='TJS', 积分钱包 type='LUCKY_COIN'
    // 原代码使用 'BALANCE' 是错误的，数据库中不存在 type='BALANCE' 的钱包
    const sourceType = exchangeType === 'BALANCE_TO_COIN' ? 'TJS' : 'LUCKY_COIN'
    const targetType = exchangeType === 'BALANCE_TO_COIN' ? 'LUCKY_COIN' : 'TJS'
    // 积分钱包的 currency 是 'POINTS'，现金钱包的 currency 是 'TJS'
    const sourceCurrency = sourceType === 'LUCKY_COIN' ? 'POINTS' : curr
    const targetCurrency = targetType === 'LUCKY_COIN' ? 'POINTS' : curr

    // 获取源钱包（包含 version 用于乐观锁）
    const { data: sourceWallet, error: sourceError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', sourceType)
      .eq('currency', sourceCurrency)
      .single()

    if (sourceError || !sourceWallet) {
      throw new Error('未找到源钱包')
    }

    // 获取目标钱包（包含 version 用于乐观锁）
    const { data: targetWallet, error: targetError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', targetType)
      .eq('currency', targetCurrency)
      .single()

    if (targetError || !targetWallet) {
      throw new Error('未找到目标钱包')
    }

    // 检查源钱包余额
    const sourceBalance = parseFloat(sourceWallet.balance)
    if (sourceBalance < amount) {
      throw new Error('余额不足')
    }

    // 计算兑换比例 (1:1)
    const exchangeRate = 1.0
    const exchangedAmount = amount * exchangeRate

    // 记录兑换前余额
    const sourceBalanceBefore = sourceBalance
    const targetBalanceBefore = parseFloat(targetWallet.balance)
    const newSourceBalance = sourceBalanceBefore - amount
    const newTargetBalance = targetBalanceBefore + exchangedAmount

    // 【资金安全修复 v4】使用乐观锁更新源钱包余额
    const sourceVersion = sourceWallet.version || 1
    const { error: updateSourceError, data: updatedSource } = await supabaseClient
      .from('wallets')
      .update({
        balance: newSourceBalance,
        version: sourceVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceWallet.id)
      .eq('version', sourceVersion)
      .select()
      .single()

    if (updateSourceError || !updatedSource) {
      console.error('更新源钱包失败 (乐观锁冲突):', updateSourceError)
      throw new Error('兑换失败，请重试（可能存在并发操作）')
    }

    // 【资金安全修复 v4】使用乐观锁更新目标钱包余额
    const targetVersion = targetWallet.version || 1
    const { error: updateTargetError, data: updatedTarget } = await supabaseClient
      .from('wallets')
      .update({
        balance: newTargetBalance,
        version: targetVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetWallet.id)
      .eq('version', targetVersion)
      .select()
      .single()

    if (updateTargetError || !updatedTarget) {
      console.error('更新目标钱包失败 (乐观锁冲突):', updateTargetError)
      // 回滚源钱包（使用乐观锁检查 version）
      await supabaseClient
        .from('wallets')
        .update({
          balance: sourceBalanceBefore,
          version: sourceVersion + 2,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceWallet.id)
        .eq('version', sourceVersion + 1)
      throw new Error('兑换失败，请重试（可能存在并发操作）')
    }

    // 创建兑换记录
    const { data: exchangeRecord, error: recordError } = await supabaseClient
      .from('exchange_records')
      .insert({
        user_id: user.id,
        exchange_type: exchangeType,
        amount: amount,
        currency: curr,
        exchange_rate: exchangeRate,
        source_wallet_id: sourceWallet.id,
        target_wallet_id: targetWallet.id,
        source_balance_before: sourceBalanceBefore,
        source_balance_after: newSourceBalance,
        target_balance_before: targetBalanceBefore,
        target_balance_after: newTargetBalance,
      })
      .select()
      .single()

    if (recordError) {
      console.error('创建兑换记录失败:', recordError)
    }

    // 创建钱包交易记录（包含 balance_before）
    await supabaseClient.from('wallet_transactions').insert([
      {
        wallet_id: sourceWallet.id,
        type: 'COIN_EXCHANGE',
        amount: -amount,
        balance_before: sourceBalanceBefore,
        balance_after: newSourceBalance,
        status: 'COMPLETED',
        description: `兑换${amount}${curr}到${targetType === 'LUCKY_COIN' ? '积分商城币' : '余额'}`,
        processed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      {
        wallet_id: targetWallet.id,
        type: 'COIN_EXCHANGE',
        amount: exchangedAmount,
        balance_before: targetBalanceBefore,
        balance_after: newTargetBalance,
        status: 'COMPLETED',
        description: `从${sourceType === 'TJS' ? '余额' : '积分商城币'}兑换${exchangedAmount}${curr}`,
        processed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ])

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          exchangeRecord,
          sourceWallet: {
            type: sourceType,
            balanceBefore: sourceBalanceBefore,
            balanceAfter: newSourceBalance,
          },
          targetWallet: {
            type: targetType,
            balanceBefore: targetBalanceBefore,
            balanceAfter: newTargetBalance,
          },
        },
        message: '兑换成功',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('兑换错误:', error)
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
