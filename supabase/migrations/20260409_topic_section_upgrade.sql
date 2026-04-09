-- ============================================================================
-- DODO 专题系统升级 · Section 分组模式
-- 日期: 2026-04-09
-- 说明: 
--   1. topic_products 表已有 story_group / story_text_i18n 字段（线上已存在）
--   2. 新增 rpc_get_topic_detail_v2：按 story_group 分组返回 sections
--   3. 新增 rpc_admin_save_topic_sections：事务保存 section 分组数据
-- ============================================================================

-- ============================================================================
-- 1. 确保 topic_products 表有 story_group 和 story_text_i18n 字段
--    （幂等操作，如果已存在则跳过）
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'topic_products' AND column_name = 'story_group'
    ) THEN
        ALTER TABLE topic_products ADD COLUMN story_group integer DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'topic_products' AND column_name = 'story_text_i18n'
    ) THEN
        ALTER TABLE topic_products ADD COLUMN story_text_i18n jsonb DEFAULT NULL;
    END IF;
    -- [BUG-1 修复] 确保 homepage_topics 表有 cover_image_url 列（AI生成封面图）
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'homepage_topics' AND column_name = 'cover_image_url'
    ) THEN
        ALTER TABLE homepage_topics ADD COLUMN cover_image_url text DEFAULT NULL;
    END IF;
END $$;

-- 为 story_group 添加索引（加速分组查询）
CREATE INDEX IF NOT EXISTS idx_topic_products_story_group 
    ON topic_products (topic_id, story_group, sort_order);

-- ============================================================================
-- 2. rpc_get_topic_detail_v2
--    按 story_group 分组返回 sections，每个 section 包含场景文案和关联商品
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_topic_detail_v2(
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
    v_sections json;
    v_topic_id uuid;
    v_now timestamptz := now();
BEGIN
    -- 获取专题 ID
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
            ht.cover_image_url,
            ht.theme_color,
            ht.translation_status,
            ht.start_time,
            ht.end_time
        FROM homepage_topics ht
        WHERE ht.id = v_topic_id
    ) t;

    -- 按 story_group 分组返回 sections
    -- 每个 section = { story_group, story_text_i18n, products[] }
    SELECT COALESCE(json_agg(section ORDER BY section.story_group ASC), '[]'::json)
    INTO v_sections
    FROM (
        SELECT
            COALESCE(tp_group.story_group, 0) AS story_group,
            -- 取该组第一条记录的 story_text_i18n 作为本组场景文案
            (SELECT tp_inner.story_text_i18n 
             FROM topic_products tp_inner 
             WHERE tp_inner.topic_id = v_topic_id 
               AND COALESCE(tp_inner.story_group, 0) = COALESCE(tp_group.story_group, 0) 
               AND tp_inner.story_text_i18n IS NOT NULL
             LIMIT 1
            ) AS story_text_i18n,
            -- 该组下的所有商品
            (SELECT json_agg(p ORDER BY p.sort_order ASC)
             FROM (
                SELECT
                    tp2.sort_order,
                    tp2.note_i18n,
                    tp2.badge_text_i18n,
                    ip.id AS product_id,
                    ip.name_i18n,
                    ip.description_i18n,
                    ip.image_url,
                    ip.image_urls,
                    ip.original_price,
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
                FROM topic_products tp2
                JOIN inventory_products ip ON ip.id = tp2.product_id
                WHERE tp2.topic_id = v_topic_id
                  AND COALESCE(tp2.story_group, 0) = COALESCE(tp_group.story_group, 0)
             ) p
            ) AS products
        FROM (
            SELECT DISTINCT COALESCE(story_group, 0) AS story_group
            FROM topic_products
            WHERE topic_id = v_topic_id
        ) tp_group
    ) section;

    RETURN json_build_object(
        'success', true,
        'topic', v_topic,
        'sections', v_sections
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_topic_detail_v2(text, text)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 3. rpc_admin_save_topic_sections
--    事务保存专题的 section 分组数据
--    p_sections: [{ story_group, story_text_i18n, products: [{ product_id, sort_order, note_i18n, badge_text_i18n }] }]
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_save_topic_sections(
    p_session_token text,
    p_topic_id uuid,
    p_sections jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id uuid;
    v_section jsonb;
    v_product jsonb;
    v_group_idx int;
    v_count int := 0;
BEGIN
    -- 验证管理员会话
    v_admin_id := verify_admin_session(p_session_token);

    -- 验证专题存在
    IF NOT EXISTS (SELECT 1 FROM homepage_topics WHERE id = p_topic_id) THEN
        RAISE EXCEPTION 'TOPIC_NOT_FOUND: 专题不存在 %', p_topic_id;
    END IF;

    -- 事务内清空并重写
    DELETE FROM topic_products WHERE topic_id = p_topic_id;

    IF p_sections IS NOT NULL AND jsonb_array_length(p_sections) > 0 THEN
        v_group_idx := 0;
        FOR v_section IN SELECT * FROM jsonb_array_elements(p_sections)
        LOOP
            -- 遍历该 section 下的商品
            IF v_section->'products' IS NOT NULL AND jsonb_array_length(v_section->'products') > 0 THEN
                FOR v_product IN SELECT * FROM jsonb_array_elements(v_section->'products')
                LOOP
                    -- 验证商品存在
                    IF NOT EXISTS (
                        SELECT 1 FROM inventory_products
                        WHERE id = (v_product->>'product_id')::uuid
                    ) THEN
                        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: 商品不存在 %', v_product->>'product_id';
                    END IF;

                    INSERT INTO topic_products (
                        topic_id,
                        product_id,
                        sort_order,
                        note_i18n,
                        badge_text_i18n,
                        story_group,
                        story_text_i18n
                    ) VALUES (
                        p_topic_id,
                        (v_product->>'product_id')::uuid,
                        COALESCE((v_product->>'sort_order')::int, 0),
                        CASE WHEN v_product ? 'note_i18n' THEN v_product->'note_i18n' ELSE NULL END,
                        CASE WHEN v_product ? 'badge_text_i18n' THEN v_product->'badge_text_i18n' ELSE NULL END,
                        v_group_idx,
                        CASE WHEN v_section ? 'story_text_i18n' THEN v_section->'story_text_i18n' ELSE NULL END
                    )
                    ON CONFLICT (topic_id, product_id) DO UPDATE SET
                        sort_order = EXCLUDED.sort_order,
                        note_i18n = EXCLUDED.note_i18n,
                        badge_text_i18n = EXCLUDED.badge_text_i18n,
                        story_group = EXCLUDED.story_group,
                        story_text_i18n = EXCLUDED.story_text_i18n;

                    v_count := v_count + 1;
                END LOOP;
            END IF;

            v_group_idx := v_group_idx + 1;
        END LOOP;
    END IF;

    -- 记录审计日志
    INSERT INTO admin_audit_logs (admin_id, action, target_type, details)
    VALUES (
        v_admin_id,
        'save_topic_sections',
        'homepage_topics',
        jsonb_build_object(
            'topic_id', p_topic_id,
            'section_count', COALESCE(jsonb_array_length(p_sections), 0),
            'product_count', v_count
        )
    );

    RETURN json_build_object(
        'success', true,
        'topic_id', p_topic_id,
        'section_count', COALESCE(jsonb_array_length(p_sections), 0),
        'product_count', v_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_save_topic_sections(text, uuid, jsonb)
    TO anon, authenticated, service_role;
