import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const url = new URL(req.url)
    const configType = url.searchParams.get('type') || 'DEPOSIT'

    // 获取支付配置
    const { data: configs, error } = await supabaseClient
      .from('payment_config')
      .select('*')
      .eq('config_type', configType)
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('获取支付配置失败:', error)
      // 如果表不存在或没有数据，返回空数组而不是错误
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          message: '暂无支付配置'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: configs,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('获取支付配置错误:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
