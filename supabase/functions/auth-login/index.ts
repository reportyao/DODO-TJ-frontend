import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 密码哈希函数 (HMAC-SHA256 + 应用盐) - 与 auth-register 保持一致
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

// 标准化手机号：与 auth-register 保持一致
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) {
    if (/^\d{9}$/.test(cleaned)) {
      cleaned = '+992' + cleaned;
    } else if (/^992\d{9}$/.test(cleaned)) {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { phone_number, password } = await req.json();

    if (!phone_number || !password) {
      return new Response(JSON.stringify({ error: { message: '手机号和密码是必填项' } }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // 1. 标准化手机号并查找用户（兼容多种格式）
    // ============================================================
    const normalizedPhone = normalizePhone(phone_number);
    const phoneWithoutPlus = normalizedPhone.replace(/^\+/, '');

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, phone_number, password_hash, first_name, last_name, referral_code, status, is_blocked, deleted_at')
      .or(`phone_number.eq.${normalizedPhone},phone_number.eq.${phoneWithoutPlus},phone_number.eq.+${phoneWithoutPlus}`)
      .limit(1)
      .maybeSingle();

    if (userError || !user) {
      // 安全起见：不区分"用户不存在"和"密码错误"
      return new Response(JSON.stringify({ error: { message: '手机号或密码错误' } }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // 2. 检查用户状态（封禁/删除检查）
    // ============================================================
    if (user.is_blocked === true) {
      return new Response(JSON.stringify({ error: { message: '您的账户已被封禁，请联系客服' } }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (user.deleted_at) {
      return new Response(JSON.stringify({ error: { message: '该账户已被注销' } }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // 3. 验证密码
    // ============================================================
    if (!user.password_hash) {
      // 用户可能是从 Telegram 迁移过来的，尚未设置密码
      return new Response(JSON.stringify({
        error: {
          message: '该账户尚未设置密码，请使用"忘记密码"功能设置新密码',
          code: 'PASSWORD_NOT_SET'
        }
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hashedPassword = await hashPassword(password);
    if (user.password_hash !== hashedPassword) {
      return new Response(JSON.stringify({ error: { message: '手机号或密码错误' } }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // 4. 创建会话
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
      throw new Error('创建会话失败: ' + sessionError?.message);
    }

    // ============================================================
    // 5. 获取钱包信息
    // ============================================================
    const { data: wallets } = await supabase
      .from('wallets')
      .select('id, type, currency, balance')
      .eq('user_id', user.id);

    // ============================================================
    // 6. 返回结果 (保持与 auth-telegram 兼容的结构)
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
      },
      wallets: wallets || [],
      session: {
        token: session.session_token,
        expires_at: session.expires_at
      },
      is_new_user: false
    };

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({ error: { message: error.message } }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
