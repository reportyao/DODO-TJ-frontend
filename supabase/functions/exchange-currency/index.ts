import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

/** 根据错误消息映射到标准化错误码 */
function mapErrorCode(msg: string): string {
  if (msg.includes('服务器配置错误')) return 'ERR_SERVER_CONFIG';
  if (msg.includes('缺少必要参数')) return 'ERR_PARAMS_MISSING';
  if (msg.includes('数量无效')) return 'ERR_QUANTITY_INVALID';
  if (msg.includes('未授权：缺少会话令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('未授权：缺少 session_token')) return 'ERR_MISSING_SESSION';
  if (msg.includes('未授权：缺少认证令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('未授权：无效的会话令牌')) return 'ERR_INVALID_TOKEN';
  if (msg.includes('未授权：无效的认证令牌')) return 'ERR_INVALID_TOKEN';
  if (msg.includes('未授权：会话不存在或已过期')) return 'ERR_INVALID_SESSION';
  if (msg.includes('未授权：会话不存在或已失效')) return 'ERR_INVALID_SESSION';
  if (msg.includes('未授权：会话已过期')) return 'ERR_SESSION_EXPIRED';
  if (msg.includes('未授权：用户不存在')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('验证会话失败')) return 'ERR_SESSION_VALIDATE_FAILED';
  if (msg.includes('用户不存在')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('商品不存在')) return 'ERR_PRODUCT_NOT_FOUND';
  if (msg.includes('库存不足')) return 'ERR_OUT_OF_STOCK';
  if (msg.includes('价格配置无效')) return 'ERR_PRICE_CONFIG_INVALID';
  if (msg.includes('余额不足')) return 'ERR_INSUFFICIENT_BALANCE';
  if (msg.includes('积分余额不足')) return 'ERR_INSUFFICIENT_POINTS';
  if (msg.includes('未找到用户钱包')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('获取钱包信息失败')) return 'ERR_WALLET_INFO_FAILED';
  if (msg.includes('冻结余额失败')) return 'ERR_FREEZE_BALANCE_FAILED';
  if (msg.includes('创建提现请求失败')) return 'ERR_WITHDRAW_CREATE_FAILED';
  if (msg.includes('充值金额必须大于0')) return 'ERR_DEPOSIT_AMOUNT_INVALID';
  if (msg.includes('提现金额必须大于0')) return 'ERR_WITHDRAW_AMOUNT_INVALID';
  if (msg.includes('金额必须大于0')) return 'ERR_AMOUNT_INVALID';
  if (msg.includes('兑换金额必须大于0')) return 'ERR_EXCHANGE_AMOUNT_INVALID';
  if (msg.includes('无效的兑换类型')) return 'ERR_EXCHANGE_TYPE_INVALID';
  if (msg.includes('未找到源钱包')) return 'ERR_SOURCE_WALLET_NOT_FOUND';
  if (msg.includes('未找到目标钱包')) return 'ERR_TARGET_WALLET_NOT_FOUND';
  if (msg.includes('源钱包和目标钱包类型必须不同')) return 'ERR_SAME_WALLET_TYPE';
  if (msg.includes('票据不存在或不属于您')) return 'ERR_TICKET_NOT_FOUND';
  if (msg.includes('该票据已在转售中')) return 'ERR_TICKET_ALREADY_RESALE';
  if (msg.includes('转售商品不存在')) return 'ERR_RESALE_ITEM_NOT_FOUND';
  if (msg.includes('该商品已下架或已售出')) return 'ERR_RESALE_ITEM_UNAVAILABLE';
  if (msg.includes('不能购买自己的商品')) return 'ERR_CANNOT_BUY_OWN';
  if (msg.includes('未找到奖品记录')) return 'ERR_PRIZE_NOT_FOUND';
  if (msg.includes('您不是该抽奖的中奖者')) return 'ERR_NOT_WINNER';
  if (msg.includes('创建奖品记录失败')) return 'ERR_PRIZE_CREATE_FAILED';
  if (msg.includes('生成提货码失败')) return 'ERR_PICKUP_CODE_FAILED';
  if (msg.includes('您不是地推人员')) return 'ERR_NOT_PROMOTER';
  if (msg.includes('您的地推人员账号未激活')) return 'ERR_PROMOTER_INACTIVE';
  if (msg.includes('自提点不存在或不可用')) return 'ERR_PICKUP_POINT_NOT_FOUND';
  if (msg.includes('搜索关键词不能为空')) return 'ERR_SEARCH_KEYWORD_EMPTY';
  if (msg.includes('记录不存在或不属于您')) return 'ERR_RECORD_NOT_FOUND';
  if (msg.includes('卖家钱包不存在')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('买家钱包不存在')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('源钱包不存在')) return 'ERR_SOURCE_WALLET_NOT_FOUND';
  if (msg.includes('目标钱包不存在')) return 'ERR_TARGET_WALLET_NOT_FOUND';
  if (msg.includes('缺少转售商品ID')) return 'ERR_RESALE_ID_MISSING';
  if (msg.includes('缺少会话令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('目标用户ID不能为空')) return 'ERR_PARAMS_MISSING';
  if (msg.includes('获取用户信息失败')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('钱包版本冲突')) return 'ERR_CONCURRENT_OPERATION';
  if (msg.includes('扣除余额失败')) return 'ERR_FREEZE_BALANCE_FAILED';
  if (msg.includes('增加卖家余额失败')) return 'ERR_SERVER_ERROR';
  if (msg.includes('兑换操作失败')) return 'ERR_EXCHANGE_FAILED';
  if (msg.includes('兑换操作缺少目标钱包类型')) return 'ERR_EXCHANGE_WALLET_MISSING';
  if (msg.includes('无效的目标钱包类型')) return 'ERR_EXCHANGE_WALLET_MISSING';
  if (msg.includes('无效的操作')) return 'ERR_INVALID_ACTION';
  if (msg.includes('操作失败')) return 'ERR_CONCURRENT_OPERATION';
  return 'ERR_SERVER_ERROR';
}


// 通用的 session 验证函数（与 claim-prize / request-shipping 保持一致）
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌');
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('服务器配置错误');
  }

  const sessionResponse = await fetch(
    `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${sessionToken}&is_active=eq.true&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!sessionResponse.ok) {
    throw new Error('验证会话失败');
  }

  const sessions = await sessionResponse.json();
  if (sessions.length === 0) {
    throw new Error('未授权：会话不存在或已失效');
  }

  const session = sessions[0];
  const expiresAt = new Date(session.expires_at);
  if (expiresAt < new Date()) {
    throw new Error('未授权：会话已过期');
  }

  return { userId: session.user_id };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()

    // ============================================================
    // 1. 认证：优先使用 session_token，向后兼容 Authorization header
    // ============================================================
    let userId: string;

    if (body.session_token) {
      // 新的自定义 session 认证（PWA 模式）
      const result = await validateSession(body.session_token);
      userId = result.userId;
    } else {
      // 向后兼容：尝试 Authorization header（Supabase Auth，将来移除）
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new Error('未授权：缺少 session_token');
      }
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
          global: {
            headers: { Authorization: authHeader },
          },
        }
      );
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !user) {
        throw new Error('未授权');
      }
      userId = user.id;
    }

    // 使用 service role client 进行数据库操作
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { exchangeType, amount, currency } = body

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
    const sourceType = exchangeType === 'BALANCE_TO_COIN' ? 'TJS' : 'LUCKY_COIN'
    const targetType = exchangeType === 'BALANCE_TO_COIN' ? 'LUCKY_COIN' : 'TJS'
    // 积分钱包的 currency 是 'POINTS'，现金钱包的 currency 是 'TJS'
    const sourceCurrency = sourceType === 'LUCKY_COIN' ? 'POINTS' : curr
    const targetCurrency = targetType === 'LUCKY_COIN' ? 'POINTS' : curr

    // 获取源钱包（包含 version 用于乐观锁）
    const { data: sourceWallet, error: sourceError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
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
      .eq('user_id', userId)
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
        user_id: userId,
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
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('兑换错误:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
        error_code: mapErrorCode(errMsg),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
