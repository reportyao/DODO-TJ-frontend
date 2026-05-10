-- 修复 B2B 后台订单 RPC 引用不存在的 users.phone 字段
-- 线上 400 报错：column u.phone does not exist
-- users 表实际手机号字段为 phone_number；同时详情 RPC 存在同类隐患，一并修复。

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

  SELECT COUNT(*) INTO v_total
  FROM b2b_orders o
  WHERE (p_fulfillment_status IS NULL OR o.fulfillment_status = p_fulfillment_status)
    AND (p_financial_status IS NULL OR o.financial_status = p_financial_status)
    AND (p_search IS NULL OR p_search = '' OR
         o.order_number ILIKE '%' || p_search || '%' OR
         EXISTS (SELECT 1 FROM wholesaler_profiles wp WHERE wp.user_id = o.user_id AND wp.company_name ILIKE '%' || p_search || '%')
    );

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
      o.status AS legacy_status,
      o.payment_status AS legacy_payment_status,
      o.payment_method,
      wp.company_name AS wholesaler_company,
      wp.contact_phone AS wholesaler_phone,
      u.phone_number AS user_phone
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
    'user_phone', u.phone_number
  ) INTO v_order
  FROM b2b_orders o
  LEFT JOIN wholesaler_profiles wp ON wp.user_id = o.user_id
  LEFT JOIN users u ON u.id = o.user_id
  WHERE o.id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.admin_b2b_order_list TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_order_detail TO anon, authenticated;
