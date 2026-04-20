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
 * v2 升级：返回 sections 结构（按 story_group 分组）
 *
 * 返回专题详情：
 * - topic: 专题主信息（标题、副标题、导语、正文块、封面图等）
 * - sections: 按 story_group 分组的段落+商品数组
 * - products: 扁平商品列表（向后兼容）
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

    // 优先调用 v2 RPC（支持 sections 分组）
    let data: any = null;
    let rpcError: any = null;

    try {
      const { data: v2Data, error: v2Error } = await supabase.rpc('rpc_get_topic_detail_v2', {
        p_slug: slug,
        p_lang: lang,
      });

      if (!v2Error && v2Data) {
        data = v2Data;
      } else {
        rpcError = v2Error;
      }
    } catch (e) {
      console.warn('rpc_get_topic_detail_v2 not available, falling back to v1:', e);
    }

    // 回退到 v1 RPC
    if (!data) {
      const { data: v1Data, error: v1Error } = await supabase.rpc('rpc_get_topic_detail', {
        p_slug: slug,
        p_lang: lang,
      });

      if (v1Error) {
        console.error('rpc_get_topic_detail error:', v1Error);
        return createResponse(
          { success: false, error: v1Error.message },
          500
        );
      }

      data = v1Data;
    }

    // RPC 内部已处理 TOPIC_NOT_FOUND
    if (data && data.success === false) {
      return createResponse(
        { success: false, error: data.error || 'TOPIC_NOT_FOUND' },
        404
      );
    }

    // 构建扁平 products 列表（向后兼容）
    const sections = data?.sections || [];
    let flatProducts = data?.products || [];

    // 如果有 sections 但没有 flatProducts，从 sections 中提取
    if (sections.length > 0 && flatProducts.length === 0) {
      flatProducts = sections.flatMap((s: any) => s.products || []);
    }

    return createResponse({
      success: true,
      data: {
        topic: data?.topic || null,
        sections: sections,
        products: flatProducts,
      },
      meta: {
        slug,
        lang,
        version: 'v2',
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
