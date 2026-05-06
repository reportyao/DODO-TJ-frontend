-- ============================================================================
-- B2B 首页 Feed 流 RPC 函数
-- 日期: 2026-05-06
-- 版本: Phase 2
--
-- 目的: 为 B2B 模式提供首页商品数据，直接从 inventory_products 表获取
--       彻底绕过 lotteries 活动层
--
-- 与旧版 rpc_get_home_feed 的区别:
--   - 数据源: inventory_products (而非 lotteries)
--   - 价格字段: wholesale_price, retail_price (而非 ticket_price, original_price)
--   - 无夺宝进度: 不返回 sold_tickets, total_tickets
--   - 支持分类过滤: 通过 p_category_id 参数在数据库层过滤
--   - 保留: banners 和 categories 逻辑不变
--
-- 返回结构:
--   {
--     banners: [...],       -- 轮播图（复用现有 banners 表）
--     categories: [...],    -- 一级分类（复用 homepage_categories 表）
--     products: [...],      -- 商品列表（直接从 inventory_products 获取）
--     total_count: number   -- 商品总数（用于前端分页/加载更多）
--   }
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_b2b_home_feed(
    p_lang text DEFAULT 'zh',
    p_limit int DEFAULT 100,
    p_category_id uuid DEFAULT NULL
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
    v_total_count int;
    v_now timestamptz := now();
BEGIN
    -- ========================================================================
    -- 1. 获取 Banner（复用现有 banners 表逻辑，与旧版一致）
    -- ========================================================================
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

    -- ========================================================================
    -- 2. 获取一级分类（复用 homepage_categories 表）
    -- ========================================================================
    SELECT COALESCE(json_agg(c ORDER BY c.sort_order ASC), '[]'::json)
    INTO v_categories
    FROM (
        SELECT id, code, name_i18n, sort_order
        FROM homepage_categories
        WHERE is_active = true
        ORDER BY sort_order ASC
    ) c;

    -- ========================================================================
    -- 3. 获取商品列表（核心变更：直接从 inventory_products 获取）
    --
    -- 关键设计:
    --   - 只返回 status = 'ACTIVE' 且 stock > 0 的商品
    --   - 支持通过 p_category_id 过滤分类（通过 product_categories 关联表）
    --   - 返回字段包含 wholesale_price 和 retail_price（前端根据用户角色决定展示哪个）
    --   - 不返回 cost_price（仅管理后台可见）
    --   - 包含 min_order_quantity 和 unit_measure（B2B 特有字段）
    -- ========================================================================
    
    -- 先获取总数（用于前端判断是否还有更多数据）
    SELECT COUNT(*)
    INTO v_total_count
    FROM inventory_products ip
    WHERE ip.status = 'ACTIVE'
      AND (ip.stock IS NULL OR ip.stock > 0)
      AND (
          p_category_id IS NULL
          OR EXISTS (
              SELECT 1 FROM product_categories pc
              WHERE pc.product_id = ip.id
                AND pc.category_id = p_category_id
          )
      );

    -- 获取商品数据
    SELECT COALESCE(json_agg(p), '[]'::json)
    INTO v_products
    FROM (
        SELECT
            'product' AS type,
            ip.id AS item_id,
            json_build_object(
                'product_id', ip.id,
                'name_i18n', COALESCE(ip.name_i18n, json_build_object('zh', ip.name)),
                'description_i18n', COALESCE(ip.description_i18n, '{}'::json),
                'image_url', ip.image_url,
                'image_urls', COALESCE(ip.image_urls, ARRAY[]::text[]),
                'original_price', ip.original_price,
                'wholesale_price', ip.wholesale_price,
                'retail_price', ip.retail_price,
                'currency', COALESCE(ip.currency, 'TJS'),
                'stock', COALESCE(ip.stock, 0),
                'min_order_quantity', COALESCE(ip.min_order_quantity, 1),
                'unit_measure', COALESCE(ip.unit_measure, '件'),
                'sku', ip.sku,
                'status', ip.status,
                'specifications_i18n', ip.specifications_i18n,
                'material_i18n', ip.material_i18n
            ) AS data
        FROM inventory_products ip
        WHERE ip.status = 'ACTIVE'
          AND (ip.stock IS NULL OR ip.stock > 0)
          AND (
              p_category_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM product_categories pc
                  WHERE pc.product_id = ip.id
                    AND pc.category_id = p_category_id
              )
          )
        ORDER BY ip.created_at DESC
        LIMIT p_limit
    ) p;

    -- ========================================================================
    -- 4. 组装最终结果
    -- ========================================================================
    RETURN json_build_object(
        'banners', v_banners,
        'categories', v_categories,
        'products', v_products,
        'total_count', v_total_count
    );
END;
$$;

-- 授权：允许匿名用户和已认证用户调用（普通用户也能浏览商品，只是看不到价格）
GRANT EXECUTE ON FUNCTION public.rpc_get_b2b_home_feed(text, int, uuid)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 补充索引：加速 B2B 首页商品查询
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_inventory_products_active_created
    ON public.inventory_products (created_at DESC)
    WHERE status = 'ACTIVE';

-- ============================================================================
-- 辅助 RPC: 获取单个商品详情（B2B 详情页使用）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_b2b_product_detail(
    p_product_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product json;
    v_nearest_stores json;
BEGIN
    -- 获取商品详情（不返回 cost_price）
    SELECT json_build_object(
        'product_id', ip.id,
        'name', ip.name,
        'name_i18n', COALESCE(ip.name_i18n, json_build_object('zh', ip.name)),
        'description_i18n', COALESCE(ip.description_i18n, '{}'::json),
        'details_i18n', COALESCE(ip.details_i18n, '{}'::json),
        'specifications_i18n', ip.specifications_i18n,
        'material_i18n', ip.material_i18n,
        'image_url', ip.image_url,
        'image_urls', COALESCE(ip.image_urls, ARRAY[]::text[]),
        'original_price', ip.original_price,
        'wholesale_price', ip.wholesale_price,
        'retail_price', ip.retail_price,
        'currency', COALESCE(ip.currency, 'TJS'),
        'stock', COALESCE(ip.stock, 0),
        'min_order_quantity', COALESCE(ip.min_order_quantity, 1),
        'unit_measure', COALESCE(ip.unit_measure, '件'),
        'sku', ip.sku,
        'barcode', ip.barcode,
        'status', ip.status,
        'ai_understanding', ip.ai_understanding
    )
    INTO v_product
    FROM inventory_products ip
    WHERE ip.id = p_product_id;

    -- 获取所有门店信息（前端根据用户位置计算距离排序）
    SELECT COALESCE(json_agg(s), '[]'::json)
    INTO v_nearest_stores
    FROM (
        SELECT
            id,
            name,
            address,
            latitude,
            longitude,
            phone,
            working_hours
        FROM pickup_points
        WHERE is_active = true
        ORDER BY name ASC
        LIMIT 10
    ) s;

    RETURN json_build_object(
        'product', v_product,
        'stores', v_nearest_stores
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_b2b_product_detail(uuid)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 辅助 RPC: 搜索商品（支持俄语和塔吉克语）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_b2b_search_products(
    p_query text,
    p_limit int DEFAULT 50
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_products json;
    v_search_pattern text;
BEGIN
    -- 构建模糊搜索模式（支持中文、俄语、塔吉克语）
    v_search_pattern := '%' || LOWER(TRIM(p_query)) || '%';

    SELECT COALESCE(json_agg(p), '[]'::json)
    INTO v_products
    FROM (
        SELECT
            ip.id AS product_id,
            ip.name_i18n,
            ip.image_url,
            ip.wholesale_price,
            ip.retail_price,
            ip.original_price,
            COALESCE(ip.currency, 'TJS') AS currency,
            COALESCE(ip.stock, 0) AS stock,
            COALESCE(ip.min_order_quantity, 1) AS min_order_quantity,
            COALESCE(ip.unit_measure, '件') AS unit_measure,
            ip.status
        FROM inventory_products ip
        WHERE ip.status = 'ACTIVE'
          AND (ip.stock IS NULL OR ip.stock > 0)
          AND (
              -- 搜索中文名称
              LOWER(ip.name) LIKE v_search_pattern
              -- 搜索多语言名称 (JSONB 中的 zh, ru, tg)
              OR LOWER(COALESCE(ip.name_i18n->>'zh', '')) LIKE v_search_pattern
              OR LOWER(COALESCE(ip.name_i18n->>'ru', '')) LIKE v_search_pattern
              OR LOWER(COALESCE(ip.name_i18n->>'tg', '')) LIKE v_search_pattern
              -- 搜索 SKU
              OR LOWER(COALESCE(ip.sku, '')) LIKE v_search_pattern
              -- 搜索多语言描述
              OR LOWER(COALESCE(ip.description_i18n->>'zh', '')) LIKE v_search_pattern
              OR LOWER(COALESCE(ip.description_i18n->>'ru', '')) LIKE v_search_pattern
              OR LOWER(COALESCE(ip.description_i18n->>'tg', '')) LIKE v_search_pattern
          )
        ORDER BY ip.created_at DESC
        LIMIT p_limit
    ) p;

    RETURN json_build_object(
        'products', v_products,
        'query', p_query
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_b2b_search_products(text, int)
    TO anon, authenticated, service_role;
