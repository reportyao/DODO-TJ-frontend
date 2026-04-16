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

    // 支持 query string 和 request body 两种传参方式
    const url = new URL(req.url)
    let configType = url.searchParams.get('type') || 'DEPOSIT'
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        if (body?.type) {configType = body.type}
      } catch (_) { /* ignore */ }
    }

    // 获取所有启用的支付配置（兼容 is_enabled 和 is_active 两个字段）
    const { data: configs, error } = await supabaseClient
      .from('payment_config')
      .select('*')
      .eq('config_type', configType)
      .or('is_enabled.eq.true,is_active.eq.true')
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('获取支付配置失败:', error)
      return new Response(
        JSON.stringify({ success: true, data: [], message: '暂无支付配置' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 标准化数据：将旧格式（config 字段）映射为新格式（config_data 字段）
    const normalizedConfigs = (configs || []).map((item: any) => {
      // 如果 config_data 已存在且有效，直接使用
      if (item.config_data && typeof item.config_data === 'object' && item.config_data.method) {
        return item
      }
      // 兼容旧格式：从 config 字段回填 config_data
      const oldConfig = item.config || {}
      const configData = {
        method: item.type || oldConfig.method || 'BANK_TRANSFER',
        enabled: item.is_enabled ?? item.is_active ?? true,
        account_number: oldConfig.account_number || '',
        account_name: oldConfig.account_name || '',
        bank_name: oldConfig.bank_name || '',
        phone_number: oldConfig.phone_number || '',
        qr_code_url: oldConfig.qr_code_url || '',
        instructions: item.instructions || oldConfig.instructions || { zh: '', ru: '', tg: '' },
        min_amount: item.min_amount || oldConfig.min_amount || 0,
        max_amount: item.max_amount || oldConfig.max_amount || 999999,
        processing_time: oldConfig.processing_time || '30',
        require_payer_name: item.require_payer_name || false,
        require_payer_account: item.require_payer_account || false,
        require_payer_phone: item.require_payer_phone || false,
      }
      return {
        ...item,
        config_data: configData,
        config_key: item.config_key || item.name || item.id,
      }
    })

    return new Response(
      JSON.stringify({ success: true, data: normalizedConfigs }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
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
