-- ============================================================================
-- P2 Hotfix: 修复 b2b_create_order_from_cart_tx 授信检查逻辑
-- ============================================================================
-- Bug 现象：
--   原版 P2 下单 RPC 在判断授信额度时，使用条件
--     IF COALESCE(v_profile.credit_limit, 0) <= 0
--        OR v_credit_used_after > COALESCE(v_profile.credit_limit, 0) THEN
--   只要批发商的 credit_limit = 0（系统默认值），无论是否选择即时支付都会被拒绝下单，
--   并且即使开启了授信但选择 0 天账期（现款现货）也无法跳过授信占用。
--   这导致 P2 上线后所有现存批发商立刻无法下单，是阻塞性故障。
--
-- 修复方案：
--   1) 仅当 payment_terms_days > 0 (赊销/账期模式) 时才进行授信额度校验
--      并占用 credit_used；
--   2) payment_terms_days = 0 视为现款现货 (COD)，下单不占用授信，
--      下单后由后台 record_payment 流程负责确认收款，credit_used 维持不变；
--   3) 仍保留对 credit_status (on_hold/bad_debt/disabled) 的硬性拦截，
--      防止高风险客户即使使用现款方式继续下单。
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
  v_user_id_text text;
  v_credit_used_before numeric(12,2) := 0;
  v_credit_used_after numeric(12,2) := 0;
  v_payment_terms int := 0;
  v_due_at timestamptz;
  v_uses_credit boolean := false;
BEGIN
  v_user_id_text := p_user_id::text;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_INVALID_USER', 'error', '缺少用户 ID');
  END IF;

  IF NULLIF(btrim(COALESCE(p_delivery_address, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_PARAMS_MISSING', 'error', '配送地址不能为空，请在个人资料中设置或在下单时提供');
  END IF;

  v_effective_note := COALESCE(p_delivery_note, '');
  v_effective_request_hash := COALESCE(NULLIF(p_request_hash, ''), md5(v_user_id_text || '|' || COALESCE(p_delivery_address, '') || '|' || v_effective_note));
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
    jsonb_strip_nulls(jsonb_build_object('order_number', v_order_number, 'total_amount', v_total_amount, 'total_quantity', v_total_quantity, 'item_count', v_item_count)),
    v_order_id, p_user_id, 'customer', 'checkout_create_order', 'pending',
    jsonb_strip_nulls(jsonb_build_object('order_number', v_order_number, 'total_amount', v_total_amount, 'total_quantity', v_total_quantity, 'item_count', v_item_count, 'idempotency_key', CASE WHEN v_has_idempotency THEN p_idempotency_key ELSE NULL END, 'request_hash', v_effective_request_hash, 'session_token_hash', p_session_token_hash, 'credit_limit_snapshot', v_profile.credit_limit, 'credit_used_before', v_credit_used_before, 'credit_used_after', v_credit_used_after, 'payment_due_at', v_due_at, 'uses_credit', v_uses_credit))
  );

  v_response := jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id, 'order_number', v_order_number,
      'total_amount', v_total_amount, 'subtotal_amount', v_total_amount,
      'paid_total', 0, 'balance_due', v_total_amount,
      'item_count', v_item_count, 'total_quantity', v_total_quantity,
      'status', 'pending', 'fulfillment_status', 'pending',
      'payment_status', 'pending', 'financial_status', 'unpaid',
      'delivery_address', p_delivery_address,
      'payment_due_at', v_due_at,
      'payment_terms_days', v_payment_terms,
      'uses_credit', v_uses_credit,
      'credit_used_after', v_credit_used_after,
      'credit_available', GREATEST(COALESCE(v_profile.credit_limit, 0) - v_credit_used_after, 0),
      'profit_status', CASE WHEN v_missing_cost THEN 'cost_missing' ELSE 'complete' END
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

COMMENT ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) IS
'B2B 事务化下单 RPC（P2 授信风控版 - hotfix）。当 payment_terms_days > 0 走授信赊销并占用额度；当 payment_terms_days = 0 视为现款现货 (COD)，不做额度校验，亦不占用 credit_used。';

GRANT EXECUTE ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) TO anon, authenticated;
