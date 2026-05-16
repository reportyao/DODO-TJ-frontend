-- ============================================================================
-- B2B 满额赠送商品（Gift With Purchase）
-- ============================================================================
-- 功能：后台配置满额赠送规则和赠品池；购物车返回促销状态；下单RPC服务端校验赠品资格、库存并写入0元赠品订单行。

CREATE TABLE IF NOT EXISTS public.b2b_gift_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  threshold_amount numeric(12,2) NOT NULL CHECK (threshold_amount > 0),
  max_gift_items integer NOT NULL DEFAULT 1 CHECK (max_gift_items >= 1),
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b2b_gift_rules_time_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS public.b2b_gift_rule_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.b2b_gift_rules(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  gift_quantity integer NOT NULL DEFAULT 1 CHECK (gift_quantity >= 1),
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_b2b_gift_rules_active_threshold ON public.b2b_gift_rules(is_active, threshold_amount DESC, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_b2b_gift_rule_products_rule ON public.b2b_gift_rule_products(rule_id, is_active, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_b2b_gift_rule_products_product ON public.b2b_gift_rule_products(product_id);

ALTER TABLE public.b2b_orders ADD COLUMN IF NOT EXISTS gift_rule_id uuid REFERENCES public.b2b_gift_rules(id) ON DELETE SET NULL;
ALTER TABLE public.b2b_orders ADD COLUMN IF NOT EXISTS gift_product_id uuid REFERENCES public.inventory_products(id) ON DELETE SET NULL;
ALTER TABLE public.b2b_orders ADD COLUMN IF NOT EXISTS gift_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.b2b_order_items ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false;
ALTER TABLE public.b2b_order_items ADD COLUMN IF NOT EXISTS gift_rule_id uuid REFERENCES public.b2b_gift_rules(id) ON DELETE SET NULL;

COMMENT ON TABLE public.b2b_gift_rules IS 'B2B满额赠送规则：按购物车商品实付小计判断是否可领取赠品。';
COMMENT ON TABLE public.b2b_gift_rule_products IS 'B2B满额赠送规则的赠品池。';
COMMENT ON COLUMN public.b2b_order_items.is_gift IS '是否为满额赠送产生的0元赠品订单行。';

-- 管理端安全RPC白名单增量补丁
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)'::regprocedure) INTO v_def;
  IF v_def IS NOT NULL AND v_def NOT LIKE '%b2b_gift_rules%' THEN
    IF v_def LIKE '%''b2b_order_items''%' THEN
      v_def := replace(v_def, '''b2b_order_items''', '''b2b_order_items'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSIF v_def LIKE '%''b2b_orders''%' THEN
      v_def := replace(v_def, '''b2b_orders''', '''b2b_orders'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSIF v_def LIKE '%''inventory_products''%' THEN
      v_def := replace(v_def, '''inventory_products''', '''inventory_products'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSE
      RAISE EXCEPTION 'admin_query whitelist anchor not found';
    END IF;
    EXECUTE v_def;
  END IF;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'admin_query signature not found, skip GWP whitelist patch';
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.admin_count(text,text,jsonb,text)'::regprocedure) INTO v_def;
  IF v_def IS NOT NULL AND v_def NOT LIKE '%b2b_gift_rules%' THEN
    IF v_def LIKE '%''b2b_order_items''%' THEN
      v_def := replace(v_def, '''b2b_order_items''', '''b2b_order_items'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSIF v_def LIKE '%''b2b_orders''%' THEN
      v_def := replace(v_def, '''b2b_orders''', '''b2b_orders'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSIF v_def LIKE '%''inventory_products''%' THEN
      v_def := replace(v_def, '''inventory_products''', '''inventory_products'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSE
      RAISE EXCEPTION 'admin_count whitelist anchor not found';
    END IF;
    EXECUTE v_def;
  END IF;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'admin_count signature not found, skip GWP whitelist patch';
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  -- 当前管理端写入RPC在 20260406_fix_admin_mutate_array_upsert.sql 中为7参数版本。
  SELECT pg_get_functiondef('public.admin_mutate(text,text,text,jsonb,jsonb,text,text)'::regprocedure) INTO v_def;
  IF v_def IS NOT NULL AND v_def NOT LIKE '%b2b_gift_rules%' THEN
    IF v_def LIKE '%''b2b_order_items''%' THEN
      v_def := replace(v_def, '''b2b_order_items''', '''b2b_order_items'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSIF v_def LIKE '%''b2b_orders''%' THEN
      v_def := replace(v_def, '''b2b_orders''', '''b2b_orders'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSIF v_def LIKE '%''inventory_products''%' THEN
      v_def := replace(v_def, '''inventory_products''', '''inventory_products'', ''b2b_gift_rules'', ''b2b_gift_rule_products''');
    ELSE
      RAISE EXCEPTION 'admin_mutate whitelist anchor not found';
    END IF;
    EXECUTE v_def;
  END IF;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'admin_mutate 7-arg signature not found, skip GWP whitelist patch';
END $$;

DROP FUNCTION IF EXISTS public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.b2b_create_order_from_cart_tx(
  p_user_id uuid,
  p_delivery_address text,
  p_delivery_note text DEFAULT '',
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL,
  p_session_token_hash text DEFAULT NULL,
  p_selected_gift_product_id uuid DEFAULT NULL
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
  v_user_id_text text;
  v_credit_used_before numeric(12,2) := 0;
  v_credit_used_after numeric(12,2) := 0;
  v_payment_terms int := 0;
  v_due_at timestamptz;
  v_uses_credit boolean := false;
  v_gift_rule record;
  v_gift_product record;
  v_gift_quantity integer := 0;
  v_gift_stock_before integer;
  v_gift_stock_after integer;
  v_effective_item_count integer := 0;
  v_effective_total_quantity integer := 0;
BEGIN
  v_user_id_text := p_user_id::text;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_INVALID_USER', 'error', '缺少用户 ID');
  END IF;

  IF NULLIF(btrim(COALESCE(p_delivery_address, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_PARAMS_MISSING', 'error', '配送地址不能为空，请在个人资料中设置或在下单时提供');
  END IF;

  v_effective_note := COALESCE(p_delivery_note, '');
  v_effective_request_hash := COALESCE(NULLIF(p_request_hash, ''), md5(v_user_id_text || '|' || COALESCE(p_delivery_address, '') || '|' || v_effective_note || '|' || COALESCE(p_selected_gift_product_id::text, '')));
  v_has_idempotency := NULLIF(p_idempotency_key, '') IS NOT NULL;

  IF v_has_idempotency THEN
    PERFORM pg_advisory_xact_lock(hashtext('b2b_checkout:' || p_idempotency_key));

    INSERT INTO public.b2b_idempotency_keys(scope, idempotency_key, user_id, request_hash, status, locked_until, expires_at)
    VALUES ('b2b_checkout', p_idempotency_key, p_user_id, v_effective_request_hash, 'processing', now() + interval '5 minutes', now() + interval '24 hours')
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

  SELECT * INTO v_profile
  FROM public.wholesaler_profiles
  WHERE user_id::text = v_user_id_text
  FOR UPDATE;

  IF v_profile IS NULL OR v_profile.status <> 'approved' THEN
    v_response := jsonb_build_object('success', false, 'error_code', 'ERR_WHOLESALER_NOT_APPROVED', 'error', '仅已审核通过的批发商可以提交 B2B 订单');
    IF v_has_idempotency THEN
      UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_WHOLESALER_NOT_APPROVED'
      WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
    END IF;
    RETURN v_response;
  END IF;

  -- 高风险客户拦截 (无论是否走授信都禁止下单)
  IF v_profile.credit_status IN ('on_hold', 'bad_debt', 'disabled') THEN
    v_response := jsonb_build_object('success', false, 'error_code', 'ERR_CREDIT_STATUS_BLOCKED', 'error', '当前授信状态不允许下单: ' || v_profile.credit_status);
    IF v_has_idempotency THEN
      UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_CREDIT_STATUS_BLOCKED'
      WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
    END IF;
    RETURN v_response;
  END IF;

  v_credit_used_before := COALESCE(v_profile.credit_used, 0);
  v_payment_terms := COALESCE(v_profile.payment_terms_days, 0);
  v_due_at := now() + make_interval(days => v_payment_terms);

  -- 仅当 payment_terms_days > 0 时才走授信占用与额度检查
  v_uses_credit := v_payment_terms > 0;

  v_customer_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'user_id', v_user_id_text,
    'wholesaler_profile_id', v_profile.id,
    'wholesaler_status', v_profile.status,
    'company_name', v_profile.company_name,
    'contact_phone', v_profile.contact_phone,
    'tax_id', v_profile.tax_id,
    'business_address', v_profile.business_address,
    'profile_delivery_address', v_profile.delivery_address,
    'checkout_delivery_address', p_delivery_address,
    'credit_limit_snapshot', v_profile.credit_limit,
    'credit_used_before', v_credit_used_before,
    'selected_gift_product_id', p_selected_gift_product_id,
    'gift_rule_id', CASE WHEN v_gift_rule IS NULL THEN NULL ELSE v_gift_rule.id END,
    'payment_terms_days', v_payment_terms,
    'payment_due_at', v_due_at,
    'uses_credit', v_uses_credit
  ));

  FOR v_item IN
    SELECT sc.id AS cart_id, sc.product_id, sc.quantity,
           ip.name, ip.name_i18n, ip.image_url,
           ip.wholesale_price, ip.retail_price, ip.cost_price,
           ip.stock, ip.min_order_quantity, ip.unit_measure, ip.sku, ip.status
    FROM public.shopping_carts sc
    JOIN public.inventory_products ip ON ip.id = sc.product_id
    WHERE sc.user_id = v_user_id_text
    ORDER BY sc.created_at ASC, sc.id ASC
    FOR UPDATE OF sc, ip
  LOOP
    v_item_count := v_item_count + 1;

    IF COALESCE(v_item.status, '') <> 'ACTIVE' THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_PRODUCT_UNAVAILABLE', 'error', '商品不可购买: ' || COALESCE(v_item.name, v_item.product_id::text));
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_PRODUCT_UNAVAILABLE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
      RETURN v_response;
    END IF;
    IF v_item.quantity < COALESCE(v_item.min_order_quantity, 1) THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_MIN_ORDER_QUANTITY', 'error', '商品未达到起订量: ' || COALESCE(v_item.name, v_item.product_id::text));
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_MIN_ORDER_QUANTITY' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
      RETURN v_response;
    END IF;
    IF COALESCE(v_item.stock, 0) < v_item.quantity THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_OUT_OF_STOCK', 'error', '商品库存不足: ' || COALESCE(v_item.name, v_item.product_id::text));
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_OUT_OF_STOCK' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
      RETURN v_response;
    END IF;
    IF COALESCE(v_item.wholesale_price, 0) <= 0 THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_INVALID_PRICE', 'error', '商品批发价无效: ' || COALESCE(v_item.name, v_item.product_id::text));
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_INVALID_PRICE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
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
    IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_CART_EMPTY' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
    RETURN v_response;
  END IF;

  -- 满额赠送：服务端以购物车实时金额重新校验资格与赠品库存，防止前端篡改。
  IF p_selected_gift_product_id IS NOT NULL THEN
    SELECT r.*, rp.gift_quantity
    INTO v_gift_rule
    FROM public.b2b_gift_rules r
    JOIN public.b2b_gift_rule_products rp ON rp.rule_id = r.id
    WHERE r.is_active = true
      AND rp.is_active = true
      AND rp.product_id = p_selected_gift_product_id
      AND r.threshold_amount <= v_total_amount
      AND (r.starts_at IS NULL OR r.starts_at <= now())
      AND (r.ends_at IS NULL OR r.ends_at >= now())
    ORDER BY r.threshold_amount DESC, r.sort_order ASC, r.created_at DESC
    LIMIT 1;

    IF v_gift_rule IS NULL THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_GIFT_NOT_ELIGIBLE', 'error', '当前订单金额未满足所选赠品规则或赠品不可用');
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_GIFT_NOT_ELIGIBLE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
      RETURN v_response;
    END IF;

    SELECT id, name, name_i18n, image_url, wholesale_price, retail_price, cost_price, stock, unit_measure, sku, status
    INTO v_gift_product
    FROM public.inventory_products
    WHERE id = p_selected_gift_product_id
    FOR UPDATE;

    v_gift_quantity := GREATEST(COALESCE(v_gift_rule.gift_quantity, 1), 1);

    IF v_gift_product IS NULL OR COALESCE(v_gift_product.status, '') <> 'ACTIVE' THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_GIFT_UNAVAILABLE', 'error', '所选赠品已下架或不存在');
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_GIFT_UNAVAILABLE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
      RETURN v_response;
    END IF;

    IF COALESCE(v_gift_product.stock, 0) < v_gift_quantity THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_GIFT_OUT_OF_STOCK', 'error', '所选赠品库存不足，请重新选择');
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_GIFT_OUT_OF_STOCK' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
      RETURN v_response;
    END IF;

    IF v_gift_product.cost_price IS NULL THEN
      v_missing_cost := true;
    ELSE
      v_total_cost_amount := v_total_cost_amount + (v_gift_product.cost_price * v_gift_quantity);
    END IF;
  END IF;

  v_effective_item_count := v_item_count + CASE WHEN p_selected_gift_product_id IS NOT NULL THEN 1 ELSE 0 END;
  v_effective_total_quantity := v_total_quantity + COALESCE(v_gift_quantity, 0);

  -- 仅赊销订单进行授信额度检查
  IF v_uses_credit THEN
    v_credit_used_after := v_credit_used_before + v_total_amount;
    IF COALESCE(v_profile.credit_limit, 0) <= 0 OR v_credit_used_after > COALESCE(v_profile.credit_limit, 0) THEN
      v_response := jsonb_build_object(
        'success', false,
        'error_code', 'ERR_CREDIT_LIMIT_EXCEEDED',
        'error', '授信额度不足，无法提交订单',
        'credit_limit', COALESCE(v_profile.credit_limit, 0),
        'credit_used', v_credit_used_before,
        'order_amount', v_total_amount,
        'credit_available', GREATEST(COALESCE(v_profile.credit_limit, 0) - v_credit_used_before, 0)
      );
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_CREDIT_LIMIT_EXCEEDED'
        WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;
  ELSE
    -- 现款现货模式：不占用授信，credit_used_after 与 before 相同
    v_credit_used_after := v_credit_used_before;
  END IF;

  v_order_number := public.generate_b2b_order_number();

  INSERT INTO public.b2b_orders (
    order_number, user_id, total_amount, subtotal_amount, discount_amount,
    shipping_fee, freight_amount, item_count, total_quantity,
    status, fulfillment_status, payment_method, payment_status, financial_status,
    reconciliation_status, delivery_address, delivery_note,
    customer_snapshot, checkout_idempotency_key, checkout_request_hash, source,
    total_cost_amount, cost_total_snapshot, gross_profit_amount, expected_gross_profit,
    profit_status, cost_status, receivable_total, balance_due, paid_total,
    version, order_version,
    payment_due_at, payment_terms_days, credit_limit_snapshot, credit_used_before, credit_used_after,
    risk_status, collection_status, bad_debt_status
  ) VALUES (
    v_order_number, v_user_id_text, v_total_amount, v_total_amount, 0,
    0, 0, v_effective_item_count, v_effective_total_quantity,
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
    v_total_amount, v_total_amount, 0,
    1, 1,
    v_due_at, v_payment_terms, v_profile.credit_limit, v_credit_used_before, v_credit_used_after,
    'normal', 'none', 'none'
  ) RETURNING id INTO v_order_id;

  FOR v_item IN
    SELECT sc.product_id, sc.quantity,
           ip.name, ip.name_i18n, ip.image_url,
           ip.wholesale_price, ip.retail_price, ip.cost_price,
           ip.stock, ip.min_order_quantity, ip.unit_measure, ip.sku, ip.status
    FROM public.shopping_carts sc
    JOIN public.inventory_products ip ON ip.id = sc.product_id
    WHERE sc.user_id = v_user_id_text
    ORDER BY sc.created_at ASC, sc.id ASC
  LOOP
    UPDATE public.inventory_products
    SET stock = stock - v_item.quantity, updated_at = now()
    WHERE id = v_item.product_id AND stock >= v_item.quantity
    RETURNING stock INTO v_stock_after;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'B2B stock deduction failed for product %', v_item.product_id USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.b2b_order_items (
      order_id, product_id, quantity, unit_price, subtotal, snapshot_data,
      product_name_zh, product_name_original, sku, image_url, unit_measure,
      cost_price_snapshot, wholesale_price_snapshot,
      ordered_quantity, picked_quantity, shipped_quantity, delivered_quantity,
      returned_quantity, shortage_quantity, line_expected_profit, item_status,
      product_name, product_image_url, product_sku,
      cost_price, line_cost_amount, line_profit_amount
    ) VALUES (
      v_order_id, v_item.product_id, v_item.quantity, v_item.wholesale_price,
      v_item.wholesale_price * v_item.quantity,
      jsonb_strip_nulls(jsonb_build_object('id', v_item.product_id, 'name', v_item.name, 'name_i18n', v_item.name_i18n, 'image_url', v_item.image_url, 'sku', v_item.sku, 'unit_measure', v_item.unit_measure, 'wholesale_price', v_item.wholesale_price, 'retail_price', v_item.retail_price)),
      COALESCE(v_item.name, ''), v_item.name, v_item.sku, v_item.image_url,
      COALESCE(v_item.unit_measure, '件'),
      v_item.cost_price, v_item.wholesale_price,
      v_item.quantity, 0, 0, 0, 0, 0,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE (v_item.wholesale_price - v_item.cost_price) * v_item.quantity END,
      'ordered',
      COALESCE(v_item.name, ''), v_item.image_url, v_item.sku,
      v_item.cost_price,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE v_item.cost_price * v_item.quantity END,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE (v_item.wholesale_price - v_item.cost_price) * v_item.quantity END
    );

    INSERT INTO public.inventory_transactions(inventory_product_id, transaction_type, quantity, stock_before, stock_after, related_order_id, notes)
    VALUES (v_item.product_id, 'B2B_SALE', -v_item.quantity, v_item.stock, v_stock_after, v_order_id, 'B2B订单 ' || v_order_number || ' P2授信下单扣减库存');
  END LOOP;

  IF p_selected_gift_product_id IS NOT NULL THEN
    v_gift_stock_before := v_gift_product.stock;

    UPDATE public.inventory_products
    SET stock = stock - v_gift_quantity, updated_at = now()
    WHERE id = p_selected_gift_product_id AND stock >= v_gift_quantity
    RETURNING stock INTO v_gift_stock_after;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'B2B gift stock deduction failed for product %', p_selected_gift_product_id USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.b2b_order_items (
      order_id, product_id, quantity, unit_price, subtotal, snapshot_data,
      product_name_zh, product_name_original, sku, image_url, unit_measure,
      cost_price_snapshot, wholesale_price_snapshot,
      ordered_quantity, picked_quantity, shipped_quantity, delivered_quantity,
      returned_quantity, shortage_quantity, line_expected_profit, item_status,
      product_name, product_image_url, product_sku,
      cost_price, line_cost_amount, line_profit_amount,
      is_gift, gift_rule_id
    ) VALUES (
      v_order_id, p_selected_gift_product_id, v_gift_quantity, 0, 0,
      jsonb_strip_nulls(jsonb_build_object(
        'id', p_selected_gift_product_id,
        'name', v_gift_product.name,
        'name_i18n', v_gift_product.name_i18n,
        'image_url', v_gift_product.image_url,
        'sku', v_gift_product.sku,
        'unit_measure', v_gift_product.unit_measure,
        'is_gift', true,
        'gift_rule_id', v_gift_rule.id,
        'gift_rule_name', v_gift_rule.name,
        'threshold_amount', v_gift_rule.threshold_amount
      )),
      COALESCE(v_gift_product.name, ''), v_gift_product.name, v_gift_product.sku, v_gift_product.image_url,
      COALESCE(v_gift_product.unit_measure, '件'),
      v_gift_product.cost_price, 0,
      v_gift_quantity, 0, 0, 0, 0, 0,
      CASE WHEN v_gift_product.cost_price IS NULL THEN NULL ELSE -v_gift_product.cost_price * v_gift_quantity END,
      'ordered',
      COALESCE(v_gift_product.name, ''), v_gift_product.image_url, v_gift_product.sku,
      v_gift_product.cost_price,
      CASE WHEN v_gift_product.cost_price IS NULL THEN NULL ELSE v_gift_product.cost_price * v_gift_quantity END,
      CASE WHEN v_gift_product.cost_price IS NULL THEN NULL ELSE -v_gift_product.cost_price * v_gift_quantity END,
      true, v_gift_rule.id
    );

    INSERT INTO public.inventory_transactions(inventory_product_id, transaction_type, quantity, stock_before, stock_after, related_order_id, notes)
    VALUES (p_selected_gift_product_id, 'B2B_GIFT', -v_gift_quantity, v_gift_stock_before, v_gift_stock_after, v_order_id, 'B2B订单 ' || v_order_number || ' 满额赠送扣减库存');

    UPDATE public.b2b_orders
    SET gift_rule_id = v_gift_rule.id,
        gift_product_id = p_selected_gift_product_id,
        gift_quantity = v_gift_quantity,
        updated_at = now()
    WHERE id = v_order_id;
  END IF;

  DELETE FROM public.shopping_carts WHERE user_id = v_user_id_text;

  -- 仅赊销订单更新 credit_used 并写入授信占用事件
  IF v_uses_credit THEN
    UPDATE public.wholesaler_profiles
    SET credit_used = v_credit_used_after, updated_at = now()
    WHERE id = v_profile.id;

    INSERT INTO public.b2b_credit_events(
      wholesaler_id, order_id, event_type, amount,
      credit_limit_before, credit_limit_after,
      credit_used_before, credit_used_after,
      payment_terms_after, note, metadata
    ) VALUES (
      v_profile.id, v_order_id, 'order_credit_hold', v_total_amount,
      v_profile.credit_limit, v_profile.credit_limit,
      v_credit_used_before, v_credit_used_after,
      v_payment_terms, '订单创建占用授信额度', jsonb_build_object('order_number', v_order_number, 'payment_due_at', v_due_at)
    );
  END IF;

  INSERT INTO public.b2b_order_operation_logs(entity_type, entity_id, action, user_id, new_value, order_id, actor_id, actor_type, operation, to_state, metadata)
  VALUES (
    'order', v_order_id, 'checkout_create_order', p_user_id,
    jsonb_strip_nulls(jsonb_build_object('order_number', v_order_number, 'total_amount', v_total_amount, 'total_quantity', v_effective_total_quantity, 'item_count', v_effective_item_count)),
    v_order_id, p_user_id, 'customer', 'checkout_create_order', 'pending',
    jsonb_strip_nulls(jsonb_build_object('order_number', v_order_number, 'total_amount', v_total_amount, 'total_quantity', v_effective_total_quantity, 'item_count', v_effective_item_count, 'selected_gift_product_id', p_selected_gift_product_id, 'gift_rule_id', CASE WHEN v_gift_rule IS NULL THEN NULL ELSE v_gift_rule.id END, 'idempotency_key', CASE WHEN v_has_idempotency THEN p_idempotency_key ELSE NULL END, 'request_hash', v_effective_request_hash, 'session_token_hash', p_session_token_hash, 'credit_limit_snapshot', v_profile.credit_limit, 'credit_used_before', v_credit_used_before, 'credit_used_after', v_credit_used_after, 'payment_due_at', v_due_at, 'uses_credit', v_uses_credit))
  );

  v_response := jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id, 'order_number', v_order_number,
      'total_amount', v_total_amount, 'subtotal_amount', v_total_amount,
      'paid_total', 0, 'balance_due', v_total_amount,
      'item_count', v_effective_item_count, 'total_quantity', v_effective_total_quantity,
      'status', 'pending', 'fulfillment_status', 'pending',
      'payment_status', 'pending', 'financial_status', 'unpaid',
      'delivery_address', p_delivery_address,
      'payment_due_at', v_due_at,
      'payment_terms_days', v_payment_terms,
      'uses_credit', v_uses_credit,
      'credit_used_after', v_credit_used_after,
      'credit_available', GREATEST(COALESCE(v_profile.credit_limit, 0) - v_credit_used_after, 0),
      'profit_status', CASE WHEN v_missing_cost THEN 'cost_missing' ELSE 'complete' END,
      'gift', CASE WHEN p_selected_gift_product_id IS NULL THEN NULL ELSE jsonb_build_object('rule_id', v_gift_rule.id, 'rule_name', v_gift_rule.name, 'product_id', p_selected_gift_product_id, 'quantity', v_gift_quantity) END
    ),
    'message', CASE WHEN v_uses_credit THEN '订单创建成功，授信额度已占用，等待配送' ELSE '订单创建成功，等待配送收款' END
  );

  IF v_has_idempotency THEN
    UPDATE public.b2b_idempotency_keys
    SET status = 'succeeded', response_json = v_response, error_code = NULL, locked_until = NULL
    WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_response;
END;
$$;



COMMENT ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text, uuid) IS
'B2B 事务化下单 RPC（含满额赠送校验版）。当传入 selected_gift_product_id 时，服务端按实时购物车金额、规则状态和库存重新校验，并写入0元赠品订单行。';

GRANT EXECUTE ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text, uuid) TO anon, authenticated;
