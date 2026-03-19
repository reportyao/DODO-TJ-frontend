import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { phone_number } = await req.json();

    if (!phone_number) {
      return new Response(JSON.stringify({ error: { message: '手机号是必填项' } }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. 查找用户
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, phone_number')
      .eq('phone_number', phone_number)
      .single();

    if (userError || !user) {
      // 安全起见，即使用户不存在也返回成功，防止手机号枚举
      return new Response(JSON.stringify({ success: true, message: '如果该手机号已注册，您将收到重置链接' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. 生成重置 Token
    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(); // 1小时有效

    // 3. 存储 Token (假设有 password_reset_tokens 表，如果没有则写入 notification_queue 记录)
    // 这里我们直接写入通知队列，由 whatsapp-notification-sender 处理
    const resetLink = `https://tezbarakat.app/reset-password?token=${resetToken}`;
    
    const { error: insertError } = await supabase
      .from('notification_queue')
      .insert({
        user_id: user.id,
        phone_number: user.phone_number,
        type: 'password_reset',
        notification_type: 'password_reset',
        payload: { reset_link: resetLink, token: resetToken },
        status: 'pending',
        channel: 'whatsapp',
        priority: 1, // 高优先级
        scheduled_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new Error('发送重置链接失败: ' + insertError.message);
    }

    return new Response(JSON.stringify({ success: true, message: '重置链接已通过 WhatsApp 发送' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Reset password error:', error);
    return new Response(JSON.stringify({ error: { message: error.message } }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
