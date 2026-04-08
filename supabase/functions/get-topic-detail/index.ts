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
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// 统一响应构造
function createResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * GET /get-topic-detail?slug=winter-kitchen-essentials&lang=zh
 *
 * 返回专题详情：
 * - topic: 专题主信息（标题、副标题、导语、正文块、封面图等）
 * - products: 专题内商品列表（含活跃 lottery 信息、场景说明、标签文案）
 *
 * 前端根据 slug 路由到专题详情页，调用此接口获取完整数据。
 */
Deno.serve(async (req: Request) => {
  // 处理 CORS 预检
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    const lang = url.searchParams.get('lang') || 'zh';

    // 参数校验
    if (!slug || slug.trim() === '') {
      return createResponse(
        { success: false, error: 'slug parameter is required' },
        400
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 调用 RPC 获取专题详情
    const { data, error } = await supabase.rpc('rpc_get_topic_detail', {
      p_slug: slug,
      p_lang: lang,
    });

    if (error) {
      console.error('rpc_get_topic_detail error:', error);
      return createResponse(
        { success: false, error: error.message },
        500
      );
    }

    // RPC 内部已处理 TOPIC_NOT_FOUND
    if (data && data.success === false) {
      return createResponse(
        { success: false, error: data.error || 'TOPIC_NOT_FOUND' },
        404
      );
    }

    return createResponse({
      success: true,
      data: {
        topic: data?.topic || null,
        products: data?.products || [],
      },
      meta: {
        slug,
        lang,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('get-topic-detail error:', error);
    return createResponse(
      {
        success: false,
        error: errMsg || 'Unknown error',
      },
      500
    );
  }
});
