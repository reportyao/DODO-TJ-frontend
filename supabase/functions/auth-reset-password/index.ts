import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 密码哈希函数 (SHA-256) - 与 auth-register/auth-login 保持一致
async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    const { action } = body;

    // ============================================================
    // 动作分发：request（请求重置）/ verify（验证Token并重置密码）
    // ============================================================

    if (action === 'verify' || action === 'reset') {
      // ============================================================
      // 验证 Token 并重置密码
      // ============================================================
      const { token, new_password } = body;

      if (!token || !new_password) {
        return new Response(JSON.stringify({ error: { message: '重置Token和新密码是必填项' } }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (new_password.length < 6) {
        return new Response(JSON.stringify({ error: { message: '密码长度至少6位' } }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 查找有效的重置 Token（存储在 user_sessions 中，device_info = 'password_reset'）
      const { data: resetSession, error: sessionError } = await supabase
        .from('user_sessions')
        .select('id, user_id, expires_at')
        .eq('session_token', token)
        .eq('device_info', 'password_reset')
        .eq('is_active', true)
        .single();

      if (sessionError || !resetSession) {
        return new Response(JSON.stringify({ error: { message: '重置链接无效或已过期' } }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 检查是否过期
      if (new Date(resetSession.expires_at) < new Date()) {
        // 标记为已失效
        await supabase
          .from('user_sessions')
          .update({ is_active: false })
          .eq('id', resetSession.id);

        return new Response(JSON.stringify({ error: { message: '重置链接已过期，请重新申请' } }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 更新密码
      const hashedPassword = await hashPassword(new_password);
      const { error: updateError } = await supabase
        .from('users')
        .update({
          password_hash: hashedPassword,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resetSession.user_id);

      if (updateError) {
        throw new Error('密码更新失败: ' + updateError.message);
      }

      // 使 Token 失效（一次性使用）
      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('id', resetSession.id);

      // 使该用户所有其他活跃会话失效（安全措施）
      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('user_id', resetSession.user_id)
        .eq('is_active', true)
        .neq('device_info', 'password_reset');

      return new Response(JSON.stringify({
        success: true,
        message: '密码重置成功，请使用新密码登录'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else {
      // ============================================================
      // 请求密码重置（默认动作）
      // ============================================================
      const { phone_number } = body;

      if (!phone_number) {
        return new Response(JSON.stringify({ error: { message: '手机号是必填项' } }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const normalizedPhone = normalizePhone(phone_number);
      const phoneWithoutPlus = normalizedPhone.replace(/^\+/, '');

      // 查找用户（尝试多种格式匹配，与 auth-login 保持一致）
      const { data: user } = await supabase
        .from('users')
        .select('id, phone_number')
        .or(`phone_number.eq.${normalizedPhone},phone_number.eq.${phoneWithoutPlus},phone_number.eq.+${phoneWithoutPlus}`)
        .limit(1)
        .maybeSingle();

      if (!user) {
        // 安全起见，即使用户不存在也返回成功，防止手机号枚举
        return new Response(JSON.stringify({
          success: true,
          message: '如果该手机号已注册，您将收到重置链接'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 检查是否有未过期的重置请求（防止频繁请求）
      const { data: existingReset } = await supabase
        .from('user_sessions')
        .select('id, created_at')
        .eq('user_id', user.id)
        .eq('device_info', 'password_reset')
        .eq('is_active', true)
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingReset) {
        const createdAt = new Date(existingReset.created_at);
        const cooldown = 2 * 60 * 1000; // 2分钟冷却期
        if (Date.now() - createdAt.getTime() < cooldown) {
          return new Response(JSON.stringify({
            error: { message: '请求过于频繁，请2分钟后再试' }
          }), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // 使旧的重置Token失效
        await supabase
          .from('user_sessions')
          .update({ is_active: false })
          .eq('id', existingReset.id);
      }

      // 生成重置 Token 并持久化到 user_sessions 表
      const resetToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(); // 1小时有效

      const { error: sessionInsertError } = await supabase
        .from('user_sessions')
        .insert({
          user_id: user.id,
          session_token: resetToken,
          device_info: 'password_reset',
          is_active: true,
          expires_at: expiresAt,
        });

      if (sessionInsertError) {
        throw new Error('创建重置Token失败: ' + sessionInsertError.message);
      }

      // 发送通知到 WhatsApp 队列
      const resetLink = `https://dodo.tj/reset-password?token=${resetToken}`;

      const { error: notifyError } = await supabase
        .from('notification_queue')
        .insert({
          user_id: user.id,
          phone_number: user.phone_number,
          type: 'password_reset',
          notification_type: 'password_reset',
          payload: { reset_link: resetLink },
          title: '密码重置',
          message: `您的密码重置链接: ${resetLink}`,
          status: 'pending',
          channel: 'whatsapp',
          priority: 1,
          scheduled_at: new Date().toISOString(),
        });

      if (notifyError) {
        console.error('通知队列插入失败:', notifyError);
        // 不阻断流程，Token已经持久化，用户可以通过其他方式获取
      }

      return new Response(JSON.stringify({
        success: true,
        message: '如果该手机号已注册，您将收到重置链接'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('Reset password error:', error);
    return new Response(JSON.stringify({ error: { message: error.message } }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
