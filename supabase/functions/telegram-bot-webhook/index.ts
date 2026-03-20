/**
 * telegram-bot-webhook - DEPRECATED / 已废弃
 *
 * 此 Edge Function 已废弃，不再部署或调用。
 * 项目已从 Telegram Bot 迁移至 WhatsApp Business API + PWA。
 * 通知逻辑已迁移至 telegram-notification-sender（内部已改为 WhatsApp 实现）。
 *
 * Deprecated since: 2026-04-01
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.warn('[DEPRECATED] telegram-bot-webhook called. This function is no longer active.');

  return new Response(
    JSON.stringify({
      success: false,
      error: 'DEPRECATED',
      message: 'This Telegram Bot webhook is no longer active. Project migrated to WhatsApp Business API + PWA.',
      deprecated_since: '2026-04-01',
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
