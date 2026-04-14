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
function createResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
  });
}

/**
 * GET /get-home-feed?lang=zh&limit=100
 *
 * 返回首页 feed 数据：
 * - banners: 当前有效的 Banner 列表（含多语言图片，消除前端独立请求）
 * - categories: 一级分类列表（金刚区，已精简字段）
 * - products: 活跃商品列表（基于 lotteries，已精简字段）
 * - placements: 当前有效的专题投放卡列表
 *
 * 前端负责按 feed_position 将 placements 插入 products 流中。
 *
 * [v2 性能优化]
 * - 添加 Cache-Control 响应头，CDN 缓存 30 秒，客户端缓存 10 秒
 * - RPC 返回体已瘦身（移除首屏不需要的字段）
 * - Banner 数据合并到此接口，前端不再独立查询 banners 表
 */
Deno.serve(async (req: Request) => {
  // 处理 CORS 预检
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const lang = url.searchParams.get('lang') || 'zh';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 调用 RPC 获取首页 feed 数据
    const { data, error } = await supabase.rpc('rpc_get_home_feed', {
      p_lang: lang,
      p_limit: limit,
    });

    if (error) {
      console.error('rpc_get_home_feed error:', error);
      return createResponse(
        { success: false, error: error.message },
        500
      );
    }

    // [v2] 添加缓存头：CDN 缓存 30s，客户端缓存 10s，允许 stale-while-revalidate
    // 首页 feed 数据变化频率低（商品上下架、Banner 更新），30s 缓存可大幅减少 RPC 调用
    return createResponse(
      {
        success: true,
        data: data,
        meta: {
          lang,
          limit,
          timestamp: new Date().toISOString(),
        },
      },
      200,
      {
        'Cache-Control': 'public, s-maxage=30, max-age=10, stale-while-revalidate=60',
      }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('get-home-feed error:', error);
    return createResponse(
      {
        success: false,
        error: errMsg || 'Unknown error',
      },
      500
    );
  }
});
