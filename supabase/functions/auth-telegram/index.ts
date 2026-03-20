/**
 * [已废弃] Telegram 认证 Edge Function
 * 
 * 此函数已在 WhatsApp + PWA 迁移中废弃。
 * 所有认证请求应使用 auth-login 或 auth-register。
 * 
 * 保留此文件以防止 Supabase 部署时报错（函数目录存在但无入口）。
 * 如果仍有旧客户端调用此函数，将返回明确的迁移提示。
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.warn('[auth-telegram] DEPRECATED: This endpoint has been replaced by auth-login and auth-register');

  return new Response(
    JSON.stringify({
      error: {
        code: 'AUTH_DEPRECATED',
        message: 'Telegram 认证已停用。请使用手机号登录 (auth-login) 或注册 (auth-register)。',
      },
    }),
    {
      status: 410, // 410 Gone - 表示资源已永久移除
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
