/**
 * ============================================================
 * auth-login Edge Function（用户登录）
 * ============================================================
 * 
 * 功能：用户通过手机号+密码登录，创建会话
 * 安全：密码使用 HMAC-SHA256 + 应用盐哈希
 * 国际化：所有错误返回 error_code，前端通过 i18n 翻译
 * ============================================================
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 标准化错误响应 */
function errorResponse(errorCode: string, fallbackMessage: string, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error: fallbackMessage, error_code: errorCode }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// 密码哈希函数 (HMAC-SHA256 + 应用盐)
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

// 标准化手机号
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
      return errorResponse('ERR_PHONE_PASSWORD_REQUIRED', '手机号和密码是必填项');
    }

    // 1. 标准化手机号并查找用户
    const normalizedPhone = normalizePhone(phone_number);
    const phoneWithoutPlus = normalizedPhone.replace(/^\+/, '');

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, phone_number, password_hash, first_name, last_name, referral_code, status, is_blocked, deleted_at, avatar_url, language_code, preferred_language')
      .or(`phone_number.eq.${normalizedPhone},phone_number.eq.${phoneWithoutPlus},phone_number.eq.+${phoneWithoutPlus}`)
      .limit(1)
      .maybeSingle();

    if (userError || !user) {
      return errorResponse('ERR_WRONG_CREDENTIALS', '手机号或密码错误', 401);
    }

    // 2. 检查用户状态
    if (user.is_blocked === true) {
      return errorResponse('ERR_USER_BLOCKED', '您的账户已被封禁，请联系客服', 403);
    }

    if (user.deleted_at) {
      return errorResponse('ERR_USER_DELETED', '该账户已被注销', 403);
    }

    // 3. 验证密码
    if (!user.password_hash) {
      return errorResponse('ERR_PASSWORD_NOT_SET', '该账户尚未设置密码，请使用"忘记密码"功能设置新密码', 401);
    }

    const hashedPassword = await hashPassword(password);
    if (user.password_hash !== hashedPassword) {
      return errorResponse('ERR_WRONG_CREDENTIALS', '手机号或密码错误', 401);
    }

    // 4. 更新最后登录时间
    await supabase
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    // 5. 创建会话
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
      console.error('[auth-login] Session creation failed:', sessionError?.message);
      return errorResponse('ERR_SESSION_CREATE_FAILED', '创建会话失败', 500);
    }

    // 6. 获取钱包信息
    const { data: wallets } = await supabase
      .from('wallets')
      .select('id, type, currency, balance')
      .eq('user_id', user.id);

    // 7. 返回结果
    const result = {
      success: true,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        first_name: user.first_name,
        last_name: user.last_name,
        referral_code: user.referral_code,
        status: user.status,
        avatar_url: user.avatar_url,
        language_code: user.language_code,
        preferred_language: user.preferred_language,
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

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[auth-login] Error:', errMsg);
    return errorResponse('ERR_SERVER_ERROR', errMsg, 500);
  }
});
