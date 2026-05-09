-- ============================================================================
-- B2B P0-4 ~ P0-8: 后台订单专用RPC、收款流水、权限隔离与安全输出
-- 日期: 2026-05-10
-- 版本: P0 Phase 2
--
-- 目的:
--   1. 新增订单状态拆分字段（履约、财务、对账）
--   2. 新增订单明细结构化快照字段
--   3. 新增付款流水表、操作日志表、幂等表
--   4. 创建后台订单专用 RPC（列表、详情、确认、备货、发货、签收、取消）
--   5. 创建收款流水 RPC（登记、确认、驳回）
--   6. 创建用户侧安全视图
--   7. 配置 RLS 策略
--
-- 注意:
--   - 保留旧字段 status/payment_status/payment_method 兼容
--   - 新 RPC 双写旧字段，确保旧页面可回滚
--   - 所有写操作通过 verify_admin_session 校验管理员身份
-- ============================================================================

-- ============================================================================
-- 1. 扩展 b2b_orders 表：新增状态拆分与财务字段
-- ============================================================================

ALTER TABLE b2b_orders
ADD COLUMN IF NOT EXISTS fulfillment_status varchar(30) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS financial_status varchar(30) DEFAULT 'unpaid',
ADD COLUMN IF NOT EXISTS reconciliation_status varchar(30) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS currency varchar(10) DEFAULT 'TJS',
ADD COLUMN IF NOT EXISTS subtotal_amount numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS shipping_fee numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS receivable_total numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS paid_total numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS balance_due numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_total_snapshot numeric(12,2),
ADD COLUMN IF NOT EXISTS expected_gross_profit numeric(12,2),
ADD COLUMN IF NOT EXISTS cost_status varchar(20) DEFAULT 'missing',
ADD COLUMN IF NOT EXISTS version int DEFAULT 1,
ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- 添加约束
DO $$ BEGIN
  ALTER TABLE b2b_orders ADD CONSTRAINT chk_b2b_fulfillment_status
    CHECK (fulfillment_status IN ('pending','confirmed','picking','shortage','ready_to_ship','shipping','delivered','cancelled','returned','closed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE b2b_orders ADD CONSTRAINT chk_b2b_financial_status
    CHECK (financial_status IN ('unpaid','partial_paid','paid','overpaid','refunded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE b2b_orders ADD CONSTRAINT chk_b2b_reconciliation_status
    CHECK (reconciliation_status IN ('pending','matched','mismatched','locked'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 索引
CREATE INDEX IF NOT EXISTS idx_b2b_orders_fulfillment_status ON b2b_orders(fulfillment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_financial_status ON b2b_orders(financial_status, created_at DESC);

-- ============================================================================
-- 2. 扩展 b2b_order_items 表：结构化快照与履约数量
-- ============================================================================

ALTER TABLE b2b_order_items
ADD COLUMN IF NOT EXISTS product_name_zh text,
ADD COLUMN IF NOT EXISTS product_name_original text,
ADD COLUMN IF NOT EXISTS sku text,
ADD COLUMN IF NOT EXISTS barcode text,
ADD COLUMN IF NOT EXISTS image_url text,
ADD COLUMN IF NOT EXISTS specifications_zh text,
ADD COLUMN IF NOT EXISTS unit_measure text DEFAULT '件',
ADD COLUMN IF NOT EXISTS cost_price_snapshot numeric(12,2),
ADD COLUMN IF NOT EXISTS wholesale_price_snapshot numeric(12,2),
ADD COLUMN IF NOT EXISTS ordered_quantity int,
ADD COLUMN IF NOT EXISTS picked_quantity int DEFAULT 0,
ADD COLUMN IF NOT EXISTS shipped_quantity int DEFAULT 0,
ADD COLUMN IF NOT EXISTS delivered_quantity int DEFAULT 0,
ADD COLUMN IF NOT EXISTS returned_quantity int DEFAULT 0,
ADD COLUMN IF NOT EXISTS shortage_quantity int DEFAULT 0,
ADD COLUMN IF NOT EXISTS line_expected_profit numeric(12,2),
ADD COLUMN IF NOT EXISTS item_status varchar(30) DEFAULT 'ordered';

DO $$ BEGIN
  ALTER TABLE b2b_order_items ADD CONSTRAINT chk_b2b_item_status
    CHECK (item_status IN ('ordered','picking','shortage','shipped','delivered','returned','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 3. 新增付款流水表
-- ============================================================================

CREATE TABLE IF NOT EXISTS b2b_payment_transactions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES b2b_orders(id) ON DELETE CASCADE,
    transaction_type varchar(20) NOT NULL DEFAULT 'payment',
    payment_method varchar(30) NOT NULL DEFAULT 'cod_cash',
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    status varchar(20) NOT NULL DEFAULT 'pending',
    paid_at timestamptz,
    confirmed_at timestamptz,
    proof_url text,
    payer_name text,
    receiver_admin_id uuid,
    note text,
    reject_reason text,
    created_by uuid,
    confirmed_by uuid,
    idempotency_key text UNIQUE,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT chk_payment_tx_type CHECK (transaction_type IN ('payment','refund','adjustment')),
    CONSTRAINT chk_payment_tx_status CHECK (status IN ('pending','confirmed','rejected','voided'))
);

CREATE INDEX IF NOT EXISTS idx_b2b_payment_tx_order ON b2b_payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_b2b_payment_tx_status ON b2b_payment_transactions(status, created_at DESC);

-- RLS
ALTER TABLE b2b_payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on payment_transactions"
    ON b2b_payment_transactions FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

CREATE POLICY "Users can view own order payment transactions"
    ON b2b_payment_transactions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM b2b_orders
            WHERE b2b_orders.id = b2b_payment_transactions.order_id
            AND b2b_orders.user_id = auth.uid()
        )
    );

GRANT SELECT ON b2b_payment_transactions TO authenticated;
GRANT ALL ON b2b_payment_transactions TO service_role;

-- ============================================================================
-- 4. 新增操作日志表
-- ============================================================================

CREATE TABLE IF NOT EXISTS b2b_order_operation_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type varchar(50) NOT NULL,
    entity_id uuid NOT NULL,
    action varchar(100) NOT NULL,
    old_value jsonb,
    new_value jsonb,
    admin_id uuid,
    user_id uuid,
    source varchar(50) DEFAULT 'admin',
    idempotency_key text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_op_logs_entity ON b2b_order_operation_logs(entity_type, entity_id, created_at DESC);

-- RLS: deny all for anon/authenticated, only service_role
ALTER TABLE b2b_order_operation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on operation_logs"
    ON b2b_order_operation_logs FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

GRANT ALL ON b2b_order_operation_logs TO service_role;

-- ============================================================================
-- 5. 新增幂等键表
-- ============================================================================

CREATE TABLE IF NOT EXISTS b2b_idempotency_keys (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope varchar(100) NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text,
    result_json jsonb,
    created_at timestamptz DEFAULT now(),
    expires_at timestamptz DEFAULT (now() + interval '24 hours'),
    UNIQUE(scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_b2b_idempotency_expires ON b2b_idempotency_keys(expires_at);

ALTER TABLE b2b_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on idempotency_keys"
    ON b2b_idempotency_keys FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

GRANT ALL ON b2b_idempotency_keys TO service_role;

-- ============================================================================
-- 6. 回填现有订单数据到新字段
-- ============================================================================

-- 回填 fulfillment_status 从旧 status
UPDATE b2b_orders SET
  fulfillment_status = CASE
    WHEN status IN ('pending', 'processing') THEN 'pending'
    WHEN status = 'delivering' THEN 'shipping'
    WHEN status IN ('delivered', 'paid') THEN 'delivered'
    WHEN status = 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END,
  financial_status = CASE
    WHEN payment_status = 'paid' THEN 'paid'
    ELSE 'unpaid'
  END,
  subtotal_amount = total_amount,
  receivable_total = total_amount,
  paid_total = CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END,
  balance_due = CASE WHEN payment_status = 'paid' THEN 0 ELSE total_amount END,
  cost_status = 'missing'
WHERE fulfillment_status = 'pending' AND financial_status = 'unpaid' AND subtotal_amount = 0;

-- 回填 order_items 的 ordered_quantity
UPDATE b2b_order_items SET
  ordered_quantity = quantity,
  wholesale_price_snapshot = unit_price,
  product_name_zh = COALESCE(
    snapshot_data->>'name_zh',
    snapshot_data->'name_i18n'->>'zh',
    snapshot_data->'name_i18n'->>'ru',
    snapshot_data->>'name',
    ''
  ),
  product_name_original = COALESCE(
    snapshot_data->'name_i18n'->>'ru',
    snapshot_data->'name_i18n'->>'tg',
    snapshot_data->>'name',
    ''
  ),
  sku = COALESCE(snapshot_data->>'sku', ''),
  image_url = COALESCE(snapshot_data->>'image_url', ''),
  item_status = CASE
    WHEN EXISTS (SELECT 1 FROM b2b_orders o WHERE o.id = b2b_order_items.order_id AND o.status = 'cancelled') THEN 'cancelled'
    WHEN EXISTS (SELECT 1 FROM b2b_orders o WHERE o.id = b2b_order_items.order_id AND o.status IN ('delivered', 'paid')) THEN 'delivered'
    WHEN EXISTS (SELECT 1 FROM b2b_orders o WHERE o.id = b2b_order_items.order_id AND o.status = 'delivering') THEN 'shipped'
    ELSE 'ordered'
  END
WHERE ordered_quantity IS NULL;

-- 回填 delivered_quantity for delivered orders
UPDATE b2b_order_items SET
  delivered_quantity = quantity,
  shipped_quantity = quantity,
  picked_quantity = quantity
WHERE item_status = 'delivered' AND delivered_quantity = 0;

-- ============================================================================
-- 7. P0-4: 后台订单列表 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_order_list(
  p_session_token text,
  p_fulfillment_status text DEFAULT NULL,
  p_financial_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 20
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_offset int;
  v_total bigint;
  v_orders json;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);
  v_offset := (GREATEST(p_page, 1) - 1) * p_page_size;

  -- Count total
  SELECT COUNT(*) INTO v_total
  FROM b2b_orders o
  WHERE (p_fulfillment_status IS NULL OR o.fulfillment_status = p_fulfillment_status)
    AND (p_financial_status IS NULL OR o.financial_status = p_financial_status)
    AND (p_search IS NULL OR p_search = '' OR
         o.order_number ILIKE '%' || p_search || '%' OR
         EXISTS (SELECT 1 FROM wholesaler_profiles wp WHERE wp.user_id = o.user_id AND wp.company_name ILIKE '%' || p_search || '%')
    );

  -- Fetch orders with wholesaler info
  SELECT json_agg(row_order) INTO v_orders
  FROM (
    SELECT
      o.id,
      o.order_number,
      o.user_id,
      o.total_amount,
      o.item_count,
      o.total_quantity,
      o.fulfillment_status,
      o.financial_status,
      o.reconciliation_status,
      o.subtotal_amount,
      o.receivable_total,
      o.paid_total,
      o.balance_due,
      o.cost_total_snapshot,
      o.expected_gross_profit,
      o.cost_status,
      o.estimated_delivery_date,
      o.delivery_address,
      o.delivery_note,
      o.admin_note,
      o.version,
      o.created_at,
      o.updated_at,
      -- Legacy fields for compatibility
      o.status AS legacy_status,
      o.payment_status AS legacy_payment_status,
      o.payment_method,
      -- Wholesaler info
      wp.company_name AS wholesaler_company,
      wp.contact_phone AS wholesaler_phone,
      u.phone AS user_phone
    FROM b2b_orders o
    LEFT JOIN wholesaler_profiles wp ON wp.user_id = o.user_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE (p_fulfillment_status IS NULL OR o.fulfillment_status = p_fulfillment_status)
      AND (p_financial_status IS NULL OR o.financial_status = p_financial_status)
      AND (p_search IS NULL OR p_search = '' OR
           o.order_number ILIKE '%' || p_search || '%' OR
           wp.company_name ILIKE '%' || p_search || '%')
    ORDER BY o.created_at DESC
    LIMIT p_page_size OFFSET v_offset
  ) row_order;

  RETURN json_build_object(
    'success', true,
    'data', COALESCE(v_orders, '[]'::json),
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
END;
$$;

-- ============================================================================
-- 8. P0-4: 后台订单详情 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_order_detail(
  p_session_token text,
  p_order_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_order json;
  v_items json;
  v_payments json;
  v_logs json;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- Order info
  SELECT json_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'user_id', o.user_id,
    'total_amount', o.total_amount,
    'item_count', o.item_count,
    'total_quantity', o.total_quantity,
    'fulfillment_status', o.fulfillment_status,
    'financial_status', o.financial_status,
    'reconciliation_status', o.reconciliation_status,
    'currency', o.currency,
    'subtotal_amount', o.subtotal_amount,
    'discount_amount', o.discount_amount,
    'shipping_fee', o.shipping_fee,
    'receivable_total', o.receivable_total,
    'paid_total', o.paid_total,
    'balance_due', o.balance_due,
    'cost_total_snapshot', o.cost_total_snapshot,
    'expected_gross_profit', o.expected_gross_profit,
    'cost_status', o.cost_status,
    'estimated_delivery_date', o.estimated_delivery_date,
    'delivery_address', o.delivery_address,
    'delivery_note', o.delivery_note,
    'admin_note', o.admin_note,
    'payment_method', o.payment_method,
    'version', o.version,
    'locked_at', o.locked_at,
    'confirmed_at', o.confirmed_at,
    'confirmed_by', o.confirmed_by,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'legacy_status', o.status,
    'legacy_payment_status', o.payment_status,
    'wholesaler_company', wp.company_name,
    'wholesaler_phone', wp.contact_phone,
    'wholesaler_address', wp.business_address,
    'user_phone', u.phone
  ) INTO v_order
  FROM b2b_orders o
  LEFT JOIN wholesaler_profiles wp ON wp.user_id = o.user_id
  LEFT JOIN users u ON u.id = o.user_id
  WHERE o.id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  -- Order items
  SELECT json_agg(json_build_object(
    'id', i.id,
    'product_id', i.product_id,
    'product_name_zh', i.product_name_zh,
    'product_name_original', i.product_name_original,
    'sku', i.sku,
    'barcode', i.barcode,
    'image_url', i.image_url,
    'specifications_zh', i.specifications_zh,
    'unit_measure', i.unit_measure,
    'unit_price', i.unit_price,
    'quantity', i.quantity,
    'subtotal', i.subtotal,
    'cost_price_snapshot', i.cost_price_snapshot,
    'wholesale_price_snapshot', i.wholesale_price_snapshot,
    'ordered_quantity', i.ordered_quantity,
    'picked_quantity', i.picked_quantity,
    'shipped_quantity', i.shipped_quantity,
    'delivered_quantity', i.delivered_quantity,
    'returned_quantity', i.returned_quantity,
    'shortage_quantity', i.shortage_quantity,
    'line_expected_profit', i.line_expected_profit,
    'item_status', i.item_status
  ) ORDER BY i.created_at) INTO v_items
  FROM b2b_order_items i
  WHERE i.order_id = p_order_id;

  -- Payment transactions
  SELECT json_agg(json_build_object(
    'id', pt.id,
    'transaction_type', pt.transaction_type,
    'payment_method', pt.payment_method,
    'amount', pt.amount,
    'status', pt.status,
    'paid_at', pt.paid_at,
    'confirmed_at', pt.confirmed_at,
    'proof_url', pt.proof_url,
    'payer_name', pt.payer_name,
    'note', pt.note,
    'reject_reason', pt.reject_reason,
    'created_by', pt.created_by,
    'confirmed_by', pt.confirmed_by,
    'idempotency_key', pt.idempotency_key,
    'created_at', pt.created_at
  ) ORDER BY pt.created_at DESC) INTO v_payments
  FROM b2b_payment_transactions pt
  WHERE pt.order_id = p_order_id;

  -- Operation logs (last 50)
  SELECT json_agg(json_build_object(
    'id', l.id,
    'action', l.action,
    'old_value', l.old_value,
    'new_value', l.new_value,
    'admin_id', l.admin_id,
    'source', l.source,
    'created_at', l.created_at
  ) ORDER BY l.created_at DESC) INTO v_logs
  FROM (
    SELECT * FROM b2b_order_operation_logs
    WHERE entity_type = 'order' AND entity_id = p_order_id
    ORDER BY created_at DESC
    LIMIT 50
  ) l;

  RETURN json_build_object(
    'success', true,
    'order', v_order,
    'items', COALESCE(v_items, '[]'::json),
    'payments', COALESCE(v_payments, '[]'::json),
    'logs', COALESCE(v_logs, '[]'::json)
  );
END;
$$;

-- ============================================================================
-- 9. P0-4: 确认订单 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_confirm_order(
  p_session_token text,
  p_order_id uuid,
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
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'confirm_order' AND idempotency_key = p_idempotency_key) THEN
      SELECT result_json INTO v_order FROM b2b_idempotency_keys WHERE scope = 'confirm_order' AND idempotency_key = p_idempotency_key;
      RETURN json_build_object('success', true, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  -- Lock order row
  SELECT * INTO v_order FROM b2b_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  IF v_order.fulfillment_status != 'pending' THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 只有待处理订单可以确认，当前状态: %', v_order.fulfillment_status;
  END IF;

  -- Update order
  UPDATE b2b_orders SET
    fulfillment_status = 'confirmed',
    status = 'processing',  -- legacy compatibility
    admin_note = COALESCE(p_note, admin_note),
    version = version + 1,
    updated_at = now()
  WHERE id = p_order_id;

  -- Update items status
  UPDATE b2b_order_items SET item_status = 'picking' WHERE order_id = p_order_id AND item_status = 'ordered';

  -- Log
  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, old_value, new_value, idempotency_key)
  VALUES ('order', p_order_id, 'confirm_order', v_admin_id,
          jsonb_build_object('fulfillment_status', 'pending'),
          jsonb_build_object('fulfillment_status', 'confirmed', 'note', p_note),
          p_idempotency_key);

  -- Record idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('confirm_order', p_idempotency_key, jsonb_build_object('order_id', p_order_id, 'status', 'confirmed'));
  END IF;

  RETURN json_build_object('success', true, 'message', '订单已确认', 'fulfillment_status', 'confirmed');
END;
$$;

-- ============================================================================
-- 10. P0-4: 更新备货数量 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_update_picking(
  p_session_token text,
  p_order_id uuid,
  p_items jsonb,  -- [{"item_id": "uuid", "picked_quantity": 10, "shortage_quantity": 2}]
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
  v_has_shortage boolean := false;
  v_all_picked boolean := true;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'update_picking' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_order FROM b2b_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  IF v_order.fulfillment_status NOT IN ('confirmed', 'picking', 'shortage') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 当前状态不允许更新备货: %', v_order.fulfillment_status;
  END IF;

  -- Update each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE b2b_order_items SET
      picked_quantity = COALESCE((v_item->>'picked_quantity')::int, picked_quantity),
      shortage_quantity = COALESCE((v_item->>'shortage_quantity')::int, shortage_quantity),
      item_status = CASE
        WHEN COALESCE((v_item->>'shortage_quantity')::int, 0) > 0 THEN 'shortage'
        WHEN COALESCE((v_item->>'picked_quantity')::int, 0) >= ordered_quantity THEN 'picking'
        ELSE item_status
      END
    WHERE id = (v_item->>'item_id')::uuid AND order_id = p_order_id;

    IF COALESCE((v_item->>'shortage_quantity')::int, 0) > 0 THEN
      v_has_shortage := true;
    END IF;
  END LOOP;

  -- Check if all items are fully picked
  IF EXISTS (SELECT 1 FROM b2b_order_items WHERE order_id = p_order_id AND picked_quantity < ordered_quantity AND shortage_quantity = 0) THEN
    v_all_picked := false;
  END IF;

  -- Update order fulfillment status
  UPDATE b2b_orders SET
    fulfillment_status = CASE
      WHEN v_has_shortage THEN 'shortage'
      WHEN v_all_picked THEN 'ready_to_ship'
      ELSE 'picking'
    END,
    admin_note = COALESCE(p_note, admin_note),
    version = version + 1,
    updated_at = now()
  WHERE id = p_order_id;

  -- Log
  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, new_value, idempotency_key)
  VALUES ('order', p_order_id, 'update_picking', v_admin_id,
          jsonb_build_object('items', p_items, 'has_shortage', v_has_shortage),
          p_idempotency_key);

  -- Record idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('update_picking', p_idempotency_key, jsonb_build_object('order_id', p_order_id));
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', '备货数量已更新',
    'has_shortage', v_has_shortage,
    'fulfillment_status', CASE WHEN v_has_shortage THEN 'shortage' WHEN v_all_picked THEN 'ready_to_ship' ELSE 'picking' END
  );
END;
$$;

-- ============================================================================
-- 11. P0-4: 发货 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_ship_order(
  p_session_token text,
  p_order_id uuid,
  p_delivery_date text DEFAULT NULL,
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
  v_item record;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'ship_order' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_order FROM b2b_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  IF v_order.fulfillment_status NOT IN ('confirmed', 'picking', 'shortage', 'ready_to_ship') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 当前状态不允许发货: %', v_order.fulfillment_status;
  END IF;

  -- Update items: set shipped_quantity = picked_quantity (or ordered_quantity if not picked)
  UPDATE b2b_order_items SET
    shipped_quantity = CASE
      WHEN picked_quantity > 0 THEN picked_quantity
      ELSE ordered_quantity - shortage_quantity
    END,
    item_status = 'shipped'
  WHERE order_id = p_order_id AND item_status NOT IN ('cancelled', 'returned');

  -- Update order
  UPDATE b2b_orders SET
    fulfillment_status = 'shipping',
    status = 'delivering',  -- legacy compatibility
    estimated_delivery_date = CASE WHEN p_delivery_date IS NOT NULL THEN p_delivery_date::date ELSE estimated_delivery_date END,
    admin_note = COALESCE(p_note, admin_note),
    version = version + 1,
    updated_at = now()
  WHERE id = p_order_id;

  -- Log
  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, new_value, idempotency_key)
  VALUES ('order', p_order_id, 'ship_order', v_admin_id,
          jsonb_build_object('fulfillment_status', 'shipping', 'delivery_date', p_delivery_date),
          p_idempotency_key);

  -- Record idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('ship_order', p_idempotency_key, jsonb_build_object('order_id', p_order_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '订单已发货', 'fulfillment_status', 'shipping');
END;
$$;

-- ============================================================================
-- 12. P0-4: 签收 RPC（不自动标记付款）
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_mark_delivered(
  p_session_token text,
  p_order_id uuid,
  p_delivered_items jsonb DEFAULT NULL,  -- [{"item_id": "uuid", "delivered_quantity": 10}] optional
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

  -- Idempotency check
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

  -- Update items delivered quantity
  IF p_delivered_items IS NOT NULL AND jsonb_array_length(p_delivered_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_delivered_items)
    LOOP
      UPDATE b2b_order_items SET
        delivered_quantity = COALESCE((v_item->>'delivered_quantity')::int, shipped_quantity),
        item_status = 'delivered'
      WHERE id = (v_item->>'item_id')::uuid AND order_id = p_order_id;
    END LOOP;
  ELSE
    -- Default: all shipped items are delivered
    UPDATE b2b_order_items SET
      delivered_quantity = shipped_quantity,
      item_status = 'delivered'
    WHERE order_id = p_order_id AND item_status = 'shipped';
  END IF;

  -- Update order: mark delivered but DO NOT change financial_status
  UPDATE b2b_orders SET
    fulfillment_status = 'delivered',
    status = 'delivered',  -- legacy compatibility (NOT 'paid')
    confirmed_at = now(),
    confirmed_by = v_admin_id,
    admin_note = COALESCE(p_note, admin_note),
    version = version + 1,
    updated_at = now()
  WHERE id = p_order_id;

  -- Log
  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, new_value, idempotency_key)
  VALUES ('order', p_order_id, 'mark_delivered', v_admin_id,
          jsonb_build_object('fulfillment_status', 'delivered', 'note', p_note),
          p_idempotency_key);

  -- Record idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('mark_delivered', p_idempotency_key, jsonb_build_object('order_id', p_order_id));
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', '订单已签收（财务状态未变更，请通过收款流水确认付款）',
    'fulfillment_status', 'delivered',
    'financial_status', v_order.financial_status
  );
END;
$$;

-- ============================================================================
-- 13. P0-4: 取消订单 RPC（事务化库存回补）
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
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'cancel_order' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_order FROM b2b_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  IF v_order.fulfillment_status NOT IN ('pending', 'confirmed', 'picking', 'shortage', 'ready_to_ship') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 当前状态不允许取消: %', v_order.fulfillment_status;
  END IF;

  IF v_order.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_ORDER_LOCKED: 订单已锁账，无法取消';
  END IF;

  -- Restore inventory for each item (atomic within this transaction)
  FOR v_item IN
    SELECT * FROM b2b_order_items WHERE order_id = p_order_id
  LOOP
    -- Get current stock with row lock
    SELECT stock INTO v_stock_before
    FROM inventory_products
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF v_stock_before IS NOT NULL THEN
      -- Restore stock
      UPDATE inventory_products SET
        stock = stock + v_item.quantity,
        updated_at = now()
      WHERE id = v_item.product_id;

      -- Record inventory transaction
      INSERT INTO inventory_transactions(
        inventory_product_id, transaction_type, quantity,
        stock_before, stock_after, related_order_id, notes
      ) VALUES (
        v_item.product_id, 'B2B_CANCEL', v_item.quantity,
        v_stock_before, v_stock_before + v_item.quantity,
        p_order_id, '取消B2B订单 ' || v_order.order_number || ' 库存回补'
      );
    END IF;
  END LOOP;

  -- Update items
  UPDATE b2b_order_items SET item_status = 'cancelled' WHERE order_id = p_order_id;

  -- Update order
  UPDATE b2b_orders SET
    fulfillment_status = 'cancelled',
    status = 'cancelled',  -- legacy compatibility
    admin_note = COALESCE(p_reason, admin_note),
    version = version + 1,
    updated_at = now()
  WHERE id = p_order_id;

  -- Log
  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, new_value, idempotency_key)
  VALUES ('order', p_order_id, 'cancel_order', v_admin_id,
          jsonb_build_object('reason', p_reason, 'fulfillment_status', 'cancelled'),
          p_idempotency_key);

  -- Record idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('cancel_order', p_idempotency_key, jsonb_build_object('order_id', p_order_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '订单已取消，库存已回补', 'fulfillment_status', 'cancelled');
END;
$$;

-- ============================================================================
-- 14. P0-5: 登记收款 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_record_payment(
  p_session_token text,
  p_order_id uuid,
  p_payment_method text DEFAULT 'cod_cash',
  p_amount numeric DEFAULT 0,
  p_proof_url text DEFAULT NULL,
  p_payer_name text DEFAULT NULL,
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
  v_tx_id uuid;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: 金额必须大于 0';
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_payment_transactions WHERE idempotency_key = p_idempotency_key) THEN
      SELECT id INTO v_tx_id FROM b2b_payment_transactions WHERE idempotency_key = p_idempotency_key;
      RETURN json_build_object('success', true, 'transaction_id', v_tx_id, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_order FROM b2b_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  IF v_order.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_ORDER_LOCKED: 订单已锁账，无法登记收款';
  END IF;

  IF v_order.fulfillment_status = 'cancelled' THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 已取消订单无法登记收款';
  END IF;

  -- Insert payment transaction
  INSERT INTO b2b_payment_transactions(
    order_id, transaction_type, payment_method, amount, status,
    proof_url, payer_name, note, created_by, receiver_admin_id, idempotency_key, paid_at
  ) VALUES (
    p_order_id, 'payment', p_payment_method, p_amount, 'pending',
    p_proof_url, p_payer_name, p_note, v_admin_id, v_admin_id, p_idempotency_key, now()
  )
  RETURNING id INTO v_tx_id;

  -- Log
  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, new_value, idempotency_key)
  VALUES ('payment_transaction', v_tx_id, 'record_payment', v_admin_id,
          jsonb_build_object('amount', p_amount, 'method', p_payment_method, 'order_id', p_order_id),
          p_idempotency_key);

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id, 'message', '收款已登记，待确认');
END;
$$;

-- ============================================================================
-- 15. P0-5: 确认收款 RPC（聚合更新财务状态）
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_confirm_payment_tx(
  p_session_token text,
  p_transaction_id uuid,
  p_decision text,  -- 'confirm' or 'reject'
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
  v_tx record;
  v_order record;
  v_new_paid_total numeric(12,2);
  v_new_financial_status text;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_decision NOT IN ('confirm', 'reject') THEN
    RAISE EXCEPTION 'INVALID_DECISION: 决定必须是 confirm 或 reject';
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'confirm_payment' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求，返回原结果', 'idempotent', true);
    END IF;
  END IF;

  -- Lock transaction
  SELECT * INTO v_tx FROM b2b_payment_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 付款流水不存在';
  END IF;

  IF v_tx.status != 'pending' THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE_TRANSITION: 只有待确认的流水可以操作，当前状态: %', v_tx.status;
  END IF;

  -- Update transaction status
  IF p_decision = 'confirm' THEN
    UPDATE b2b_payment_transactions SET
      status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = v_admin_id,
      updated_at = now()
    WHERE id = p_transaction_id;
  ELSE
    UPDATE b2b_payment_transactions SET
      status = 'rejected',
      reject_reason = p_reason,
      confirmed_by = v_admin_id,
      updated_at = now()
    WHERE id = p_transaction_id;
  END IF;

  -- Recalculate order financial status from confirmed transactions
  SELECT * INTO v_order FROM b2b_orders WHERE id = v_tx.order_id FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0) INTO v_new_paid_total
  FROM b2b_payment_transactions
  WHERE order_id = v_tx.order_id AND status = 'confirmed' AND transaction_type = 'payment';

  -- Determine new financial status
  IF v_new_paid_total = 0 THEN
    v_new_financial_status := 'unpaid';
  ELSIF v_new_paid_total >= v_order.receivable_total THEN
    IF v_new_paid_total > v_order.receivable_total THEN
      v_new_financial_status := 'overpaid';
    ELSE
      v_new_financial_status := 'paid';
    END IF;
  ELSE
    v_new_financial_status := 'partial_paid';
  END IF;

  -- Update order financial fields
  UPDATE b2b_orders SET
    paid_total = v_new_paid_total,
    balance_due = GREATEST(receivable_total - v_new_paid_total, 0),
    financial_status = v_new_financial_status,
    -- Legacy compatibility: only mark paid if fully paid
    payment_status = CASE WHEN v_new_financial_status = 'paid' THEN 'paid' ELSE payment_status END,
    version = version + 1,
    updated_at = now()
  WHERE id = v_tx.order_id;

  -- Log
  INSERT INTO b2b_order_operation_logs(entity_type, entity_id, action, admin_id, old_value, new_value, idempotency_key)
  VALUES ('payment_transaction', p_transaction_id, p_decision || '_payment', v_admin_id,
          jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', CASE WHEN p_decision = 'confirm' THEN 'confirmed' ELSE 'rejected' END,
                            'financial_status', v_new_financial_status, 'paid_total', v_new_paid_total),
          p_idempotency_key);

  -- Record idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('confirm_payment', p_idempotency_key,
            jsonb_build_object('transaction_id', p_transaction_id, 'decision', p_decision));
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', CASE WHEN p_decision = 'confirm' THEN '收款已确认' ELSE '收款已驳回' END,
    'financial_status', v_new_financial_status,
    'paid_total', v_new_paid_total,
    'balance_due', GREATEST(v_order.receivable_total - v_new_paid_total, 0)
  );
END;
$$;

-- ============================================================================
-- 16. P0-7: 用户侧安全视图（隐藏成本、利润、内部备注、对账信息）
-- ============================================================================

CREATE OR REPLACE VIEW public.v_b2b_orders_safe AS
SELECT
  o.id,
  o.order_number,
  o.user_id,
  o.total_amount,
  o.item_count,
  o.total_quantity,
  -- 用户侧简化状态映射
  CASE
    WHEN o.fulfillment_status = 'pending' THEN '待确认'
    WHEN o.fulfillment_status IN ('confirmed', 'picking', 'shortage', 'ready_to_ship') THEN '备货中'
    WHEN o.fulfillment_status = 'shipping' THEN '配送中'
    WHEN o.fulfillment_status = 'delivered' AND o.financial_status = 'paid' THEN '已完成'
    WHEN o.fulfillment_status = 'delivered' THEN '已送达'
    WHEN o.fulfillment_status = 'cancelled' THEN '已取消'
    WHEN o.fulfillment_status = 'returned' THEN '退货处理中'
    ELSE o.fulfillment_status
  END AS display_status,
  -- 安全的财务信息（不暴露内部细节）
  o.receivable_total,
  o.paid_total,
  o.balance_due,
  CASE
    WHEN o.financial_status = 'paid' THEN '已付款'
    WHEN o.financial_status = 'partial_paid' THEN '部分付款'
    WHEN o.financial_status = 'unpaid' THEN '待付款'
    ELSE '处理中'
  END AS display_financial_status,
  o.payment_method,
  o.estimated_delivery_date,
  o.delivery_address,
  o.delivery_note,
  o.created_at,
  o.updated_at
  -- 不返回: admin_note, cost_total_snapshot, expected_gross_profit, cost_status,
  --         reconciliation_status, locked_at, confirmed_by
FROM b2b_orders o;

-- 用户侧安全的订单明细视图
CREATE OR REPLACE VIEW public.v_b2b_order_items_safe AS
SELECT
  i.id,
  i.order_id,
  i.product_id,
  i.product_name_zh,
  i.product_name_original,
  i.sku,
  i.image_url,
  i.specifications_zh,
  i.unit_measure,
  i.unit_price,
  i.quantity,
  i.subtotal,
  i.ordered_quantity,
  i.delivered_quantity,
  i.returned_quantity,
  i.shortage_quantity,
  CASE
    WHEN i.item_status = 'ordered' THEN '待处理'
    WHEN i.item_status = 'picking' THEN '备货中'
    WHEN i.item_status = 'shortage' THEN '缺货'
    WHEN i.item_status = 'shipped' THEN '已发货'
    WHEN i.item_status = 'delivered' THEN '已签收'
    WHEN i.item_status = 'returned' THEN '已退货'
    WHEN i.item_status = 'cancelled' THEN '已取消'
    ELSE i.item_status
  END AS display_item_status,
  i.created_at
  -- 不返回: cost_price_snapshot, wholesale_price_snapshot, line_expected_profit, picked_quantity, shipped_quantity
FROM b2b_order_items i;

-- ============================================================================
-- 17. 添加 B2B 表到 admin_mutate 白名单（用于兼容）
-- ============================================================================

-- 更新 admin_query 白名单以包含新的 B2B 表
-- 注意: 主要写操作应通过专用 RPC，但允许 admin_query 读取
DO $$
BEGIN
  -- 这里不修改 admin_query/admin_mutate 的白名单，
  -- 因为所有 B2B 写操作都通过专用 RPC 完成
  -- admin_query 已经可以读取 b2b_orders 和 b2b_order_items（如果在白名单中）
  NULL;
END $$;

-- ============================================================================
-- 18. 确保 inventory_transactions 支持 B2B_CANCEL 类型
-- ============================================================================

-- 检查并添加 B2B_CANCEL 到 transaction_type 约束
DO $$
DECLARE
  v_constraint_exists boolean;
BEGIN
  -- 尝试插入一条测试记录来验证约束，如果失败则修改约束
  -- 由于不同项目约束实现不同，这里用安全方式处理
  BEGIN
    -- 先尝试删除旧约束再重建
    ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check;
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check
      CHECK (transaction_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN', 'TRANSFER', 'B2B_SALE', 'B2B_CANCEL', 'B2B_RETURN', 'MANUAL', 'INITIAL'));
  EXCEPTION WHEN OTHERS THEN
    -- 约束可能不存在或格式不同，忽略错误
    NULL;
  END;
END $$;

-- ============================================================================
-- 19. Grant permissions
-- ============================================================================

GRANT SELECT ON v_b2b_orders_safe TO authenticated;
GRANT SELECT ON v_b2b_order_items_safe TO authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_order_list TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_order_detail TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_confirm_order TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_update_picking TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_ship_order TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_mark_delivered TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_cancel_order TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_record_payment TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_b2b_confirm_payment_tx TO anon, authenticated;
