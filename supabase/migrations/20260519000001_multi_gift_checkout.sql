-- ============================================================================
-- Support Multi-Gift Checkout (Stacked Mode)
-- ============================================================================

-- 1. Recreate the checkout RPC to support multiple gifts
-- Change p_selected_gift_product_id (uuid) to p_selected_gift_product_ids (uuid[])
DROP FUNCTION IF EXISTS public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.b2b_create_order_from_cart_tx(
  p_user_id uuid,
  p_delivery_address text,
  p_delivery_note text DEFAULT '',
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL,
  p_session_token_hash text DEFAULT NULL,
  p_selected_gift_product_ids uuid[] DEFAULT NULL
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
  
  -- 赠品相关
  v_gift_pid uuid;
  v_gift_rule record;
  v_gift_product record;
  v_gift_quantity integer := 0;
  v_gift_stock_before integer;
  v_gift_stock_after integer;
  v_gift_total_quantity integer := 0;
  v_gift_item_count integer := 0;
  v_gift_details jsonb := '[]'::jsonb;
  
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
  v_effective_request_hash := COALESCE(NULLIF(p_request_hash, ''), md5(v_user_id_text || '|' || COALESCE(p_delivery_address, '') || '|' || v_effective_note || '|' || COALESCE(p_selected_gift_product_ids::text, '')));
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
  v_uses_credit := v_payment_terms > 0;

  -- ========== 遍历购物车计算金额 ==========
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

  -- ========== 满额赠送校验（累计叠加模式） ==========
  IF p_selected_gift_product_ids IS NOT NULL AND array_length(p_selected_gift_product_ids, 1) > 0 THEN
    FOREACH v_gift_pid IN ARRAY p_selected_gift_product_ids
    LOOP
      -- 为每个选择的赠品寻找其所属的最高门槛规则（确保每个赠品都对应一个独立的已达标规则）
      -- 注意：由于是叠加模式，只要该赠品在任意一个已达标规则池中即可。
      SELECT r.*, rp.gift_quantity
      INTO v_gift_rule
      FROM public.b2b_gift_rules r
      JOIN public.b2b_gift_rule_products rp ON rp.rule_id = r.id
      WHERE r.is_active = true
        AND rp.is_active = true
        AND rp.product_id = v_gift_pid
        AND r.threshold_amount <= v_total_amount
        AND (r.starts_at IS NULL OR r.starts_at <= now())
        AND (r.ends_at IS NULL OR r.ends_at >= now())
      ORDER BY r.threshold_amount DESC, r.sort_order ASC, r.created_at DESC
      LIMIT 1;

      IF v_gift_rule IS NULL THEN
        v_response := jsonb_build_object('success', false, 'error_code', 'ERR_GIFT_NOT_ELIGIBLE', 'error', '赠品资格无效或金额未达标: ' || v_gift_pid::text);
        IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_GIFT_NOT_ELIGIBLE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
        RETURN v_response;
      END IF;

      SELECT id, name, name_i18n, image_url, wholesale_price, retail_price, cost_price, stock, unit_measure, sku, status
      INTO v_gift_product
      FROM public.inventory_products
      WHERE id = v_gift_pid
      FOR UPDATE;

      v_gift_quantity := GREATEST(COALESCE(v_gift_rule.gift_quantity, 1), 1);

      IF v_gift_product IS NULL OR COALESCE(v_gift_product.status, '') <> 'ACTIVE' THEN
        v_response := jsonb_build_object('success', false, 'error_code', 'ERR_GIFT_UNAVAILABLE', 'error', '赠品已下架: ' || v_gift_pid::text);
        IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_GIFT_UNAVAILABLE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
        RETURN v_response;
      END IF;

      IF COALESCE(v_gift_product.stock, 0) < v_gift_quantity THEN
        v_response := jsonb_build_object('success', false, 'error_code', 'ERR_GIFT_OUT_OF_STOCK', 'error', '赠品库存不足: ' || COALESCE(v_gift_product.name, v_gift_pid::text));
        IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_GIFT_OUT_OF_STOCK' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
        RETURN v_response;
      END IF;

      -- 记录赠品详情用于快照
      v_gift_details := v_gift_details || jsonb_build_object(
        'product_id', v_gift_pid,
        'rule_id', v_gift_rule.id,
        'rule_name', v_gift_rule.name,
        'quantity', v_gift_quantity,
        'cost_price', v_gift_product.cost_price
      );

      v_gift_total_quantity := v_gift_total_quantity + v_gift_quantity;
      v_gift_item_count := v_gift_item_count + 1;

      IF v_gift_product.cost_price IS NOT NULL THEN
        v_total_cost_amount := v_total_cost_amount + (v_gift_product.cost_price * v_gift_quantity);
      END IF;
    END LOOP;
  END IF;

  v_effective_item_count := v_item_count + v_gift_item_count;
  v_effective_total_quantity := v_total_quantity + v_gift_total_quantity;

  -- ========== 构建客户快照 ==========
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
    'selected_gift_product_ids', p_selected_gift_product_ids,
    'gift_details', v_gift_details,
    'payment_terms_days', v_payment_terms,
    'payment_due_at', v_due_at,
    'uses_credit', v_uses_credit
  ));

  IF v_uses_credit THEN
    v_credit_used_after := v_credit_used_before + v_total_amount;
    IF COALESCE(v_profile.credit_limit, 0) <= 0 OR v_credit_used_after > COALESCE(v_profile.credit_limit, 0) THEN
      v_response := jsonb_build_object('success', false, 'error_code', 'ERR_CREDIT_LIMIT_EXCEEDED', 'error', '授信额度不足');
      IF v_has_idempotency THEN UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_CREDIT_LIMIT_EXCEEDED' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key; END IF;
      RETURN v_response;
    END IF;
  ELSE
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
    v_order_number, p_user_id, v_total_amount, v_total_amount, 0,
    0, 0, v_effective_item_count, v_effective_total_quantity,
    'pending', 'unfulfilled', 'credit', 'unpaid', 'authorized',
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

  -- 写入常规商品
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
      ordered_quantity, item_status, product_name, product_image_url, product_sku,
      cost_price, line_cost_amount, line_profit_amount
    ) VALUES (
      v_order_id, v_item.product_id, v_item.quantity, v_item.wholesale_price,
      v_item.wholesale_price * v_item.quantity,
      jsonb_strip_nulls(jsonb_build_object('id', v_item.product_id, 'name', v_item.name, 'name_i18n', v_item.name_i18n, 'image_url', v_item.image_url, 'sku', v_item.sku, 'unit_measure', v_item.unit_measure, 'wholesale_price', v_item.wholesale_price)),
      COALESCE(v_item.name, ''), v_item.name, v_item.sku, v_item.image_url,
      COALESCE(v_item.unit_measure, '件'),
      v_item.cost_price, v_item.wholesale_price,
      v_item.quantity, 'ordered', COALESCE(v_item.name, ''), v_item.image_url, v_item.sku,
      v_item.cost_price,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE v_item.cost_price * v_item.quantity END,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE (v_item.wholesale_price - v_item.cost_price) * v_item.quantity END
    );

    INSERT INTO public.inventory_transactions(inventory_product_id, transaction_type, quantity, stock_before, stock_after, related_order_id, notes)
    VALUES (v_item.product_id, 'B2B_SALE', -v_item.quantity, v_item.stock, v_stock_after, v_order_id, 'B2B订单 ' || v_order_number);
  END LOOP;

  -- 写入赠品
  IF p_selected_gift_product_ids IS NOT NULL AND array_length(p_selected_gift_product_ids, 1) > 0 THEN
    FOREACH v_gift_pid IN ARRAY p_selected_gift_product_ids
    LOOP
      -- 再次获取赠品详情（为了处理库存）
      SELECT r.id as rule_id, r.name as rule_name, r.threshold_amount, rp.gift_quantity
      INTO v_gift_rule
      FROM public.b2b_gift_rules r
      JOIN public.b2b_gift_rule_products rp ON rp.rule_id = r.id
      WHERE rp.product_id = v_gift_pid AND r.threshold_amount <= v_total_amount AND r.is_active = true AND rp.is_active = true
      ORDER BY r.threshold_amount DESC LIMIT 1;

      SELECT id, name, name_i18n, image_url, cost_price, stock, unit_measure, sku
      INTO v_gift_product
      FROM public.inventory_products WHERE id = v_gift_pid FOR UPDATE;

      v_gift_quantity := COALESCE(v_gift_rule.gift_quantity, 1);
      v_gift_stock_before := v_gift_product.stock;

      UPDATE public.inventory_products
      SET stock = stock - v_gift_quantity, updated_at = now()
      WHERE id = v_gift_pid AND stock >= v_gift_quantity
      RETURNING stock INTO v_gift_stock_after;

      INSERT INTO public.b2b_order_items (
        order_id, product_id, quantity, unit_price, subtotal, snapshot_data,
        product_name_zh, product_name_original, sku, image_url, unit_measure,
        cost_price_snapshot, wholesale_price_snapshot,
        ordered_quantity, item_status, product_name, product_image_url, product_sku,
        cost_price, line_cost_amount, line_profit_amount,
        is_gift, gift_rule_id
      ) VALUES (
        v_order_id, v_gift_pid, v_gift_quantity, 0, 0,
        jsonb_strip_nulls(jsonb_build_object('id', v_gift_pid, 'name', v_gift_product.name, 'is_gift', true, 'gift_rule_id', v_gift_rule.rule_id)),
        COALESCE(v_gift_product.name, ''), v_gift_product.name, v_gift_product.sku, v_gift_product.image_url,
        COALESCE(v_gift_product.unit_measure, '件'),
        v_gift_product.cost_price, 0,
        v_gift_quantity, 'ordered', COALESCE(v_gift_product.name, ''), v_gift_product.image_url, v_gift_product.sku,
        v_gift_product.cost_price,
        CASE WHEN v_gift_product.cost_price IS NULL THEN NULL ELSE v_gift_product.cost_price * v_gift_quantity END,
        CASE WHEN v_gift_product.cost_price IS NULL THEN NULL ELSE -v_gift_product.cost_price * v_gift_quantity END,
        true, v_gift_rule.rule_id
      );

      INSERT INTO public.inventory_transactions(inventory_product_id, transaction_type, quantity, stock_before, stock_after, related_order_id, notes)
      VALUES (v_gift_pid, 'B2B_GIFT', -v_gift_quantity, v_gift_stock_before, v_gift_stock_after, v_order_id, 'B2B赠品');
    END LOOP;
  END IF;

  DELETE FROM public.shopping_carts WHERE user_id = v_user_id_text;

  IF v_uses_credit THEN
    UPDATE public.wholesaler_profiles SET credit_used = v_credit_used_after, updated_at = now() WHERE id = v_profile.id;
  END IF;

  v_response := jsonb_build_object('success', true, 'order', jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'total_amount', v_total_amount, 'item_count', v_effective_item_count));
  
  IF v_has_idempotency THEN
    UPDATE public.b2b_idempotency_keys SET status = 'succeeded', response_json = v_response, locked_until = NULL WHERE id = v_idem.id;
  END IF;

  RETURN v_response;
END;
$$;
