/**
 * Telegram 认证 Edge Function
 * 
 * 功能：
 * 1. 验证 Telegram initData
 * 2. 创建或更新用户
 * 3. 处理邀请关系
 * 4. 【新增】新用户邀请奖励：
 *    - 给新用户发放10积分
 *    - 给邀请人增加1次抽奖机会
 * 5. 创建会话
 */

// 循环检查函数：检查设置邀请关系是否会形成循环
async function wouldCreateCycle(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  referrerId: string
): Promise<boolean> {  console.log(`[Cycle Check] Checking if setting ${userId} -> ${referrerId} would create a cycle`);
  
  let currentId = referrerId;
  const visited = new Set<string>();
  visited.add(userId);
  
  let depth = 0;
  const maxDepth = 100;
  
  while (currentId && depth < maxDepth) {
    depth++;
    
    if (currentId === userId) {
      console.log(`[Cycle Check] ❌ Cycle detected at depth ${depth}`);
      return true;
    }
    
    if (visited.has(currentId)) {
      console.log(`[Cycle Check] ⚠️  Existing cycle in chain, stopping`);
      break;
    }
    
    visited.add(currentId);
    
    const response = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${currentId}&select=referred_by_id,referrer_id`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) break;
    
    const users = await response.json();
    if (users.length === 0) break;
    
    const user = users[0];
    currentId = user.referred_by_id || user.referrer_id || null;
  }
  
  if (depth >= maxDepth) {
    console.error(`[Cycle Check] ⚠️  Max depth reached`);
    return true;
  }
  
  console.log(`[Cycle Check] ✅ No cycle, depth: ${depth}`);
  return false;
}

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
        const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN') || '8554465278:AAH7Pp0m9BoPECcmDC2ba10SQOz9sj6TVvg';

        if (!serviceRoleKey || !supabaseUrl) {
            throw new Error('Supabase configuration missing');
        }

        // 解析请求数据
        const { initData, startParam } = await req.json();

        if (!initData) {
            throw new Error('Telegram initData is required');
        }

        // 解析 Telegram initData
        const urlParams = new URLSearchParams(initData);
        const userDataRaw = urlParams.get('user');
        const hash = urlParams.get('hash');
        const authDate = urlParams.get('auth_date');

        if (!userDataRaw || !hash || !authDate) {
            throw new Error('Invalid initData format');
        }

        // 解析用户数据
        const userData = JSON.parse(userDataRaw);
        const telegramId = userData.id.toString();

        // 获取用户头像 (带超时控制)
        let avatarUrl = userData.photo_url || null;
        try {
            console.log(`[Avatar] Fetching avatar for user ${telegramId} via Bot API...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

            const profilePhotosResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getUserProfilePhotos?user_id=${telegramId}&limit=1`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (profilePhotosResponse.ok) {
                const profileData = await profilePhotosResponse.json();
                if (profileData.ok && profileData.result.total_count > 0) {
                    const photos = profileData.result.photos[0];
                    const photo = photos[photos.length - 1]; 
                    const fileId = photo.file_id;
                    
                    const fileController = new AbortController();
                    const fileTimeoutId = setTimeout(() => fileController.abort(), 5000);
                    const fileResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getFile?file_id=${fileId}`, {
                        signal: fileController.signal
                    });
                    clearTimeout(fileTimeoutId);

                    if (fileResponse.ok) {
                        const fileData = await fileResponse.json();
                        if (fileData.ok) {
                            const tgFilePath = fileData.result.file_path;
                            const tgFileUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${tgFilePath}`;
                            
                            // 终极方案：转存到 Supabase Storage
                            try {
                                console.log(`[Avatar] Downloading from Telegram: ${tgFileUrl}`);
                                const imageResponse = await fetch(tgFileUrl);
                                if (imageResponse.ok) {
                                    const imageArrayBuffer = await imageResponse.arrayBuffer();
                                    const fileName = `${telegramId}_${Date.now()}.jpg`;
                                    
                                    console.log(`[Avatar] Uploading to Supabase Storage: avatars/${fileName}`);
                                    console.log(`[Avatar] File size: ${imageArrayBuffer.byteLength} bytes`);
                                    
                                    // 使用正确的 Supabase Storage API
                                    const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/avatars/${fileName}`, {
                                        method: 'POST',
                                        headers: {
                                            'Authorization': `Bearer ${serviceRoleKey}`,
                                            'apikey': serviceRoleKey,
                                            'Content-Type': 'image/jpeg',
                                            'x-upsert': 'true'
                                        },
                                        body: imageArrayBuffer
                                    });
                                    
                                    const uploadResult = await uploadResponse.text();
                                    console.log(`[Avatar] Upload response status: ${uploadResponse.status}`);
                                    console.log(`[Avatar] Upload response body: ${uploadResult}`);
                                    
                                    if (uploadResponse.ok || uploadResponse.status === 200) {
                                        avatarUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${fileName}`;
                                        console.log(`[Avatar] Successfully stored in Supabase: ${avatarUrl}`);
                                        
                                        // 验证文件是否真的可访问
                                        const verifyResponse = await fetch(avatarUrl, { method: 'HEAD' });
                                        if (!verifyResponse.ok) {
                                            console.error(`[Avatar] File uploaded but not accessible, status: ${verifyResponse.status}`);
                                            avatarUrl = tgFileUrl; // Fallback
                                        } else {
                                            console.log(`[Avatar] File verified accessible`);
                                        }
                                    } else {
                                        console.error(`[Avatar] Storage upload failed: ${uploadResult}`);
                                        avatarUrl = tgFileUrl; // Fallback to direct TG URL
                                    }
                                }
                            } catch (storageError: unknown) {
                                console.error(`[Avatar] Storage process failed:`, storageError);
                                avatarUrl = tgFileUrl;
                            }
                        }
                    }
                }
            }
        } catch (avatarError: unknown) {
    const avatarErrorMsg = avatarError instanceof Error ? avatarErrorMsg : String(avatarError);
            console.error('[Avatar] Failed to fetch avatar via Bot API (using fallback):', avatarErrorMsg);
            // 保持使用 userData.photo_url
        }

        // 验证 initData 时效性（24小时内有效）
        const authTimestamp = parseInt(authDate) * 1000;
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24小时

        if (now - authTimestamp > maxAge) {
            throw new Error('InitData expired');
        }

        // 生成推荐码（基于 telegramId）
        const generateReferralCode = (telegramId: string): string => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const base = parseInt(telegramId) || 12345;
            let result = '';
            let num = base;
            
            while (result.length < 8) {
                result = chars[num % chars.length] + result;
                num = Math.floor(num / chars.length) || 1;
            }
            
            return 'LM' + result.substring(0, 6);
        };

        const referralCode = generateReferralCode(telegramId);

        // 处理推荐关系
        let referredById = null;
        if (startParam) {
            // 支持多种格式：
            // 1. ref_XXX (旧格式)
            // 2. XXX (新格式，直接是邀请码)
            let referralCodeFromParam = startParam;
            if (startParam.startsWith('ref_')) {
                referralCodeFromParam = startParam.substring(4);
            }
            
            console.log(`[Auth] Processing referral code: ${referralCodeFromParam}`);
            
            // 查找推荐人（同时支持 referral_code 和 invite_code）
            const referrerResponse = await fetch(`${supabaseUrl}/rest/v1/users?or=(referral_code.eq.${referralCodeFromParam},invite_code.eq.${referralCodeFromParam})&select=id`, {
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                }
            });

            if (referrerResponse.ok) {
                const referrerData = await referrerResponse.json();
                if (referrerData.length > 0) {
                    referredById = referrerData[0].id;
                }
            }
        }

        // 检查用户是否已存在
        const existingUserResponse = await fetch(`${supabaseUrl}/rest/v1/users?telegram_id=eq.${telegramId}&select=*`, {
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            }
        });

        const existingUsers = await existingUserResponse.json();
        let user;
        let isNewUser = existingUsers.length === 0;
        let newUserGiftAwarded = false;

        if (existingUsers.length > 0) {
            // 更新现有用户
            user = existingUsers[0];
            
            const updateData: any = {
                telegram_username: userData.username || null,
                first_name: userData.first_name || null,
                last_name: userData.last_name || null,
                language_code: userData.language_code || 'zh',
                avatar_url: avatarUrl || user.avatar_url || null,
                last_login_at: new Date().toISOString(),
                last_active_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            // 修复: 强化邀请关系不可变性 - 同时检查两个字段
            // 只有当用户从未被邀请过时，才设置邀请关系
            if (!user.referred_by_id && !user.referrer_id && referredById) {
                // 检查是否会形成循环
                const wouldCycle = await wouldCreateCycle(supabaseUrl, serviceRoleKey, user.id, referredById);
                
                if (wouldCycle) {
                    console.error(`[Auth] ❌ Cannot set referral: would create circular reference`);
                    // 不设置邀请关系，但允许用户登录
                } else {
                    updateData.referrer_id = referredById;
                    updateData.referred_by_id = referredById;
                    console.log(`[Auth] ✅ Setting referral relationship for existing user ${user.id}: referred by ${referredById}`);
                }
            } else if ((user.referred_by_id || user.referrer_id) && referredById) {
                console.log(`[Auth] User ${user.id} already has referrer, ignoring new referral code`);
            }

            const updateResponse = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${user.id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(updateData)
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                throw new Error(`Failed to update user: ${errorText}`);
            }

            const updatedUsers = await updateResponse.json();
            user = updatedUsers[0];
        } else {
            // 创建新用户 (id 由数据库自动生成)
            
            // 验证邀请人是否存在
            let finalReferredById = referredById;
            
            if (referredById) {
                const referrerResponse = await fetch(
                    `${supabaseUrl}/rest/v1/users?id=eq.${referredById}&select=id,created_at`,
                    {
                        headers: {
                            'Authorization': `Bearer ${serviceRoleKey}`,
                            'apikey': serviceRoleKey,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                if (referrerResponse.ok) {
                    const referrers = await referrerResponse.json();
                    if (referrers.length === 0) {
                        console.error(`[Auth] ❌ Referrer ${referredById} not found, ignoring referral`);
                        finalReferredById = null;
                    } else {
                        console.log(`[Auth] ✅ Referrer ${referredById} exists, valid referral`);
                    }
                } else {
                    console.error(`[Auth] Failed to verify referrer, ignoring referral`);
                    finalReferredById = null;
                }
            }
            
            const newUserData = {
                telegram_id: telegramId,
                telegram_username: userData.username || null,
                first_name: userData.first_name || null,
                last_name: userData.last_name || null,
                language_code: userData.language_code || 'zh',
                avatar_url: avatarUrl || null,
                referral_code: referralCode,
                referred_by_id: finalReferredById,
                referrer_id: finalReferredById,
                status: 'ACTIVE',
                is_verified: false,
                kyc_level: 'NONE',
                two_factor_enabled: false,
                last_login_at: new Date().toISOString(),
                last_active_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const createResponse = await fetch(`${supabaseUrl}/rest/v1/users`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(newUserData)
            });

            if (!createResponse.ok) {
                const errorText = await createResponse.text();
                throw new Error(`Failed to create user: ${errorText}`);
            }

            const newUsers = await createResponse.json();
            user = newUsers[0];

            // 为新用户创建钱包
            const wallets = [
                {
                    user_id: user.id,
                    type: 'TJS',
                    currency: 'TJS',
                    balance: 0,
                    frozen_balance: 0,
                    total_deposits: 0,
                    total_withdrawals: 0,
                    version: 1,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                {
                    user_id: user.id,
                    type: 'LUCKY_COIN',
                    currency: 'POINTS',  // 修复：LUCKY_COIN钱包的currency应为POINTS
                    balance: 10, // 【新增】新用户赠送10积分
                    frozen_balance: 0,
                    total_deposits: 0,
                    total_withdrawals: 0,
                    version: 1,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ];

            const createWalletsResponse = await fetch(`${supabaseUrl}/rest/v1/wallets`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(wallets)
            });

            if (!createWalletsResponse.ok) {
                const errorText = await createWalletsResponse.text();
                console.error('Failed to create wallets:', errorText);
                // 钱包创建失败必须回滚用户创建
                // 删除刚创建的用户
                await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${user.id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${serviceRoleKey}`,
                        'apikey': serviceRoleKey
                    }
                });
                throw new Error('Failed to create wallets for new user');
            } else {
                newUserGiftAwarded = true;
                
                // 【新增】记录新人积分奖励的钱包交易
                const walletsData = await createWalletsResponse.json();
                const luckyWallet = walletsData.find((w: any) => w.type === 'LUCKY_COIN');
                if (luckyWallet) {
                    await fetch(`${supabaseUrl}/rest/v1/wallet_transactions`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${serviceRoleKey}`,
                            'apikey': serviceRoleKey,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify({
                            wallet_id: luckyWallet.id,
                            type: 'NEW_USER_GIFT',
                            amount: 10,
                            balance_before: 0,
                            balance_after: 10,
                            description: '新用户注册奖励',
                            status: 'COMPLETED',
                            created_at: new Date().toISOString()
                        })
                    });
                }
            }

            // 【新增】如果有邀请人，给邀请人增加1次抽奖机会
            if (referredById) {
                try {
                    // 增加邀请人的抽奖次数
                    await fetch(`${supabaseUrl}/rest/v1/rpc/add_user_spin_count`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${serviceRoleKey}`,
                            'apikey': serviceRoleKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            p_user_id: referredById,
                            p_count: 1,
                            p_source: 'invite_reward'
                        })
                    });

                    // 记录邀请奖励
                    await fetch(`${supabaseUrl}/rest/v1/invite_rewards`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${serviceRoleKey}`,
                            'apikey': serviceRoleKey,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                    body: JSON.stringify({
                        inviter_id: referredById,
                        invitee_id: user.id,
                        reward_type: 'new_user_register',
                        spin_count_awarded: 1,
                        lucky_coins_awarded: 10, // 注：这里只是记录，实际积分已在创建钱包时发放（第225行 balance: 10）
                        is_processed: true,
                        processed_at: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    })
                    });

                    console.log(`[Invite Reward] Awarded 1 spin to inviter ${referredById} for inviting ${user.id}`);
                    
                    // 给邀请人和被邀请人各增加5次AI对话次数
                    try {
                        // 给邀请人增加AI次数
                        await fetch(`${supabaseUrl}/functions/v1/ai-add-bonus`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${serviceRoleKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                user_id: referredById,
                                amount: 5,
                                reason: 'invite_reward'
                            })
                        });
                        
                        // 给被邀请人增加AI次数
                        await fetch(`${supabaseUrl}/functions/v1/ai-add-bonus`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${serviceRoleKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                user_id: user.id,
                                amount: 5,
                                reason: 'invite_reward'
                            })
                        });
                        
                        console.log(`[Invite Reward] Awarded 5 AI chats to both inviter ${referredById} and invitee ${user.id}`);
                    } catch (aiRewardError: unknown) {
                        console.error('Failed to process AI invite reward:', aiRewardError);
                    }
                    
// 创建邀请成功通知
                    try {
                        await fetch(`${supabaseUrl}/rest/v1/notifications`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${serviceRoleKey}`,
                                'apikey': serviceRoleKey,
                                'Content-Type': 'application/json',
                                'Prefer': 'return=minimal'
                            },
                            body: JSON.stringify({
                                user_id: referredById,
                                type: 'INVITE_SUCCESS',
                                title_i18n: {
                                    zh: '邀请成功',
                                    ru: 'Успешное приглашение',
                                    tg: 'Даъвати муваффақ'
                                },
                                message_i18n: {
                                    zh: `恭喜！用户 ${userData.first_name || userData.username || '新用户'} 通过您的邀请链接注册成功！您获得了1次转盘抽奖机会和5次AI对话次数。`,
                                    ru: `Поздравляем! Пользователь ${userData.first_name || userData.username || 'новый пользователь'} успешно зарегистрировался по вашей реферальной ссылке! Вы получили 1 вращение колеса и 5 AI-чатов.`,
                                    tg: `Табрик! Корбар ${userData.first_name || userData.username || 'корбари нав'} тавассути истиноди шумо бомуваффақият сабти ном кард! Шумо 1 чархиши чархак ва 5 суҳбати AI гирифтед.`
                                },
                                is_read: false,
                                metadata: {
                                    invitee_id: user.id,
                                    invitee_name: userData.first_name || userData.username,
                                    rewards: {
                                        spin_count: 1,
                                        ai_chats: 5
                                    }
                                },
                                created_at: new Date().toISOString()
                            })
                        });
                        
                        console.log(`[Invite Notification] Created notification for inviter ${referredById}`);
                        
                        // 【新增】发送Bot通知给邀请人
                        const inviterResponse = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${referredById}&select=telegram_id`, {
                            headers: {
                                'Authorization': `Bearer ${serviceRoleKey}`,
                                'apikey': serviceRoleKey,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (inviterResponse.ok) {
                            const inviterData = await inviterResponse.json();
                            if (inviterData.length > 0 && inviterData[0].telegram_id) {
                                await fetch(`${supabaseUrl}/rest/v1/notification_queue`, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${serviceRoleKey}`,
                                        'apikey': serviceRoleKey,
                                        'Content-Type': 'application/json',
                                        'Prefer': 'return=minimal'
                                    },
                                    body: JSON.stringify({
                                        user_id: referredById,
                                        type: 'referral_success',
                                        payload: {
                                            invitee_name: userData.first_name || userData.username || '新用户'
                                        },
                                        telegram_chat_id: parseInt(inviterData[0].telegram_id),
                                        notification_type: 'referral_success',
                                        title: '邀请成功',
                                        message: '',
                                        data: {
                                            invitee_name: userData.first_name || userData.username || '新用户'
                                        },
                                        priority: 2,
                                        status: 'pending',
                                        scheduled_at: new Date().toISOString(),
                                        retry_count: 0,
                                        max_retries: 3,
                                        created_at: new Date().toISOString(),
                                        updated_at: new Date().toISOString()
                                    })
                                });
                                console.log(`[Invite Bot Notification] Queued notification for inviter ${referredById}`);
                            }
                        }
                    } catch (notificationError: unknown) {
                        console.error('Failed to create invite notification:', notificationError);
                    }
                } catch (inviteError: unknown) {
                    console.error('Failed to process invite reward:', inviteError);
                    // 邀请奖励失败不影响用户注册
                }
            }
        }

        // 获取用户钱包信息
        const walletsResponse = await fetch(`${supabaseUrl}/rest/v1/wallets?user_id=eq.${user.id}&select=*`, {
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            }
        });

        const wallets = walletsResponse.ok ? await walletsResponse.json() : [];

        // 创建会话token（简单实现）
        const sessionToken = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天后过期

        // 创建用户会话
        const sessionData = {
            user_id: user.id,
            session_token: sessionToken,
            device_info: 'telegram_mini_app',
            is_active: true,
            expires_at: expiresAt.toISOString()
        };

        const createSessionResponse = await fetch(`${supabaseUrl}/rest/v1/user_sessions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(sessionData)
        });

        let session = null;
        if (createSessionResponse.ok) {
            const sessions = await createSessionResponse.json();
            session = sessions[0];
            console.log('[Auth] Session created successfully:', session?.session_token?.substring(0, 8) + '...');
        } else {
            const errorText = await createSessionResponse.text();
            console.error('[Auth] Failed to create session:', createSessionResponse.status, errorText);
        }

        // 返回认证结果
        const result = {
            success: true,
            user: {
                id: user.id,
                telegram_id: user.telegram_id,
                telegram_username: user.telegram_username,
                first_name: user.first_name,
                last_name: user.last_name,
                language_code: user.language_code,
                referral_code: user.referral_code,
                status: user.status,
                is_verified: user.is_verified,
                kyc_level: user.kyc_level
            },
            wallets: wallets,
            session: session ? {
                token: session.session_token,
                expires_at: session.expires_at
            } : null,
            is_new_user: isNewUser,
            // 【新增】新用户奖励信息
            new_user_gift: isNewUser && newUserGiftAwarded ? {
                lucky_coins: 10,
                message: '恭喜！好友送你 10 积分！'
            } : null
        };

        return new Response(JSON.stringify({ data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
        console.error('Authentication error:', error);

        const errorResponse = {
            error: {
                code: 'AUTH_FAILED',
                message: errMsg
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
