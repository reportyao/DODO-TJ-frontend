-- ============================================================================
-- 修复首页 Feed 过滤过期商品
-- 日期: 2026-04-22
--
-- 问题：rpc_get_home_feed 仅按 status = 'ACTIVE' 过滤，但未检查 end_time，
--       导致已过期但状态尚未被 cleanup-expired-lotteries 更新的商品仍然出现在首页。
--
-- 修复：
--   1. 增加 end_time 过期过滤条件
--   2. 返回 end_time 字段，供前端 isLotteryPurchasable 做二次校验
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
    -- 1. 获取 Banner
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

    -- 2. 获取一级分类
    SELECT COALESCE(json_agg(c ORDER BY c.sort_order ASC), '[]'::json)
    INTO v_categories
    FROM (
        SELECT id, code, name_i18n, sort_order
        FROM homepage_categories
        WHERE is_active = true
        ORDER BY sort_order ASC
    ) c;

    -- 3. 获取活跃商品（增加 end_time 过期过滤 + 返回 end_time 字段）
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
                'status', l.status,
                'end_time', l.end_time
            ) AS data
        FROM lotteries l
        WHERE l.status = 'ACTIVE'
          AND (l.end_time IS NULL OR l.end_time > v_now)
        ORDER BY l.sort_order ASC, l.created_at DESC
        LIMIT p_limit
    ) p;

    -- 4. 获取当前有效的专题投放
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

-- 重新授权
GRANT EXECUTE ON FUNCTION public.rpc_get_home_feed(text, int)
    TO anon, authenticated, service_role;
