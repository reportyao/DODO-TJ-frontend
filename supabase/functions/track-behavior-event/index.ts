import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// 使用环境变量获取 Supabase 配置
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

// CORS headers（与项目其他 Edge Function 保持一致）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 统一响应构造
function createResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * 允许的事件名白名单
 * 防止客户端伪造任意事件名写入数据库
 */
const ALLOWED_EVENT_NAMES = new Set([
  'home_view',
  'banner_click',
  'category_click',
  'topic_card_expose',
  'topic_card_click',
  'product_card_expose',
  'product_card_click',
  'topic_detail_view',
  'topic_product_click',
  'product_detail_view',
  'order_create',
  'order_pay_success',
  'order_complete',
]);

/**
 * POST /track-behavior-event
 *
 * 接收用户行为事件上报。
 *
 * 支持两种模式：
 * 1. 单条上报: body 为单个事件对象
 * 2. 批量上报: body 为 { events: [...] } 数组
 *
 * 事件对象结构:
 * {
 *   session_id: string (必填)
 *   user_id?: string
 *   event_name: string (必填，须在白名单内)
 *   page_name: string (必填)
 *   entity_type?: string
 *   entity_id?: string
 *   position?: string
 *   source_page?: string
 *   source_topic_id?: string
 *   source_placement_id?: string
 *   source_category_id?: string
 *   lottery_id?: string
 *   inventory_product_id?: string
 *   order_id?: string
 *   trace_id?: string
 *   metadata?: object
 *   device_info?: object
 * }
 */
Deno.serve(async (req: Request) => {
  // 处理 CORS 预检
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 仅允许 POST
  if (req.method !== 'POST') {
    return createResponse(
      { success: false, error: 'Method not allowed' },
      405
    );
  }

  try {
    const body = await req.json();
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 判断是批量还是单条
    const events: unknown[] = Array.isArray(body.events) ? body.events : [body];

    // 限制单次批量上报数量
    if (events.length > 50) {
      return createResponse(
        { success: false, error: 'Too many events in a single batch (max 50)' },
        400
      );
    }

    const results: { event_id?: string; error?: string }[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const event of events) {
      const e = event as Record<string, unknown>;

      // 基本校验
      if (!e.session_id || typeof e.session_id !== 'string') {
        results.push({ error: 'session_id is required' });
        errorCount++;
        continue;
      }

      if (!e.event_name || typeof e.event_name !== 'string') {
        results.push({ error: 'event_name is required' });
        errorCount++;
        continue;
      }

      // 白名单校验
      if (!ALLOWED_EVENT_NAMES.has(e.event_name as string)) {
        results.push({ error: `Unknown event_name: ${e.event_name}` });
        errorCount++;
        continue;
      }

      // 调用 RPC 写入
      const { data, error } = await supabase.rpc('rpc_track_behavior_event', {
        p_session_id: e.session_id as string,
        p_user_id: (e.user_id as string) || null,
        p_event_name: e.event_name as string,
        p_page_name: (e.page_name as string) || '',
        p_entity_type: (e.entity_type as string) || null,
        p_entity_id: (e.entity_id as string) || null,
        p_position: (e.position as string) || null,
        p_source_page: (e.source_page as string) || null,
        p_source_topic_id: (e.source_topic_id as string) || null,
        p_source_placement_id: (e.source_placement_id as string) || null,
        p_source_category_id: (e.source_category_id as string) || null,
        p_lottery_id: (e.lottery_id as string) || null,
        p_inventory_product_id: (e.inventory_product_id as string) || null,
        p_order_id: (e.order_id as string) || null,
        p_trace_id: (e.trace_id as string) || null,
        p_metadata: (e.metadata as Record<string, unknown>) || {},
        p_device_info: (e.device_info as Record<string, unknown>) || null,
      });

      if (error) {
        console.error('track event error:', error);
        results.push({ error: error.message });
        errorCount++;
      } else {
        results.push({ event_id: data?.event_id });
        successCount++;
      }
    }

    return createResponse({
      success: errorCount === 0,
      total: events.length,
      success_count: successCount,
      error_count: errorCount,
      results: events.length > 1 ? results : undefined,
      event_id: events.length === 1 ? results[0]?.event_id : undefined,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('track-behavior-event error:', error);
    return createResponse(
      {
        success: false,
        error: errMsg || 'Unknown error',
      },
      500
    );
  }
});
