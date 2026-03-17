import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
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
    `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${sessionToken}&is_active=eq.true&select=*,users(*)`,
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

  // 检查是否有用户数据
  if (!session.users) {
    throw new Error('未授权：用户不存在');
  }

  return {
    userId: session.user_id,
    user: session.users,
    session: session
  };
}

// 生成提现订单号
function generateOrderNumber(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `WD${timestamp}${random}`;
}

serve(async (req) => {
  // 允许 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 从 body 中获取 session_token
    const body = await req.json()
    const { 
      session_token, 
      amount, 
      currency = 'TJS', 
      withdrawalMethod,
      bankName,
      bankAccountNumber,
      bankAccountName,
      bankBranch,
      idCardNumber,
      idCardName,
      phoneNumber,
      mobileWalletNumber,
      mobileWalletName
    } = body

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    if (!amount || amount <= 0) {
      throw new Error('提现金额必须大于0');
    }

    // 验证用户 session
    const { userId } = await validateSession(session_token);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // 1. 获取用户钱包
    const walletResponse = await fetch(
      `${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}&type=eq.TJS&currency=eq.${currency}&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!walletResponse.ok) {
      throw new Error('获取钱包信息失败');
    }

    const wallets = await walletResponse.json();
    
    if (wallets.length === 0) {
      throw new Error('未找到用户钱包');
    }

    const wallet = wallets[0];

    // 2. 检查可用余额是否足够（余额 - 已冻结金额）
    const currentBalance = parseFloat(wallet.balance) || 0;
    const currentFrozenBalance = parseFloat(wallet.frozen_balance) || 0;
    const withdrawAmount = parseFloat(amount);
    const availableBalance = currentBalance - currentFrozenBalance;

    if (availableBalance < withdrawAmount) {
      throw new Error(`可用余额不足，当前可用余额: ${availableBalance.toFixed(2)} ${currency}（总余额: ${currentBalance.toFixed(2)}，已冻结: ${currentFrozenBalance.toFixed(2)}）`);
    }

    // 3. 冻结余额（增加frozen_balance，不减少balance）
    // 这样用户可以看到余额，但不能使用被冻结的部分
    // 【资金安全修复 v3】添加乐观锁防止并发冻结导致超额冻结
    // 场景: 用户快速点击两次提现，可能导致同一笔钱被冻结两次
    const currentVersion = wallet.version || 1;
    const newFrozenBalance = currentFrozenBalance + withdrawAmount;

    const updateWalletResponse = await fetch(
      `${supabaseUrl}/rest/v1/wallets?id=eq.${wallet.id}&version=eq.${currentVersion}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          frozen_balance: newFrozenBalance,
          version: currentVersion + 1,  // 乐观锁: 版本号+1
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateWalletResponse.ok) {
      const errorText = await updateWalletResponse.text();
      console.error('冻结余额失败:', errorText);
      throw new Error('冻结余额失败');
    }

    // 【乐观锁校验】检查是否有行被更新（如果 version 不匹配，返回空数组）
    const updatedWallets = await updateWalletResponse.json();
    if (!updatedWallets || updatedWallets.length === 0) {
      console.error('冻结余额失败: 乐观锁版本不匹配，可能存在并发操作');
      throw new Error('操作失败，请重试（可能存在并发操作）');
    }

    // 4. 生成订单号
    const orderNumber = generateOrderNumber();

    // 5. 创建提现请求（状态为PENDING，等待管理员审核）
    const insertResponse = await fetch(
      `${supabaseUrl}/rest/v1/withdrawal_requests`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          user_id: userId,
          order_number: orderNumber,
          amount: withdrawAmount,
          currency: currency,
          withdrawal_method: withdrawalMethod,
          bank_name: bankName,
          bank_account_number: bankAccountNumber,
          bank_account_name: bankAccountName,
          bank_branch: bankBranch,
          id_card_number: idCardNumber,
          id_card_name: idCardName,
          phone_number: phoneNumber,
          mobile_wallet_number: mobileWalletNumber,
          mobile_wallet_name: mobileWalletName,
          status: 'PENDING'
        })
      }
    );

    if (!insertResponse.ok) {
      // 如果创建提现请求失败，需要回滚钱包冻结
      // 【资金安全修复 v4】回滚时使用乐观锁检查 version，防止覆盖并发操作
      await fetch(
        `${supabaseUrl}/rest/v1/wallets?id=eq.${wallet.id}&version=eq.${currentVersion + 1}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            frozen_balance: currentFrozenBalance,
            version: currentVersion + 2,  // 回滚时版本号再+1
            updated_at: new Date().toISOString()
          })
        }
      );
      
      const errorText = await insertResponse.text();
      console.error('创建提现请求失败:', errorText);
      throw new Error('创建提现请求失败');
    }

    const data = await insertResponse.json();

    // 6. 创建钱包交易记录（状态为PENDING，等待审核）
    // 注意：此时不记录余额变化，因为余额还没有真正扣除
    await fetch(
      `${supabaseUrl}/rest/v1/wallet_transactions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          wallet_id: wallet.id,
          type: 'WITHDRAWAL_FREEZE',
          amount: -withdrawAmount,
          balance_before: currentBalance,  // 【修复 4.1】添加 balance_before 确保流水完整
          balance_after: currentBalance, // 余额不变，只是冻结
          status: 'PENDING',
          description: `提现申请已冻结 - 订单号: ${orderNumber}，等待审核`,
          related_id: data[0]?.id || null
        })
      }
    );

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: '提现申请已提交，金额已冻结，等待管理员审核', 
        data: data[0],
        wallet: {
          balance: currentBalance,
          frozen_balance: newFrozenBalance,
          available_balance: currentBalance - newFrozenBalance
        }
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('withdraw_request error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
    )
  }
})
