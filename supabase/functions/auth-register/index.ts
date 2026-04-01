import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 密码哈希函数 (HMAC-SHA256 + 应用盐)
// 使用 HMAC 而非纯 SHA-256，防止彩虹表攻击
const APP_SALT = Deno.env.get('PASSWORD_SALT') || 'tezbarakat_default_salt_2026';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(APP_SALT);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 标准化手机号：去除空格、括号、连字符，保留+号前缀
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // 确保以+号开头（国际格式）
  if (!cleaned.startsWith('+')) {
    // 如果是塔吉克斯坦号码（9位数字），自动加上+992
    if (/^\d{9}$/.test(cleaned)) {
      cleaned = '+992' + cleaned;
    } else if (/^992\d{9}$/.test(cleaned)) {
      cleaned = '+' + cleaned;
    }
    // 其他情况保持原样，由数据库UNIQUE约束保证唯一性
  }
  return cleaned;
}

// 生成碰撞安全的邀请码（使用crypto.randomUUID的一部分，碰撞概率极低）
function generateReferralCode(): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return uuid.substring(0, 8).toUpperCase();
}

// 带重试的邀请码生成（处理极端碰撞情况）
async function generateUniqueReferralCode(supabase: any, maxRetries = 3): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateReferralCode();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', code)
      .single();
    if (!existing) {
      return code;
    }
  }
  // 极端情况：使用更长的码
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { phone_number, password, first_name, last_name, referral_code } = await req.json();

    // ============================================================
    // 参数校验
    // ============================================================
    if (!phone_number || !password) {
      return new Response(JSON.stringify({ success: false, error: '手机号和密码是必填项', error_code: 'ERR_PHONE_PASSWORD_REQUIRED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ success: false, error: '密码长度至少6位', error_code: 'ERR_PASSWORD_TOO_SHORT' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 标准化手机号
    const normalizedPhone = normalizePhone(phone_number);

    if (!/^\+?\d{9,15}$/.test(normalizedPhone)) {
      return new Response(JSON.stringify({ success: false, error: '手机号格式不正确', error_code: 'ERR_PHONE_FORMAT_INVALID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // 1. 检查用户是否已存在（标准化后匹配）
    // ============================================================
    const phoneWithoutPlus = normalizedPhone.replace(/^\+/, '');
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .or(`phone_number.eq.${normalizedPhone},phone_number.eq.${phoneWithoutPlus},phone_number.eq.+${phoneWithoutPlus}`)
      .limit(1)
      .maybeSingle();

    if (existingUser) {
      return new Response(JSON.stringify({ success: false, error: '该手机号已被注册', error_code: 'ERR_PHONE_ALREADY_USED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // 2. 处理邀请码
    // ============================================================
    let referredById = null;
    if (referral_code) {
      const { data: referrer } = await supabase
        .from('users')
        .select('id')
        .eq('referral_code', referral_code.toUpperCase().trim())
        .single();
      if (referrer) {
        referredById = referrer.id;
      }
    }

    // ============================================================
    // 3. 生成碰撞安全的邀请码
    // ============================================================
    const hashedPassword = await hashPassword(password);
    const newReferralCode = await generateUniqueReferralCode(supabase);

    // ============================================================
    // 4. 创建用户
    // ============================================================
    const { data: user, error: createError } = await supabase
      .from('users')
      .insert({
        phone_number: normalizedPhone,
        password_hash: hashedPassword,
        first_name: first_name?.trim() || null,
        last_name: last_name?.trim() || null,
        referral_code: newReferralCode,
        referred_by_id: referredById,
        referrer_id: referredById,
        status: 'ACTIVE',
        last_login_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError || !user) {
      // 检查是否是UNIQUE约束冲突（并发注册同一手机号）
      if (createError?.code === '23505') {
        return new Response(JSON.stringify({ success: false, error: '该手机号已被注册', error_code: 'ERR_PHONE_ALREADY_USED' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('创建用户失败: ' + createError?.message);
    }

    // ============================================================
    // 5. 初始化钱包
    // ============================================================
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
        updated_at: new Date().toISOString(),
      },
      {
        user_id: user.id,
        type: 'LUCKY_COIN',
        currency: 'POINTS',
        balance: 10, // 注册奖励
        frozen_balance: 0,
        total_deposits: 0,
        total_withdrawals: 0,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    ];

    const { data: createdWallets, error: walletError } = await supabase
      .from('wallets')
      .insert(wallets)
      .select();

    if (walletError) {
      console.error('创建钱包失败:', walletError);
      // 钱包创建失败需要回滚用户创建
      await supabase.from('users').delete().eq('id', user.id);
      throw new Error('创建钱包失败，注册已回滚');
    }

    // 记录积分奖励交易
    if (createdWallets) {
      const luckyWallet = createdWallets.find((w: any) => w.type === 'LUCKY_COIN');
      if (luckyWallet) {
        await supabase.from('wallet_transactions').insert({
          wallet_id: luckyWallet.id,
          type: 'NEW_USER_GIFT',
          amount: 10,
          balance_before: 0,
          balance_after: 10,
          description: '新用户注册奖励',
          status: 'COMPLETED',
          created_at: new Date().toISOString(),
        });
      }
    }

    // ============================================================
    // 6. 如果有邀请人，发放奖励
    // ============================================================
    if (referredById) {
      try {
        // 增加邀请人的抽奖次数
        await supabase.rpc('add_user_spin_count', {
          p_user_id: referredById,
          p_count: 1,
          p_source: 'invite_reward'
        });

        // 记录邀请奖励
        await supabase.from('invite_rewards').insert({
          inviter_id: referredById,
          invitee_id: user.id,
          reward_type: 'new_user_register',
          spin_count_awarded: 1,
          lucky_coins_awarded: 10,
          is_processed: true,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });

        // 给邀请人和被邀请人各增加5次AI对话次数
        try {
          const supabaseUrl = SUPABASE_URL;
          const serviceRoleKey = SUPABASE_SERVICE_ROLE_KEY;

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

        // 发送通知给邀请人
        await supabase.from('notifications').insert({
          user_id: referredById,
          type: 'INVITE_SUCCESS',
          title_i18n: { zh: '邀请成功', ru: 'Успешное приглашение', tg: 'Даъвати муваффақ' },
          message_i18n: {
            zh: `恭喜！用户 ${first_name || '新用户'} 通过您的邀请链接注册成功！您获得了1次转盘抽奖机会和5次AI对话次数。`,
            ru: `Поздравляем! Пользователь ${first_name || 'новый пользователь'} успешно зарегистрировался по вашей ссылке! Вы получили 1 вращение колеса и 5 AI-чатов.`,
            tg: `Табрик! Корбар ${first_name || 'корбари нав'} тавассути истиноди шумо бомуваффақият сабти ном кард! Шумо 1 чархиши чархак ва 5 суҳбати AI гирифтед.`
          },
          metadata: {
            invitee_id: user.id,
            invitee_name: first_name || null,
            rewards: { spin_count: 1, ai_chats: 5 }
          },
          created_at: new Date().toISOString(),
        });

        // 将通知加入 WhatsApp 发送队列
        const { data: inviterData } = await supabase
          .from('users')
          .select('phone_number')
          .eq('id', referredById)
          .single();

        if (inviterData?.phone_number) {
          await supabase.from('notification_queue').insert({
            user_id: referredById,
            phone_number: inviterData.phone_number,
            type: 'referral_success',
            notification_type: 'referral_success',
            payload: {
              invitee_name: first_name || '新用户'
            },
            title: '邀请成功',
            message: `用户 ${first_name || '新用户'} 通过您的邀请链接注册成功！`,
            priority: 2,
            status: 'pending',
            channel: 'whatsapp',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            max_retries: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      } catch (referralError) {
        // 邀请奖励失败不应阻断注册流程
        console.error('邀请奖励发放失败:', referralError);
      }
    }

    // ============================================================
    // 7. 创建会话（必须成功，否则返回错误）
    // ============================================================
    const sessionToken = crypto.randomUUID();
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        session_token: sessionToken,
        device_info: 'pwa_web',
        is_active: true,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (sessionError || !session) {
      // 会话创建失败是严重错误，用户无法登录
      console.error('创建会话失败:', sessionError);
      return new Response(JSON.stringify({
        success: false, error: '注册成功但会话创建失败，请尝试登录', error_code: 'ERR_SESSION_CREATE_FAILED'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // 8. 返回结果
    // ============================================================
    const result = {
      success: true,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        first_name: user.first_name,
        last_name: user.last_name,
        referral_code: user.referral_code,
        status: user.status,
        avatar_url: user.avatar_url || null,
        language_code: user.language_code || null,
        preferred_language: user.preferred_language || null,
      },
      wallets: createdWallets || [],
      session: {
        token: session.session_token,
        expires_at: session.expires_at
      },
      is_new_user: true,
      new_user_gift: {
        lucky_coins: 10,
        message: '恭喜！注册成功，送你 10 积分！'
      }
    };

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Registration error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, error_code: 'ERR_SERVER_ERROR' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
