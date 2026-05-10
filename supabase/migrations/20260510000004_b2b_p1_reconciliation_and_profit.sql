-- ============================================================================
-- B2B P1 迁移：对账中心 + 利润核算
-- 日期: 2026-05-10
-- 版本: P1 v1
--
-- 包含内容:
--   P1-1: b2b_reconciliation_batches（对账批次表）
--         b2b_reconciliation_items（对账明细表）
--         b2b_order_adjustments（订单调整/差异表）
--         相关索引与 RLS
--   P1-2/P1-3/P1-4: 对账 RPC
--         admin_b2b_create_reconciliation_batch  创建对账批次
--         admin_b2b_get_reconciliation_list      对账批次列表
--         admin_b2b_get_reconciliation_detail    对账批次详情
--         admin_b2b_add_adjustment               添加差异调整
--         admin_b2b_lock_reconciliation_batch    锁账
--         admin_b2b_unlock_reconciliation_batch  反锁账（高权限）
--         admin_b2b_close_reconciliation_batch   关闭批次
--   P1-5: 利润重算 RPC
--         admin_b2b_recalculate_profit           重算单订单利润
--         admin_b2b_batch_recalculate_profit     批量重算利润
--   P1-6: 利润看板 RPC
--         admin_b2b_profit_dashboard             利润看板汇总
--         admin_b2b_profit_order_list            利润订单明细列表
-- ============================================================================

-- ============================================================================
-- P1-1: 对账批次表
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.b2b_reconciliation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number varchar(50) UNIQUE NOT NULL,     -- 批次号，如 REC-20260510-001
  title text,                                    -- 批次标题（可选，如"5月第一周对账"）
  scope varchar(50) NOT NULL DEFAULT 'manual',   -- 对账范围: manual/daily/weekly/monthly
  status varchar(30) NOT NULL DEFAULT 'draft',   -- draft/reviewing/matched/mismatched/locked/closed
  payment_method varchar(50),                    -- 收款方式筛选（可为空，表示混合）
  date_from date,                                -- 对账起始日期
  date_to date,                                  -- 对账截止日期
  order_count int DEFAULT 0,                     -- 纳入订单数
  payment_count int DEFAULT 0,                   -- 纳入付款流水数
  expected_amount numeric(12,2) DEFAULT 0,       -- 系统应收总额
  actual_amount numeric(12,2) DEFAULT 0,         -- 实际收到金额（人工填写）
  matched_amount numeric(12,2) DEFAULT 0,        -- 已匹配金额
  difference_amount numeric(12,2) DEFAULT 0,     -- 差异金额（actual - expected）
  adjustment_total numeric(12,2) DEFAULT 0,      -- 调整合计（折让、手续费等）
  final_difference numeric(12,2) DEFAULT 0,      -- 最终差异（差异 - 调整合计）
  note text,                                     -- 批次备注
  created_by uuid,                               -- 创建人（admin_id）
  reviewed_by uuid,                              -- 审核人
  locked_by uuid,                                -- 锁账人
  locked_at timestamptz,                         -- 锁账时间
  unlocked_by uuid,                              -- 反锁账人
  unlocked_at timestamptz,                       -- 反锁账时间
  unlock_reason text,                            -- 反锁账原因
  closed_at timestamptz,                         -- 关闭时间
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.b2b_reconciliation_batches IS 'B2B 对账批次表（P1）';

-- 批次状态约束
DO $$ BEGIN
  ALTER TABLE public.b2b_reconciliation_batches ADD CONSTRAINT chk_recon_batch_status
    CHECK (status IN ('draft', 'reviewing', 'matched', 'mismatched', 'locked', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 批次号生成函数
CREATE OR REPLACE FUNCTION public.generate_b2b_reconciliation_batch_number()
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
  v_date text := to_char(now(), 'YYYYMMDD');
  v_seq int;
BEGIN
  SELECT COALESCE(MAX(CAST(RIGHT(batch_number, 3) AS int)), 0) + 1
  INTO v_seq
  FROM public.b2b_reconciliation_batches
  WHERE batch_number LIKE 'REC-' || v_date || '-%';
  RETURN 'REC-' || v_date || '-' || LPAD(v_seq::text, 3, '0');
END;
$$;

-- ============================================================================
-- P1-1: 对账明细表（关联付款流水与订单）
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.b2b_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.b2b_reconciliation_batches(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.b2b_orders(id),
  payment_transaction_id uuid REFERENCES public.b2b_payment_transactions(id),
  item_type varchar(30) NOT NULL DEFAULT 'payment', -- payment/order/adjustment
  expected_amount numeric(12,2) DEFAULT 0,           -- 应收金额
  actual_amount numeric(12,2) DEFAULT 0,             -- 实收金额
  matched_status varchar(30) DEFAULT 'pending',      -- pending/matched/mismatched/adjusted
  difference_amount numeric(12,2) DEFAULT 0,         -- 差异（actual - expected）
  note text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.b2b_reconciliation_items IS 'B2B 对账明细表（P1）';

DO $$ BEGIN
  ALTER TABLE public.b2b_reconciliation_items ADD CONSTRAINT chk_recon_item_status
    CHECK (matched_status IN ('pending', 'matched', 'mismatched', 'adjusted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- P1-1: 订单调整表（差异处理：短款、长款、手续费、折让、人工调整）
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.b2b_order_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.b2b_orders(id),
  batch_id uuid REFERENCES public.b2b_reconciliation_batches(id),
  adjustment_type varchar(50) NOT NULL,   -- short_payment/over_payment/fee/discount/manual
  amount numeric(12,2) NOT NULL,          -- 调整金额（正数=增加应收，负数=减少应收）
  direction varchar(10) DEFAULT 'debit',  -- debit/credit
  reason text NOT NULL,                   -- 调整原因（必填）
  proof_url text,                         -- 凭证 URL
  status varchar(30) DEFAULT 'pending',   -- pending/approved/rejected
  created_by uuid NOT NULL,              -- 操作人（admin_id）
  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.b2b_order_adjustments IS 'B2B 订单调整/差异表（P1）';

DO $$ BEGIN
  ALTER TABLE public.b2b_order_adjustments ADD CONSTRAINT chk_adjustment_type
    CHECK (adjustment_type IN ('short_payment', 'over_payment', 'fee', 'discount', 'manual', 'return_refund'));
  ALTER TABLE public.b2b_order_adjustments ADD CONSTRAINT chk_adjustment_status
    CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- P1-1: 索引
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_recon_batches_status ON public.b2b_reconciliation_batches(status);
CREATE INDEX IF NOT EXISTS idx_recon_batches_date ON public.b2b_reconciliation_batches(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_recon_batches_created_at ON public.b2b_reconciliation_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recon_items_batch ON public.b2b_reconciliation_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_recon_items_order ON public.b2b_reconciliation_items(order_id);
CREATE INDEX IF NOT EXISTS idx_recon_items_payment ON public.b2b_reconciliation_items(payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_order ON public.b2b_order_adjustments(order_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_batch ON public.b2b_order_adjustments(batch_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_status ON public.b2b_order_adjustments(status);

-- ============================================================================
-- P1-1: RLS 策略（对账表默认禁止直接访问，只通过 SECURITY DEFINER RPC）
-- ============================================================================

ALTER TABLE public.b2b_reconciliation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_order_adjustments ENABLE ROW LEVEL SECURITY;

-- 禁止所有直接访问（通过 RPC 访问）
DO $$ BEGIN
  DROP POLICY IF EXISTS "deny_all_recon_batches" ON public.b2b_reconciliation_batches;
  CREATE POLICY "deny_all_recon_batches" ON public.b2b_reconciliation_batches
    FOR ALL TO authenticated, anon USING (false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "deny_all_recon_items" ON public.b2b_reconciliation_items;
  CREATE POLICY "deny_all_recon_items" ON public.b2b_reconciliation_items
    FOR ALL TO authenticated, anon USING (false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "deny_all_adjustments" ON public.b2b_order_adjustments;
  CREATE POLICY "deny_all_adjustments" ON public.b2b_order_adjustments
    FOR ALL TO authenticated, anon USING (false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================================
-- P1-1: b2b_orders 补充 locked_at 字段（P0 预留，P1 启用）
-- ============================================================================

ALTER TABLE public.b2b_orders
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid,
  ADD COLUMN IF NOT EXISTS lock_reason text;

-- ============================================================================
-- P1-2/P1-3/P1-4: 对账 RPC
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_b2b_create_reconciliation_batch: 创建对账批次
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_create_reconciliation_batch(
  p_session_token text,
  p_title text DEFAULT NULL,
  p_scope varchar DEFAULT 'manual',
  p_payment_method varchar DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_actual_amount numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_payment_ids uuid[] DEFAULT NULL,   -- 指定纳入的付款流水 ID
  p_order_ids uuid[] DEFAULT NULL,     -- 指定纳入的订单 ID
  p_idempotency_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_batch_id uuid;
  v_batch_number varchar;
  v_expected_amount numeric(12,2) := 0;
  v_payment_count int := 0;
  v_order_count int := 0;
  v_rec record;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- 幂等检查
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'create_recon_batch' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
    END IF;
  END IF;

  v_batch_number := generate_b2b_reconciliation_batch_number();

  INSERT INTO public.b2b_reconciliation_batches (
    batch_number, title, scope, payment_method, date_from, date_to,
    actual_amount, note, created_by, status
  ) VALUES (
    v_batch_number,
    COALESCE(p_title, '对账批次 ' || v_batch_number),
    p_scope, p_payment_method, p_date_from, p_date_to,
    p_actual_amount, p_note, v_admin_id, 'draft'
  )
  RETURNING id INTO v_batch_id;

  -- 纳入指定付款流水
  IF p_payment_ids IS NOT NULL AND array_length(p_payment_ids, 1) > 0 THEN
    FOR v_rec IN
      SELECT pt.id, pt.order_id, pt.amount
      FROM public.b2b_payment_transactions pt
      WHERE pt.id = ANY(p_payment_ids) AND pt.status = 'confirmed'
    LOOP
      INSERT INTO public.b2b_reconciliation_items (
        batch_id, order_id, payment_transaction_id, item_type,
        expected_amount, actual_amount, matched_status
      ) VALUES (
        v_batch_id, v_rec.order_id, v_rec.id, 'payment',
        v_rec.amount, v_rec.amount, 'pending'
      );
      v_expected_amount := v_expected_amount + v_rec.amount;
      v_payment_count := v_payment_count + 1;
    END LOOP;
  END IF;

  -- 纳入指定订单（按应收总额）
  IF p_order_ids IS NOT NULL AND array_length(p_order_ids, 1) > 0 THEN
    FOR v_rec IN
      SELECT id, receivable_total
      FROM public.b2b_orders
      WHERE id = ANY(p_order_ids)
    LOOP
      INSERT INTO public.b2b_reconciliation_items (
        batch_id, order_id, item_type,
        expected_amount, actual_amount, matched_status
      ) VALUES (
        v_batch_id, v_rec.id, 'order',
        COALESCE(v_rec.receivable_total, 0), 0, 'pending'
      );
      v_expected_amount := v_expected_amount + COALESCE(v_rec.receivable_total, 0);
      v_order_count := v_order_count + 1;
    END LOOP;
  END IF;

  -- 按日期范围自动纳入（如果没有指定 ID）
  IF (p_payment_ids IS NULL OR array_length(p_payment_ids, 1) = 0)
     AND (p_order_ids IS NULL OR array_length(p_order_ids, 1) = 0)
     AND (p_date_from IS NOT NULL OR p_date_to IS NOT NULL) THEN
    FOR v_rec IN
      SELECT pt.id, pt.order_id, pt.amount
      FROM public.b2b_payment_transactions pt
      WHERE pt.status = 'confirmed'
        AND (p_payment_method IS NULL OR pt.payment_method = p_payment_method)
        AND (p_date_from IS NULL OR pt.paid_at::date >= p_date_from)
        AND (p_date_to IS NULL OR pt.paid_at::date <= p_date_to)
    LOOP
      INSERT INTO public.b2b_reconciliation_items (
        batch_id, order_id, payment_transaction_id, item_type,
        expected_amount, actual_amount, matched_status
      ) VALUES (
        v_batch_id, v_rec.order_id, v_rec.id, 'payment',
        v_rec.amount, v_rec.amount, 'pending'
      );
      v_expected_amount := v_expected_amount + v_rec.amount;
      v_payment_count := v_payment_count + 1;
    END LOOP;
  END IF;

  -- 更新批次汇总
  UPDATE public.b2b_reconciliation_batches SET
    order_count = v_order_count,
    payment_count = v_payment_count,
    expected_amount = v_expected_amount,
    matched_amount = v_expected_amount,
    difference_amount = COALESCE(p_actual_amount, v_expected_amount) - v_expected_amount,
    final_difference = COALESCE(p_actual_amount, v_expected_amount) - v_expected_amount,
    status = CASE
      WHEN ABS(COALESCE(p_actual_amount, v_expected_amount) - v_expected_amount) < 0.01 THEN 'matched'
      WHEN p_actual_amount IS NOT NULL THEN 'mismatched'
      ELSE 'draft'
    END
  WHERE id = v_batch_id;

  -- 写操作日志
  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, admin_id, new_value,
    actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'reconciliation_batch', v_batch_id, 'create_batch', v_admin_id,
    jsonb_build_object('batch_number', v_batch_number, 'expected_amount', v_expected_amount),
    v_admin_id, 'admin', 'create_reconciliation_batch', 'draft',
    jsonb_build_object('batch_number', v_batch_number, 'payment_count', v_payment_count, 'order_count', v_order_count)
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('create_recon_batch', p_idempotency_key, jsonb_build_object('batch_id', v_batch_id));
  END IF;

  RETURN json_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'batch_number', v_batch_number,
    'expected_amount', v_expected_amount,
    'payment_count', v_payment_count,
    'order_count', v_order_count,
    'message', '对账批次创建成功'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_create_reconciliation_batch TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_get_reconciliation_list: 对账批次列表
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_get_reconciliation_list(
  p_session_token text,
  p_status varchar DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
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
  v_total int;
  v_batches json;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);
  v_offset := (p_page - 1) * p_page_size;

  SELECT COUNT(*) INTO v_total
  FROM public.b2b_reconciliation_batches b
  WHERE (p_status IS NULL OR b.status = p_status)
    AND (p_date_from IS NULL OR b.date_from >= p_date_from)
    AND (p_date_to IS NULL OR b.date_to <= p_date_to);

  SELECT json_agg(row_to_json(t)) INTO v_batches
  FROM (
    SELECT
      b.id, b.batch_number, b.title, b.scope, b.status,
      b.payment_method, b.date_from, b.date_to,
      b.order_count, b.payment_count,
      b.expected_amount, b.actual_amount, b.matched_amount,
      b.difference_amount, b.adjustment_total, b.final_difference,
      b.note, b.locked_at, b.created_at, b.updated_at,
      b.created_by, b.locked_by
    FROM public.b2b_reconciliation_batches b
    WHERE (p_status IS NULL OR b.status = p_status)
      AND (p_date_from IS NULL OR b.date_from >= p_date_from)
      AND (p_date_to IS NULL OR b.date_to <= p_date_to)
    ORDER BY b.created_at DESC
    LIMIT p_page_size OFFSET v_offset
  ) t;

  RETURN json_build_object(
    'success', true,
    'data', COALESCE(v_batches, '[]'::json),
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_get_reconciliation_list TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_get_reconciliation_detail: 对账批次详情
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_get_reconciliation_detail(
  p_session_token text,
  p_batch_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_batch record;
  v_items json;
  v_adjustments json;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT * INTO v_batch FROM public.b2b_reconciliation_batches WHERE id = p_batch_id;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 对账批次不存在';
  END IF;

  -- 明细（含订单和付款流水信息）
  SELECT json_agg(row_to_json(t)) INTO v_items
  FROM (
    SELECT
      ri.id, ri.item_type, ri.expected_amount, ri.actual_amount,
      ri.matched_status, ri.difference_amount, ri.note, ri.created_at,
      -- 订单信息
      o.order_number, o.fulfillment_status, o.financial_status,
      o.receivable_total, o.paid_total, o.balance_due,
      -- 付款流水信息
      pt.transaction_type, pt.payment_method, pt.amount AS payment_amount,
      pt.status AS payment_status, pt.paid_at, pt.payer_name, pt.proof_url
    FROM public.b2b_reconciliation_items ri
    LEFT JOIN public.b2b_orders o ON o.id = ri.order_id
    LEFT JOIN public.b2b_payment_transactions pt ON pt.id = ri.payment_transaction_id
    WHERE ri.batch_id = p_batch_id
    ORDER BY ri.created_at ASC
  ) t;

  -- 调整记录
  SELECT json_agg(row_to_json(t)) INTO v_adjustments
  FROM (
    SELECT
      a.id, a.adjustment_type, a.amount, a.direction, a.reason,
      a.proof_url, a.status, a.created_at,
      o.order_number
    FROM public.b2b_order_adjustments a
    LEFT JOIN public.b2b_orders o ON o.id = a.order_id
    WHERE a.batch_id = p_batch_id
    ORDER BY a.created_at ASC
  ) t;

  RETURN json_build_object(
    'success', true,
    'batch', row_to_json(v_batch),
    'items', COALESCE(v_items, '[]'::json),
    'adjustments', COALESCE(v_adjustments, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_get_reconciliation_detail TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_add_adjustment: 添加差异调整（P1-3）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_add_adjustment(
  p_session_token text,
  p_batch_id uuid,
  p_order_id uuid,
  p_adjustment_type varchar,
  p_amount numeric,
  p_reason text,
  p_proof_url text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_batch record;
  v_adj_id uuid;
  v_new_adjustment_total numeric;
  v_new_final_diff numeric;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'add_adjustment' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_batch FROM public.b2b_reconciliation_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 对账批次不存在';
  END IF;
  IF v_batch.status = 'locked' THEN
    RAISE EXCEPTION 'ERR_BATCH_LOCKED: 对账批次已锁账，无法添加调整';
  END IF;
  IF v_batch.status = 'closed' THEN
    RAISE EXCEPTION 'ERR_BATCH_CLOSED: 对账批次已关闭';
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'ERR_REASON_REQUIRED: 调整原因不能为空';
  END IF;

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

  -- 写操作日志
  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, admin_id, new_value,
    order_id, actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'reconciliation_batch', p_batch_id, 'add_adjustment', v_admin_id,
    jsonb_build_object('adjustment_type', p_adjustment_type, 'amount', p_amount, 'reason', p_reason),
    p_order_id, v_admin_id, 'admin', 'add_adjustment', v_batch.status,
    jsonb_build_object('adj_id', v_adj_id, 'final_difference', v_new_final_diff)
  );

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

GRANT EXECUTE ON FUNCTION admin_b2b_add_adjustment TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_lock_reconciliation_batch: 锁账（P1-4）
-- 锁账后：禁止普通修改金额和流水，订单 locked_at 同步设置
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_lock_reconciliation_batch(
  p_session_token text,
  p_batch_id uuid,
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
  v_batch record;
  v_order_ids uuid[];
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'lock_recon_batch' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_batch FROM public.b2b_reconciliation_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 对账批次不存在';
  END IF;
  IF v_batch.status = 'locked' THEN
    RAISE EXCEPTION 'ERR_ALREADY_LOCKED: 对账批次已锁账';
  END IF;
  IF v_batch.status = 'closed' THEN
    RAISE EXCEPTION 'ERR_BATCH_CLOSED: 对账批次已关闭';
  END IF;

  -- 锁账批次
  UPDATE public.b2b_reconciliation_batches SET
    status = 'locked', locked_by = v_admin_id, locked_at = now(),
    note = COALESCE(p_note, note), updated_at = now()
  WHERE id = p_batch_id;

  -- 同步锁定相关订单（防止后续修改金额）
  SELECT array_agg(DISTINCT order_id) INTO v_order_ids
  FROM public.b2b_reconciliation_items
  WHERE batch_id = p_batch_id AND order_id IS NOT NULL;

  IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
    UPDATE public.b2b_orders SET
      locked_at = now(), locked_by = v_admin_id,
      lock_reason = '对账批次 ' || v_batch.batch_number || ' 锁账',
      reconciliation_status = 'locked', updated_at = now()
    WHERE id = ANY(v_order_ids) AND locked_at IS NULL;
  END IF;

  -- 写操作日志
  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, admin_id, new_value,
    actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'reconciliation_batch', p_batch_id, 'lock_batch', v_admin_id,
    jsonb_build_object('status', 'locked', 'note', p_note),
    v_admin_id, 'admin', 'lock_reconciliation_batch', 'locked',
    jsonb_build_object('batch_number', v_batch.batch_number, 'locked_order_count', array_length(v_order_ids, 1))
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('lock_recon_batch', p_idempotency_key, jsonb_build_object('batch_id', p_batch_id));
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', '对账批次已锁账',
    'locked_order_count', COALESCE(array_length(v_order_ids, 1), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_lock_reconciliation_batch TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_unlock_reconciliation_batch: 反锁账（P1-4，高权限）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_unlock_reconciliation_batch(
  p_session_token text,
  p_batch_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_batch record;
  v_order_ids uuid[];
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'ERR_REASON_REQUIRED: 反锁账原因不能为空';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'unlock_recon_batch' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_batch FROM public.b2b_reconciliation_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 对账批次不存在';
  END IF;
  IF v_batch.status != 'locked' THEN
    RAISE EXCEPTION 'ERR_NOT_LOCKED: 对账批次未处于锁账状态';
  END IF;

  -- 反锁账
  UPDATE public.b2b_reconciliation_batches SET
    status = 'reviewing',
    unlocked_by = v_admin_id, unlocked_at = now(),
    unlock_reason = p_reason, updated_at = now()
  WHERE id = p_batch_id;

  -- 解锁相关订单
  SELECT array_agg(DISTINCT order_id) INTO v_order_ids
  FROM public.b2b_reconciliation_items
  WHERE batch_id = p_batch_id AND order_id IS NOT NULL;

  IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
    UPDATE public.b2b_orders SET
      locked_at = NULL, locked_by = NULL, lock_reason = NULL,
      reconciliation_status = 'unreconciled', updated_at = now()
    WHERE id = ANY(v_order_ids) AND locked_by = v_batch.locked_by;
  END IF;

  -- 写操作日志
  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, admin_id, new_value,
    actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'reconciliation_batch', p_batch_id, 'unlock_batch', v_admin_id,
    jsonb_build_object('status', 'reviewing', 'reason', p_reason),
    v_admin_id, 'admin', 'unlock_reconciliation_batch', 'reviewing',
    jsonb_build_object('batch_number', v_batch.batch_number, 'reason', p_reason)
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('unlock_recon_batch', p_idempotency_key, jsonb_build_object('batch_id', p_batch_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '对账批次已反锁账，可继续修改');
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_unlock_reconciliation_batch TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_close_reconciliation_batch: 关闭批次
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_close_reconciliation_batch(
  p_session_token text,
  p_batch_id uuid,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_batch record;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT * INTO v_batch FROM public.b2b_reconciliation_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 对账批次不存在';
  END IF;
  IF v_batch.status = 'closed' THEN
    RAISE EXCEPTION 'ERR_ALREADY_CLOSED: 对账批次已关闭';
  END IF;

  UPDATE public.b2b_reconciliation_batches SET
    status = 'closed', closed_at = now(),
    note = COALESCE(p_note, note), updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, admin_id, new_value,
    actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'reconciliation_batch', p_batch_id, 'close_batch', v_admin_id,
    jsonb_build_object('status', 'closed'),
    v_admin_id, 'admin', 'close_reconciliation_batch', 'closed',
    jsonb_build_object('batch_number', v_batch.batch_number)
  );

  RETURN json_build_object('success', true, 'message', '对账批次已关闭');
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_close_reconciliation_batch TO anon, authenticated;

-- ============================================================================
-- P1-5: 利润重算 RPC
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_b2b_recalculate_profit: 重算单订单利润
-- 基于成本快照、签收数量、退款、折让、物流成本计算利润
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_recalculate_profit(
  p_session_token text,
  p_order_id uuid,
  p_reason text DEFAULT '手动重算',
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
  v_total_cost numeric(12,2) := 0;
  v_total_revenue numeric(12,2) := 0;
  v_total_adjustment numeric(12,2) := 0;
  v_gross_profit numeric(12,2);
  v_actual_profit numeric(12,2);
  v_has_missing_cost boolean := false;
  v_has_partial_cost boolean := false;
  v_item_count int := 0;
  v_cost_item_count int := 0;
  v_new_cost_status varchar;
  v_new_profit_status varchar;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM b2b_idempotency_keys WHERE scope = 'recalc_profit' AND idempotency_key = p_idempotency_key) THEN
      RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.b2b_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  -- 基于订单明细重算成本与收入
  FOR v_item IN
    SELECT
      oi.id,
      oi.cost_price_snapshot,
      oi.wholesale_price_snapshot,
      oi.unit_price,
      COALESCE(oi.delivered_quantity, oi.quantity) AS effective_qty,
      oi.returned_quantity,
      oi.item_status
    FROM public.b2b_order_items oi
    WHERE oi.order_id = p_order_id AND oi.item_status != 'cancelled'
  LOOP
    v_item_count := v_item_count + 1;
    -- 实际收入 = 签收数量 × 批发价（扣除退货）
    v_total_revenue := v_total_revenue +
      (COALESCE(v_item.effective_qty, 0) - COALESCE(v_item.returned_quantity, 0))
      * COALESCE(v_item.wholesale_price_snapshot, v_item.unit_price, 0);

    IF v_item.cost_price_snapshot IS NOT NULL THEN
      v_cost_item_count := v_cost_item_count + 1;
      v_total_cost := v_total_cost +
        (COALESCE(v_item.effective_qty, 0) - COALESCE(v_item.returned_quantity, 0))
        * v_item.cost_price_snapshot;
    ELSE
      v_has_missing_cost := true;
    END IF;
  END LOOP;

  -- 获取调整金额（折让、手续费等已审批的调整）
  SELECT COALESCE(SUM(amount * CASE WHEN direction = 'credit' THEN 1 ELSE -1 END), 0)
  INTO v_total_adjustment
  FROM public.b2b_order_adjustments
  WHERE order_id = p_order_id AND status = 'approved';

  -- 判断成本状态
  IF v_item_count = 0 THEN
    v_new_cost_status := 'missing';
    v_new_profit_status := 'cost_missing';
  ELSIF v_has_missing_cost AND v_cost_item_count = 0 THEN
    v_new_cost_status := 'missing';
    v_new_profit_status := 'cost_missing';
  ELSIF v_has_missing_cost THEN
    v_new_cost_status := 'partial';
    v_new_profit_status := 'cost_missing';
  ELSE
    v_new_cost_status := 'complete';
    v_new_profit_status := 'complete';
  END IF;

  -- 计算利润（成本缺失时为 NULL）
  IF v_new_cost_status IN ('complete') THEN
    v_gross_profit := v_total_revenue - v_total_cost;
    v_actual_profit := v_gross_profit + v_total_adjustment;
  ELSE
    v_gross_profit := NULL;
    v_actual_profit := NULL;
  END IF;

  -- 更新订单利润字段
  UPDATE public.b2b_orders SET
    total_cost_amount = CASE WHEN v_new_cost_status = 'complete' THEN v_total_cost ELSE total_cost_amount END,
    cost_total_snapshot = CASE WHEN v_new_cost_status = 'complete' THEN v_total_cost ELSE cost_total_snapshot END,
    gross_profit_amount = v_gross_profit,
    expected_gross_profit = v_gross_profit,
    cost_status = v_new_cost_status,
    profit_status = v_new_profit_status,
    updated_at = now()
  WHERE id = p_order_id;

  -- 更新订单明细的行利润
  UPDATE public.b2b_order_items SET
    line_profit_amount = CASE
      WHEN cost_price_snapshot IS NOT NULL THEN
        (COALESCE(delivered_quantity, quantity) - COALESCE(returned_quantity, 0))
        * (COALESCE(wholesale_price_snapshot, unit_price, 0) - cost_price_snapshot)
      ELSE NULL
    END,
    line_expected_profit = CASE
      WHEN cost_price_snapshot IS NOT NULL THEN
        quantity * (COALESCE(wholesale_price_snapshot, unit_price, 0) - cost_price_snapshot)
      ELSE NULL
    END
  WHERE order_id = p_order_id AND item_status != 'cancelled';

  -- 写操作日志
  INSERT INTO public.b2b_order_operation_logs (
    entity_type, entity_id, action, admin_id, new_value,
    order_id, actor_id, actor_type, operation, to_state, metadata
  ) VALUES (
    'order', p_order_id, 'recalculate_profit', v_admin_id,
    jsonb_build_object(
      'gross_profit', v_gross_profit, 'actual_profit', v_actual_profit,
      'total_cost', v_total_cost, 'total_revenue', v_total_revenue,
      'cost_status', v_new_cost_status
    ),
    p_order_id, v_admin_id, 'admin', 'recalculate_profit', v_new_profit_status,
    jsonb_build_object('reason', p_reason, 'adjustment_total', v_total_adjustment)
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('recalc_profit', p_idempotency_key, jsonb_build_object('order_id', p_order_id));
  END IF;

  RETURN json_build_object(
    'success', true,
    'order_id', p_order_id,
    'gross_profit', v_gross_profit,
    'actual_profit', v_actual_profit,
    'total_cost', v_total_cost,
    'total_revenue', v_total_revenue,
    'adjustment_total', v_total_adjustment,
    'cost_status', v_new_cost_status,
    'profit_status', v_new_profit_status,
    'message', '利润重算完成'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_recalculate_profit TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_batch_recalculate_profit: 批量重算利润
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_batch_recalculate_profit(
  p_session_token text,
  p_order_ids uuid[] DEFAULT NULL,   -- NULL 表示重算所有成本缺失的订单
  p_cost_status_filter varchar DEFAULT 'missing'  -- missing/partial/all
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_order_id uuid;
  v_success_count int := 0;
  v_fail_count int := 0;
  v_target_ids uuid[];
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_order_ids IS NOT NULL AND array_length(p_order_ids, 1) > 0 THEN
    v_target_ids := p_order_ids;
  ELSE
    SELECT array_agg(id) INTO v_target_ids
    FROM public.b2b_orders
    WHERE (p_cost_status_filter = 'all'
           OR (p_cost_status_filter = 'missing' AND cost_status IN ('missing', 'partial'))
           OR cost_status = p_cost_status_filter)
      AND fulfillment_status NOT IN ('cancelled')
    LIMIT 500;  -- 单次最多 500 条
  END IF;

  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) = 0 THEN
    RETURN json_build_object('success', true, 'message', '没有需要重算的订单', 'count', 0);
  END IF;

  FOREACH v_order_id IN ARRAY v_target_ids LOOP
    BEGIN
      PERFORM public.admin_b2b_recalculate_profit(p_session_token, v_order_id, '批量重算');
      v_success_count := v_success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail_count := v_fail_count + 1;
    END;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'total', array_length(v_target_ids, 1),
    'success_count', v_success_count,
    'fail_count', v_fail_count,
    'message', format('批量重算完成：成功 %s 条，失败 %s 条', v_success_count, v_fail_count)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_batch_recalculate_profit TO anon, authenticated;

-- ============================================================================
-- P1-6: 利润看板 RPC
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_b2b_profit_dashboard: 利润看板汇总
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_profit_dashboard(
  p_session_token text,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_customer_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_summary json;
  v_by_customer json;
  v_by_product json;
  v_cost_missing_orders json;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- 总体汇总
  SELECT json_build_object(
    'total_orders', COUNT(*),
    'total_revenue', COALESCE(SUM(receivable_total), 0),
    'total_paid', COALESCE(SUM(paid_total), 0),
    'total_balance_due', COALESCE(SUM(balance_due), 0),
    'total_cost', COALESCE(SUM(CASE WHEN cost_status = 'complete' THEN total_cost_amount ELSE NULL END), 0),
    'total_gross_profit', COALESCE(SUM(gross_profit_amount), 0),
    'cost_complete_count', COUNT(*) FILTER (WHERE cost_status = 'complete'),
    'cost_missing_count', COUNT(*) FILTER (WHERE cost_status IN ('missing', 'partial')),
    'avg_gross_margin', CASE
      WHEN SUM(CASE WHEN cost_status = 'complete' THEN receivable_total ELSE 0 END) > 0
      THEN ROUND(SUM(gross_profit_amount) / NULLIF(SUM(CASE WHEN cost_status = 'complete' THEN receivable_total ELSE 0 END), 0) * 100, 2)
      ELSE NULL
    END
  ) INTO v_summary
  FROM public.b2b_orders
  WHERE fulfillment_status NOT IN ('cancelled')
    AND (p_date_from IS NULL OR created_at::date >= p_date_from)
    AND (p_date_to IS NULL OR created_at::date <= p_date_to)
    AND (p_customer_id IS NULL OR user_id = p_customer_id);

  -- 按客户维度
  SELECT json_agg(row_to_json(t)) INTO v_by_customer
  FROM (
    SELECT
      o.user_id,
      COALESCE(wp.company_name, o.user_id) AS customer_name,
      COUNT(*) AS order_count,
      COALESCE(SUM(o.receivable_total), 0) AS total_revenue,
      COALESCE(SUM(o.paid_total), 0) AS total_paid,
      COALESCE(SUM(o.balance_due), 0) AS total_balance_due,
      COALESCE(SUM(o.gross_profit_amount), 0) AS total_profit,
      COUNT(*) FILTER (WHERE o.cost_status IN ('missing', 'partial')) AS cost_missing_count,
      CASE
        WHEN SUM(CASE WHEN o.cost_status = 'complete' THEN o.receivable_total ELSE 0 END) > 0
        THEN ROUND(SUM(o.gross_profit_amount) / NULLIF(SUM(CASE WHEN o.cost_status = 'complete' THEN o.receivable_total ELSE 0 END), 0) * 100, 2)
        ELSE NULL
      END AS avg_gross_margin
    FROM public.b2b_orders o
    LEFT JOIN public.wholesaler_profiles wp ON wp.user_id = o.user_id
    WHERE o.fulfillment_status NOT IN ('cancelled')
      AND (p_date_from IS NULL OR o.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at::date <= p_date_to)
      AND (p_customer_id IS NULL OR o.user_id = p_customer_id)
    GROUP BY o.user_id, wp.company_name
    ORDER BY total_revenue DESC
    LIMIT 20
  ) t;

  -- 按商品维度（Top 20）
  SELECT json_agg(row_to_json(t)) INTO v_by_product
  FROM (
    SELECT
      oi.product_id,
      COALESCE(oi.product_name_zh, oi.product_name, oi.product_name_original, oi.product_id::text) AS product_name,
      oi.sku,
      SUM(oi.quantity) AS total_quantity,
      COALESCE(SUM(oi.subtotal), 0) AS total_revenue,
      COALESCE(SUM(oi.line_cost_amount), 0) AS total_cost,
      COALESCE(SUM(oi.line_profit_amount), 0) AS total_profit,
      COUNT(DISTINCT oi.order_id) AS order_count,
      CASE
        WHEN SUM(oi.subtotal) > 0
        THEN ROUND(SUM(oi.line_profit_amount) / NULLIF(SUM(oi.subtotal), 0) * 100, 2)
        ELSE NULL
      END AS gross_margin
    FROM public.b2b_order_items oi
    JOIN public.b2b_orders o ON o.id = oi.order_id
    WHERE o.fulfillment_status NOT IN ('cancelled')
      AND oi.item_status NOT IN ('cancelled')
      AND (p_date_from IS NULL OR o.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at::date <= p_date_to)
      AND (p_customer_id IS NULL OR o.user_id = p_customer_id)
    GROUP BY oi.product_id, oi.product_name_zh, oi.product_name, oi.product_name_original, oi.sku
    ORDER BY total_revenue DESC
    LIMIT 20
  ) t;

  RETURN json_build_object(
    'success', true,
    'summary', v_summary,
    'by_customer', COALESCE(v_by_customer, '[]'::json),
    'by_product', COALESCE(v_by_product, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_profit_dashboard TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_b2b_profit_order_list: 利润订单明细列表（支持筛选）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_b2b_profit_order_list(
  p_session_token text,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_customer_id text DEFAULT NULL,
  p_cost_status varchar DEFAULT NULL,        -- missing/partial/complete
  p_profit_filter varchar DEFAULT NULL,      -- low_margin/negative/cost_missing/all
  p_min_margin numeric DEFAULT NULL,         -- 最低毛利率（%）
  p_max_margin numeric DEFAULT NULL,         -- 最高毛利率（%）
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
  v_total int;
  v_orders json;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);
  v_offset := (p_page - 1) * p_page_size;

  SELECT COUNT(*) INTO v_total
  FROM public.b2b_orders o
  WHERE o.fulfillment_status NOT IN ('cancelled')
    AND (p_date_from IS NULL OR o.created_at::date >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at::date <= p_date_to)
    AND (p_customer_id IS NULL OR o.user_id = p_customer_id)
    AND (p_cost_status IS NULL OR o.cost_status = p_cost_status)
    AND (p_profit_filter IS NULL
         OR (p_profit_filter = 'cost_missing' AND o.cost_status IN ('missing', 'partial'))
         OR (p_profit_filter = 'negative' AND o.gross_profit_amount < 0)
         OR (p_profit_filter = 'low_margin' AND o.cost_status = 'complete'
             AND o.receivable_total > 0
             AND (o.gross_profit_amount / o.receivable_total * 100) < COALESCE(p_min_margin, 20))
        );

  SELECT json_agg(row_to_json(t)) INTO v_orders
  FROM (
    SELECT
      o.id, o.order_number, o.user_id,
      COALESCE(wp.company_name, o.user_id) AS customer_name,
      o.fulfillment_status, o.financial_status,
      o.receivable_total, o.paid_total, o.balance_due,
      o.total_cost_amount, o.gross_profit_amount, o.expected_gross_profit,
      o.cost_status, o.profit_status,
      CASE
        WHEN o.cost_status = 'complete' AND o.receivable_total > 0
        THEN ROUND(o.gross_profit_amount / o.receivable_total * 100, 2)
        ELSE NULL
      END AS gross_margin_pct,
      o.item_count, o.total_quantity,
      o.created_at, o.updated_at
    FROM public.b2b_orders o
    LEFT JOIN public.wholesaler_profiles wp ON wp.user_id = o.user_id
    WHERE o.fulfillment_status NOT IN ('cancelled')
      AND (p_date_from IS NULL OR o.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at::date <= p_date_to)
      AND (p_customer_id IS NULL OR o.user_id = p_customer_id)
      AND (p_cost_status IS NULL OR o.cost_status = p_cost_status)
      AND (p_profit_filter IS NULL
           OR (p_profit_filter = 'cost_missing' AND o.cost_status IN ('missing', 'partial'))
           OR (p_profit_filter = 'negative' AND o.gross_profit_amount < 0)
           OR (p_profit_filter = 'low_margin' AND o.cost_status = 'complete'
               AND o.receivable_total > 0
               AND (o.gross_profit_amount / o.receivable_total * 100) < COALESCE(p_min_margin, 20))
          )
    ORDER BY o.created_at DESC
    LIMIT p_page_size OFFSET v_offset
  ) t;

  RETURN json_build_object(
    'success', true,
    'data', COALESCE(v_orders, '[]'::json),
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_b2b_profit_order_list TO anon, authenticated;

-- ============================================================================
-- 最终权限授予（确保 service_role 可以访问所有新表）
-- ============================================================================

GRANT ALL ON public.b2b_reconciliation_batches TO service_role;
GRANT ALL ON public.b2b_reconciliation_items TO service_role;
GRANT ALL ON public.b2b_order_adjustments TO service_role;
