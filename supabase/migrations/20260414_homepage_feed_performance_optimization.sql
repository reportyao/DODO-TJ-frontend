-- ============================================================================
-- DODO 首页 Feed 性能优化 · 字段瘦身 + 缓存策略 + 索引补充
-- 日期: 2026-04-14
-- 
-- 优化目标：
--   1. rpc_get_home_feed 返回体瘦身：移除首屏不需要的字段，减少 JSON 序列化开销
--   2. Banner 数据合并到 feed RPC，消除前端独立请求
--   3. 补充 lotteries 表的首页查询索引
--   4. 补充 banners 表的首页查询索引
-- ============================================================================

-- ============================================================================
-- 1. 补充首页查询索引
-- ============================================================================

-- lotteries: 首页商品列表查询（status = 'ACTIVE' + sort_order + created_at）
CREATE INDEX IF NOT EXISTS idx_lotteries_active_sort_created
  ON public.lotteries (sort_order ASC, created_at DESC)
  WHERE status = 'ACTIVE';

-- banners: 首页轮播图查询（is_active = true + sort_order）
CREATE INDEX IF NOT EXISTS idx_banners_active_sort
  ON public.banners (sort_order ASC)
  WHERE is_active = true;

-- topic_placements: 首页专题投放查询
CREATE INDEX IF NOT EXISTS idx_topic_placements_active_position
  ON public.topic_placements (feed_position ASC, sort_order ASC)
  WHERE is_active = true;

-- homepage_categories: 首页分类查询
CREATE INDEX IF NOT EXISTS idx_homepage_categories_active_sort
  ON public.homepage_categories (sort_order ASC)
  WHERE is_active = true;

-- ============================================================================
-- 2. 优化 rpc_get_home_feed：字段瘦身 + Banner 多语言图片合并
--
-- 变更清单：
--   [Banner] 新增 image_url_zh, image_url_ru, image_url_tg, link_type
--            → 前端 BannerCarousel 不再需要独立查询 banners 表
--   [Category] 移除 icon_key, color_token（前端 CategoryGrid 通过 code 映射图标）
--   [Product] 移除 description_i18n（首页卡片不显示描述）
--             移除 image_urls（首页卡片只用 image_url 单图）
--             移除 full_purchase_enabled, full_purchase_price（详情页才需要）
--             移除 period（首页卡片不显示期号）
--             移除 draw_time, end_time（首页卡片不显示倒计时）
--   [Placement] 无变更（字段已精简）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_home_feed(
    p_lang text DEFAULT 'zh',
    p_limit int DEFAULT 100
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_banners json;
    v_categories json;
    v_products json;
    v_placements json;
    v_now timestamptz := now();
BEGIN
    -- 1. 获取 Banner（新增多语言图片字段 + link_type，消除前端独立请求）
    SELECT COALESCE(json_agg(b ORDER BY b.sort_order ASC), '[]'::json)
    INTO v_banners
    FROM (
        SELECT
            id,
            title,
            image_url,
            image_url_zh,
            image_url_ru,
            image_url_tg,
            link_url,
            link_type,
            sort_order
        FROM banners
        WHERE is_active = true
          AND (start_time IS NULL OR start_time <= v_now)
          AND (end_time IS NULL OR end_time >= v_now)
    ) b;

    -- 2. 获取一级分类（移除 icon_key, color_token，前端通过 code 映射）
    SELECT COALESCE(json_agg(c ORDER BY c.sort_order ASC), '[]'::json)
    INTO v_categories
    FROM (
        SELECT id, code, name_i18n, sort_order
        FROM homepage_categories
        WHERE is_active = true
        ORDER BY sort_order ASC
    ) c;

    -- 3. 获取活跃商品（字段瘦身：移除首屏不需要的字段）
    SELECT COALESCE(json_agg(p), '[]'::json)
    INTO v_products
    FROM (
        SELECT
            'product' AS type,
            l.id AS item_id,
            json_build_object(
                'lottery_id', l.id,
                'inventory_product_id', l.inventory_product_id,
                'title_i18n', COALESCE(l.title_i18n, '{}'::jsonb),
                'image_url', l.image_url,
                'original_price', l.original_price,
                'ticket_price', l.ticket_price,
                'total_tickets', l.total_tickets,
                'sold_tickets', l.sold_tickets,
                'price_comparisons', l.price_comparisons,
                'currency', COALESCE(l.currency, 'TJS'),
                'status', l.status
            ) AS data
        FROM lotteries l
        WHERE l.status = 'ACTIVE'
        ORDER BY l.sort_order ASC, l.created_at DESC
        LIMIT p_limit
    ) p;

    -- 4. 获取当前有效的专题投放（无变更）
    SELECT COALESCE(json_agg(tp), '[]'::json)
    INTO v_placements
    FROM (
        SELECT
            'topic' AS type,
            tpl.id AS item_id,
            json_build_object(
                'topic_id', ht.id,
                'placement_id', tpl.id,
                'slug', ht.slug,
                'title_i18n', COALESCE(tpl.title_i18n, ht.title_i18n),
                'subtitle_i18n', COALESCE(tpl.subtitle_i18n, ht.subtitle_i18n),
                'cover_image_default', COALESCE(tpl.cover_image_default, ht.cover_image_default),
                'cover_image_zh', COALESCE(tpl.cover_image_zh, ht.cover_image_zh),
                'cover_image_ru', COALESCE(tpl.cover_image_ru, ht.cover_image_ru),
                'cover_image_tg', COALESCE(tpl.cover_image_tg, ht.cover_image_tg),
                'cover_image_url', ht.cover_image_url,
                'theme_color', ht.theme_color,
                'card_style', COALESCE(ht.card_style, 'default'),
                'card_variant_name', tpl.card_variant_name,
                'feed_position', tpl.feed_position
            ) AS data
        FROM topic_placements tpl
        JOIN homepage_topics ht ON ht.id = tpl.topic_id
        WHERE tpl.is_active = true
          AND ht.status = 'published'
          AND ht.is_active = true
          AND (tpl.start_time IS NULL OR tpl.start_time <= v_now)
          AND (tpl.end_time IS NULL OR tpl.end_time >= v_now)
          AND (ht.start_time IS NULL OR ht.start_time <= v_now)
          AND (ht.end_time IS NULL OR ht.end_time >= v_now)
        ORDER BY tpl.feed_position ASC, tpl.sort_order ASC
    ) tp;

    -- 5. 组装最终结果
    RETURN json_build_object(
        'banners', v_banners,
        'categories', v_categories,
        'products', v_products,
        'placements', v_placements
    );
END;
$$;

-- 重新授权（函数签名未变，但 CREATE OR REPLACE 后需确保权限）
GRANT EXECUTE ON FUNCTION public.rpc_get_home_feed(text, int)
    TO anon, authenticated, service_role;
