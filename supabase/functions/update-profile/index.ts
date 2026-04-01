import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * update-profile Edge Function
 * 
 * 处理用户个人资料修改：
 * 1. 修改昵称（first_name）
 * 2. 修改头像（avatar_url）
 * 3. 修改手机号（phone_number）—— 需要输入两次确认，不需要验证码
 * 4. 修改密码（password）—— 需要验证旧密码，输入两次新密码
 * 
 * 认证方式：通过 custom session token（Authorization header）
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const APP_SALT = Deno.env.get('PASSWORD_SALT') || 'tezbarakat_default_salt_2026';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 密码哈希函数 (HMAC-SHA256 + 应用盐) - 与 auth-register/auth-login/auth-reset-password 保持一致
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

// 标准化手机号：与 auth-register/auth-login 保持一致
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

// 从 Authorization header 中提取 session token 并验证用户身份
async function authenticateUser(req: Request, supabase: any, bodyToken?: string): Promise<{ userId: string } | null> {
  // 优先从 body 中读取 session_token（兼容前端通过 body 传递的方式）
  // 其次从 Authorization header 中读取（兼容直接设置 header 的方式）
  let token = bodyToken;
  if (!token) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const candidate = authHeader.replace('Bearer ', '');
      // 过滤掉 anon key（anon key 是 JWT，以 eyJ 开头且很长）
      // 自定义 session token 格式不同，不是 JWT
      if (candidate && !candidate.startsWith('eyJ')) {
        token = candidate;
      }
    }
  }

  if (!token) {
    return null;
  }
  
  // 查找活跃的 session
  const { data: session, error } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('session_token', token)
    .eq('is_active', true)
    .single();

  if (error || !session) {
    return null;
  }

  // 检查是否过期
  if (new Date(session.expires_at) < new Date()) {
    return null;
  }

  return { userId: session.user_id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 先读取 body，以便从中提取 session_token
    const body = await req.json();
    const { action, session_token: bodySessionToken } = body;

    // 1. 验证用户身份（优先使用 body 中的 session_token，其次使用 Authorization header）
    const auth = await authenticateUser(req, supabase, bodySessionToken);
    if (!auth) {
      return new Response(
        JSON.stringify({ error: { message: '未授权，请重新登录', code: 'ERR_UNAUTHORIZED' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // 动作分发
    // ============================================================

    if (action === 'update_basic') {
      // ============================================================
      // 修改基本信息（昵称 + 头像）
      // ============================================================
      const { first_name, avatar_url } = body;

      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (first_name !== undefined) {
        if (typeof first_name === 'string' && first_name.trim().length > 0) {
          updateData.first_name = first_name.trim();
        } else if (first_name === '' || first_name === null) {
          updateData.first_name = null;
        }
      }

      if (avatar_url !== undefined) {
        updateData.avatar_url = avatar_url;
      }

      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', auth.userId)
        .select('id, first_name, last_name, avatar_url, phone_number, referral_code, is_verified, kyc_level, email, level')
        .single();

      if (updateError) {
        throw new Error('更新失败: ' + updateError.message);
      }

      return new Response(
        JSON.stringify({ success: true, data: { user: updatedUser } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'update_phone') {
      // ============================================================
      // 修改手机号（需要输入两次确认）
      // ============================================================
      const { new_phone, confirm_phone } = body;

      if (!new_phone || !confirm_phone) {
        return new Response(
          JSON.stringify({ error: { message: '请输入新手机号', code: 'ERR_NEW_PHONE_REQUIRED' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 标准化手机号
      const normalizedNewPhone = normalizePhone(new_phone);
      const normalizedConfirmPhone = normalizePhone(confirm_phone);

      // 验证两次输入是否一致
      if (normalizedNewPhone !== normalizedConfirmPhone) {
        return new Response(
          JSON.stringify({ error: { message: '两次输入的手机号不一致', code: 'ERR_PHONE_MISMATCH' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 验证手机号格式（塔吉克斯坦手机号：+992 + 9位数字）
      if (!/^\+992\d{9}$/.test(normalizedNewPhone)) {
        return new Response(
          JSON.stringify({ error: { message: '手机号格式不正确，请输入塔吉克斯坦手机号', code: 'ERR_PHONE_FORMAT_INVALID' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 检查新手机号是否已被其他用户使用
      const phoneWithoutPlus = normalizedNewPhone.replace(/^\+/, '');
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .or(`phone_number.eq.${normalizedNewPhone},phone_number.eq.${phoneWithoutPlus},phone_number.eq.+${phoneWithoutPlus}`)
        .neq('id', auth.userId)
        .limit(1)
        .maybeSingle();

      if (existingUser) {
        return new Response(
          JSON.stringify({ error: { message: '该手机号已被其他账户使用', code: 'ERR_PHONE_ALREADY_USED' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 更新手机号
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          phone_number: normalizedNewPhone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', auth.userId)
        .select('id, first_name, last_name, avatar_url, phone_number, referral_code, is_verified, kyc_level, email, level')
        .single();

      if (updateError) {
        throw new Error('手机号更新失败: ' + updateError.message);
      }

      return new Response(
        JSON.stringify({ success: true, data: { user: updatedUser } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'update_password') {
      // ============================================================
      // 修改密码（需要验证旧密码，输入两次新密码）
      // ============================================================
      const { old_password, new_password, confirm_password } = body;

      if (!old_password) {
        return new Response(
          JSON.stringify({ error: { message: '请输入当前密码', code: 'ERR_CURRENT_PASSWORD_REQUIRED' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!new_password || !confirm_password) {
        return new Response(
          JSON.stringify({ error: { message: '请输入新密码', code: 'ERR_NEW_PASSWORD_REQUIRED' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (new_password !== confirm_password) {
        return new Response(
          JSON.stringify({ error: { message: '两次输入的新密码不一致', code: 'ERR_PASSWORD_MISMATCH' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (new_password.length < 6) {
        return new Response(
          JSON.stringify({ error: { message: '新密码长度至少6位', code: 'ERR_PASSWORD_TOO_SHORT' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 获取当前用户的密码哈希
      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', auth.userId)
        .single();

      if (fetchError || !currentUser) {
        throw new Error('获取用户信息失败');
      }

      // 验证旧密码
      const oldPasswordHash = await hashPassword(old_password);
      if (oldPasswordHash !== currentUser.password_hash) {
        return new Response(
          JSON.stringify({ error: { message: '当前密码不正确', code: 'ERR_WRONG_PASSWORD' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 更新密码
      const newPasswordHash = await hashPassword(new_password);
      const { error: updateError } = await supabase
        .from('users')
        .update({
          password_hash: newPasswordHash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', auth.userId);

      if (updateError) {
        throw new Error('密码更新失败: ' + updateError.message);
      }

      return new Response(
        JSON.stringify({ success: true, message: '密码修改成功' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: { message: '不支持的操作类型', code: 'ERR_UNSUPPORTED_ACTION' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('[update-profile] Error:', error);
    return new Response(
      JSON.stringify({ error: { message: error.message || '服务器内部错误', code: 'ERR_SERVER_ERROR' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
