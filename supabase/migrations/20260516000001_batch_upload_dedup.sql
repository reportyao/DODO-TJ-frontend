-- ============================================================
-- 批量上传去重功能 — 数据库迁移
-- 创建时间: 2026-05-16
-- ============================================================

-- 1. 为 inventory_products.name 添加索引（加速名称查询）
CREATE INDEX IF NOT EXISTS idx_inventory_products_name
  ON inventory_products (name);

-- 2. 为 inventory_products.image_urls 添加 GIN 索引（加速数组重叠查询）
CREATE INDEX IF NOT EXISTS idx_inventory_products_image_urls
  ON inventory_products USING GIN (image_urls);

-- 3. 创建去重检查 RPC 函数
CREATE OR REPLACE FUNCTION public.check_batch_duplicates(
  p_session_token TEXT,
  p_items JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_item JSONB;
  v_name TEXT;
  v_urls TEXT[];
  v_url TEXT;
  v_duplicates JSONB := '[]'::JSONB;
  v_reason TEXT;
  v_found_id UUID;
BEGIN
  -- 验证管理员 session
  SELECT admin_id INTO v_admin_id
  FROM admin_sessions
  WHERE session_token = p_session_token
    AND expires_at > now()
    AND is_active = true;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AUTH_FAILED: 会话无效或已过期';
  END IF;

  -- 遍历每个待检查的商品
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_name := NULLIF(TRIM(v_item->>'name'), '');
    v_urls := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'urls', '[]'::JSONB)));
    v_reason := NULL;
    v_found_id := NULL;

    -- 检查1: 商品名称是否已存在于 inventory_products
    IF v_name IS NOT NULL THEN
      SELECT id INTO v_found_id
      FROM inventory_products
      WHERE LOWER(name) = LOWER(v_name)
        AND status != 'INACTIVE'
      LIMIT 1;

      IF v_found_id IS NOT NULL THEN
        v_reason := '商品名称已存在';
      END IF;
    END IF;

    -- 检查2: 图片URL是否已存在于 inventory_products
    IF v_reason IS NULL AND array_length(v_urls, 1) > 0 THEN
      SELECT id INTO v_found_id
      FROM inventory_products
      WHERE image_urls && v_urls
      LIMIT 1;

      IF v_found_id IS NOT NULL THEN
        v_reason := '图片URL已存在';
      END IF;
    END IF;

    -- 检查3: 图片URL是否已存在于 batch_upload_items 队列中（未处理完的）
    IF v_reason IS NULL AND array_length(v_urls, 1) > 0 THEN
      DECLARE
        v_batch_item_id UUID;
      BEGIN
        SELECT id INTO v_batch_item_id
        FROM batch_upload_items
        WHERE image_urls && v_urls
          AND status NOT IN ('error', 'skipped')
        LIMIT 1;

        IF v_batch_item_id IS NOT NULL THEN
          v_reason := '图片URL已在处理队列中';
          v_found_id := v_batch_item_id;
        END IF;
      END;
    END IF;

    -- 检查4: 商品名称是否已存在于 batch_upload_items 队列中
    IF v_reason IS NULL AND v_name IS NOT NULL THEN
      DECLARE
        v_batch_item_id UUID;
      BEGIN
        SELECT id INTO v_batch_item_id
        FROM batch_upload_items
        WHERE LOWER(product_name) = LOWER(v_name)
          AND status NOT IN ('error', 'skipped')
        LIMIT 1;

        IF v_batch_item_id IS NOT NULL THEN
          v_reason := '商品名称已在处理队列中';
          v_found_id := v_batch_item_id;
        END IF;
      END;
    END IF;

    -- 如果发现重复，添加到结果中
    IF v_reason IS NOT NULL THEN
      v_duplicates := v_duplicates || jsonb_build_object(
        'id', v_item->>'id',
        'name', COALESCE(v_name, ''),
        'reason', v_reason,
        'existing_id', v_found_id::TEXT
      );
    END IF;
  END LOOP;

  RETURN v_duplicates::JSON;
END;
$$;

-- 4. 授权
GRANT EXECUTE ON FUNCTION public.check_batch_duplicates(TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.check_batch_duplicates(TEXT, JSONB) TO authenticated;

-- ============================================================
-- 迁移完成
-- ============================================================
