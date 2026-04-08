-- ============================================================================
-- DODO 首页场景化改造 · 阶段 1 · RPC 函数
-- 日期: 2026-04-08
-- 说明: 后台事务RPC + 前台只读查询RPC
-- ============================================================================

-- ============================================================================
-- 1. 保存商品分类标签关系（事务）
--    后台通过 adminRpc 调用，以事务方式重写 product_categories 与 product_tags
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_save_product_taxonomy(
    p_session_token text,
    p_product_id uuid,
    p_category_ids uuid[],
    p_tag_ids uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id uuid;
    v_cat_count int;
    v_tag_count int;
BEGIN
    -- 验证管理员会话
    v_admin_id := verify_admin_session(p_session_token);

    -- 验证商品存在
    IF NOT EXISTS (SELECT 1 FROM inventory_products WHERE id = p_product_id) THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: 商品不存在 %', p_product_id;
    END IF;

    -- 事务内重写分类关系
    DELETE FROM product_categories WHERE product_id = p_product_id;

    IF p_category_ids IS NOT NULL AND array_length(p_category_ids, 1) > 0 THEN
        INSERT INTO product_categories (product_id, category_id)
        SELECT p_product_id, unnest(p_category_ids)
        ON CONFLICT (product_id, category_id) DO NOTHING;
    END IF;

    -- 事务内重写标签关系
    DELETE FROM product_tags WHERE product_id = p_product_id;

    IF p_tag_ids IS NOT NULL AND array_length(p_tag_ids, 1) > 0 THEN
        INSERT INTO product_tags (product_id, tag_id)
        SELECT p_product_id, unnest(p_tag_ids)
        ON CONFLICT (product_id, tag_id) DO NOTHING;
    END IF;

    -- 统计结果
    SELECT count(*) INTO v_cat_count FROM product_categories WHERE product_id = p_product_id;
    SELECT count(*) INTO v_tag_count FROM product_tags WHERE product_id = p_product_id;

    -- 记录审计日志
    INSERT INTO admin_audit_logs (admin_id, action, target_type, details)
    VALUES (
        v_admin_id,
        'save_product_taxonomy',
        'inventory_products',
        jsonb_build_object(
            'product_id', p_product_id,
            'category_ids', to_jsonb(p_category_ids),
            'tag_ids', to_jsonb(p_tag_ids),
            'category_count', v_cat_count,
            'tag_count', v_tag_count
        )
    );

    RETURN json_build_object(
        'success', true,
        'product_id', p_product_id,
        'category_count', v_cat_count,
        'tag_count', v_tag_count
    );
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION public.rpc_admin_save_product_taxonomy(text, uuid, uuid[], uuid[])
    TO anon, authenticated, service_role;

-- ============================================================================
-- 2. 保存专题与商品关系（事务）
--    后台通过 adminRpc 调用，以事务方式重写 topic_products
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_save_topic_products(
    p_session_token text,
    p_topic_id uuid,
    p_items jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id uuid;
    v_item jsonb;
    v_count int := 0;
BEGIN
    -- 验证管理员会话
    v_admin_id := verify_admin_session(p_session_token);

    -- 验证专题存在
    IF NOT EXISTS (SELECT 1 FROM homepage_topics WHERE id = p_topic_id) THEN
        RAISE EXCEPTION 'TOPIC_NOT_FOUND: 专题不存在 %', p_topic_id;
    END IF;

    -- 事务内重写专题商品关系
    DELETE FROM topic_products WHERE topic_id = p_topic_id;

    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            -- 验证商品存在
            IF NOT EXISTS (
                SELECT 1 FROM inventory_products
                WHERE id = (v_item->>'product_id')::uuid
            ) THEN
                RAISE EXCEPTION 'PRODUCT_NOT_FOUND: 商品不存在 %', v_item->>'product_id';
            END IF;

            INSERT INTO topic_products (
                topic_id,
                product_id,
                sort_order,
                note_i18n,
                badge_text_i18n
            ) VALUES (
                p_topic_id,
                (v_item->>'product_id')::uuid,
                COALESCE((v_item->>'sort_order')::int, 0),
                CASE WHEN v_item ? 'note_i18n' THEN v_item->'note_i18n' ELSE NULL END,
                CASE WHEN v_item ? 'badge_text_i18n' THEN v_item->'badge_text_i18n' ELSE NULL END
            )
            ON CONFLICT (topic_id, product_id) DO UPDATE SET
                sort_order = EXCLUDED.sort_order,
                note_i18n = EXCLUDED.note_i18n,
                badge_text_i18n = EXCLUDED.badge_text_i18n;

            v_count := v_count + 1;
        END LOOP;
    END IF;

    -- 记录审计日志
    INSERT INTO admin_audit_logs (admin_id, action, target_type, details)
    VALUES (
        v_admin_id,
        'save_topic_products',
        'homepage_topics',
        jsonb_build_object(
            'topic_id', p_topic_id,
            'product_count', v_count
        )
    );

    RETURN json_build_object(
        'success', true,
        'topic_id', p_topic_id,
        'product_count', v_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_save_topic_products(text, uuid, jsonb)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 3. 后台查询专题推荐商品池
--    支持商品名称模糊搜索、分类多选、标签多选、状态过滤与分页
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_search_topic_products(
    p_session_token text,
    p_keyword text DEFAULT NULL,
    p_category_ids uuid[] DEFAULT NULL,
    p_tag_ids uuid[] DEFAULT NULL,
    p_has_active_lottery boolean DEFAULT NULL,
    p_limit int DEFAULT 20,
    p_offset int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id uuid;
    v_result json;
    v_count bigint;
    v_sql text;
    v_count_sql text;
    v_where text := ' WHERE true';
BEGIN
    -- 验证管理员会话
    v_admin_id := verify_admin_session(p_session_token);

    -- 构建基础查询
    v_sql := '
        SELECT
            ip.id,
            ip.name_i18n,
            ip.description_i18n,
            ip.image_url,
            ip.image_urls,
            ip.original_price,
            ip.status,
            ip.sku,
            ip.created_at,
            -- 已绑定分类
            COALESCE(
                (SELECT json_agg(json_build_object(
                    ''id'', hc.id, ''code'', hc.code, ''name_i18n'', hc.name_i18n
                ))
                FROM product_categories pc2
                JOIN homepage_categories hc ON hc.id = pc2.category_id
                WHERE pc2.product_id = ip.id),
                ''[]''::json
            ) AS categories,
            -- 已绑定标签
            COALESCE(
                (SELECT json_agg(json_build_object(
                    ''id'', ht.id, ''code'', ht.code, ''tag_group'', ht.tag_group, ''name_i18n'', ht.name_i18n
                ))
                FROM product_tags pt2
                JOIN homepage_tags ht ON ht.id = pt2.tag_id
                WHERE pt2.product_id = ip.id),
                ''[]''::json
            ) AS tags,
            -- 当前活跃 lottery
            (SELECT json_build_object(
                ''id'', l.id,
                ''ticket_price'', l.ticket_price,
                ''total_tickets'', l.total_tickets,
                ''sold_tickets'', l.sold_tickets,
                ''status'', l.status
            )
            FROM lotteries l
            WHERE l.inventory_product_id = ip.id::text
              AND l.status = ''ACTIVE''
            ORDER BY l.created_at DESC
            LIMIT 1
            ) AS active_lottery
        FROM inventory_products ip
    ';

    -- 关键词搜索
    IF p_keyword IS NOT NULL AND p_keyword != '' THEN
        v_where := v_where || format(
            ' AND (ip.name_i18n::text ILIKE ''%%%s%%'' OR ip.sku ILIKE ''%%%s%%'' OR ip.id::text ILIKE ''%%%s%%'')',
            p_keyword, p_keyword, p_keyword
        );
    END IF;

    -- 分类筛选
    IF p_category_ids IS NOT NULL AND array_length(p_category_ids, 1) > 0 THEN
        v_where := v_where || format(
            ' AND EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = ip.id AND pc.category_id = ANY(%L::uuid[]))',
            p_category_ids::text
        );
    END IF;

    -- 标签筛选
    IF p_tag_ids IS NOT NULL AND array_length(p_tag_ids, 1) > 0 THEN
        v_where := v_where || format(
            ' AND EXISTS (SELECT 1 FROM product_tags pt WHERE pt.product_id = ip.id AND pt.tag_id = ANY(%L::uuid[]))',
            p_tag_ids::text
        );
    END IF;

    -- 是否有活跃 lottery
    IF p_has_active_lottery = true THEN
        v_where := v_where || ' AND EXISTS (SELECT 1 FROM lotteries l WHERE l.inventory_product_id = ip.id::text AND l.status = ''ACTIVE'')';
    END IF;

    -- 计算总数
    v_count_sql := 'SELECT count(*) FROM inventory_products ip' || v_where;
    EXECUTE v_count_sql INTO v_count;

    -- 查询数据
    v_sql := v_sql || v_where || format(' ORDER BY ip.created_at DESC LIMIT %s OFFSET %s', p_limit, p_offset);
    EXECUTE format('SELECT COALESCE(json_agg(t), ''[]''::json) FROM (%s) t', v_sql) INTO v_result;

    RETURN json_build_object(
        'data', v_result,
        'total', v_count,
        'limit', p_limit,
        'offset', p_offset
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_search_topic_products(text, text, uuid[], uuid[], boolean, int, int)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 4. 前台首页 feed 查询
--    返回 banners + categories + feed_items（商品卡 + 专题卡混排）
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
    v_feed_items json;
    v_now timestamptz := now();
BEGIN
    -- 1. 获取 Banner
    SELECT COALESCE(json_agg(b ORDER BY b.sort_order ASC), '[]'::json)
    INTO v_banners
    FROM (
        SELECT id, title, image_url, link_url, sort_order, start_time, end_time
        FROM banners
        WHERE is_active = true
          AND (start_time IS NULL OR start_time <= v_now)
          AND (end_time IS NULL OR end_time >= v_now)
    ) b;

    -- 2. 获取一级分类
    SELECT COALESCE(json_agg(c ORDER BY c.sort_order ASC), '[]'::json)
    INTO v_categories
    FROM (
        SELECT id, code, name_i18n, icon_key, color_token, sort_order
        FROM homepage_categories
        WHERE is_active = true
        ORDER BY sort_order ASC
    ) c;

    -- 3. 获取活跃商品（基于 lotteries，兼容现有交易链路）
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
                'description_i18n', COALESCE(l.description_i18n, '{}'::jsonb),
                'image_url', l.image_url,
                'image_urls', l.image_urls,
                'original_price', l.original_price,
                'ticket_price', l.ticket_price,
                'total_tickets', l.total_tickets,
                'sold_tickets', l.sold_tickets,
                'price_comparisons', l.price_comparisons,
                'currency', COALESCE(l.currency, 'TJS'),
                'full_purchase_enabled', l.full_purchase_enabled,
                'full_purchase_price', l.full_purchase_price,
                'status', l.status,
                'period', l.period,
                'draw_time', l.draw_time,
                'end_time', l.end_time
            ) AS data
        FROM lotteries l
        WHERE l.status = 'ACTIVE'
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

GRANT EXECUTE ON FUNCTION public.rpc_get_home_feed(text, int)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 5. 前台专题详情查询
--    返回专题主信息 + 正文块 + 专题内商品列表（含活跃 lottery 信息）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_topic_detail(
    p_slug text,
    p_lang text DEFAULT 'zh'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_topic json;
    v_products json;
    v_topic_id uuid;
    v_now timestamptz := now();
BEGIN
    -- 获取专题基础信息
    SELECT ht.id INTO v_topic_id
    FROM homepage_topics ht
    WHERE ht.slug = p_slug
      AND ht.status = 'published'
      AND ht.is_active = true
      AND (ht.start_time IS NULL OR ht.start_time <= v_now)
      AND (ht.end_time IS NULL OR ht.end_time >= v_now);

    IF v_topic_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'TOPIC_NOT_FOUND'
        );
    END IF;

    -- 获取专题主信息
    SELECT row_to_json(t) INTO v_topic
    FROM (
        SELECT
            ht.id,
            ht.slug,
            ht.topic_type,
            ht.title_i18n,
            ht.subtitle_i18n,
            ht.intro_i18n,
            ht.story_blocks_i18n,
            ht.cover_image_default,
            ht.cover_image_zh,
            ht.cover_image_ru,
            ht.cover_image_tg,
            ht.theme_color,
            ht.translation_status,
            ht.start_time,
            ht.end_time
        FROM homepage_topics ht
        WHERE ht.id = v_topic_id
    ) t;

    -- 获取专题内商品（含活跃 lottery 信息）
    SELECT COALESCE(json_agg(p ORDER BY p.sort_order ASC), '[]'::json)
    INTO v_products
    FROM (
        SELECT
            tp.sort_order,
            tp.note_i18n,
            tp.badge_text_i18n,
            ip.id AS product_id,
            ip.name_i18n,
            ip.description_i18n,
            ip.image_url,
            ip.image_urls,
            ip.original_price,
            -- 获取当前活跃 lottery
            (SELECT json_build_object(
                'lottery_id', l.id,
                'ticket_price', l.ticket_price,
                'total_tickets', l.total_tickets,
                'sold_tickets', l.sold_tickets,
                'status', l.status,
                'full_purchase_enabled', l.full_purchase_enabled,
                'full_purchase_price', l.full_purchase_price,
                'price_comparisons', l.price_comparisons,
                'currency', COALESCE(l.currency, 'TJS'),
                'draw_time', l.draw_time,
                'end_time', l.end_time
            )
            FROM lotteries l
            WHERE l.inventory_product_id = ip.id::text
              AND l.status = 'ACTIVE'
            ORDER BY l.created_at DESC
            LIMIT 1
            ) AS active_lottery
        FROM topic_products tp
        JOIN inventory_products ip ON ip.id = tp.product_id
        WHERE tp.topic_id = v_topic_id
    ) p;

    RETURN json_build_object(
        'success', true,
        'topic', v_topic,
        'products', v_products
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_topic_detail(text, text)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 6. 埋点写入 RPC（轻量版，主要由 Edge Function 调用）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_track_behavior_event(
    p_session_id text,
    p_user_id uuid DEFAULT NULL,
    p_event_name text DEFAULT '',
    p_page_name text DEFAULT '',
    p_entity_type text DEFAULT NULL,
    p_entity_id text DEFAULT NULL,
    p_position text DEFAULT NULL,
    p_source_page text DEFAULT NULL,
    p_source_topic_id uuid DEFAULT NULL,
    p_source_placement_id uuid DEFAULT NULL,
    p_source_category_id uuid DEFAULT NULL,
    p_lottery_id text DEFAULT NULL,
    p_inventory_product_id uuid DEFAULT NULL,
    p_order_id text DEFAULT NULL,
    p_trace_id text DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_device_info jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id uuid;
BEGIN
    -- 基本校验
    IF p_session_id IS NULL OR p_session_id = '' THEN
        RETURN json_build_object('success', false, 'error', 'session_id is required');
    END IF;

    IF p_event_name IS NULL OR p_event_name = '' THEN
        RETURN json_build_object('success', false, 'error', 'event_name is required');
    END IF;

    -- 写入事件
    INSERT INTO user_behavior_events (
        session_id, user_id, event_name, page_name,
        entity_type, entity_id, position,
        source_page, source_topic_id, source_placement_id, source_category_id,
        lottery_id, inventory_product_id, order_id, trace_id,
        metadata, device_info
    ) VALUES (
        p_session_id, p_user_id, p_event_name, p_page_name,
        p_entity_type, p_entity_id, p_position,
        p_source_page, p_source_topic_id, p_source_placement_id, p_source_category_id,
        p_lottery_id, p_inventory_product_id, p_order_id, p_trace_id,
        p_metadata, p_device_info
    )
    RETURNING id INTO v_event_id;

    RETURN json_build_object(
        'success', true,
        'event_id', v_event_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_track_behavior_event(
    text, uuid, text, text, text, text, text, text,
    uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb
) TO anon, authenticated, service_role;

-- ============================================================================
-- 7. 标签引用数查询（后台标签管理页使用）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_get_tag_usage_counts(
    p_session_token text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id uuid;
    v_result json;
BEGIN
    v_admin_id := verify_admin_session(p_session_token);

    SELECT COALESCE(json_agg(t), '[]'::json)
    INTO v_result
    FROM (
        SELECT
            ht.id AS tag_id,
            ht.code,
            ht.tag_group,
            count(pt.id) AS usage_count
        FROM homepage_tags ht
        LEFT JOIN product_tags pt ON pt.tag_id = ht.id
        GROUP BY ht.id, ht.code, ht.tag_group
        ORDER BY ht.tag_group, count(pt.id) DESC
    ) t;

    RETURN json_build_object('data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_tag_usage_counts(text)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 8. 分类商品数统计（后台分类管理页使用）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_get_category_product_counts(
    p_session_token text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id uuid;
    v_result json;
BEGIN
    v_admin_id := verify_admin_session(p_session_token);

    SELECT COALESCE(json_agg(t), '[]'::json)
    INTO v_result
    FROM (
        SELECT
            hc.id AS category_id,
            hc.code,
            count(pc.id) AS product_count
        FROM homepage_categories hc
        LEFT JOIN product_categories pc ON pc.category_id = hc.id
        GROUP BY hc.id, hc.code
        ORDER BY hc.sort_order ASC
    ) t;

    RETURN json_build_object('data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_category_product_counts(text)
    TO anon, authenticated, service_role;
