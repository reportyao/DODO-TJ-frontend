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


// 通用的 session 验证函数
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌');
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('服务器配置错误');
  }

  // 查询 user_sessions 表验证 session
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

  // 检查 session 是否过期
  const expiresAt = new Date(session.expires_at);
  const now = new Date();
  
  if (expiresAt < now) {
    throw new Error('未授权：会话已过期');
  }

  return {
    userId: session.user_id,
    session: session
  };
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

    const body = await req.json()
    const { resale_item_id, session_token } = body

    console.log('[PurchaseResale] Request:', { resale_item_id, session_token: session_token ? 'present' : 'missing' })

    if (!resale_item_id) {
      throw new Error('缺少转售商品ID')
    }

    // 验证用户 session
    let userId: string
    
    if (session_token) {
      // 使用自定义 session token 验证
      const { userId: validatedUserId } = await validateSession(session_token)
      userId = validatedUserId
    } else {
      // session_token 是必须的认证方式
      throw new Error('未授权：缺少 session_token')
    }

    console.log('[PurchaseResale] Validated user:', userId)

    // 查询转售商品信息 (使用 resales 表)
    const { data: resaleItem, error: resaleError } = await supabaseClient
      .from('resales')
      .select('*, lotteries(*)')
      .eq('id', resale_item_id)
      .single()

    if (resaleError || !resaleItem) {
      console.error('[PurchaseResale] Resale item not found:', resaleError)
      throw new Error('转售商品不存在')
    }

    console.log('[PurchaseResale] Resale item:', { 
      id: resaleItem.id, 
      status: resaleItem.status, 
      price: resaleItem.resale_price,
      seller_id: resaleItem.seller_id
    })

    // 检查状态
    if (resaleItem.status !== 'ACTIVE') {
      throw new Error('该商品已下架或已售出')
    }

    // 不能购买自己的商品
    if (resaleItem.seller_id === userId) {
      throw new Error('不能购买自己的商品')
    }

    /**
     * 查询买家积分钱包余额
     * 
     * 钱包类型说明（重要）：
     * - 现金钱包: type='TJS', currency='TJS'
     * - 积分钱包: type='LUCKY_COIN', currency='POINTS'
     * 
     * 历史遗留问题：
     * - LUCKY_COIN 是历史名称（幸运币），现在前端统一显示为"积分"
     * - 积分钱包的 currency 必须是 'POINTS'，不能是 'TJS' 或 'LUCKY_COIN'
     */
    const { data: buyerWallet, error: walletError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'LUCKY_COIN')      // 积分钱包类型
      .eq('currency', 'POINTS')      // 积分货币单位
      .single()

    if (walletError || !buyerWallet) {
      console.error('[PurchaseResale] Buyer wallet not found:', walletError)
      throw new Error('买家钱包不存在')
    }

    console.log('[PurchaseResale] Buyer wallet balance:', buyerWallet.balance)

    // 检查余额
    if (buyerWallet.balance < resaleItem.resale_price) {
      throw new Error('积分余额不足')
    }

    const buyerBalanceBefore = parseFloat(buyerWallet.balance)
    const buyerBalanceAfter = buyerBalanceBefore - resaleItem.resale_price
    const buyerVersion = buyerWallet.version || 1

    /**
     * 查询卖家现金钱包
     * 
     * 钱包类型说明（重要）：
     * - 现金钱包: type='TJS', currency='TJS'
     * - 积分钱包: type='LUCKY_COIN', currency='POINTS'
     * 
     * 注意：数据库枚举 WalletType 只有 'TJS' 和 'LUCKY_COIN'，没有 'BALANCE'
     */
    const { data: sellerWallet, error: sellerWalletError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', resaleItem.seller_id)
      .eq('type', 'TJS')  // 现金钱包的type是'TJS'，不是'BALANCE'
      .eq('currency', 'TJS')
      .single()

    if (sellerWalletError || !sellerWallet) {
      console.error('[PurchaseResale] Seller wallet not found:', sellerWalletError)
      throw new Error('卖家钱包不存在')
    }

    // 计算卖家收入 (扣除5%手续费)
    const sellerAmount = resaleItem.resale_price * 0.95
    const fee = resaleItem.resale_price * 0.05
    const sellerBalanceBefore = parseFloat(sellerWallet.balance)
    const sellerBalanceAfter = sellerBalanceBefore + sellerAmount
    const sellerVersion = sellerWallet.version || 1

    // 开始事务处理
    // 1. 扣除买家积分余额
    // 【资金安全修复 v3】添加乐观锁防止并发购买导致余额错误
    const { error: deductError, data: updatedBuyerWallet } = await supabaseClient
      .from('wallets')
      .update({ 
        balance: buyerBalanceAfter,
        version: buyerVersion + 1,  // 乐观锁: 版本号+1
        updated_at: new Date().toISOString()
      })
      .eq('id', buyerWallet.id)
      .eq('version', buyerVersion)  // 乐观锁: 只有版本号匹配才能更新
      .select()
      .single()

    if (deductError || !updatedBuyerWallet) {
      console.error('[PurchaseResale] Deduct buyer balance error (possible concurrent conflict):', deductError)
      throw new Error('扣除余额失败，请重试')
    }

    // 2. 增加卖家现金余额
    // 【乐观锁】防止并发卖出导致余额错误
    const { error: addError, data: updatedSellerWallet } = await supabaseClient
      .from('wallets')
      .update({ 
        balance: sellerBalanceAfter,
        version: sellerVersion + 1,  // 乐观锁: 版本号+1
        updated_at: new Date().toISOString()
      })
      .eq('id', sellerWallet.id)
      .eq('version', sellerVersion)  // 乐观锁
      .select()
      .single()

    if (addError || !updatedSellerWallet) {
      console.error('[PurchaseResale] Add seller balance error:', addError)
      // 【资金安全修复 v4】回滚买家余额（使用乐观锁检查 version）
      await supabaseClient
        .from('wallets')
        .update({ 
          balance: buyerBalanceBefore,
          version: buyerVersion + 2,  // 回滚时版本号再+1
          updated_at: new Date().toISOString()
        })
        .eq('id', buyerWallet.id)
        .eq('version', buyerVersion + 1)  // 乐观锁: 检查当前 version
      throw new Error('增加卖家余额失败，请重试')
    }

    // 3. 更新转售商品状态
    const { error: updateResaleError } = await supabaseClient
      .from('resales')
      .update({
        status: 'SOLD',
        buyer_id: userId,
        sold_at: new Date().toISOString(),
      })
      .eq('id', resale_item_id)

    if (updateResaleError) {
      console.error('[PurchaseResale] Update resale status error:', updateResaleError)
      // 【资金安全修复 v4】回滚时使用乐观锁检查 version，防止覆盖并发操作
      await supabaseClient.from('wallets').update({ 
        balance: buyerBalanceBefore, 
        version: buyerVersion + 2,
        updated_at: new Date().toISOString()
      }).eq('id', buyerWallet.id)
        .eq('version', buyerVersion + 1)  // 乐观锁: 检查当前 version
      await supabaseClient.from('wallets').update({ 
        balance: sellerBalanceBefore, 
        version: sellerVersion + 2,
        updated_at: new Date().toISOString()
      }).eq('id', sellerWallet.id)
        .eq('version', sellerVersion + 1)  // 乐观锁: 检查当前 version
      throw new Error('更新转售商品状态失败: ' + updateResaleError.message)
    }

    // 4. 转移参与记录所有权（使用 lottery_entries 表）
    if (resaleItem.ticket_id) {
      const { error: updateEntryError } = await supabaseClient
        .from('lottery_entries')
        .update({
          user_id: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resaleItem.ticket_id)

      if (updateEntryError) {
        console.error('[PurchaseResale] Update entry owner error:', updateEntryError)
        // 不回滚，参与记录转移失败不影响交易
      }
    }

    // 5. 记录钱包交易 (买家)
    // 【修复 v3】添加 balance_before 和 status 字段
    await supabaseClient
      .from('wallet_transactions')
      .insert({
        wallet_id: buyerWallet.id,
        type: 'RESALE_PURCHASE',
        amount: -resaleItem.resale_price,
        balance_before: buyerBalanceBefore,  // 新增: 记录购买前余额
        balance_after: buyerBalanceAfter,
        status: 'COMPLETED',
        description: `购买转售: ${resaleItem.lotteries?.title || '商品'}`,
        processed_at: new Date().toISOString(),
      })

    // 6. 记录钱包交易 (卖家)
    await supabaseClient
      .from('wallet_transactions')
      .insert({
        wallet_id: sellerWallet.id,
        type: 'RESALE_INCOME',
        amount: sellerAmount,
        balance_before: sellerBalanceBefore,  // 新增: 记录卖出前余额
        balance_after: sellerBalanceAfter,
        status: 'COMPLETED',
        description: `转售收入 (扣除${fee.toFixed(2)}TJS手续费)`,
        processed_at: new Date().toISOString(),
      })

    // 交易记录已通过 wallet_transactions 表记录，不再使用已删除的 transactions 表

    // 7. 创建订单记录 (MARKET_PURCHASE)
    const orderNumber = `MKT${Date.now()}${Math.floor(Math.random() * 1000)}`
    const { error: orderError } = await supabaseClient
      .from('orders')
      .insert({
        user_id: userId,
        order_number: orderNumber,
        type: 'MARKET_PURCHASE',
        status: 'COMPLETED',
        total_amount: resaleItem.resale_price,
        currency: 'TJS',
        payment_method: 'LUCKY_COIN',
        lottery_id: resaleItem.lottery_id,
        paid_at: new Date().toISOString(),
        payment_data: {
          resale_id: resale_item_id,
          seller_id: resaleItem.seller_id,
          ticket_id: resaleItem.ticket_id,
          original_price: resaleItem.original_price
        },
        updated_at: new Date().toISOString()
      })

    if (orderError) {
      console.error('[PurchaseResale] Create order error:', orderError)
      // 不回滚，订单记录创建失败不影响核心交易
    } else {
      console.log('[PurchaseResale] Order created:', orderNumber)
    }

    console.log('[PurchaseResale] Success!')

    return new Response(
      JSON.stringify({
        success: true,
        message: '购买成功',
        data: {
          resale_id: resale_item_id,
          price: resaleItem.resale_price,
          new_balance: buyerBalanceAfter
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[PurchaseResale] Error:', error)
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
