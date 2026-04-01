import { mapErrorCode } from '../_shared/errorResponse.ts'
Deno.serve(async (req) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Credentials': 'false'
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }



    try {
        // 获取 Supabase 配置
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');

        if (!serviceRoleKey || !supabaseUrl) {
            throw new Error('服务器配置错误');
        }

        // 解析请求数据
        const { action, walletType, currency, amount, targetWalletType, referenceId } = await req.json();

        if (!action) {
            throw new Error('缺少必要参数: action');
        }

        const validActions = ['deposit', 'withdraw', 'exchange', 'balance'];
        if (!validActions.includes(action)) {
            throw new Error(`无效的操作类型`);
        }

        // 获取用户信息（从 auth header）
        const authHeader = req.headers.get('authorization');
        if (!authHeader) {
            throw new Error('未授权：缺少认证令牌');
        }

        const token = authHeader.replace('Bearer ', '');

        // 验证用户 token
        const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'apikey': serviceRoleKey
            }
        });

        if (!userResponse.ok) {
            throw new Error('未授权：无效的认证令牌');
        }

        const authUser = await userResponse.json();
        const userId = authUser.id;

        // 获取用户详细信息
        const userDetailResponse = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=*`, {
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            }
        });

        const users = await userDetailResponse.json();
        if (users.length === 0) {
            throw new Error('用户不存在');
        }
        const user = users[0];

        // 处理余额查询
        if (action === 'balance') {
            const walletsResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}&select=*`, {
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                }
            });

            const wallets = await walletsResponse.json();
            const result = {
                success: true,
                user_id: userId,
                wallets: wallets.map((w: any) => ({
                    id: w.id,
                    type: w.type,
                    currency: w.currency,
                    balance: w.balance,
                    frozen_balance: w.frozen_balance,
                    total_deposits: w.total_deposits,
                    total_withdrawals: w.total_withdrawals
                }))
            };

            return new Response(JSON.stringify({ data: result }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 验证必需参数
        if (!walletType || !currency || (!amount && action !== 'balance')) {
            throw new Error('缺少必要参数');
        }

        if (amount <= 0) {
            throw new Error('金额必须大于0');
        }

        // 获取源钱包
        const sourceWalletResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}&type=eq.${walletType}&currency=eq.${currency}&select=*`, {
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            }
        });

        const sourceWallets = await sourceWalletResponse.json();
        if (sourceWallets.length === 0) {
            throw new Error('源钱包不存在');
        }
        const sourceWallet = sourceWallets[0];

        // 处理不同类型的交易
        let result: any;

        switch (action) {
            case 'deposit':
                result = await handleDeposit(supabaseUrl, serviceRoleKey, sourceWallet, amount, referenceId);
                break;
            case 'withdraw':
                result = await handleWithdraw(supabaseUrl, serviceRoleKey, sourceWallet, amount, referenceId);
                break;
            case 'exchange':
                if (!targetWalletType) {
                    throw new Error('兑换操作缺少目标钱包类型');
                }
                result = await handleExchange(supabaseUrl, serviceRoleKey, userId, sourceWallet, targetWalletType, currency, amount);
                break;
            default:
                throw new Error('无效的操作');
        }

        return new Response(JSON.stringify({ data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Wallet transaction error:', error);

        return new Response(
            JSON.stringify({
                success: false,
                error: errMsg,
                error_code: mapErrorCode(errMsg),
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    }
});

// 处理充值
async function handleDeposit(supabaseUrl: string, serviceRoleKey: string, wallet: any, amount: number, referenceId?: string): Promise<any> {
    const newBalance = wallet.balance + amount;
    const newTotalDeposits = wallet.total_deposits + amount;

    // 更新钱包余额
    const updateWalletResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?id=eq.${wallet.id}&version=eq.${wallet.version}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            balance: newBalance,
            total_deposits: newTotalDeposits,
            version: wallet.version + 1,
            updated_at: new Date().toISOString()
        })
    });

    if (!updateWalletResponse.ok) {
        const errorText = await updateWalletResponse.text();
        throw new Error(`充值更新钱包失败: ${errorText}`);
    }

    const updatedWallets = await updateWalletResponse.json();
    if (updatedWallets.length === 0) {
        throw new Error('钱包版本冲突，请重试');
    }

    // 创建交易记录
    const transactionData = {
        wallet_id: wallet.id,
        type: 'DEPOSIT',
        amount: amount,
        balance_before: wallet.balance,
        balance_after: newBalance,
        status: 'COMPLETED',
        description: '钱包充值',
        reference_id: referenceId,
        processed_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    };

    const createTransactionResponse = await fetch(`${supabaseUrl}/rest/v1/wallet_transactions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(transactionData)
    });

    if (!createTransactionResponse.ok) {
        const errorText = await createTransactionResponse.text();
        throw new Error(`创建交易记录失败: ${errorText}`);
    }

    const transactions = await createTransactionResponse.json();

    // 创建 Bot 通知
    await createBotNotification(supabaseUrl, serviceRoleKey, wallet.user_id, 'wallet_deposit', {
        transaction_amount: amount,
        transaction_type: 'DEPOSIT'
    });

    return {
        success: true,
        action: 'deposit',
        amount: amount,
        new_balance: newBalance,
        transaction: transactions[0]
    };
}

// 处理提现
async function handleWithdraw(supabaseUrl: string, serviceRoleKey: string, wallet: any, amount: number, referenceId?: string): Promise<any> {
    // 检查余额是否足够
    if (wallet.balance < amount) {
        throw new Error('余额不足');
    }

    const newBalance = wallet.balance - amount;
    const newTotalWithdrawals = wallet.total_withdrawals + amount;

    // 更新钱包余额
    const updateWalletResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?id=eq.${wallet.id}&version=eq.${wallet.version}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            balance: newBalance,
            total_withdrawals: newTotalWithdrawals,
            version: wallet.version + 1,
            updated_at: new Date().toISOString()
        })
    });

    if (!updateWalletResponse.ok) {
        const errorText = await updateWalletResponse.text();
        throw new Error(`提现更新钱包失败: ${errorText}`);
    }

    const updatedWallets = await updateWalletResponse.json();
    if (updatedWallets.length === 0) {
        throw new Error('钱包版本冲突，请重试');
    }

    // 创建交易记录
    const transactionData = {
        wallet_id: wallet.id,
        type: 'WITHDRAWAL',
        amount: -amount,
        balance_before: wallet.balance,
        balance_after: newBalance,
        status: 'COMPLETED',
        description: '钱包提现',
        reference_id: referenceId,
        processed_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    };

    const createTransactionResponse = await fetch(`${supabaseUrl}/rest/v1/wallet_transactions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(transactionData)
    });

    if (!createTransactionResponse.ok) {
        const errorText = await createTransactionResponse.text();
        throw new Error(`创建交易记录失败: ${errorText}`);
    }

    const transactions = await createTransactionResponse.json();

    // 创建 Bot 通知
    await createBotNotification(supabaseUrl, serviceRoleKey, wallet.user_id, 'wallet_withdraw_completed', {
        transaction_amount: amount,
        transaction_type: 'WITHDRAWAL'
    });

    return {
        success: true,
        action: 'withdraw',
        amount: amount,
        new_balance: newBalance,
        transaction: transactions[0]
    };
}

// 处理币种兑换（余额钱包 <-> 积分钱包）
async function handleExchange(supabaseUrl: string, serviceRoleKey: string, userId: string, sourceWallet: any, targetWalletType: string, currency: string, amount: number): Promise<any> {
    // 验证兑换规则
    if (sourceWallet.type === targetWalletType) {
        throw new Error('源钱包和目标钱包类型必须不同');
    }

    // 【资金安全修复 v4】修复钱包类型验证，标准类型为 'TJS' 和 'LUCKY_COIN'
    const validTypes = ['TJS', 'LUCKY_COIN'];
    if (!validTypes.includes(targetWalletType)) {
        throw new Error('无效的目标钱包类型');
    }

    // 检查源钱包余额
    if (sourceWallet.balance < amount) {
        throw new Error('余额不足');
    }

    // 【资金安全修复 v4】获取目标钱包，积分钱包的 currency 是 'POINTS'
    const targetCurrency = targetWalletType === 'LUCKY_COIN' ? 'POINTS' : currency;
    const targetWalletResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}&type=eq.${targetWalletType}&currency=eq.${targetCurrency}&select=*`, {
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
        }
    });

    const targetWallets = await targetWalletResponse.json();
    if (targetWallets.length === 0) {
        throw new Error('目标钱包不存在');
    }
    const targetWallet = targetWallets[0];

    // 兑换比例（1:1兑换）
    const exchangeRate = 1.0;
    const exchangedAmount = amount * exchangeRate;

    // 更新源钱包（减少余额）
    const newSourceBalance = sourceWallet.balance - amount;
    const updateSourceResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?id=eq.${sourceWallet.id}&version=eq.${sourceWallet.version}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            balance: newSourceBalance,
            version: sourceWallet.version + 1,
            updated_at: new Date().toISOString()
        })
    });

    if (!updateSourceResponse.ok) {
        const errorText = await updateSourceResponse.text();
        throw new Error(`更新源钱包失败: ${errorText}`);
    }

    // 【资金安全修复 v4】检查乐观锁是否成功（返回空数组表示 version 不匹配）
    // 注意: 这里用的是 fetch API，需要加 Prefer: return=representation 并检查响应

    // 更新目标钱包（增加余额）
    const newTargetBalance = targetWallet.balance + exchangedAmount;
    const updateTargetResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?id=eq.${targetWallet.id}&version=eq.${targetWallet.version}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            balance: newTargetBalance,
            version: targetWallet.version + 1,
            updated_at: new Date().toISOString()
        })
    });

    if (!updateTargetResponse.ok) {
        // 【资金安全修复 v4】回滚源钱包（使用乐观锁检查 version）
        await fetch(`${supabaseUrl}/rest/v1/wallets?id=eq.${sourceWallet.id}&version=eq.${sourceWallet.version + 1}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                balance: sourceWallet.balance,
                version: sourceWallet.version + 2,
                updated_at: new Date().toISOString()
            })
        });
        
        const errorText = await updateTargetResponse.text();
        throw new Error(`更新目标钱包失败: ${errorText}`);
    }

    // 创建源钱包交易记录（支出）
    const sourceTransactionData = {
        wallet_id: sourceWallet.id,
        type: 'COIN_EXCHANGE',
        amount: -amount,
        balance_before: sourceWallet.balance,
        balance_after: newSourceBalance,
        status: 'COMPLETED',
        description: `兑换至${targetWalletType === 'TJS' ? '余额钱包' : '积分钱包'}`,
        processed_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    };

    // 创建目标钱包交易记录（收入）
    const targetTransactionData = {
        wallet_id: targetWallet.id,
        type: 'COIN_EXCHANGE',
        amount: exchangedAmount,
        balance_before: targetWallet.balance,
        balance_after: newTargetBalance,
        status: 'COMPLETED',
        description: `从${sourceWallet.type === 'TJS' ? '余额钱包' : '积分钱包'}兑换`,
        processed_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    };

    // 批量创建交易记录
    const transactionBatch = [sourceTransactionData, targetTransactionData];
    await fetch(`${supabaseUrl}/rest/v1/wallet_transactions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(transactionBatch)
    });

    return {
        success: true,
        action: 'exchange',
        source_wallet: {
            type: sourceWallet.type,
            old_balance: sourceWallet.balance,
            new_balance: newSourceBalance,
            amount_deducted: amount
        },
        target_wallet: {
            type: targetWallet.type,
            old_balance: targetWallet.balance,
            new_balance: newTargetBalance,
            amount_added: exchangedAmount
        },
        exchange_rate: exchangeRate
    };
}

// 创建通知的辅助函数
async function createBotNotification(
    supabaseUrl: string, 
    serviceRoleKey: string, 
    userId: string, 
    notificationType: string, 
    data: any
): Promise<void> {
    try {
        // 获取用户的手机号
        const userResponse = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=phone_number`, {
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            }
        });

        const users = await userResponse.json();
        if (users.length > 0 && users[0].phone_number) {
            // 创建通知
            const notificationData = {
                user_id: userId,
                phone_number: users[0].phone_number,
                notification_type: notificationType,
                title: getNotificationTitle(notificationType),
                message: getNotificationMessage(notificationType),
                data: data,
                channel: 'whatsapp',
                priority: 2,
                status: 'pending',
                scheduled_at: new Date().toISOString(),
                retry_count: 0,
                max_retries: 3,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            await fetch(`${supabaseUrl}/rest/v1/notification_queue`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(notificationData)
            });
        }
    } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error creating notification:', error);
        // 不抛出错误，避免影响主业务流程
    }
}

// 获取通知标题
function getNotificationTitle(notificationType: string): string {
    switch (notificationType) {
        case 'wallet_deposit':
            return '充值成功';
        case 'wallet_withdraw_completed':
            return '提现完成';
        case 'wallet_withdraw_pending':
            return '提现申请已提交';
        default:
            return '钱包通知';
    }
}

// 获取通知消息
function getNotificationMessage(notificationType: string): string {
    switch (notificationType) {
        case 'wallet_deposit':
            return '您的钱包充值已成功到账';
        case 'wallet_withdraw_completed':
            return '您的提现申请已处理完成';
        case 'wallet_withdraw_pending':
            return '您的提现申请正在处理中';
        default:
            return '钱包状态更新';
    }
}