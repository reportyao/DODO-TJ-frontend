-- ============================================================================
-- B2B P0 修复迁移：修复所有测试发现的问题
-- 日期: 2026-05-10
-- 版本: P0 Fix v2
--
-- 修复内容:
--   1. 补充 b2b_orders 缺失字段（迁移 20260509000002 未应用的字段）
--   2. 补充 b2b_order_items 缺失字段
--   3. 修复 b2b_create_order_from_cart_tx 的 SQL 类型错误
--      根本原因: shopping_carts.user_id 和 b2b_orders.user_id 是 text 类型
--      而函数参数 p_user_id 是 uuid，需要显式 ::text 转换
--   4. 修复 b2b_order_operation_logs 列名不匹配问题（添加缺失列）
--   5. 修复 b2b_order_operation_logs.user_id 类型（text -> uuid）
--   6. 修复 b2b_idempotency_keys 缺失字段（user_id, status, locked_until, response_json, error_code）
--   7. 新增 b2b_cancel_order_tx RPC（用户侧原子取消订单，替代非事务化多步写入）
--   8. 修复 b2b_orders.reconciliation_status 约束值（unreconciled 不在旧约束中）
--   9. 修复 admin_b2b_cancel_order 和 admin_b2b_mark_delivered 使用新字段
--   10. 回填现有订单的新字段
--   11. 修复 inventory_transactions 约束支持 B2B_CANCEL 类型
-- ============================================================================

-- ============================================================================
-- 1. 补充 b2b_orders 缺失字段（来自迁移 20260509000002）
-- ============================================================================

ALTER TABLE b2b_orders
  ADD COLUMN IF NOT EXISTS order_version int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS freight_amount numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS gross_profit_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS profit_status varchar(20) DEFAULT 'cost_missing',
  ADD COLUMN IF NOT EXISTS customer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key text,
  ADD COLUMN IF NOT EXISTS checkout_request_hash text,
  ADD COLUMN IF NOT EXISTS source varchar(50) DEFAULT 'b2b-checkout',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_by uuid;

-- profit_status 约束
DO $$ BEGIN
  ALTER TABLE b2b_orders ADD CONSTRAINT chk_b2b_profit_status
    CHECK (profit_status IN ('complete', 'cost_missing', 'recalculating'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. 修复 b2b_orders.reconciliation_status 约束
--    旧约束值: pending/matched/mismatched/locked
--    b2b_create_order_from_cart_tx 写入: 'unreconciled'（不在旧约束中）
--    修复: 扩展约束包含 unreconciled/in_progress/difference
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE b2b_orders DROP CONSTRAINT IF EXISTS chk_b2b_reconciliation_status;
  ALTER TABLE b2b_orders ADD CONSTRAINT chk_b2b_reconciliation_status
    CHECK (reconciliation_status IN (
      'pending', 'matched', 'mismatched', 'locked',
      'unreconciled', 'in_progress', 'difference'
    ));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'reconciliation_status constraint update failed: %', SQLERRM;
END $$;

-- ============================================================================
-- 3. 补充 b2b_order_items 缺失字段（来自迁移 20260509000002）
-- ============================================================================

ALTER TABLE b2b_order_items
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS product_name_i18n jsonb,
  ADD COLUMN IF NOT EXISTS product_image_url text,
  ADD COLUMN IF NOT EXISTS product_sku text,
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS line_cost_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS line_profit_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS prepared_quantity int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_quantity int DEFAULT 0;

-- 回填 b2b_order_items 新字段（从已有字段同步）
UPDATE b2b_order_items SET
  product_name = COALESCE(product_name, product_name_zh, product_name_original),
  product_image_url = COALESCE(product_image_url, image_url),
  product_sku = COALESCE(product_sku, sku),
  cost_price = COALESCE(cost_price, cost_price_snapshot),
  line_cost_amount = COALESCE(line_cost_amount, 
    CASE WHEN cost_price_snapshot IS NOT NULL THEN cost_price_snapshot * quantity ELSE NULL END),
  line_profit_amount = COALESCE(line_profit_amount, line_expected_profit),
  prepared_quantity = COALESCE(prepared_quantity, picked_quantity, 0),
  cancelled_quantity = COALESCE(cancelled_quantity, 0)
WHERE product_name IS NULL OR product_image_url IS NULL OR product_sku IS NULL;

-- ============================================================================
-- 4. 修复 b2b_idempotency_keys 缺失字段
--    迁移 20260509000003 使用了: user_id, status, locked_until, response_json, error_code
--    但迁移 20260510000001 定义的表没有这些字段
-- ============================================================================

ALTER TABLE b2b_idempotency_keys
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'processing',
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS response_json jsonb,
  ADD COLUMN IF NOT EXISTS error_code text;

DO $$ BEGIN
  ALTER TABLE b2b_idempotency_keys ADD CONSTRAINT chk_idempotency_status
    CHECK (status IN ('processing', 'succeeded', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 5. 修复 b2b_order_operation_logs 列名不匹配 + user_id 类型修复
--    迁移 20260510000001 定义: entity_type, entity_id, action, admin_id, old_value, new_value, user_id(text)
--    迁移 20260509000003 写入: order_id, actor_id, actor_type, operation, to_state, metadata
--    修复1: 添加缺失字段
--    修复2: user_id 从 text 改为 uuid
-- ============================================================================

ALTER TABLE b2b_order_operation_logs
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS actor_type varchar(50),
  ADD COLUMN IF NOT EXISTS operation varchar(100),
  ADD COLUMN IF NOT EXISTS to_state varchar(50),
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- 修复 user_id 类型从 text 到 uuid
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'b2b_order_operation_logs'
      AND column_name = 'user_id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE public.b2b_order_operation_logs
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
    RAISE NOTICE 'b2b_order_operation_logs.user_id converted from text to uuid';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'user_id type conversion: %', SQLERRM;
END $$;

-- ============================================================================
-- 6. 修复 b2b_create_order_from_cart_tx 函数
--    根本原因: shopping_carts.user_id 和 b2b_orders.user_id 是 text 类型
--    而函数参数 p_user_id 是 uuid，需要显式 ::text 转换
-- ============================================================================

CREATE OR REPLACE FUNCTION public.b2b_create_order_from_cart_tx(
  p_user_id uuid,
  p_delivery_address text,
  p_delivery_note text DEFAULT '',
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL,
  p_session_token_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_item record;
  v_order_id uuid;
  v_order_number varchar;
  v_item_count integer := 0;
  v_total_quantity integer := 0;
  v_total_amount numeric(12, 2) := 0;
  v_total_cost_amount numeric(12, 2) := 0;
  v_missing_cost boolean := false;
  v_stock_after integer;
  v_customer_snapshot jsonb;
  v_response jsonb;
  v_idem record;
  v_has_idempotency boolean := false;
  v_effective_request_hash text;
  v_effective_note text;
  -- FIX: shopping_carts.user_id 和 b2b_orders.user_id 是 text 类型，需要显式转换
  v_user_id_text text;
BEGIN
  v_user_id_text := p_user_id::text;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'ERR_INVALID_USER',
      'error', '缺少用户 ID'
    );
  END IF;

  IF NULLIF(btrim(COALESCE(p_delivery_address, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'ERR_PARAMS_MISSING',
      'error', '配送地址不能为空，请在个人资料中设置或在下单时提供'
    );
  END IF;

  v_effective_note := COALESCE(p_delivery_note, '');
  v_effective_request_hash := COALESCE(
    NULLIF(p_request_hash, ''),
    md5(v_user_id_text || '|' || COALESCE(p_delivery_address, '') || '|' || v_effective_note)
  );
  v_has_idempotency := NULLIF(p_idempotency_key, '') IS NOT NULL;

  -- ---------------------------------------------------------------------------
  -- 幂等保护：同一 scope + key 串行执行；成功请求直接重放响应。
  -- ---------------------------------------------------------------------------
  IF v_has_idempotency THEN
    PERFORM pg_advisory_xact_lock(hashtext('b2b_checkout:' || p_idempotency_key));

    INSERT INTO public.b2b_idempotency_keys (
      scope, idempotency_key, user_id, request_hash, status, locked_until, expires_at
    ) VALUES (
      'b2b_checkout', p_idempotency_key, p_user_id, v_effective_request_hash,
      'processing', now() + interval '5 minutes', now() + interval '24 hours'
    )
    ON CONFLICT (scope, idempotency_key) DO NOTHING;

    SELECT * INTO v_idem
    FROM public.b2b_idempotency_keys
    WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_idem.user_id IS NOT NULL AND v_idem.user_id != p_user_id THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'ERR_IDEMPOTENCY_CONFLICT', 'error', '幂等键已被其他用户使用');
    END IF;

    IF v_idem.request_hash IS NOT NULL AND v_idem.request_hash <> v_effective_request_hash THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'ERR_IDEMPOTENCY_CONFLICT', 'error', '同一幂等键不能用于不同下单请求');
    END IF;

    IF v_idem.status = 'succeeded' AND v_idem.response_json IS NOT NULL THEN
      RETURN v_idem.response_json || jsonb_build_object('idempotent_replay', true);
    END IF;

    UPDATE public.b2b_idempotency_keys
    SET status = 'processing', error_code = NULL, locked_until = now() + interval '5 minutes'
    WHERE id = v_idem.id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 客户快照：批发商资料不是下单门槛，但必须在历史订单中结构化保存。
  -- ---------------------------------------------------------------------------
  SELECT id, status, company_name, contact_phone, tax_id, business_address, delivery_address
  INTO v_profile
  FROM public.wholesaler_profiles
  WHERE user_id = v_user_id_text  -- FIX: wholesaler_profiles.user_id 也是 text
  LIMIT 1;

  v_customer_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'user_id', v_user_id_text,
    'wholesaler_profile_id', v_profile.id,
    'wholesaler_status', v_profile.status,
    'company_name', v_profile.company_name,
    'contact_phone', v_profile.contact_phone,
    'tax_id', v_profile.tax_id,
    'business_address', v_profile.business_address,
    'profile_delivery_address', v_profile.delivery_address,
    'checkout_delivery_address', p_delivery_address
  ));

  -- ---------------------------------------------------------------------------
  -- 锁定购物车与商品行，完成业务校验与金额计算。
  -- ---------------------------------------------------------------------------
  FOR v_item IN
    SELECT
      sc.id AS cart_id, sc.product_id, sc.quantity,
      ip.name, ip.name_i18n, ip.image_url,
      ip.wholesale_price, ip.retail_price, ip.cost_price,
      ip.stock, ip.min_order_quantity, ip.unit_measure, ip.sku, ip.status
    FROM public.shopping_carts sc
    JOIN public.inventory_products ip ON ip.id = sc.product_id
    WHERE sc.user_id = v_user_id_text  -- FIX: shopping_carts.user_id 是 text
    ORDER BY sc.created_at ASC, sc.id ASC
    FOR UPDATE OF sc, ip
  LOOP
    v_item_count := v_item_count + 1;

    IF COALESCE(v_item.status, '') <> 'ACTIVE' THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_PRODUCT_UNAVAILABLE',
        'error', '商品不可购买: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(v_item.product_id));
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_PRODUCT_UNAVAILABLE'
        WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;

    IF v_item.quantity < COALESCE(v_item.min_order_quantity, 1) THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_MIN_ORDER_QUANTITY',
        'error', '商品未达到起订量: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(jsonb_build_object('product_id', v_item.product_id, 'min_order_quantity', v_item.min_order_quantity)));
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_MIN_ORDER_QUANTITY'
        WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;

    IF COALESCE(v_item.stock, 0) < v_item.quantity THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_OUT_OF_STOCK',
        'error', '商品库存不足: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(jsonb_build_object('product_id', v_item.product_id, 'stock', COALESCE(v_item.stock, 0), 'requested_quantity', v_item.quantity)));
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_OUT_OF_STOCK'
        WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;

    IF COALESCE(v_item.wholesale_price, 0) <= 0 THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_INVALID_PRICE',
        'error', '商品批发价无效: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(v_item.product_id));
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_INVALID_PRICE'
        WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;

    v_total_quantity := v_total_quantity + v_item.quantity;
    v_total_amount := v_total_amount + (v_item.wholesale_price * v_item.quantity);

    IF v_item.cost_price IS NULL THEN
      v_missing_cost := true;
    ELSE
      v_total_cost_amount := v_total_cost_amount + (v_item.cost_price * v_item.quantity);
    END IF;
  END LOOP;

  IF v_item_count = 0 THEN
    v_response := jsonb_build_object('success', false, 'error_code', 'ERR_CART_EMPTY', 'error', '购物车为空');
    IF v_has_idempotency THEN
      UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_CART_EMPTY'
      WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
    END IF;
    RETURN v_response;
  END IF;

  v_order_number := public.generate_b2b_order_number();

  -- FIX: b2b_orders.user_id 是 text，使用 v_user_id_text
  INSERT INTO public.b2b_orders (
    order_number, user_id, total_amount, subtotal_amount, discount_amount,
    shipping_fee, freight_amount, item_count, total_quantity,
    status, fulfillment_status, payment_method, payment_status, financial_status,
    reconciliation_status, delivery_address, delivery_note,
    customer_snapshot, checkout_idempotency_key, checkout_request_hash, source,
    total_cost_amount, cost_total_snapshot, gross_profit_amount, expected_gross_profit,
    profit_status, cost_status, receivable_total, balance_due, paid_total,
    version, order_version
  ) VALUES (
    v_order_number, v_user_id_text, v_total_amount, v_total_amount, 0,
    0, 0, v_item_count, v_total_quantity,
    'pending', 'pending', 'cod', 'pending', 'unpaid',
    'unreconciled', p_delivery_address, v_effective_note,
    v_customer_snapshot,
    CASE WHEN v_has_idempotency THEN p_idempotency_key ELSE NULL END,
    v_effective_request_hash, 'b2b-checkout',
    CASE WHEN v_missing_cost THEN NULL ELSE v_total_cost_amount END,
    CASE WHEN v_missing_cost THEN NULL ELSE v_total_cost_amount END,
    CASE WHEN v_missing_cost THEN NULL ELSE v_total_amount - v_total_cost_amount END,
    CASE WHEN v_missing_cost THEN NULL ELSE v_total_amount - v_total_cost_amount END,
    CASE WHEN v_missing_cost THEN 'cost_missing' ELSE 'complete' END,
    CASE WHEN v_missing_cost THEN 'missing' ELSE 'complete' END,
    v_total_amount, v_total_amount, 0, 1, 1
  )
  RETURNING id INTO v_order_id;

  -- ---------------------------------------------------------------------------
  -- 写入明细、扣减库存与库存流水。
  -- ---------------------------------------------------------------------------
  FOR v_item IN
    SELECT
      sc.product_id, sc.quantity,
      ip.name, ip.name_i18n, ip.image_url,
      ip.wholesale_price, ip.retail_price, ip.cost_price,
      ip.stock, ip.min_order_quantity, ip.unit_measure, ip.sku, ip.status
    FROM public.shopping_carts sc
    JOIN public.inventory_products ip ON ip.id = sc.product_id
    WHERE sc.user_id = v_user_id_text  -- FIX: text cast
    ORDER BY sc.created_at ASC, sc.id ASC
  LOOP
    UPDATE public.inventory_products
    SET stock = stock - v_item.quantity, updated_at = now()
    WHERE id = v_item.product_id AND stock >= v_item.quantity
    RETURNING stock INTO v_stock_after;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'B2B stock deduction failed for product %', v_item.product_id USING ERRCODE = 'P0001';
    END IF;

    -- FIX: 写入两套字段（新旧兼容）
    INSERT INTO public.b2b_order_items (
      order_id, product_id, quantity, unit_price, subtotal, snapshot_data,
      -- 新字段（migration 20260510000001）
      product_name_zh, product_name_original, sku, image_url, unit_measure,
      cost_price_snapshot, wholesale_price_snapshot,
      ordered_quantity, picked_quantity, shipped_quantity, delivered_quantity,
      returned_quantity, shortage_quantity, line_expected_profit, item_status,
      -- 旧字段（migration 20260509000002 + 本次修复）
      product_name, product_image_url, product_sku,
      cost_price, line_cost_amount, line_profit_amount
    ) VALUES (
      v_order_id, v_item.product_id, v_item.quantity, v_item.wholesale_price,
      v_item.wholesale_price * v_item.quantity,
      jsonb_strip_nulls(jsonb_build_object(
        'id', v_item.product_id, 'name', v_item.name, 'name_i18n', v_item.name_i18n,
        'image_url', v_item.image_url, 'sku', v_item.sku, 'unit_measure', v_item.unit_measure,
        'wholesale_price', v_item.wholesale_price, 'retail_price', v_item.retail_price
      )),
      -- 新字段
      COALESCE(v_item.name, ''), v_item.name, v_item.sku, v_item.image_url,
      COALESCE(v_item.unit_measure, '件'),
      v_item.cost_price, v_item.wholesale_price,
      v_item.quantity, 0, 0, 0, 0, 0,
      CASE WHEN v_item.cost_price IS NULL THEN NULL
           ELSE (v_item.wholesale_price - v_item.cost_price) * v_item.quantity END,
      'ordered',
      -- 旧字段
      COALESCE(v_item.name, ''), v_item.image_url, v_item.sku,
      v_item.cost_price,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE v_item.cost_price * v_item.quantity END,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE (v_item.wholesale_price - v_item.cost_price) * v_item.quantity END
    );

    INSERT INTO public.inventory_transactions (
      inventory_product_id, transaction_type, quantity, stock_before, stock_after,
      related_order_id, notes
    ) VALUES (
      v_item.product_id, 'B2B_SALE', -v_item.quantity, v_item.stock, v_stock_after,
      v_order_id, 'B2B订单 ' || v_order_number || ' 事务化扣减库存'
    );
  END LOOP;

  -- FIX: DELETE 也需要 text cast
  DELETE FROM public.shopping_carts WHERE user_id = v_user_id_text;

  -- FIX: 写入 b2b_order_operation_logs 使用正确的列名（同时支持两套）
  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, user_id, new_value,
    order_id, actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'order', v_order_id, 'checkout_create_order', p_user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_number', v_order_number, 'total_amount', v_total_amount,
      'total_quantity', v_total_quantity, 'item_count', v_item_count
    )),
    v_order_id, p_user_id, 'customer', 'checkout_create_order', 'pending',
    jsonb_strip_nulls(jsonb_build_object(
      'order_number', v_order_number, 'total_amount', v_total_amount,
      'total_quantity', v_total_quantity, 'item_count', v_item_count,
      'idempotency_key', CASE WHEN v_has_idempotency THEN p_idempotency_key ELSE NULL END,
      'request_hash', v_effective_request_hash,
      'session_token_hash', p_session_token_hash
    ))
  );

  v_response := jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id, 'order_number', v_order_number,
      'total_amount', v_total_amount, 'subtotal_amount', v_total_amount,
      'paid_total', 0, 'item_count', v_item_count, 'total_quantity', v_total_quantity,
      'status', 'pending', 'fulfillment_status', 'pending',
      'payment_status', 'pending', 'financial_status', 'unpaid',
      'delivery_address', p_delivery_address,
      'profit_status', CASE WHEN v_missing_cost THEN 'cost_missing' ELSE 'complete' END
    ),
    'message', '订单创建成功，等待配送'
  );

  IF v_has_idempotency THEN
    UPDATE public.b2b_idempotency_keys
    SET status = 'succeeded', response_json = v_response, error_code = NULL, locked_until = NULL
    WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_response;
END;
$$;

COMMENT ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) IS
'B2B 事务化下单 RPC（P0 修复版 v2）。修复了 text=uuid 类型错误（shopping_carts.user_id 是 text 类型）和列名不匹配问题。';

REVOKE ALL ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) TO service_role;

-- ============================================================================
-- 7. 新增 b2b_cancel_order_tx RPC（用户侧原子取消订单）
--    修复: 原 Edge Function 中的非事务化取消改为 RPC
--    b2b-orders Edge Function 的 handleCancelOrder 已更新为调用此 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.b2b_cancel_order_tx(
  p_user_id uuid,
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_item record;
  v_stock_before int;
  v_stock_after int;
  v_user_id_text text;
BEGIN
  v_user_id_text := p_user_id::text;

  IF p_user_id IS NULL OR p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_PARAMS_MISSING', 'error', '用户ID和订单ID不能为空');
  END IF;

  -- FIX: b2b_orders.user_id 是 text
  SELECT * INTO v_order
  FROM public.b2b_orders
  WHERE id = p_order_id AND user_id = v_user_id_text
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_ORDER_NOT_FOUND', 'error', '订单不存在');
  END IF;

  IF v_order.fulfillment_status NOT IN ('pending', 'confirmed') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_INVALID_STATUS',
      'error', '只能取消待处理或已确认的订单，当前状态: ' || v_order.fulfillment_status);
  END IF;

  IF v_order.locked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_ORDER_LOCKED', 'error', '订单已锁账，无法取消');
  END IF;

  -- 原子回补库存
  FOR v_item IN
    SELECT product_id, quantity
    FROM public.b2b_order_items
    WHERE order_id = p_order_id AND item_status NOT IN ('cancelled', 'returned')
  LOOP
    SELECT stock INTO v_stock_before
    FROM public.inventory_products WHERE id = v_item.product_id FOR UPDATE;

    v_stock_after := COALESCE(v_stock_before, 0) + v_item.quantity;

    UPDATE public.inventory_products SET stock = v_stock_after, updated_at = now() WHERE id = v_item.product_id;

    INSERT INTO public.inventory_transactions (
      inventory_product_id, transaction_type, quantity, stock_before, stock_after, related_order_id, notes
    ) VALUES (
      v_item.product_id, 'B2B_CANCEL', v_item.quantity,
      COALESCE(v_stock_before, 0), v_stock_after, p_order_id,
      'B2B订单 ' || v_order.order_number || ' 用户取消，回补库存'
    );
  END LOOP;

  UPDATE public.b2b_orders SET
    status = 'cancelled', fulfillment_status = 'cancelled',
    cancelled_at = now(), cancelled_by = p_user_id,
    cancellation_reason = p_reason, version = version + 1, updated_at = now()
  WHERE id = p_order_id;

  UPDATE public.b2b_order_items SET
    item_status = 'cancelled', cancelled_quantity = COALESCE(ordered_quantity, quantity)
  WHERE order_id = p_order_id AND item_status NOT IN ('cancelled', 'returned');

  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, user_id, new_value,
    order_id, actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'order', p_order_id, 'user_cancel_order', p_user_id,
    jsonb_build_object('fulfillment_status', 'cancelled', 'reason', p_reason),
    p_order_id, p_user_id, 'customer', 'cancel_order', 'cancelled',
    jsonb_build_object('reason', p_reason, 'previous_status', v_order.fulfillment_status)
  );

  RETURN jsonb_build_object('success', true, 'message', '订单已取消，库存已回补',
    'order_id', p_order_id, 'fulfillment_status', 'cancelled');
END;
$$;

COMMENT ON FUNCTION public.b2b_cancel_order_tx(uuid, uuid, text) IS
'B2B 用户侧原子取消订单 RPC（P0 修复版）。替代 b2b-orders Edge Function 中的非事务化取消逻辑，确保库存回补与订单状态更新在同一事务中完成。';

REVOKE ALL ON FUNCTION public.b2b_cancel_order_tx(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.b2b_cancel_order_tx(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.b2b_cancel_order_tx(uuid, uuid, text) TO authenticated;

-- ============================================================================
-- 8. 修复 admin_b2b_cancel_order 使用 cancelled_at/cancelled_by 字段
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_cancel_order(
  p_session_token text,
  p_order_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_order record;
  v_item record;
  v_stock_before int;
  v_stock_after int;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'cancel_order' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_order FROM b2b_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  IF v_order.fulfillment_status = 'cancelled' THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 订单已取消';
  END IF;

  IF v_order.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_ORDER_LOCKED: 订单已锁账，无法取消';
  END IF;

  FOR v_item IN
    SELECT product_id, COALESCE(ordered_quantity, quantity) AS qty
    FROM b2b_order_items
    WHERE order_id = p_order_id AND item_status NOT IN ('cancelled', 'returned')
  LOOP
    SELECT stock INTO v_stock_before FROM inventory_products WHERE id = v_item.product_id FOR UPDATE;
    v_stock_after := COALESCE(v_stock_before, 0) + v_item.qty;
    UPDATE inventory_products SET stock = v_stock_after, updated_at = now() WHERE id = v_item.product_id;
    INSERT INTO inventory_transactions (
      inventory_product_id, transaction_type, quantity, stock_before, stock_after, related_order_id, notes
    ) VALUES (
      v_item.product_id, 'B2B_CANCEL', v_item.qty,
      COALESCE(v_stock_before, 0), v_stock_after, p_order_id,
      'B2B订单 ' || v_order.order_number || ' 管理员取消，回补库存'
    );
  END LOOP;

  UPDATE b2b_order_items SET
    item_status = 'cancelled', cancelled_quantity = COALESCE(ordered_quantity, quantity)
  WHERE order_id = p_order_id AND item_status NOT IN ('cancelled', 'returned');

  UPDATE b2b_orders SET
    fulfillment_status = 'cancelled', status = 'cancelled',
    admin_note = COALESCE(p_reason, admin_note),
    cancelled_at = now(), cancelled_by = v_admin_id,
    cancellation_reason = p_reason,
    version = version + 1, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, new_value, idempotency_key,
    order_id, actor_id, actor_type, operation, to_state, metadata)
  VALUES ('order', p_order_id, 'cancel_order', v_admin_id,
          jsonb_build_object('reason', p_reason, 'fulfillment_status', 'cancelled'),
          p_idempotency_key,
          p_order_id, v_admin_id, 'admin', 'cancel_order', 'cancelled',
          jsonb_build_object('reason', p_reason));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('cancel_order', p_idempotency_key, jsonb_build_object('order_id', p_order_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '订单已取消，库存已回补', 'fulfillment_status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_cancel_order TO anon, authenticated;

-- ============================================================================
-- 9. 修复 admin_b2b_mark_delivered 使用 delivered_at/delivered_by 字段
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_mark_delivered(
  p_session_token text,
  p_order_id uuid,
  p_delivered_items jsonb DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_order record;
  v_item jsonb;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'mark_delivered' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_order FROM b2b_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  IF v_order.fulfillment_status NOT IN ('shipping', 'ready_to_ship') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 当前状态不允许签收: %', v_order.fulfillment_status;
  END IF;

  IF p_delivered_items IS NOT NULL AND jsonb_array_length(p_delivered_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_delivered_items)
    LOOP
      UPDATE b2b_order_items SET
        delivered_quantity = COALESCE((v_item->>'delivered_quantity')::int, shipped_quantity),
        item_status = 'delivered'
      WHERE id = (v_item->>'item_id')::uuid AND order_id = p_order_id;
    END LOOP;
  ELSE
    UPDATE b2b_order_items SET
      delivered_quantity = shipped_quantity, item_status = 'delivered'
    WHERE order_id = p_order_id AND item_status = 'shipped';
  END IF;

  -- FIX: 使用新增的 delivered_at/delivered_by 字段
  UPDATE b2b_orders SET
    fulfillment_status = 'delivered', status = 'delivered',
    delivered_at = now(), delivered_by = v_admin_id,
    confirmed_at = now(), confirmed_by = v_admin_id,
    admin_note = COALESCE(p_note, admin_note),
    version = version + 1, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, new_value, idempotency_key,
    order_id, actor_id, actor_type, operation, to_state, metadata)
  VALUES ('order', p_order_id, 'mark_delivered', v_admin_id,
          jsonb_build_object('fulfillment_status', 'delivered', 'note', p_note),
          p_idempotency_key,
          p_order_id, v_admin_id, 'admin', 'mark_delivered', 'delivered',
          jsonb_build_object('note', p_note));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('mark_delivered', p_idempotency_key, jsonb_build_object('order_id', p_order_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '订单已签收', 'fulfillment_status', 'delivered');
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_mark_delivered TO anon, authenticated;

-- ============================================================================
-- 10. 回填现有订单数据
-- ============================================================================

UPDATE b2b_orders SET
  receivable_total = CASE WHEN receivable_total = 0 OR receivable_total IS NULL THEN total_amount ELSE receivable_total END,
  balance_due = CASE 
    WHEN payment_status = 'paid' THEN 0
    WHEN paid_total > 0 THEN GREATEST(COALESCE(receivable_total, total_amount) - paid_total, 0)
    ELSE COALESCE(receivable_total, total_amount)
  END,
  cost_status = CASE 
    WHEN cost_status IS NULL OR cost_status = '' THEN 'missing'
    ELSE cost_status
  END,
  version = CASE WHEN version IS NULL OR version = 0 THEN 1 ELSE version END,
  profit_status = CASE 
    WHEN profit_status IS NULL THEN 'cost_missing'
    ELSE profit_status
  END;

-- ============================================================================
-- 11. 修复 inventory_transactions 约束支持 B2B_CANCEL 类型
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check;
  ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check
    CHECK (transaction_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN', 'TRANSFER', 'B2B_SALE', 'B2B_CANCEL', 'B2B_RETURN', 'MANUAL', 'INITIAL'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'inventory_transactions constraint: %', SQLERRM;
END $$;

-- ============================================================================
-- 12. 最终权限授予
-- ============================================================================

GRANT EXECUTE ON FUNCTION b2b_cancel_order_tx TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) TO service_role;
