import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { count, error } = await supabase
      .from('lotteries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ACTIVE');

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: '当前活动生命周期已切换为共享库存售罄驱动，已跳过按时间过期清理。',
        checked_active_lotteries: count || 0,
        expired_count: 0,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[CleanupExpiredLotteries] Error:', errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    );
  }
});
