-- ============================================================================
-- B2B P0-2 Transactional Checkout RPC
-- 日期: 2026-05-09
--
-- 目标:
--   将 B2B checkout 的核心写路径收敛到一个数据库事务中：
--   1. 校验用户、配送地址、购物车、商品状态、起订量和库存。
--   2. 生成订单号并创建 b2b_orders。
--   3. 创建 b2b_order_items 结构化快照。
--   4. 原子扣减 inventory_products.stock 并写入 inventory_transactions。
--   5. 清空 shopping_carts。
--   6. 写入 operation log，并通过 b2b_idempotency_keys 支持幂等重放。
--
-- 注意:
--   - 函数仅授权 service_role 执行，必须由 Edge Function 完成用户会话校验后调用。
--   - 业务上继续兼容当前“登录用户可下单，批发商资料用于默认地址/识别”的策略。
--   - 所有业务失败均返回 success=false JSON，不抛出异常；不可预期数据库错误仍由 Postgres 抛出。
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
BEGIN
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
    md5(COALESCE(p_user_id::text, '') || '|' || COALESCE(p_delivery_address, '') || '|' || v_effective_note)
  );
  v_has_idempotency := NULLIF(p_idempotency_key, '') IS NOT NULL;

  -- ---------------------------------------------------------------------------
  -- 幂等保护：同一 scope + key 串行执行；成功请求直接重放响应。
  -- ---------------------------------------------------------------------------
  IF v_has_idempotency THEN
    PERFORM pg_advisory_xact_lock(hashtext('b2b_checkout:' || p_idempotency_key));

    INSERT INTO public.b2b_idempotency_keys (
      scope,
      idempotency_key,
      user_id,
      request_hash,
      status,
      locked_until,
      expires_at
    ) VALUES (
      'b2b_checkout',
      p_idempotency_key,
      p_user_id,
      v_effective_request_hash,
      'processing',
      now() + interval '5 minutes',
      now() + interval '24 hours'
    )
    ON CONFLICT (scope, idempotency_key) DO NOTHING;

    SELECT * INTO v_idem
    FROM public.b2b_idempotency_keys
    WHERE scope = 'b2b_checkout'
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_idem.user_id IS NOT NULL AND v_idem.user_id <> p_user_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'ERR_IDEMPOTENCY_CONFLICT',
        'error', '幂等键已被其他用户使用'
      );
    END IF;

    IF v_idem.request_hash <> v_effective_request_hash THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'ERR_IDEMPOTENCY_CONFLICT',
        'error', '同一幂等键不能用于不同下单请求'
      );
    END IF;

    IF v_idem.status = 'succeeded' AND v_idem.response_json IS NOT NULL THEN
      RETURN v_idem.response_json || jsonb_build_object('idempotent_replay', true);
    END IF;

    UPDATE public.b2b_idempotency_keys
    SET
      status = 'processing',
      error_code = NULL,
      locked_until = now() + interval '5 minutes'
    WHERE id = v_idem.id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 客户快照：批发商资料不是下单门槛，但必须在历史订单中结构化保存。
  -- ---------------------------------------------------------------------------
  SELECT
    id,
    status,
    company_name,
    contact_phone,
    tax_id,
    business_address,
    delivery_address
  INTO v_profile
  FROM public.wholesaler_profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  v_customer_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'user_id', p_user_id,
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
      sc.id AS cart_id,
      sc.product_id,
      sc.quantity,
      ip.name,
      ip.name_i18n,
      ip.image_url,
      ip.wholesale_price,
      ip.retail_price,
      ip.cost_price,
      ip.stock,
      ip.min_order_quantity,
      ip.unit_measure,
      ip.sku,
      ip.status
    FROM public.shopping_carts sc
    JOIN public.inventory_products ip ON ip.id = sc.product_id
    WHERE sc.user_id = p_user_id
    ORDER BY sc.created_at ASC, sc.id ASC
    FOR UPDATE OF sc, ip
  LOOP
    v_item_count := v_item_count + 1;

    IF COALESCE(v_item.status, '') <> 'ACTIVE' THEN
      v_response := jsonb_build_object(
        'success', false,
        'error_code', 'ERR_PRODUCT_UNAVAILABLE',
        'error', '商品不可购买: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(v_item.product_id)
      );
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_PRODUCT_UNAVAILABLE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;

    IF v_item.quantity < COALESCE(v_item.min_order_quantity, 1) THEN
      v_response := jsonb_build_object(
        'success', false,
        'error_code', 'ERR_MIN_ORDER_QUANTITY',
        'error', '商品未达到起订量: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(jsonb_build_object('product_id', v_item.product_id, 'min_order_quantity', v_item.min_order_quantity))
      );
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_MIN_ORDER_QUANTITY' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;

    IF COALESCE(v_item.stock, 0) < v_item.quantity THEN
      v_response := jsonb_build_object(
        'success', false,
        'error_code', 'ERR_OUT_OF_STOCK',
        'error', '商品库存不足: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(jsonb_build_object('product_id', v_item.product_id, 'stock', COALESCE(v_item.stock, 0), 'requested_quantity', v_item.quantity))
      );
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_OUT_OF_STOCK' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN v_response;
    END IF;

    IF COALESCE(v_item.wholesale_price, 0) <= 0 THEN
      v_response := jsonb_build_object(
        'success', false,
        'error_code', 'ERR_INVALID_PRICE',
        'error', '商品批发价无效: ' || COALESCE(v_item.name, v_item.product_id::text),
        'details', jsonb_build_array(v_item.product_id)
      );
      IF v_has_idempotency THEN
        UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_INVALID_PRICE' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
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
    v_response := jsonb_build_object(
      'success', false,
      'error_code', 'ERR_CART_EMPTY',
      'error', '购物车为空'
    );
    IF v_has_idempotency THEN
      UPDATE public.b2b_idempotency_keys SET status = 'failed', response_json = v_response, error_code = 'ERR_CART_EMPTY' WHERE scope = 'b2b_checkout' AND idempotency_key = p_idempotency_key;
    END IF;
    RETURN v_response;
  END IF;

  v_order_number := public.generate_b2b_order_number();

  INSERT INTO public.b2b_orders (
    order_number,
    user_id,
    total_amount,
    subtotal_amount,
    discount_amount,
    freight_amount,
    item_count,
    total_quantity,
    status,
    fulfillment_status,
    payment_method,
    payment_status,
    financial_status,
    reconciliation_status,
    delivery_address,
    delivery_note,
    customer_snapshot,
    checkout_idempotency_key,
    checkout_request_hash,
    source,
    total_cost_amount,
    gross_profit_amount,
    profit_status
  ) VALUES (
    v_order_number,
    p_user_id,
    v_total_amount,
    v_total_amount,
    0,
    0,
    v_item_count,
    v_total_quantity,
    'pending',
    'pending',
    'cod',
    'pending',
    'unpaid',
    'unreconciled',
    p_delivery_address,
    v_effective_note,
    v_customer_snapshot,
    CASE WHEN v_has_idempotency THEN p_idempotency_key ELSE NULL END,
    v_effective_request_hash,
    'b2b-checkout',
    CASE WHEN v_missing_cost THEN NULL ELSE v_total_cost_amount END,
    CASE WHEN v_missing_cost THEN NULL ELSE v_total_amount - v_total_cost_amount END,
    CASE WHEN v_missing_cost THEN 'cost_missing' ELSE 'complete' END
  )
  RETURNING id INTO v_order_id;

  -- ---------------------------------------------------------------------------
  -- 写入明细、扣减库存与库存流水。商品行仍处于本事务锁内。
  -- ---------------------------------------------------------------------------
  FOR v_item IN
    SELECT
      sc.product_id,
      sc.quantity,
      ip.name,
      ip.name_i18n,
      ip.image_url,
      ip.wholesale_price,
      ip.retail_price,
      ip.cost_price,
      ip.stock,
      ip.min_order_quantity,
      ip.unit_measure,
      ip.sku,
      ip.status
    FROM public.shopping_carts sc
    JOIN public.inventory_products ip ON ip.id = sc.product_id
    WHERE sc.user_id = p_user_id
    ORDER BY sc.created_at ASC, sc.id ASC
  LOOP
    UPDATE public.inventory_products
    SET
      stock = stock - v_item.quantity,
      updated_at = now()
    WHERE id = v_item.product_id
      AND stock >= v_item.quantity
    RETURNING stock INTO v_stock_after;

    IF NOT FOUND THEN
      -- 理论上已被 FOR UPDATE 防住；保留防御式校验。
      RAISE EXCEPTION 'B2B stock deduction failed for product %', v_item.product_id
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.b2b_order_items (
      order_id,
      product_id,
      quantity,
      unit_price,
      subtotal,
      snapshot_data,
      product_name,
      product_name_i18n,
      product_image_url,
      product_sku,
      unit_measure,
      cost_price,
      line_cost_amount,
      line_profit_amount
    ) VALUES (
      v_order_id,
      v_item.product_id,
      v_item.quantity,
      v_item.wholesale_price,
      v_item.wholesale_price * v_item.quantity,
      jsonb_strip_nulls(jsonb_build_object(
        'id', v_item.product_id,
        'name', v_item.name,
        'name_i18n', v_item.name_i18n,
        'image_url', v_item.image_url,
        'sku', v_item.sku,
        'unit_measure', v_item.unit_measure,
        'wholesale_price', v_item.wholesale_price,
        'retail_price', v_item.retail_price
      )),
      v_item.name,
      v_item.name_i18n,
      v_item.image_url,
      v_item.sku,
      v_item.unit_measure,
      v_item.cost_price,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE v_item.cost_price * v_item.quantity END,
      CASE WHEN v_item.cost_price IS NULL THEN NULL ELSE (v_item.wholesale_price - v_item.cost_price) * v_item.quantity END
    );

    INSERT INTO public.inventory_transactions (
      inventory_product_id,
      transaction_type,
      quantity,
      stock_before,
      stock_after,
      related_order_id,
      notes
    ) VALUES (
      v_item.product_id,
      'B2B_SALE',
      -v_item.quantity,
      v_item.stock,
      v_stock_after,
      v_order_id,
      'B2B订单 ' || v_order_number || ' 事务化扣减库存'
    );
  END LOOP;

  DELETE FROM public.shopping_carts
  WHERE user_id = p_user_id;

  INSERT INTO public.b2b_order_operation_logs (
    order_id,
    actor_id,
    actor_type,
    operation,
    to_state,
    metadata
  ) VALUES (
    v_order_id,
    p_user_id,
    'customer',
    'checkout_create_order',
    'pending',
    jsonb_strip_nulls(jsonb_build_object(
      'order_number', v_order_number,
      'total_amount', v_total_amount,
      'total_quantity', v_total_quantity,
      'item_count', v_item_count,
      'idempotency_key', CASE WHEN v_has_idempotency THEN p_idempotency_key ELSE NULL END,
      'request_hash', v_effective_request_hash,
      'session_token_hash', p_session_token_hash
    ))
  );

  v_response := jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order_number,
      'total_amount', v_total_amount,
      'subtotal_amount', v_total_amount,
      'paid_total', 0,
      'item_count', v_item_count,
      'total_quantity', v_total_quantity,
      'status', 'pending',
      'fulfillment_status', 'pending',
      'payment_status', 'pending',
      'financial_status', 'unpaid',
      'delivery_address', p_delivery_address,
      'profit_status', CASE WHEN v_missing_cost THEN 'cost_missing' ELSE 'complete' END
    ),
    'message', '订单创建成功，等待配送'
  );

  IF v_has_idempotency THEN
    UPDATE public.b2b_idempotency_keys
    SET
      status = 'succeeded',
      response_json = v_response,
      error_code = NULL,
      locked_until = NULL
    WHERE scope = 'b2b_checkout'
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_response;
END;
$$;

COMMENT ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) IS
'B2B 事务化下单 RPC。由 b2b-checkout Edge Function 在完成会话校验后以 service_role 调用。';

REVOKE ALL ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) TO service_role;
