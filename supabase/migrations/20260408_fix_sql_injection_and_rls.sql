-- ============================================================================
-- DODO 首页场景化改造 · 安全修复补丁
-- 日期: 2026-04-08
-- 修复内容:
--   1. rpc_admin_search_topic_products: SQL 注入漏洞修复（%s → %L）
--   2. user_behavior_events: 补充 SELECT RLS 策略（admin 看板需要）
--   3. homepage_topics: 补充 SELECT RLS 策略（前端公开读取需要）
--   4. topic_placements: 补充 SELECT RLS 策略（前端公开读取需要）
-- ============================================================================

-- ============================================================================
-- 1. 修复 SQL 注入漏洞
--    原代码: format('... ILIKE ''%%%s%%'' ...', p_keyword)
--    修复后: 使用 quote_literal 安全转义
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
    v_safe_keyword text;
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
            COALESCE(
                (SELECT json_agg(json_build_object(
                    ''id'', hc.id, ''code'', hc.code, ''name_i18n'', hc.name_i18n
                ))
                FROM product_categories pc2
                JOIN homepage_categories hc ON hc.id = pc2.category_id
                WHERE pc2.product_id = ip.id),
                ''[]''::json
            ) AS categories,
            COALESCE(
                (SELECT json_agg(json_build_object(
                    ''id'', ht.id, ''code'', ht.code, ''tag_group'', ht.tag_group, ''name_i18n'', ht.name_i18n
                ))
                FROM product_tags pt2
                JOIN homepage_tags ht ON ht.id = pt2.tag_id
                WHERE pt2.product_id = ip.id),
                ''[]''::json
            ) AS tags,
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

    -- [安全修复] 关键词搜索 - 使用 quote_literal 防止 SQL 注入
    IF p_keyword IS NOT NULL AND p_keyword != '' THEN
        -- 转义特殊字符并构建安全的 LIKE 模式
        v_safe_keyword := replace(replace(replace(p_keyword, '\', '\\'), '%', '\%'), '_', '\_');
        v_where := v_where || format(
            ' AND (ip.name_i18n::text ILIKE %L OR ip.sku ILIKE %L OR ip.id::text ILIKE %L)',
            '%' || v_safe_keyword || '%',
            '%' || v_safe_keyword || '%',
            '%' || v_safe_keyword || '%'
        );
    END IF;

    -- 分类筛选（uuid[] 类型安全，无注入风险）
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

    -- 安全限制 limit 和 offset 范围
    p_limit := LEAST(GREATEST(p_limit, 1), 100);
    p_offset := GREATEST(p_offset, 0);

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

-- ============================================================================
-- 2. 补充 user_behavior_events 的 SELECT RLS 策略
--    admin 看板需要读取行为数据；前端不需要读取
-- ============================================================================
-- 注意: 此策略通过 service_role 绕过 RLS，但为了 admin 端使用 adminQuery
-- 实际上 adminQuery 走 Edge Function (service_role)，不受 RLS 限制
-- 此处仍添加策略以防直接查询场景
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'user_behavior_events'
        AND policyname = 'user_behavior_events_service_select'
    ) THEN
        CREATE POLICY user_behavior_events_service_select
            ON user_behavior_events FOR SELECT
            TO service_role
            USING (true);
    END IF;
END $$;

-- ============================================================================
-- 3. 确保前端公开读取的表有 anon SELECT 策略
-- ============================================================================
-- homepage_topics: 前端需要读取已发布专题
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'homepage_topics'
        AND policyname = 'homepage_topics_public_read'
    ) THEN
        CREATE POLICY homepage_topics_public_read
            ON homepage_topics FOR SELECT
            TO anon, authenticated
            USING (is_active = true AND status = 'published');
    END IF;
END $$;

-- topic_placements: 前端需要读取活跃投放
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'topic_placements'
        AND policyname = 'topic_placements_public_read'
    ) THEN
        CREATE POLICY topic_placements_public_read
            ON topic_placements FOR SELECT
            TO anon, authenticated
            USING (is_active = true);
    END IF;
END $$;

-- topic_products: 前端需要读取专题商品关系
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'topic_products'
        AND policyname = 'topic_products_public_read'
    ) THEN
        CREATE POLICY topic_products_public_read
            ON topic_products FOR SELECT
            TO anon, authenticated
            USING (true);
    END IF;
END $$;
