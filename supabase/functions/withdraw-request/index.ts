/**
 * ============================================================
 * withdraw-request Edge Function（用户提现申请）
 * ============================================================
 * 
 * 功能：用户提交提现申请，冻结对应余额，等待管理员审核
 * 
 * 安全机制：
 *   - 服务端校验提现金额范围（50~10000 TJS）
 *   - 乐观锁防止并发冻结导致超额冻结
 *   - 幂等性保护：基于 idempotency_key 防止重复提交
 *   - 创建提现记录失败时自动回滚冻结余额
 * ============================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

/** 标准化错误响应，包含 error_code 用于前端国际化 */
function errorResponse(errorCode: string, fallbackMessage: string, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error: fallbackMessage, error_code: errorCode }),
    { headers: { "Content-Type": "application/json", ...corsHeaders }, status }
  )
}

// 通用的 session 验证函数
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw { code: 'ERR_MISSING_TOKEN', message: '未授权：缺少认证令牌' };
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw { code: 'ERR_SERVER_CONFIG', message: '服务器配置错误' };
  }

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
    throw { code: 'ERR_SESSION_VALIDATE_FAILED', message: '验证会话失败' };
  }

  const sessions = await sessionResponse.json();
  
  if (sessions.length === 0) {
    throw { code: 'ERR_INVALID_SESSION', message: '未授权：会话不存在或已失效' };
  }

  const session = sessions[0];
  const expiresAt = new Date(session.expires_at);
  
  if (expiresAt < new Date()) {
    throw { code: 'ERR_SESSION_EXPIRED', message: '未授权：会话已过期' };
  }

  if (!session.users) {
    throw { code: 'ERR_USER_NOT_FOUND', message: '未授权：用户不存在' };
  }

  return { userId: session.user_id, user: session.users, session };
}

// 生成提现订单号
function generateOrderNumber(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `WD${timestamp}${random}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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
      mobileWalletName,
      idempotency_key,
    } = body

    if (!session_token) {
      return errorResponse('ERR_MISSING_SESSION', '未授权：缺少 session_token', 401)
    }

    if (!amount || amount <= 0) {
      return errorResponse('ERR_WITHDRAW_AMOUNT_INVALID', '提现金额必须大于0')
    }

    const MIN_WITHDRAW = 50;
    const MAX_WITHDRAW = 10000;
    if (amount < MIN_WITHDRAW) {
      return errorResponse('ERR_WITHDRAW_AMOUNT_TOO_LOW', `提现金额不能低于最低限额 ${MIN_WITHDRAW} TJS`)
    }
    if (amount > MAX_WITHDRAW) {
      return errorResponse('ERR_WITHDRAW_AMOUNT_TOO_HIGH', `提现金额不能超过最高限额 ${MAX_WITHDRAW} TJS`)
    }

    // 验证用户 session
    const { userId } = await validateSession(session_token);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // ============================================================
    // 幂等性检查：防止重复提交
    // ============================================================
    if (idempotency_key) {
      const idempotencyResponse = await fetch(
        `${supabaseUrl}/rest/v1/withdrawal_requests?idempotency_key=eq.${idempotency_key}&select=id,status,order_number,amount`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (idempotencyResponse.ok) {
        const existingRequests = await idempotencyResponse.json();
        if (existingRequests.length > 0) {
          return new Response(
            JSON.stringify({ success: true, message: '提现申请已提交', data: existingRequests[0], deduplicated: true }),
            { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
          )
        }
      }
    }

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
      return errorResponse('ERR_WALLET_INFO_FAILED', '获取钱包信息失败', 500)
    }

    const wallets = await walletResponse.json();
    
    if (wallets.length === 0) {
      return errorResponse('ERR_WALLET_NOT_FOUND', '未找到用户钱包', 404)
    }

    const wallet = wallets[0];

    // 2. 检查可用余额是否足够
    const currentBalance = parseFloat(wallet.balance) || 0;
    const currentFrozenBalance = parseFloat(wallet.frozen_balance) || 0;
    const withdrawAmount = parseFloat(amount);
    const availableBalance = currentBalance - currentFrozenBalance;

    if (availableBalance < withdrawAmount) {
      return errorResponse('ERR_INSUFFICIENT_BALANCE', '余额不足')
    }

    // 3. 冻结余额（乐观锁防止并发）
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
          version: currentVersion + 1,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateWalletResponse.ok) {
      console.error('[withdraw-request] Freeze balance failed');
      return errorResponse('ERR_FREEZE_BALANCE_FAILED', '冻结余额失败', 500)
    }

    const updatedWallets = await updateWalletResponse.json();
    if (!updatedWallets || updatedWallets.length === 0) {
      return errorResponse('ERR_CONCURRENT_OPERATION', '操作失败，请重试（可能存在并发操作）', 409)
    }

    // 4. 生成订单号
    const orderNumber = generateOrderNumber();

    // 5. 创建提现请求
    const insertBody: Record<string, unknown> = {
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
    };

    if (idempotency_key) {
      insertBody.idempotency_key = idempotency_key;
    }

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
        body: JSON.stringify(insertBody)
      }
    );

    if (!insertResponse.ok) {
      // 检查是否是 UNIQUE 约束冲突（并发幂等性保护）
      let insertErrorBody: any = null
      try { insertErrorBody = await insertResponse.json() } catch (_) {}
      if (insertErrorBody?.code === '23505' && idempotency_key) {
        // 回滚冻结余额（因为这是重复请求，不应叠加冻结）
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
              version: currentVersion + 2,
              updated_at: new Date().toISOString()
            })
          }
        );
        // 返回已存在的请求
        const idempotencyResponse = await fetch(
          `${supabaseUrl}/rest/v1/withdrawal_requests?idempotency_key=eq.${idempotency_key}&select=id,status,order_number,amount`,
          {
            headers: {
              'Authorization': `Bearer ${serviceRoleKey}`,
              'apikey': serviceRoleKey,
              'Content-Type': 'application/json'
            }
          }
        );
        if (idempotencyResponse.ok) {
          const existingRequests = await idempotencyResponse.json();
          if (existingRequests.length > 0) {
            return new Response(
              JSON.stringify({ success: true, message: '提现申请已提交', data: existingRequests[0], deduplicated: true }),
              { headers: { 'Content-Type': 'application/json', ...corsHeaders }, status: 200 }
            )
          }
        }
      }
      // 非幂等性冲突的其他插入失败，回滚冻结余额
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
            version: currentVersion + 2,
            updated_at: new Date().toISOString()
          })
        }
      );
      
      console.error('[withdraw-request] Create request failed, balance rolled back');
      return errorResponse('ERR_WITHDRAW_CREATE_FAILED', '创建提现请求失败', 500)
    }

    const data = await insertResponse.json();

    // 6. 创建钱包交易记录
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
          balance_before: currentBalance,
          balance_after: currentBalance,
          status: 'PENDING',
          description: `Withdrawal freeze - Order: ${orderNumber}`,
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
    const err = error as { code?: string; message?: string };
    const errCode = err.code || 'ERR_SERVER_ERROR';
    const errMsg = err.message || (error instanceof Error ? error.message : String(error));
    console.error('[withdraw-request] Error:', errCode, errMsg)
    return errorResponse(errCode, errMsg, errCode.includes('UNAUTHORIZED') || errCode.includes('SESSION') || errCode.includes('TOKEN') ? 401 : 400)
  }
})
