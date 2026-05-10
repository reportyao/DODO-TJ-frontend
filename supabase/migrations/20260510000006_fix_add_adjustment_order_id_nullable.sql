-- ============================================================================
-- Fix #2: admin_b2b_add_adjustment 参数签名不匹配 + order_id NOT NULL 约束
--
-- 问题1: p_order_id 是必填参数（无 DEFAULT），但批次级调整不关联具体订单
--        导致前端不传 p_order_id 时 PostgREST 找不到匹配函数 (PGRST202)
-- 问题2: b2b_order_adjustments.order_id 有 NOT NULL 约束
--        导致批次级调整插入失败 (23502 not-null violation)
-- 同时修复: 将 RAISE EXCEPTION 改为 RETURN json（与前端 adminRpc 错误处理一致）
-- ============================================================================

-- Step 1: 允许 order_id 为空
ALTER TABLE public.b2b_order_adjustments ALTER COLUMN order_id DROP NOT NULL;

-- Step 2: 重建函数，p_order_id DEFAULT NULL，错误用 RETURN 而非 RAISE
DROP FUNCTION IF EXISTS public.admin_b2b_add_adjustment(text, uuid, uuid, varchar, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_b2b_add_adjustment(
  p_session_token text,
  p_batch_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_adjustment_type varchar DEFAULT 'manual',
  p_amount numeric DEFAULT 0,
  p_reason text DEFAULT '',
  p_proof_url text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_id uuid;
  v_batch record;
  v_adj_id uuid;
  v_new_adjustment_total numeric;
  v_new_final_diff numeric;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- 幂等检查
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'add_adjustment' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
    END IF;
  END IF;

  -- 获取批次并加锁
  SELECT * INTO v_batch FROM public.b2b_reconciliation_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch IS NULL THEN
    RETURN json_build_object('success', false, 'message', '对账批次不存在');
  END IF;
  IF v_batch.status = 'locked' THEN
    RETURN json_build_object('success', false, 'message', '对账批次已锁账，无法添加调整');
  END IF;
  IF v_batch.status = 'closed' THEN
    RETURN json_build_object('success', false, 'message', '对账批次已关闭');
  END IF;

  -- 原因必填
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN json_build_object('success', false, 'message', '调整原因不能为空');
  END IF;

  -- 插入调整记录
  INSERT INTO public.b2b_order_adjustments (
    order_id, batch_id, adjustment_type, amount,
    direction, reason, proof_url, status, created_by
  ) VALUES (
    p_order_id, p_batch_id, p_adjustment_type, ABS(p_amount),
    CASE WHEN p_amount >= 0 THEN 'credit' ELSE 'debit' END,
    p_reason, p_proof_url, 'approved', v_admin_id
  )
  RETURNING id INTO v_adj_id;

  -- 重算批次差异
  SELECT COALESCE(SUM(amount * CASE WHEN direction = 'credit' THEN 1 ELSE -1 END), 0)
  INTO v_new_adjustment_total
  FROM public.b2b_order_adjustments
  WHERE batch_id = p_batch_id AND status = 'approved';

  v_new_final_diff := v_batch.difference_amount - v_new_adjustment_total;

  UPDATE public.b2b_reconciliation_batches SET
    adjustment_total = v_new_adjustment_total,
    final_difference = v_new_final_diff,
    status = CASE
      WHEN ABS(v_new_final_diff) < 0.01 THEN 'matched'
      ELSE 'mismatched'
    END,
    updated_at = now()
  WHERE id = p_batch_id;

  -- 操作日志
  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, admin_id, new_value,
    order_id, actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'reconciliation_batch', p_batch_id, 'add_adjustment', v_admin_id,
    jsonb_build_object('adjustment_type', p_adjustment_type, 'amount', p_amount, 'reason', p_reason),
    p_order_id, v_admin_id, 'admin', 'add_adjustment', v_batch.status,
    jsonb_build_object('adj_id', v_adj_id, 'final_difference', v_new_final_diff)
  );

  -- 幂等记录
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('add_adjustment', p_idempotency_key, jsonb_build_object('adj_id', v_adj_id));
  END IF;

  RETURN json_build_object(
    'success', true,
    'adjustment_id', v_adj_id,
    'new_adjustment_total', v_new_adjustment_total,
    'new_final_difference', v_new_final_diff,
    'message', '调整记录已添加'
  );
END;
$$;
