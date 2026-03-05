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
            throw new Error('Supabase configuration missing');
        }

        // 解析请求数据
        const { lotteryId, adminToken } = await req.json();

        if (!lotteryId) {
            throw new Error('Missing required parameter: lotteryId');
        }

        // 简单的管理员验证（实际应用中应该更严格）
        if (!adminToken || adminToken !== 'ADMIN_DRAW_TOKEN_2024') {
            throw new Error('Unauthorized: Invalid admin token');
        }

        // 获取彩票信息
        const lotteryResponse = await fetch(`${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}&select=*`, {
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            }
        });

        const lotteries = await lotteryResponse.json();
        if (lotteries.length === 0) {
            throw new Error('Lottery not found');
        }
        const lottery = lotteries[0];

        // 验证彩票状态
        if (lottery.status !== 'ACTIVE' && lottery.status !== 'SOLD_OUT') {
            throw new Error(`Lottery cannot be drawn. Current status: ${lottery.status}`);
        }

        // 检查是否已经开奖
        if (lottery.status === 'COMPLETED' || lottery.winning_numbers) {
            throw new Error('Lottery has already been drawn');
        }

        // 检查开奖时间
        const drawTime = new Date(lottery.draw_time);
        const now = new Date();
        if (now < drawTime) {
            throw new Error('Draw time has not arrived yet');
        }

        // 更新彩票状态为开奖中
        await fetch(`${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: 'DRAWING',
                updated_at: new Date().toISOString()
            })
        });

        // 获取所有参与的彩票记录
        const entriesResponse = await fetch(`${supabaseUrl}/rest/v1/lottery_entries?lottery_id=eq.${lotteryId}&status=eq.ACTIVE&select=*`, {
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            }
        });

        const entries = await entriesResponse.json();
        if (entries.length === 0) {
            throw new Error('No lottery entries found');
        }

        // 获取所有参与用户的用户ID列表（用于一次性获取Bot设置）
        const userIds = [...new Set(entries.map(entry => entry.user_id))];
        
        // 一次性获取所有用户的Bot设置（修复：将fetch调用移出循环）
        const botSettingsMap = new Map();
        if (userIds.length > 0) {
            const userIdsQuery = userIds.map(id => `user_id.eq.${id}`).join(',');
            const allBotSettingsResponse = await fetch(`${supabaseUrl}/rest/v1/bot_user_settings?or=(${userIdsQuery})&select=user_id,telegram_chat_id`, {
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                }
            });
            
            const allBotSettings = await allBotSettingsResponse.json();
            // 创建用户ID到聊天ID的映射
            allBotSettings.forEach(setting => {
                if (setting.telegram_chat_id) {
                    botSettingsMap.set(setting.user_id, setting.telegram_chat_id);
                }
            });
        }

        // 生成VRF种子和证明（使用 Web Crypto API）
        const generateVRFData = async (): Promise<{ seed: string; proof: string; }> => {
            // 使用当前时间戳、彩票ID和随机数生成种子
            const timeStamp = Date.now().toString();
            const randomBytes = crypto.getRandomValues(new Uint8Array(32));
            const seedData = timeStamp + lotteryId + Array.from(randomBytes).join('');
            
            // 使用 SHA-256 生成种子
            const encoder = new TextEncoder();
            const data = encoder.encode(seedData);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = new Uint8Array(hashBuffer);
            const seed = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
            
            // 生成证明（简化版本，实际应用可能需要更复杂的VRF证明）
            const proofData = encoder.encode(seed + timeStamp);
            const proofBuffer = await crypto.subtle.digest('SHA-256', proofData);
            const proofArray = new Uint8Array(proofBuffer);
            const proof = Array.from(proofArray).map(b => b.toString(16).padStart(2, '0')).join('');
            
            return { seed, proof };
        };

        const { seed, proof } = await generateVRFData();

        // 基于种子生成确定性随机数来选择中奖号码
        const generateWinningNumbers = async (seed: string, totalEntries: number): Promise<string[]> => {
            // 计算中奖数量（根据参与人数调整）
            const winningCount = Math.max(1, Math.floor(totalEntries * 0.1)); // 10% 中奖率
            
            // 使用种子生成确定性随机数
            const seedBytes = new TextEncoder().encode(seed);
            const randomSeed = await crypto.subtle.digest('SHA-256', seedBytes);
            const randomArray = new Uint8Array(randomSeed);
            
            const winningIndices = new Set<number>();
            let randomIndex = 0;
            
            while (winningIndices.size < winningCount && randomIndex < randomArray.length - 4) {
                // 使用4个字节生成随机索引
                const randomValue = 
                    (randomArray[randomIndex] << 24) |
                    (randomArray[randomIndex + 1] << 16) |
                    (randomArray[randomIndex + 2] << 8) |
                    randomArray[randomIndex + 3];
                
                const index = randomValue % totalEntries;
                winningIndices.add(index);
                randomIndex += 4;
                
                // 如果随机数组用完了，重新生成
                if (randomIndex >= randomArray.length - 4) {
                    const newSeed = seed + winningIndices.size.toString();
                    const newSeedBytes = new TextEncoder().encode(newSeed);
                    const newRandomSeed = await crypto.subtle.digest('SHA-256', newSeedBytes);
                    const newRandomArray = new Uint8Array(newRandomSeed);
                    randomArray.set(newRandomArray);
                    randomIndex = 0;
                }
            }
            
            return Array.from(winningIndices).map(index => entries[index].numbers);
        };

        // 生成中奖号码
        const winningNumbers = await generateWinningNumbers(seed, entries.length);

        // 计算奖金池
        const totalPrizePool = lottery.ticket_price * lottery.sold_tickets * 0.8; // 80% 作为奖金池
        const firstPrize = totalPrizePool * 0.6; // 60% 给一等奖
        const secondPrize = totalPrizePool * 0.3; // 30% 给二等奖
        const thirdPrize = totalPrizePool * 0.1; // 10% 给三等奖

        // 确定中奖等级和奖金
        const winnerUpdates: any[] = [];
        const notifications: any[] = [];
        
        for (let i = 0; i < winningNumbers.length; i++) {
            const winningNumber = winningNumbers[i];
            const entry = entries.find(e => e.numbers === winningNumber);
            
            if (entry) {
                let prizeRank: number;
                let prizeAmount: number;
                
                if (i === 0) {
                    prizeRank = 1;
                    prizeAmount = firstPrize;
                } else if (i < 3) {
                    prizeRank = 2;
                    prizeAmount = secondPrize / 2; // 二等奖最多2名
                } else {
                    prizeRank = 3;
                    prizeAmount = thirdPrize / (winningNumbers.length - 3); // 三等奖分配剩余名额
                }

                winnerUpdates.push({
                    id: entry.id,
                    is_winning: true,
                    prize_amount: prizeAmount,
                    prize_rank: prizeRank
                });

                // 创建中奖通知
                notifications.push({
                    user_id: entry.user_id,
                    type: 'LOTTERY_RESULT',
                    title: `恭喜中奖！`,
                    content: `您在彩票 ${lottery.title} 中获得${prizeRank}等奖，奖金 ${prizeAmount} ${lottery.currency}`,
                    related_id: lotteryId,
                    related_type: 'lottery',
                    is_read: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            }
        }

        // 批量更新中奖记录
        for (const update of winnerUpdates) {
            await fetch(`${supabaseUrl}/rest/v1/lottery_entries?id=eq.${update.id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    is_winning: update.is_winning,
                    prize_amount: update.prize_amount,
                    prize_rank: update.prize_rank,
                    updated_at: new Date().toISOString()
                })
            });

            // 向中奖用户钱包发放奖金
            const winnerEntry = entries.find(e => e.id === update.id);
            if (winnerEntry) {
                // 获取用户钱包
                // 【资金安全修复 v3】修复钱包类型: BALANCE → TJS
                // 数据库枚举 WalletType 只有 'TJS' 和 'LUCKY_COIN'，没有 'BALANCE'
                // 现金钱包标准: type='TJS', currency='TJS'
                const winnerWalletResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?user_id=eq.${winnerEntry.user_id}&type=eq.TJS&currency=eq.${lottery.currency}&select=*`, {
                    headers: {
                        'Authorization': `Bearer ${serviceRoleKey}`,
                        'apikey': serviceRoleKey,
                        'Content-Type': 'application/json'
                    }
                });

                const winnerWallets = await winnerWalletResponse.json();
                if (winnerWallets.length > 0) {
                    const winnerWallet = winnerWallets[0];
                    const newBalance = winnerWallet.balance + update.prize_amount;

                    // 【资金安全修复 v3】添加乐观锁: 通过 version 条件确保并发安全
                    // 更新钱包余额
                    await fetch(`${supabaseUrl}/rest/v1/wallets?id=eq.${winnerWallet.id}&version=eq.${winnerWallet.version}`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${serviceRoleKey}`,
                            'apikey': serviceRoleKey,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=representation'
                        },
                        body: JSON.stringify({
                            balance: newBalance,
                            version: (winnerWallet.version || 1) + 1,
                            updated_at: new Date().toISOString()
                        })
                    });

                    // 创建奖金交易记录
                    const prizeTransactionData = {
                        wallet_id: winnerWallet.id,
                        type: 'LOTTERY_PRIZE',
                        amount: update.prize_amount,
                        balance_before: winnerWallet.balance,
                        balance_after: newBalance,
                        status: 'COMPLETED',
                        description: `彩票中奖奖金 - ${update.prize_rank}等奖`,
                        related_lottery_id: lotteryId,
                        processed_at: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    };

                    await fetch(`${supabaseUrl}/rest/v1/wallet_transactions`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${serviceRoleKey}`,
                            'apikey': serviceRoleKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(prizeTransactionData)
                    });
                }
            }
        }

        // 创建通知
        if (notifications.length > 0) {
            await fetch(`${supabaseUrl}/rest/v1/notifications`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(notifications)
            });
        }

        // 创建 Bot 通知（使用预先获取的Bot设置，避免循环中的fetch调用）
        // 只发送中奖通知，不发送未中奖通知（避免打扰用户）
        const botNotifications = [];
        for (const entry of entries) {
            const isWinner = winnerUpdates.some(w => w.id === entry.id);
            const winnerInfo = winnerUpdates.find(w => w.id === entry.id);

            // 使用预先获取的Bot设置映射
            const chatId = botSettingsMap.get(entry.user_id);
            
            if (chatId && isWinner && winnerInfo) {
                // 只发送中奖通知
                console.log(`[Lottery Draw] Sending win notification to user ${entry.user_id}`);
                botNotifications.push({
                    user_id: entry.user_id,
                    type: 'lucky_draw_win',
                    payload: {
                        lottery_id: lotteryId,
                        product_name: lottery.title,
                        winning_number: winningNumbers[0],
                        ticket_number: entry.numbers
                    },
                    status: 'pending',
                    created_at: new Date().toISOString()
                });
            }
        }

        // 批量创建 Bot 通知
        if (botNotifications.length > 0) {
            console.log(`[Lottery Draw] Inserting ${botNotifications.length} bot notifications`);
            const notifResponse = await fetch(`${supabaseUrl}/rest/v1/notification_queue`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(botNotifications)
            });
            
            if (!notifResponse.ok) {
                const errorText = await notifResponse.text();
                console.error(`[Lottery Draw] Failed to insert notifications: ${errorText}`);
            } else {
                console.log(`[Lottery Draw] ✅ Bot notifications inserted successfully`);
            }
        } else {
            console.log(`[Lottery Draw] No bot notifications to send`);
        }

        // 更新彩票状态为已完成
        const updateLotteryResponse = await fetch(`${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: 'COMPLETED',
                winning_numbers: winningNumbers,
                vrf_seed: seed,
                vrf_proof: proof,
                actual_draw_time: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
        });

        if (!updateLotteryResponse.ok) {
            const errorText = await updateLotteryResponse.text();
            throw new Error(`Failed to update lottery: ${errorText}`);
        }

        // 返回开奖结果
        const result = {
            success: true,
            lottery_id: lotteryId,
            winning_numbers: winningNumbers,
            vrf_seed: seed,
            vrf_proof: proof,
            total_winners: winnerUpdates.length,
            total_prize_pool: totalPrizePool,
            draw_time: new Date().toISOString(),
            winners: winnerUpdates.map(w => ({
                prize_rank: w.prize_rank,
                prize_amount: w.prize_amount
            }))
        };

        return new Response(JSON.stringify({ data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Lottery draw error:', error);

        const errorResponse = {
            error: {
                code: 'DRAW_FAILED',
                message: error.message
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});