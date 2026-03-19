import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 密码哈希函数 (SHA-256)
async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { phone_number, password, first_name, last_name, referral_code } = await req.json();

    if (!phone_number || !password) {
      return new Response(JSON.stringify({ error: { message: '手机号和密码是必填项' } }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. 检查用户是否已存在
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone_number', phone_number)
      .single();

    if (existingUser) {
      return new Response(JSON.stringify({ error: { message: '该手机号已被注册' } }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. 处理邀请码
    let referredById = null;
    if (referral_code) {
      const { data: referrer } = await supabase
        .from('users')
        .select('id')
        .eq('referral_code', referral_code)
        .single();
      if (referrer) {
        referredById = referrer.id;
      }
    }

    // 3. 创建用户
    const hashedPassword = await hashPassword(password);
    const newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const { data: user, error: createError } = await supabase
      .from('users')
      .insert({
        phone_number,
        password_hash: hashedPassword,
        first_name: first_name || null,
        last_name: last_name || null,
        referral_code: newReferralCode,
        referred_by_id: referredById,
        referrer_id: referredById,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError || !user) {
      throw new Error('创建用户失败: ' + createError?.message);
    }

    // 4. 初始化钱包 (参考 auth-telegram 逻辑)
    const wallets = [
      {
        user_id: user.id,
        type: 'TJS',
        currency: 'TJS',
        balance: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        user_id: user.id,
        type: 'LUCKY_COIN',
        currency: 'POINTS',
        balance: 10, // 注册奖励
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
    } else {
      // 记录积分奖励交易
      const luckyWallet = createdWallets.find(w => w.type === 'LUCKY_COIN');
      if (luckyWallet) {
        await supabase.from('wallet_transactions').insert({
          wallet_id: luckyWallet.id,
          type: 'NEW_USER_GIFT',
          amount: 10,
          balance_before: 0,
          balance_after: 10,
          description: '新用户注册奖励',
          status: 'COMPLETED',
        });
      }
    }

    // 5. 如果有邀请人，发放奖励
    if (referredById) {
      await supabase.rpc('add_user_spin_count', {
        p_user_id: referredById,
        p_count: 1,
        p_source: 'invite_reward'
      });
      
      // 发送通知给邀请人
      await supabase.from('notifications').insert({
        user_id: referredById,
        type: 'INVITE_SUCCESS',
        title_i18n: { zh: '邀请成功', ru: 'Успешное приглашение', tg: 'Даъвати муваффақ' },
        message_i18n: {
          zh: `恭喜！新用户 ${phone_number} 通过您的邀请链接注册成功！您获得了1次转盘抽奖机会。`,
          ru: `Поздравляем! Новый пользователь ${phone_number} успешно зарегистрировался по вашей ссылке! Вы получили 1 вращение.`,
          tg: `Табрик! Корбари нав ${phone_number} тавассути истиноди шумо сабти ном кард! Шумо 1 чархиш гирифтед.`
        },
        metadata: { invitee_id: user.id, invitee_phone: phone_number },
      });
    }

    // 6. 创建会话
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

    if (sessionError) {
      console.error('创建会话失败:', sessionError);
    }

    // 7. 返回结果 (保持与 auth-telegram 兼容的结构)
    const result = {
      success: true,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        first_name: user.first_name,
        last_name: user.last_name,
        referral_code: user.referral_code,
        status: user.status,
      },
      session: session ? {
        token: session.session_token,
        expires_at: session.expires_at
      } : null,
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
    return new Response(JSON.stringify({ error: { message: error.message } }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
