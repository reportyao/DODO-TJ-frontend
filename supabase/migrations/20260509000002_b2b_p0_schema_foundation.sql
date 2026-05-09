-- ============================================================================
-- B2B P0-1 Schema Foundation: 订单一致性、财务最小闭环与幂等基础
-- 日期: 2026-05-09
--
-- 目标:
--   1. 保留既有 b2b_orders.status/payment_status 字段以兼容当前前后台页面。
--   2. 新增履约状态、财务状态、金额、利润快照、客户快照与请求幂等字段。
--   3. 扩展 b2b_order_items 的结构化商品快照、成本与履约数量字段。
--   4. 新增 B2B 收款流水、订单操作日志和幂等请求表，为 P0-2/P0-3 事务化 checkout 提供基础。
--
-- 设计原则:
--   - 迁移必须可重复执行。
--   - 不破坏旧订单、旧页面和旧 Edge Function 的读取兼容性。
--   - 敏感财务与利润数据默认仅 service_role 可直接访问，后台通过受控 RPC/管理员函数访问。
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. b2b_orders: 订单、履约、财务、利润与幂等基础字段
-- -----------------------------------------------------------------------------
ALTER TABLE public.b2b_orders
  ADD COLUMN IF NOT EXISTS order_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS financial_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'unreconciled',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TJS',
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_total numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS gross_profit_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS profit_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key text,
  ADD COLUMN IF NOT EXISTS checkout_request_hash text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'b2b-checkout',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_by uuid;

UPDATE public.b2b_orders
SET
  fulfillment_status = CASE
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'delivered' THEN 'delivered'
    WHEN status = 'paid' THEN 'delivered'
    WHEN status = 'delivering' THEN 'delivering'
    WHEN status = 'processing' THEN 'preparing'
    ELSE 'pending'
  END,
  financial_status = CASE
    WHEN payment_status = 'paid' THEN 'paid'
    WHEN status = 'cancelled' THEN 'voided'
    ELSE 'unpaid'
  END,
  subtotal_amount = CASE WHEN subtotal_amount = 0 THEN COALESCE(total_amount, 0) ELSE subtotal_amount END,
  paid_total = CASE WHEN payment_status = 'paid' AND paid_total = 0 THEN COALESCE(total_amount, 0) ELSE paid_total END,
  order_version = GREATEST(order_version, 1)
WHERE fulfillment_status = 'pending'
   OR subtotal_amount = 0
   OR (payment_status = 'paid' AND paid_total = 0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_orders_fulfillment_status_check') THEN
    ALTER TABLE public.b2b_orders
      ADD CONSTRAINT b2b_orders_fulfillment_status_check
      CHECK (fulfillment_status IN ('pending', 'confirmed', 'preparing', 'delivering', 'delivered', 'cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_orders_financial_status_check') THEN
    ALTER TABLE public.b2b_orders
      ADD CONSTRAINT b2b_orders_financial_status_check
      CHECK (financial_status IN ('unpaid', 'partially_paid', 'paid', 'refunded', 'voided'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_orders_reconciliation_status_check') THEN
    ALTER TABLE public.b2b_orders
      ADD CONSTRAINT b2b_orders_reconciliation_status_check
      CHECK (reconciliation_status IN ('unreconciled', 'in_progress', 'matched', 'difference', 'locked'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_orders_profit_status_check') THEN
    ALTER TABLE public.b2b_orders
      ADD CONSTRAINT b2b_orders_profit_status_check
      CHECK (profit_status IN ('unknown', 'complete', 'cost_missing', 'not_applicable'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_orders_amounts_non_negative_check') THEN
    ALTER TABLE public.b2b_orders
      ADD CONSTRAINT b2b_orders_amounts_non_negative_check
      CHECK (
        subtotal_amount >= 0
        AND discount_amount >= 0
        AND freight_amount >= 0
        AND total_amount >= 0
        AND paid_total >= 0
      );
  END IF;
END $$;

COMMENT ON COLUMN public.b2b_orders.fulfillment_status IS 'B2B 履约状态，与财务状态解耦：pending/confirmed/preparing/delivering/delivered/cancelled。';
COMMENT ON COLUMN public.b2b_orders.financial_status IS 'B2B 财务状态，由 confirmed 收款流水聚合驱动：unpaid/partially_paid/paid/refunded/voided。';
COMMENT ON COLUMN public.b2b_orders.reconciliation_status IS 'B2B 对账状态，P1 对账中心使用。';
COMMENT ON COLUMN public.b2b_orders.subtotal_amount IS '商品小计金额，折扣和运费之外的商品金额。';
COMMENT ON COLUMN public.b2b_orders.paid_total IS '已确认收款总额，只应由 confirmed 收款流水聚合更新。';
COMMENT ON COLUMN public.b2b_orders.total_cost_amount IS '订单成本快照合计；成本缺失时可为空。';
COMMENT ON COLUMN public.b2b_orders.gross_profit_amount IS '订单毛利快照：total_amount - total_cost_amount，成本缺失时为空。';
COMMENT ON COLUMN public.b2b_orders.customer_snapshot IS '下单时客户/批发商资料快照，避免资料变更影响历史订单。';
COMMENT ON COLUMN public.b2b_orders.checkout_idempotency_key IS 'checkout 请求幂等键，用于防重复下单。';
COMMENT ON COLUMN public.b2b_orders.checkout_request_hash IS 'checkout 请求参数哈希，用于识别同幂等键不同请求。';

CREATE INDEX IF NOT EXISTS idx_b2b_orders_fulfillment_created_at
  ON public.b2b_orders (fulfillment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_financial_created_at
  ON public.b2b_orders (financial_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_reconciliation_created_at
  ON public.b2b_orders (reconciliation_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_orders_checkout_idempotency_key
  ON public.b2b_orders (checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. b2b_order_items: 结构化商品快照、成本快照与履约数量
-- -----------------------------------------------------------------------------
ALTER TABLE public.b2b_order_items
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS product_name_i18n jsonb,
  ADD COLUMN IF NOT EXISTS product_image_url text,
  ADD COLUMN IF NOT EXISTS product_sku text,
  ADD COLUMN IF NOT EXISTS unit_measure text,
  ADD COLUMN IF NOT EXISTS cost_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS line_cost_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS line_profit_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS prepared_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_quantity integer NOT NULL DEFAULT 0;

UPDATE public.b2b_order_items
SET
  product_name = COALESCE(product_name, snapshot_data->>'name'),
  product_name_i18n = COALESCE(product_name_i18n, snapshot_data->'name_i18n'),
  product_image_url = COALESCE(product_image_url, snapshot_data->>'image_url'),
  product_sku = COALESCE(product_sku, snapshot_data->>'sku'),
  unit_measure = COALESCE(unit_measure, snapshot_data->>'unit_measure'),
  prepared_quantity = GREATEST(prepared_quantity, 0),
  delivered_quantity = GREATEST(delivered_quantity, 0),
  cancelled_quantity = GREATEST(cancelled_quantity, 0)
WHERE snapshot_data IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_order_items_quantities_non_negative_check') THEN
    ALTER TABLE public.b2b_order_items
      ADD CONSTRAINT b2b_order_items_quantities_non_negative_check
      CHECK (prepared_quantity >= 0 AND delivered_quantity >= 0 AND cancelled_quantity >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_order_items_amounts_non_negative_check') THEN
    ALTER TABLE public.b2b_order_items
      ADD CONSTRAINT b2b_order_items_amounts_non_negative_check
      CHECK (
        unit_price >= 0
        AND subtotal >= 0
        AND (cost_price IS NULL OR cost_price >= 0)
        AND (line_cost_amount IS NULL OR line_cost_amount >= 0)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.b2b_order_items.product_name IS '下单时商品名称快照，优先用于历史订单展示。';
COMMENT ON COLUMN public.b2b_order_items.product_name_i18n IS '下单时商品多语言名称快照。';
COMMENT ON COLUMN public.b2b_order_items.cost_price IS '下单时成本单价快照，仅后台/财务使用。';
COMMENT ON COLUMN public.b2b_order_items.line_cost_amount IS '下单时行成本合计。';
COMMENT ON COLUMN public.b2b_order_items.line_profit_amount IS '下单时行毛利快照；成本缺失时为空。';

CREATE INDEX IF NOT EXISTS idx_b2b_order_items_product_id
  ON public.b2b_order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_b2b_order_items_product_sku
  ON public.b2b_order_items (product_sku)
  WHERE product_sku IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. B2B 收款流水：P0 财务最小闭环基础
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_payment_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.b2b_orders(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'TJS',
  payment_method text NOT NULL DEFAULT 'cod',
  status text NOT NULL DEFAULT 'registered',
  paid_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  created_by uuid,
  confirmed_by uuid,
  rejected_by uuid,
  external_reference text,
  proof_url text,
  note text,
  idempotency_key text,
  request_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_payment_records_status_check') THEN
    ALTER TABLE public.b2b_payment_records
      ADD CONSTRAINT b2b_payment_records_status_check
      CHECK (status IN ('registered', 'confirmed', 'rejected', 'voided'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_payment_records_method_check') THEN
    ALTER TABLE public.b2b_payment_records
      ADD CONSTRAINT b2b_payment_records_method_check
      CHECK (payment_method IN ('cod', 'cash', 'bank_transfer', 'card', 'wallet', 'other'));
  END IF;
END $$;

COMMENT ON TABLE public.b2b_payment_records IS 'B2B 收款流水表。订单已收金额必须由 confirmed 流水聚合，送达不等于已付款。';
COMMENT ON COLUMN public.b2b_payment_records.status IS '收款流水状态：registered=已登记待确认，confirmed=已确认，rejected=已驳回，voided=已作废。';

CREATE INDEX IF NOT EXISTS idx_b2b_payment_records_order_created_at
  ON public.b2b_payment_records (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_payment_records_status_created_at
  ON public.b2b_payment_records (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_payment_records_idempotency_key
  ON public.b2b_payment_records (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. B2B 操作日志：订单、库存、财务关键动作审计
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_order_operation_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid REFERENCES public.b2b_orders(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'system',
  operation text NOT NULL,
  from_state text,
  to_state text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_order_operation_logs_actor_type_check') THEN
    ALTER TABLE public.b2b_order_operation_logs
      ADD CONSTRAINT b2b_order_operation_logs_actor_type_check
      CHECK (actor_type IN ('customer', 'admin', 'system', 'service'));
  END IF;
END $$;

COMMENT ON TABLE public.b2b_order_operation_logs IS 'B2B 订单操作审计日志，记录 checkout、库存、状态、收款等关键动作。';

CREATE INDEX IF NOT EXISTS idx_b2b_order_operation_logs_order_created_at
  ON public.b2b_order_operation_logs (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_order_operation_logs_operation_created_at
  ON public.b2b_order_operation_logs (operation, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. B2B 幂等请求表：checkout 和后续财务/后台 RPC 统一使用
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  user_id uuid,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  response_json jsonb,
  error_code text,
  locked_until timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, idempotency_key)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_idempotency_keys_status_check') THEN
    ALTER TABLE public.b2b_idempotency_keys
      ADD CONSTRAINT b2b_idempotency_keys_status_check
      CHECK (status IN ('processing', 'succeeded', 'failed'));
  END IF;
END $$;

COMMENT ON TABLE public.b2b_idempotency_keys IS 'B2B 幂等请求记录表。同一 scope + idempotency_key 只能对应同一 request_hash。';

CREATE INDEX IF NOT EXISTS idx_b2b_idempotency_keys_user_scope_created_at
  ON public.b2b_idempotency_keys (user_id, scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_idempotency_keys_expires_at
  ON public.b2b_idempotency_keys (expires_at);

-- -----------------------------------------------------------------------------
-- 6. updated_at 触发器
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_b2b_p0_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_b2b_payment_records_updated_at ON public.b2b_payment_records;
CREATE TRIGGER trg_b2b_payment_records_updated_at
  BEFORE UPDATE ON public.b2b_payment_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_b2b_p0_updated_at();

DROP TRIGGER IF EXISTS trg_b2b_idempotency_keys_updated_at ON public.b2b_idempotency_keys;
CREATE TRIGGER trg_b2b_idempotency_keys_updated_at
  BEFORE UPDATE ON public.b2b_idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION public.touch_b2b_p0_updated_at();

-- -----------------------------------------------------------------------------
-- 7. RLS 与授权：敏感表默认仅 service_role 直接访问
-- -----------------------------------------------------------------------------
ALTER TABLE public.b2b_payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_order_operation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage b2b payment records" ON public.b2b_payment_records;
CREATE POLICY "Service role can manage b2b payment records"
  ON public.b2b_payment_records FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
  WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage b2b operation logs" ON public.b2b_order_operation_logs;
CREATE POLICY "Service role can manage b2b operation logs"
  ON public.b2b_order_operation_logs FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
  WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage b2b idempotency keys" ON public.b2b_idempotency_keys;
CREATE POLICY "Service role can manage b2b idempotency keys"
  ON public.b2b_idempotency_keys FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
  WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

GRANT ALL ON public.b2b_payment_records TO service_role;
GRANT ALL ON public.b2b_order_operation_logs TO service_role;
GRANT ALL ON public.b2b_idempotency_keys TO service_role;

-- -----------------------------------------------------------------------------
-- 8. 管理后台通用 RPC 白名单补充：仅用于后台受控管理视图，不开放给普通 authenticated 直连访问
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_signature regprocedure;
BEGIN
  v_signature := to_regprocedure('public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)');
  IF v_signature IS NOT NULL THEN
    v_def := pg_get_functiondef(v_signature);
    IF position('b2b_payment_records' IN v_def) = 0 AND position('b2b_order_items' IN v_def) > 0 THEN
      v_def := replace(v_def,
        '''b2b_order_items''',
        '''b2b_order_items'',
    ''b2b_payment_records'',
    ''b2b_order_operation_logs'',
    ''b2b_idempotency_keys'''
      );
      EXECUTE v_def;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  v_def text;
  v_signature regprocedure;
BEGIN
  v_signature := to_regprocedure('public.admin_count(text,text,jsonb,text)');
  IF v_signature IS NOT NULL THEN
    v_def := pg_get_functiondef(v_signature);
    IF position('b2b_payment_records' IN v_def) = 0 AND position('b2b_order_items' IN v_def) > 0 THEN
      v_def := replace(v_def,
        '''b2b_order_items''',
        '''b2b_order_items'',
    ''b2b_payment_records'',
    ''b2b_order_operation_logs'',
    ''b2b_idempotency_keys'''
      );
      EXECUTE v_def;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  v_def text;
  v_signature regprocedure;
BEGIN
  v_signature := to_regprocedure('public.admin_mutate(text,text,text,jsonb,jsonb,text,text)');
  IF v_signature IS NOT NULL THEN
    v_def := pg_get_functiondef(v_signature);
    IF position('b2b_payment_records' IN v_def) = 0 AND position('b2b_order_items' IN v_def) > 0 THEN
      v_def := replace(v_def,
        '''b2b_order_items''',
        '''b2b_order_items'',
    ''b2b_payment_records'',
    ''b2b_order_operation_logs'',
    ''b2b_idempotency_keys'''
      );
      EXECUTE v_def;
    END IF;
  END IF;
END $$;
