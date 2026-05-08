-- ============================================================================
-- B2B 首页 Feed RPC 分页修复
-- 日期: 2026-05-08
--
-- 修复点:
--   1. 为 rpc_get_b2b_home_feed 增加 p_offset 参数，避免前端只能拉取前 200 条再本地分页。
--   2. 显式 DROP 旧签名，避免 PostgREST/Supabase RPC schema cache 中出现歧义重载。
--   3. 保持 banners、categories、商品字段结构和授权角色与原函数一致。
-- ============================================================================

DROP FUNCTION IF EXISTS public.rpc_get_b2b_home_feed(text, int, uuid);
DROP FUNCTION IF EXISTS public.rpc_get_b2b_home_feed(text, int, uuid, int);

CREATE OR REPLACE FUNCTION public.rpc_get_b2b_home_feed(
    p_lang text DEFAULT 'zh',
    p_limit int DEFAULT 100,
    p_category_id uuid DEFAULT NULL,
    p_offset int DEFAULT 0
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
    v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 100), 100));
    v_offset int := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
    -- 获取 Banner（复用现有 banners 表逻辑）
    SELECT COALESCE(json_agg(b ORDER BY b.sort_order ASC), '[]'::json)
    INTO v_banners
    FROM (
        SELECT
            id,
            title,
            title_i18n,
            image_url,
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

    -- 获取一级分类（复用 homepage_categories 表）
    SELECT COALESCE(json_agg(c ORDER BY c.sort_order ASC), '[]'::json)
    INTO v_categories
    FROM (
        SELECT id, code, name_i18n, sort_order
        FROM homepage_categories
        WHERE is_active = true
        ORDER BY sort_order ASC
    ) c;

    -- 获取总数（用于分页）
    SELECT COUNT(*)
    INTO v_total_count
    FROM inventory_products ip
    WHERE ip.status = 'ACTIVE'
      AND ip.stock > 0
      AND (
          p_category_id IS NULL
          OR EXISTS (
              SELECT 1 FROM product_categories pc
              WHERE pc.product_id = ip.id
                AND pc.category_id = p_category_id
          )
      );

    -- 获取当前页商品数据
    SELECT COALESCE(json_agg(p), '[]'::json)
    INTO v_products
    FROM (
        SELECT
            'product' AS type,
            ip.id AS item_id,
            json_build_object(
                'product_id', ip.id,
                'name_i18n', COALESCE(ip.name_i18n, jsonb_build_object('zh', ip.name)),
                'description_i18n', COALESCE(ip.description_i18n, '{}'::jsonb),
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
          AND ip.stock > 0
          AND (
              p_category_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM product_categories pc
                  WHERE pc.product_id = ip.id
                    AND pc.category_id = p_category_id
              )
          )
        ORDER BY ip.created_at DESC, ip.id DESC
        LIMIT v_limit
        OFFSET v_offset
    ) p;

    RETURN json_build_object(
        'banners', v_banners,
        'categories', v_categories,
        'products', v_products,
        'total_count', v_total_count,
        'limit', v_limit,
        'offset', v_offset
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_b2b_home_feed(text, int, uuid, int)
    TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_inventory_products_active_created
    ON public.inventory_products (created_at DESC, id DESC)
    WHERE status = 'ACTIVE';
