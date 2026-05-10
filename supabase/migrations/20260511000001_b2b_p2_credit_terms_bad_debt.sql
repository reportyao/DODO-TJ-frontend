-- ============================================================================
-- B2B P2 迁移：授信额度 + 账期管理 + 逾期催收 + 坏账核销 + 导出审计 + 性能视图
-- 日期: 2026-05-11
-- 版本: P2 v1
--
-- 设计原则:
--   1. 不破坏 P0/P1 既有订单、对账、利润函数，全部以 ADD COLUMN/CREATE IF NOT EXISTS 扩展。
--   2. 管理端写操作统一走 SECURITY DEFINER RPC，表级 RLS 默认拒绝直接访问。
--   3. 前台下单 RPC 在本迁移后半部分覆盖为“已审核批发商 + 授信额度 + 账期风控”版本。
--   4. 对外导出由后台页面生成 CSV，本表只记录导出审计与可追溯元数据。
-- ============================================================================

-- ============================================================================
-- P2-1: 批发商授信与账期字段
-- ============================================================================

ALTER TABLE public.wholesaler_profiles
  ADD COLUMN IF NOT EXISTS credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_used numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_available numeric(12,2) GENERATED ALWAYS AS (GREATEST(credit_limit - credit_used, 0)) STORED,
  ADD COLUMN IF NOT EXISTS payment_terms_days int NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS credit_status varchar(30) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS credit_note text,
  ADD COLUMN IF NOT EXISTS credit_updated_by uuid,
  ADD COLUMN IF NOT EXISTS credit_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_overdue_at timestamptz,
  ADD COLUMN IF NOT EXISTS overdue_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bad_debt_total numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.wholesaler_profiles.credit_limit IS 'P2 授信额度。0 表示不允许赊销下单，只能在额度内创建账期订单。';
COMMENT ON COLUMN public.wholesaler_profiles.credit_used IS 'P2 当前占用授信，按未结清且未核销订单余额聚合回写。';
COMMENT ON COLUMN public.wholesaler_profiles.credit_available IS 'P2 可用授信额度，自动计算 credit_limit-credit_used，不允许小于 0。';
COMMENT ON COLUMN public.wholesaler_profiles.payment_terms_days IS 'P2 账期天数，用于订单 payment_due_at 自动计算。';
COMMENT ON COLUMN public.wholesaler_profiles.credit_status IS 'P2 授信状态: normal/on_hold/overdue/bad_debt/disabled。';

DO $$
BEGIN
  ALTER TABLE public.wholesaler_profiles DROP CONSTRAINT IF EXISTS chk_wholesaler_credit_status;
  ALTER TABLE public.wholesaler_profiles ADD CONSTRAINT chk_wholesaler_credit_status
    CHECK (credit_status IN ('normal', 'on_hold', 'overdue', 'bad_debt', 'disabled'));

  ALTER TABLE public.wholesaler_profiles DROP CONSTRAINT IF EXISTS chk_wholesaler_credit_limit_non_negative;
  ALTER TABLE public.wholesaler_profiles ADD CONSTRAINT chk_wholesaler_credit_limit_non_negative
    CHECK (credit_limit >= 0 AND credit_used >= 0 AND payment_terms_days >= 0 AND overdue_amount >= 0 AND bad_debt_total >= 0);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P2 wholesaler credit constraint update skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- P2-2: 订单账期、逾期、坏账字段
-- ============================================================================

ALTER TABLE public.b2b_orders
  ADD COLUMN IF NOT EXISTS payment_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_terms_days int,
  ADD COLUMN IF NOT EXISTS credit_limit_snapshot numeric(12,2),
  ADD COLUMN IF NOT EXISTS credit_used_before numeric(12,2),
  ADD COLUMN IF NOT EXISTS credit_used_after numeric(12,2),
  ADD COLUMN IF NOT EXISTS risk_status varchar(30) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS overdue_days int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overdue_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS collection_status varchar(30) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS collection_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS collection_next_at timestamptz,
  ADD COLUMN IF NOT EXISTS bad_debt_status varchar(30) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS bad_debt_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bad_debt_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS bad_debt_marked_by uuid,
  ADD COLUMN IF NOT EXISTS writeoff_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS written_off_at timestamptz,
  ADD COLUMN IF NOT EXISTS written_off_by uuid,
  ADD COLUMN IF NOT EXISTS risk_note text;

COMMENT ON COLUMN public.b2b_orders.payment_due_at IS 'P2 账期到期时间，按批发商 payment_terms_days 在下单时快照计算。';
COMMENT ON COLUMN public.b2b_orders.risk_status IS 'P2 风控状态: normal/due_soon/overdue/collection/bad_debt/written_off。';
COMMENT ON COLUMN public.b2b_orders.collection_status IS 'P2 催收状态: none/pending/contacted/promised/escalated/paused/closed。';
COMMENT ON COLUMN public.b2b_orders.bad_debt_status IS 'P2 坏账状态: none/pending/approved/rejected/written_off/recovered。';

DO $$
BEGIN
  ALTER TABLE public.b2b_orders DROP CONSTRAINT IF EXISTS chk_b2b_order_risk_status;
  ALTER TABLE public.b2b_orders ADD CONSTRAINT chk_b2b_order_risk_status
    CHECK (risk_status IN ('normal', 'due_soon', 'overdue', 'collection', 'bad_debt', 'written_off'));

  ALTER TABLE public.b2b_orders DROP CONSTRAINT IF EXISTS chk_b2b_order_collection_status;
  ALTER TABLE public.b2b_orders ADD CONSTRAINT chk_b2b_order_collection_status
    CHECK (collection_status IN ('none', 'pending', 'contacted', 'promised', 'escalated', 'paused', 'closed'));

  ALTER TABLE public.b2b_orders DROP CONSTRAINT IF EXISTS chk_b2b_order_bad_debt_status;
  ALTER TABLE public.b2b_orders ADD CONSTRAINT chk_b2b_order_bad_debt_status
    CHECK (bad_debt_status IN ('none', 'pending', 'approved', 'rejected', 'written_off', 'recovered'));

  ALTER TABLE public.b2b_orders DROP CONSTRAINT IF EXISTS chk_b2b_order_credit_non_negative;
  ALTER TABLE public.b2b_orders ADD CONSTRAINT chk_b2b_order_credit_non_negative
    CHECK (
      COALESCE(payment_terms_days, 0) >= 0
      AND overdue_days >= 0
      AND bad_debt_amount >= 0
      AND writeoff_amount >= 0
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P2 b2b_orders risk constraint update skipped: %', SQLERRM;
END $$;

-- 扩展财务状态约束，允许 P2 坏账/核销状态被财务与风控页面识别。
DO $$
BEGIN
  ALTER TABLE public.b2b_orders DROP CONSTRAINT IF EXISTS chk_b2b_financial_status;
  ALTER TABLE public.b2b_orders ADD CONSTRAINT chk_b2b_financial_status
    CHECK (financial_status IN ('unpaid', 'partial_paid', 'paid', 'overpaid', 'refunded', 'bad_debt', 'written_off'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P2 financial_status constraint update skipped: %', SQLERRM;
END $$;

-- 历史订单补齐账期到期时间，避免逾期报表出现空洞。
UPDATE public.b2b_orders o
SET
  payment_terms_days = COALESCE(o.payment_terms_days, wp.payment_terms_days, 7),
  payment_due_at = COALESCE(o.payment_due_at, o.created_at + make_interval(days => COALESCE(wp.payment_terms_days, 7)))
FROM public.wholesaler_profiles wp
WHERE o.user_id::text = wp.user_id::text
  AND o.payment_due_at IS NULL
  AND COALESCE(o.financial_status, 'unpaid') NOT IN ('paid', 'overpaid', 'refunded', 'written_off');

-- ============================================================================
-- P2-3: 授信事件、催收记录、坏账核销与导出审计表
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.b2b_credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wholesaler_id uuid REFERENCES public.wholesaler_profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.b2b_orders(id) ON DELETE SET NULL,
  event_type varchar(50) NOT NULL,
  amount numeric(12,2),
  credit_limit_before numeric(12,2),
  credit_limit_after numeric(12,2),
  credit_used_before numeric(12,2),
  credit_used_after numeric(12,2),
  payment_terms_before int,
  payment_terms_after int,
  note text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_credit_events IS 'P2 授信、额度占用、逾期、催收、坏账与账期变更事件流水。';

CREATE TABLE IF NOT EXISTS public.b2b_collection_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.b2b_orders(id) ON DELETE CASCADE,
  wholesaler_id uuid REFERENCES public.wholesaler_profiles(id) ON DELETE SET NULL,
  contact_method varchar(50) NOT NULL DEFAULT 'phone',
  contact_result varchar(50) NOT NULL DEFAULT 'contacted',
  promised_pay_at timestamptz,
  next_follow_up_at timestamptz,
  note text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_collection_records IS 'P2 逾期催收记录，按订单沉淀电话、WhatsApp、上门、承诺付款等过程。';

CREATE TABLE IF NOT EXISTS public.b2b_bad_debt_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.b2b_orders(id) ON DELETE CASCADE,
  wholesaler_id uuid REFERENCES public.wholesaler_profiles(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  proof_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejected_reason text,
  written_off_by uuid,
  written_off_at timestamptz,
  recovered_amount numeric(12,2) NOT NULL DEFAULT 0,
  recovered_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_bad_debt_records IS 'P2 坏账申请、审批、核销与回收记录。';

CREATE TABLE IF NOT EXISTS public.b2b_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type varchar(50) NOT NULL,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count int NOT NULL DEFAULT 0,
  file_name text,
  status varchar(30) NOT NULL DEFAULT 'completed',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_export_jobs IS 'P2 管理后台导出审计表，用于记录授信、逾期、坏账与利润导出的条件和行数。';

DO $$
BEGIN
  ALTER TABLE public.b2b_credit_events DROP CONSTRAINT IF EXISTS chk_b2b_credit_event_type;
  ALTER TABLE public.b2b_credit_events ADD CONSTRAINT chk_b2b_credit_event_type
    CHECK (event_type IN ('credit_set', 'credit_recalculate', 'credit_hold', 'credit_release', 'order_credit_hold', 'payment_credit_release', 'overdue_marked', 'collection_note', 'bad_debt_requested', 'bad_debt_approved', 'bad_debt_rejected', 'bad_debt_written_off', 'bad_debt_recovered', 'payment_terms_updated'));

  ALTER TABLE public.b2b_collection_records DROP CONSTRAINT IF EXISTS chk_b2b_collection_method;
  ALTER TABLE public.b2b_collection_records ADD CONSTRAINT chk_b2b_collection_method
    CHECK (contact_method IN ('phone', 'whatsapp', 'telegram', 'sms', 'email', 'visit', 'other'));

  ALTER TABLE public.b2b_collection_records DROP CONSTRAINT IF EXISTS chk_b2b_collection_result;
  ALTER TABLE public.b2b_collection_records ADD CONSTRAINT chk_b2b_collection_result
    CHECK (contact_result IN ('pending', 'contacted', 'no_answer', 'promised', 'disputed', 'refused', 'escalated', 'closed'));

  ALTER TABLE public.b2b_bad_debt_records DROP CONSTRAINT IF EXISTS chk_b2b_bad_debt_status;
  ALTER TABLE public.b2b_bad_debt_records ADD CONSTRAINT chk_b2b_bad_debt_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'written_off', 'recovered'));

  ALTER TABLE public.b2b_export_jobs DROP CONSTRAINT IF EXISTS chk_b2b_export_job_status;
  ALTER TABLE public.b2b_export_jobs ADD CONSTRAINT chk_b2b_export_job_status
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'P2 auxiliary constraint update skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- P2-4: 索引与性能优化
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_wholesaler_profiles_credit_status ON public.wholesaler_profiles(credit_status);
CREATE INDEX IF NOT EXISTS idx_wholesaler_profiles_credit_limit ON public.wholesaler_profiles(credit_limit DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_payment_due_at ON public.b2b_orders(payment_due_at) WHERE financial_status IN ('unpaid', 'partial_paid', 'bad_debt');
CREATE INDEX IF NOT EXISTS idx_b2b_orders_risk_status ON public.b2b_orders(risk_status);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_collection_status ON public.b2b_orders(collection_status);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_bad_debt_status ON public.b2b_orders(bad_debt_status);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_user_financial_due ON public.b2b_orders(user_id, financial_status, payment_due_at);
CREATE INDEX IF NOT EXISTS idx_b2b_credit_events_wholesaler_created ON public.b2b_credit_events(wholesaler_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_credit_events_order_created ON public.b2b_credit_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_collection_records_order_created ON public.b2b_collection_records(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_collection_records_next_follow_up ON public.b2b_collection_records(next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_bad_debt_records_order ON public.b2b_bad_debt_records(order_id);
CREATE INDEX IF NOT EXISTS idx_b2b_bad_debt_records_status ON public.b2b_bad_debt_records(status);
CREATE INDEX IF NOT EXISTS idx_b2b_export_jobs_created_by ON public.b2b_export_jobs(created_by, created_at DESC);

-- ============================================================================
-- P2-5: RLS 与安全边界
-- ============================================================================

ALTER TABLE public.b2b_credit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_collection_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_bad_debt_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_export_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "deny_all_b2b_credit_events" ON public.b2b_credit_events;
  CREATE POLICY "deny_all_b2b_credit_events" ON public.b2b_credit_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "deny_all_b2b_collection_records" ON public.b2b_collection_records;
  CREATE POLICY "deny_all_b2b_collection_records" ON public.b2b_collection_records FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "deny_all_b2b_bad_debt_records" ON public.b2b_bad_debt_records;
  CREATE POLICY "deny_all_b2b_bad_debt_records" ON public.b2b_bad_debt_records FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "deny_all_b2b_export_jobs" ON public.b2b_export_jobs;
  CREATE POLICY "deny_all_b2b_export_jobs" ON public.b2b_export_jobs FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================================
-- P2-6: 管理端只读性能视图
-- ============================================================================

CREATE OR REPLACE VIEW public.v_b2b_credit_overview AS
SELECT
  wp.id AS wholesaler_id,
  wp.user_id::text AS user_id,
  wp.company_name,
  wp.contact_phone,
  wp.status AS wholesaler_status,
  wp.credit_status,
  wp.credit_limit,
  wp.credit_used,
  wp.credit_available,
  wp.payment_terms_days,
  wp.overdue_amount,
  wp.bad_debt_total,
  wp.credit_note,
  wp.credit_updated_at,
  wp.last_overdue_at,
  COALESCE(os.open_order_count, 0) AS open_order_count,
  COALESCE(os.open_balance_due, 0) AS open_balance_due,
  COALESCE(os.overdue_order_count, 0) AS overdue_order_count,
  COALESCE(os.overdue_balance_due, 0) AS overdue_balance_due,
  COALESCE(os.due_soon_order_count, 0) AS due_soon_order_count,
  COALESCE(os.max_overdue_days, 0) AS max_overdue_days,
  COALESCE(bd.bad_debt_count, 0) AS bad_debt_count,
  COALESCE(bd.pending_bad_debt_amount, 0) AS pending_bad_debt_amount,
  COALESCE(bd.written_off_amount, 0) AS written_off_amount,
  CASE WHEN wp.credit_limit > 0 THEN ROUND((wp.credit_used / wp.credit_limit) * 100, 2) ELSE 0 END AS credit_usage_percent,
  wp.created_at,
  wp.updated_at
FROM public.wholesaler_profiles wp
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE o.fulfillment_status <> 'cancelled' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')) AS open_order_count,
    COALESCE(SUM(o.balance_due) FILTER (WHERE o.fulfillment_status <> 'cancelled' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')), 0) AS open_balance_due,
    COUNT(*) FILTER (WHERE o.fulfillment_status <> 'cancelled' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt') AND o.payment_due_at < now()) AS overdue_order_count,
    COALESCE(SUM(o.balance_due) FILTER (WHERE o.fulfillment_status <> 'cancelled' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt') AND o.payment_due_at < now()), 0) AS overdue_balance_due,
    COUNT(*) FILTER (WHERE o.fulfillment_status <> 'cancelled' AND o.financial_status IN ('unpaid', 'partial_paid') AND o.payment_due_at >= now() AND o.payment_due_at < now() + interval '3 days') AS due_soon_order_count,
    COALESCE(MAX(GREATEST(EXTRACT(day FROM now() - o.payment_due_at)::int, 0)) FILTER (WHERE o.payment_due_at < now() AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')), 0) AS max_overdue_days
  FROM public.b2b_orders o
  WHERE o.user_id::text = wp.user_id::text
) os ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS bad_debt_count,
    COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'approved')), 0) AS pending_bad_debt_amount,
    COALESCE(SUM(amount) FILTER (WHERE status = 'written_off'), 0) AS written_off_amount
  FROM public.b2b_bad_debt_records r
  WHERE r.wholesaler_id = wp.id
) bd ON true;

COMMENT ON VIEW public.v_b2b_credit_overview IS 'P2 管理端授信总览视图，汇总客户额度、账期、逾期和坏账指标。';

CREATE OR REPLACE VIEW public.v_b2b_overdue_orders AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.user_id::text AS user_id,
  wp.id AS wholesaler_id,
  wp.company_name,
  wp.contact_phone,
  wp.credit_status,
  o.total_amount,
  o.receivable_total,
  o.paid_total,
  o.balance_due,
  o.financial_status,
  o.fulfillment_status,
  o.payment_due_at,
  GREATEST(EXTRACT(day FROM now() - o.payment_due_at)::int, 0) AS overdue_days_live,
  o.overdue_days AS overdue_days_snapshot,
  o.risk_status,
  o.collection_status,
  o.collection_last_at,
  o.collection_next_at,
  o.bad_debt_status,
  o.created_at,
  o.updated_at
FROM public.b2b_orders o
LEFT JOIN public.wholesaler_profiles wp ON wp.user_id::text = o.user_id::text
WHERE o.fulfillment_status <> 'cancelled'
  AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')
  AND o.payment_due_at IS NOT NULL
  AND o.payment_due_at < now();

COMMENT ON VIEW public.v_b2b_overdue_orders IS 'P2 管理端逾期订单视图，用于催收、账龄和导出。';

-- 账龄统计物化视图：后台列表读 v_b2b_credit_overview，账龄看板可读此视图。
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_b2b_aging_summary AS
SELECT
  wp.id AS wholesaler_id,
  wp.user_id::text AS user_id,
  wp.company_name,
  COUNT(o.id) FILTER (WHERE o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')) AS outstanding_order_count,
  COALESCE(SUM(o.balance_due) FILTER (WHERE o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')), 0) AS outstanding_amount,
  COALESCE(SUM(o.balance_due) FILTER (WHERE o.payment_due_at >= now() AND o.financial_status IN ('unpaid', 'partial_paid')), 0) AS not_due_amount,
  COALESCE(SUM(o.balance_due) FILTER (WHERE o.payment_due_at < now() AND o.payment_due_at >= now() - interval '7 days' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')), 0) AS overdue_1_7_amount,
  COALESCE(SUM(o.balance_due) FILTER (WHERE o.payment_due_at < now() - interval '7 days' AND o.payment_due_at >= now() - interval '30 days' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')), 0) AS overdue_8_30_amount,
  COALESCE(SUM(o.balance_due) FILTER (WHERE o.payment_due_at < now() - interval '30 days' AND o.payment_due_at >= now() - interval '60 days' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')), 0) AS overdue_31_60_amount,
  COALESCE(SUM(o.balance_due) FILTER (WHERE o.payment_due_at < now() - interval '60 days' AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')), 0) AS overdue_60_plus_amount,
  now() AS refreshed_at
FROM public.wholesaler_profiles wp
LEFT JOIN public.b2b_orders o ON o.user_id::text = wp.user_id::text AND o.fulfillment_status <> 'cancelled'
GROUP BY wp.id, wp.user_id, wp.company_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_b2b_aging_summary_wholesaler ON public.mv_b2b_aging_summary(wholesaler_id);

-- ============================================================================
-- P2-7: 基础权限
-- ============================================================================

GRANT SELECT ON public.v_b2b_credit_overview TO anon, authenticated;
GRANT SELECT ON public.v_b2b_overdue_orders TO anon, authenticated;
GRANT SELECT ON public.mv_b2b_aging_summary TO anon, authenticated;

-- ============================================================================
-- P2-8: 授信重算辅助函数与订单触发器
-- ============================================================================

CREATE OR REPLACE FUNCTION public.b2b_recalculate_credit_for_user(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_credit_used numeric(12,2) := 0;
  v_overdue_amount numeric(12,2) := 0;
  v_bad_debt_total numeric(12,2) := 0;
  v_overdue_count int := 0;
  v_new_status varchar(30);
BEGIN
  SELECT * INTO v_profile
  FROM public.wholesaler_profiles
  WHERE user_id::text = p_user_id::text
  FOR UPDATE;

  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ERR_PROFILE_NOT_FOUND');
  END IF;

  SELECT
    COALESCE(SUM(o.balance_due) FILTER (
      WHERE o.fulfillment_status <> 'cancelled'
        AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')
        AND o.bad_debt_status <> 'written_off'
    ), 0),
    COALESCE(SUM(o.balance_due) FILTER (
      WHERE o.fulfillment_status <> 'cancelled'
        AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')
        AND o.payment_due_at IS NOT NULL
        AND o.payment_due_at < now()
        AND o.bad_debt_status <> 'written_off'
    ), 0),
    COUNT(*) FILTER (
      WHERE o.fulfillment_status <> 'cancelled'
        AND o.financial_status IN ('unpaid', 'partial_paid', 'bad_debt')
        AND o.payment_due_at IS NOT NULL
        AND o.payment_due_at < now()
        AND o.bad_debt_status <> 'written_off'
    )::int
  INTO v_credit_used, v_overdue_amount, v_overdue_count
  FROM public.b2b_orders o
  WHERE o.user_id::text = p_user_id::text;

  SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('approved', 'written_off')), 0)
  INTO v_bad_debt_total
  FROM public.b2b_bad_debt_records
  WHERE wholesaler_id = v_profile.id;

  v_new_status := CASE
    WHEN v_profile.credit_status IN ('disabled', 'on_hold') THEN v_profile.credit_status
    WHEN v_bad_debt_total > 0 THEN 'bad_debt'
    WHEN v_overdue_count > 0 THEN 'overdue'
    ELSE 'normal'
  END;

  UPDATE public.wholesaler_profiles
  SET
    credit_used = v_credit_used,
    overdue_amount = v_overdue_amount,
    bad_debt_total = v_bad_debt_total,
    last_overdue_at = CASE WHEN v_overdue_count > 0 THEN COALESCE(last_overdue_at, now()) ELSE last_overdue_at END,
    credit_status = v_new_status,
    updated_at = now()
  WHERE id = v_profile.id;

  INSERT INTO public.b2b_credit_events(
    wholesaler_id, event_type,
    credit_used_before, credit_used_after,
    credit_limit_before, credit_limit_after,
    metadata
  ) VALUES (
    v_profile.id, 'credit_recalculate',
    v_profile.credit_used, v_credit_used,
    v_profile.credit_limit, v_profile.credit_limit,
    jsonb_build_object('overdue_amount', v_overdue_amount, 'bad_debt_total', v_bad_debt_total, 'credit_status', v_new_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'wholesaler_id', v_profile.id,
    'credit_used', v_credit_used,
    'overdue_amount', v_overdue_amount,
    'bad_debt_total', v_bad_debt_total,
    'credit_status', v_new_status
  );
END;
$$;

COMMENT ON FUNCTION public.b2b_recalculate_credit_for_user(text) IS 'P2 内部辅助：按用户重算批发商授信占用、逾期金额和坏账金额。';

CREATE OR REPLACE FUNCTION public.trg_b2b_order_recalculate_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.b2b_recalculate_credit_for_user(NEW.user_id::text);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      PERFORM public.b2b_recalculate_credit_for_user(OLD.user_id::text);
      PERFORM public.b2b_recalculate_credit_for_user(NEW.user_id::text);
    ELSIF NEW.balance_due IS DISTINCT FROM OLD.balance_due
       OR NEW.financial_status IS DISTINCT FROM OLD.financial_status
       OR NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status
       OR NEW.payment_due_at IS DISTINCT FROM OLD.payment_due_at
       OR NEW.bad_debt_status IS DISTINCT FROM OLD.bad_debt_status THEN
      PERFORM public.b2b_recalculate_credit_for_user(NEW.user_id::text);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.b2b_recalculate_credit_for_user(OLD.user_id::text);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_b2b_order_recalculate_credit ON public.b2b_orders;
CREATE TRIGGER trg_b2b_order_recalculate_credit
AFTER INSERT OR UPDATE OF user_id, balance_due, financial_status, fulfillment_status, payment_due_at, bad_debt_status OR DELETE
ON public.b2b_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_b2b_order_recalculate_credit();

-- ============================================================================
-- P2-9: 管理端授信、账期、催收、坏账与导出 RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_b2b_credit_dashboard(
  p_session_token text,
  p_credit_status text DEFAULT NULL,
  p_keyword text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_items json;
  v_total int;
  v_aging json;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT COUNT(*) INTO v_total
  FROM public.v_b2b_credit_overview c
  WHERE (p_credit_status IS NULL OR p_credit_status = 'all' OR c.credit_status = p_credit_status)
    AND (
      p_keyword IS NULL OR p_keyword = ''
      OR c.company_name ILIKE '%' || p_keyword || '%'
      OR c.contact_phone ILIKE '%' || p_keyword || '%'
      OR c.user_id ILIKE '%' || p_keyword || '%'
    );

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_items
  FROM (
    SELECT *
    FROM public.v_b2b_credit_overview c
    WHERE (p_credit_status IS NULL OR p_credit_status = 'all' OR c.credit_status = p_credit_status)
      AND (
        p_keyword IS NULL OR p_keyword = ''
        OR c.company_name ILIKE '%' || p_keyword || '%'
        OR c.contact_phone ILIKE '%' || p_keyword || '%'
        OR c.user_id ILIKE '%' || p_keyword || '%'
      )
    ORDER BY c.overdue_balance_due DESC, c.credit_used DESC, c.updated_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  SELECT json_build_object(
    'customer_count', COUNT(*),
    'credit_limit_total', COALESCE(SUM(credit_limit), 0),
    'credit_used_total', COALESCE(SUM(credit_used), 0),
    'overdue_amount_total', COALESCE(SUM(overdue_amount), 0),
    'bad_debt_total', COALESCE(SUM(bad_debt_total), 0),
    'overdue_customer_count', COUNT(*) FILTER (WHERE overdue_amount > 0),
    'bad_debt_customer_count', COUNT(*) FILTER (WHERE bad_debt_total > 0)
  ) INTO v_aging
  FROM public.v_b2b_credit_overview;

  RETURN json_build_object('success', true, 'items', v_items, 'total', v_total, 'summary', v_aging);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_update_wholesaler_credit(
  p_session_token text,
  p_wholesaler_id uuid,
  p_credit_limit numeric DEFAULT NULL,
  p_payment_terms_days int DEFAULT NULL,
  p_credit_status text DEFAULT NULL,
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
  v_profile record;
  v_new_limit numeric(12,2);
  v_new_terms int;
  v_new_status text;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.b2b_idempotency_keys WHERE scope = 'update_credit' AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
  END IF;

  SELECT * INTO v_profile FROM public.wholesaler_profiles WHERE id = p_wholesaler_id FOR UPDATE;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 批发商不存在';
  END IF;

  v_new_limit := COALESCE(p_credit_limit, v_profile.credit_limit);
  v_new_terms := COALESCE(p_payment_terms_days, v_profile.payment_terms_days);
  v_new_status := COALESCE(NULLIF(p_credit_status, ''), v_profile.credit_status);

  IF v_new_limit < 0 OR v_new_terms < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_CREDIT: 授信额度和账期不能为负数';
  END IF;
  IF v_new_status NOT IN ('normal', 'on_hold', 'overdue', 'bad_debt', 'disabled') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATUS: 无效授信状态 %', v_new_status;
  END IF;

  UPDATE public.wholesaler_profiles
  SET
    credit_limit = v_new_limit,
    payment_terms_days = v_new_terms,
    credit_status = v_new_status,
    credit_note = p_note,
    credit_updated_by = v_admin_id,
    credit_updated_at = now(),
    updated_at = now()
  WHERE id = p_wholesaler_id;

  INSERT INTO public.b2b_credit_events(
    wholesaler_id, event_type,
    amount,
    credit_limit_before, credit_limit_after,
    credit_used_before, credit_used_after,
    payment_terms_before, payment_terms_after,
    note, created_by
  ) VALUES (
    p_wholesaler_id,
    CASE WHEN v_new_terms <> v_profile.payment_terms_days AND v_new_limit = v_profile.credit_limit THEN 'payment_terms_updated' ELSE 'credit_set' END,
    v_new_limit,
    v_profile.credit_limit, v_new_limit,
    v_profile.credit_used, v_profile.credit_used,
    v_profile.payment_terms_days, v_new_terms,
    p_note, v_admin_id
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('update_credit', p_idempotency_key, jsonb_build_object('wholesaler_id', p_wholesaler_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '授信信息已更新', 'wholesaler_id', p_wholesaler_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_recalculate_credit(
  p_session_token text,
  p_wholesaler_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_profile record;
  v_count int := 0;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  FOR v_profile IN
    SELECT id, user_id FROM public.wholesaler_profiles
    WHERE p_wholesaler_id IS NULL OR id = p_wholesaler_id
  LOOP
    PERFORM public.b2b_recalculate_credit_for_user(v_profile.user_id::text);
    v_count := v_count + 1;
  END LOOP;

  REFRESH MATERIALIZED VIEW public.mv_b2b_aging_summary;

  RETURN json_build_object('success', true, 'message', '授信占用已重算', 'processed_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_mark_overdue(
  p_session_token text,
  p_order_ids uuid[] DEFAULT NULL,
  p_overdue_days_threshold int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_count int := 0;
  v_order record;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  FOR v_order IN
    SELECT o.*, wp.id AS wholesaler_id
    FROM public.b2b_orders o
    LEFT JOIN public.wholesaler_profiles wp ON wp.user_id::text = o.user_id::text
    WHERE o.fulfillment_status <> 'cancelled'
      AND o.financial_status IN ('unpaid', 'partial_paid')
      AND o.payment_due_at IS NOT NULL
      AND o.payment_due_at < now() - make_interval(days => GREATEST(COALESCE(p_overdue_days_threshold, 0), 0))
      AND (p_order_ids IS NULL OR o.id = ANY(p_order_ids))
    FOR UPDATE OF o
  LOOP
    UPDATE public.b2b_orders
    SET
      risk_status = CASE WHEN v_order.risk_status = 'bad_debt' THEN v_order.risk_status ELSE 'overdue' END,
      overdue_days = GREATEST(EXTRACT(day FROM now() - v_order.payment_due_at)::int, 0),
      overdue_marked_at = COALESCE(overdue_marked_at, now()),
      collection_status = CASE WHEN collection_status = 'none' THEN 'pending' ELSE collection_status END,
      updated_at = now()
    WHERE id = v_order.id;

    IF v_order.wholesaler_id IS NOT NULL THEN
      UPDATE public.wholesaler_profiles
      SET credit_status = CASE WHEN credit_status IN ('disabled', 'on_hold', 'bad_debt') THEN credit_status ELSE 'overdue' END,
          last_overdue_at = COALESCE(last_overdue_at, now()),
          updated_at = now()
      WHERE id = v_order.wholesaler_id;

      INSERT INTO public.b2b_credit_events(wholesaler_id, order_id, event_type, amount, note, created_by, metadata)
      VALUES (v_order.wholesaler_id, v_order.id, 'overdue_marked', v_order.balance_due, '系统/管理员标记逾期', v_admin_id,
              jsonb_build_object('overdue_days', GREATEST(EXTRACT(day FROM now() - v_order.payment_due_at)::int, 0)));
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object('success', true, 'message', '逾期标记完成', 'processed_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_overdue_order_list(
  p_session_token text,
  p_keyword text DEFAULT NULL,
  p_collection_status text DEFAULT NULL,
  p_min_overdue_days int DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_items json;
  v_total int;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT COUNT(*) INTO v_total
  FROM public.v_b2b_overdue_orders o
  WHERE (p_collection_status IS NULL OR p_collection_status = 'all' OR o.collection_status = p_collection_status)
    AND (p_min_overdue_days IS NULL OR o.overdue_days_live >= p_min_overdue_days)
    AND (
      p_keyword IS NULL OR p_keyword = ''
      OR o.order_number ILIKE '%' || p_keyword || '%'
      OR o.company_name ILIKE '%' || p_keyword || '%'
      OR o.contact_phone ILIKE '%' || p_keyword || '%'
    );

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_items
  FROM (
    SELECT *
    FROM public.v_b2b_overdue_orders o
    WHERE (p_collection_status IS NULL OR p_collection_status = 'all' OR o.collection_status = p_collection_status)
      AND (p_min_overdue_days IS NULL OR o.overdue_days_live >= p_min_overdue_days)
      AND (
        p_keyword IS NULL OR p_keyword = ''
        OR o.order_number ILIKE '%' || p_keyword || '%'
        OR o.company_name ILIKE '%' || p_keyword || '%'
        OR o.contact_phone ILIKE '%' || p_keyword || '%'
      )
    ORDER BY o.overdue_days_live DESC, o.balance_due DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 300))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN json_build_object('success', true, 'items', v_items, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_add_collection_record(
  p_session_token text,
  p_order_id uuid,
  p_contact_method text,
  p_contact_result text,
  p_note text,
  p_promised_pay_at timestamptz DEFAULT NULL,
  p_next_follow_up_at timestamptz DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb,
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
  v_record_id uuid;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'ERR_PARAMS_MISSING: 催收备注不能为空';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.b2b_idempotency_keys WHERE scope = 'add_collection_record' AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
  END IF;

  SELECT o.*, wp.id AS wholesaler_id INTO v_order
  FROM public.b2b_orders o
  LEFT JOIN public.wholesaler_profiles wp ON wp.user_id::text = o.user_id::text
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  INSERT INTO public.b2b_collection_records(
    order_id, wholesaler_id, contact_method, contact_result, promised_pay_at,
    next_follow_up_at, note, attachments, created_by
  ) VALUES (
    p_order_id, v_order.wholesaler_id, COALESCE(NULLIF(p_contact_method, ''), 'phone'),
    COALESCE(NULLIF(p_contact_result, ''), 'contacted'), p_promised_pay_at,
    p_next_follow_up_at, p_note, COALESCE(p_attachments, '[]'::jsonb), v_admin_id
  ) RETURNING id INTO v_record_id;

  UPDATE public.b2b_orders
  SET
    collection_status = CASE
      WHEN p_contact_result = 'promised' THEN 'promised'
      WHEN p_contact_result = 'escalated' THEN 'escalated'
      WHEN p_contact_result = 'closed' THEN 'closed'
      ELSE 'contacted'
    END,
    collection_last_at = now(),
    collection_next_at = p_next_follow_up_at,
    risk_status = CASE WHEN risk_status IN ('bad_debt', 'written_off') THEN risk_status ELSE 'collection' END,
    risk_note = p_note,
    updated_at = now()
  WHERE id = p_order_id;

  IF v_order.wholesaler_id IS NOT NULL THEN
    INSERT INTO public.b2b_credit_events(wholesaler_id, order_id, event_type, amount, note, created_by, metadata)
    VALUES (v_order.wholesaler_id, p_order_id, 'collection_note', v_order.balance_due, p_note, v_admin_id,
            jsonb_build_object('collection_record_id', v_record_id, 'contact_method', p_contact_method, 'contact_result', p_contact_result));
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('add_collection_record', p_idempotency_key, jsonb_build_object('record_id', v_record_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '催收记录已保存', 'record_id', v_record_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_request_bad_debt(
  p_session_token text,
  p_order_id uuid,
  p_amount numeric DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_proof_urls jsonb DEFAULT '[]'::jsonb,
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
  v_record_id uuid;
  v_amount numeric(12,2);
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'ERR_PARAMS_MISSING: 坏账申请原因不能为空';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.b2b_idempotency_keys WHERE scope = 'request_bad_debt' AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
  END IF;

  SELECT o.*, wp.id AS wholesaler_id INTO v_order
  FROM public.b2b_orders o
  LEFT JOIN public.wholesaler_profiles wp ON wp.user_id::text = o.user_id::text
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;
  IF v_order.balance_due <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT: 订单无未收余额，不能申请坏账';
  END IF;

  v_amount := COALESCE(p_amount, v_order.balance_due);
  IF v_amount <= 0 OR v_amount > v_order.balance_due THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT: 坏账金额必须大于0且不超过未收余额';
  END IF;

  INSERT INTO public.b2b_bad_debt_records(order_id, wholesaler_id, amount, status, reason, proof_urls, requested_by)
  VALUES (p_order_id, v_order.wholesaler_id, v_amount, 'pending', p_reason, COALESCE(p_proof_urls, '[]'::jsonb), v_admin_id)
  RETURNING id INTO v_record_id;

  UPDATE public.b2b_orders
  SET bad_debt_status = 'pending', bad_debt_amount = v_amount, risk_status = 'bad_debt', risk_note = p_reason,
      bad_debt_marked_at = now(), bad_debt_marked_by = v_admin_id, updated_at = now()
  WHERE id = p_order_id;

  IF v_order.wholesaler_id IS NOT NULL THEN
    INSERT INTO public.b2b_credit_events(wholesaler_id, order_id, event_type, amount, note, created_by, metadata)
    VALUES (v_order.wholesaler_id, p_order_id, 'bad_debt_requested', v_amount, p_reason, v_admin_id,
            jsonb_build_object('bad_debt_record_id', v_record_id));
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('request_bad_debt', p_idempotency_key, jsonb_build_object('record_id', v_record_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '坏账申请已提交', 'record_id', v_record_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_review_bad_debt(
  p_session_token text,
  p_record_id uuid,
  p_decision text,
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
  v_record record;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'ERR_INVALID_DECISION: 决定必须是 approve 或 reject';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.b2b_idempotency_keys WHERE scope = 'review_bad_debt' AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
  END IF;

  SELECT * INTO v_record FROM public.b2b_bad_debt_records WHERE id = p_record_id FOR UPDATE;
  IF v_record IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 坏账记录不存在';
  END IF;
  IF v_record.status <> 'pending' THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE: 只有待审批坏账记录可审批';
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE public.b2b_bad_debt_records
    SET status = 'approved', approved_by = v_admin_id, approved_at = now(), note = p_reason, updated_at = now()
    WHERE id = p_record_id;

    UPDATE public.b2b_orders
    SET bad_debt_status = 'approved', financial_status = 'bad_debt', risk_status = 'bad_debt', risk_note = COALESCE(p_reason, risk_note), updated_at = now()
    WHERE id = v_record.order_id;

    IF v_record.wholesaler_id IS NOT NULL THEN
      UPDATE public.wholesaler_profiles
      SET credit_status = 'bad_debt', updated_at = now()
      WHERE id = v_record.wholesaler_id AND credit_status <> 'disabled';

      INSERT INTO public.b2b_credit_events(wholesaler_id, order_id, event_type, amount, note, created_by, metadata)
      VALUES (v_record.wholesaler_id, v_record.order_id, 'bad_debt_approved', v_record.amount, p_reason, v_admin_id,
              jsonb_build_object('bad_debt_record_id', p_record_id));
    END IF;
  ELSE
    UPDATE public.b2b_bad_debt_records
    SET status = 'rejected', rejected_by = v_admin_id, rejected_at = now(), rejected_reason = p_reason, updated_at = now()
    WHERE id = p_record_id;

    UPDATE public.b2b_orders
    SET bad_debt_status = 'rejected', risk_status = CASE WHEN payment_due_at < now() THEN 'overdue' ELSE 'normal' END,
        risk_note = p_reason, updated_at = now()
    WHERE id = v_record.order_id;

    IF v_record.wholesaler_id IS NOT NULL THEN
      INSERT INTO public.b2b_credit_events(wholesaler_id, order_id, event_type, amount, note, created_by, metadata)
      VALUES (v_record.wholesaler_id, v_record.order_id, 'bad_debt_rejected', v_record.amount, p_reason, v_admin_id,
              jsonb_build_object('bad_debt_record_id', p_record_id));
    END IF;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('review_bad_debt', p_idempotency_key, jsonb_build_object('record_id', p_record_id, 'decision', p_decision));
  END IF;

  RETURN json_build_object('success', true, 'message', CASE WHEN p_decision = 'approve' THEN '坏账已审批通过' ELSE '坏账已驳回' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_writeoff_bad_debt(
  p_session_token text,
  p_record_id uuid,
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
  v_record record;
  v_order record;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.b2b_idempotency_keys WHERE scope = 'writeoff_bad_debt' AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN json_build_object('success', true, 'message', '重复请求', 'idempotent', true);
  END IF;

  SELECT * INTO v_record FROM public.b2b_bad_debt_records WHERE id = p_record_id FOR UPDATE;
  IF v_record IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 坏账记录不存在';
  END IF;
  IF v_record.status <> 'approved' THEN
    RAISE EXCEPTION 'ERR_INVALID_STATE: 只有已审批坏账可核销';
  END IF;

  SELECT * INTO v_order FROM public.b2b_orders WHERE id = v_record.order_id FOR UPDATE;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: 订单不存在';
  END IF;

  UPDATE public.b2b_bad_debt_records
  SET status = 'written_off', written_off_by = v_admin_id, written_off_at = now(), note = COALESCE(p_note, note), updated_at = now()
  WHERE id = p_record_id;

  UPDATE public.b2b_orders
  SET
    bad_debt_status = 'written_off',
    financial_status = 'written_off',
    risk_status = 'written_off',
    writeoff_amount = v_record.amount,
    written_off_by = v_admin_id,
    written_off_at = now(),
    balance_due = GREATEST(balance_due - v_record.amount, 0),
    risk_note = COALESCE(p_note, risk_note),
    updated_at = now()
  WHERE id = v_record.order_id;

  INSERT INTO public.b2b_payment_transactions(
    order_id, transaction_type, payment_method, amount, status,
    note, created_by, receiver_admin_id, confirmed_at, confirmed_by, paid_at, idempotency_key
  ) VALUES (
    v_record.order_id, 'adjustment', 'bad_debt_writeoff', v_record.amount, 'confirmed',
    COALESCE(p_note, '坏账核销'), v_admin_id, v_admin_id, now(), v_admin_id, now(), p_idempotency_key
  );

  IF v_record.wholesaler_id IS NOT NULL THEN
    INSERT INTO public.b2b_credit_events(wholesaler_id, order_id, event_type, amount, note, created_by, metadata)
    VALUES (v_record.wholesaler_id, v_record.order_id, 'bad_debt_written_off', v_record.amount, p_note, v_admin_id,
            jsonb_build_object('bad_debt_record_id', p_record_id));
    PERFORM public.b2b_recalculate_credit_for_user(v_order.user_id::text);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.b2b_idempotency_keys(scope, idempotency_key, result_json)
    VALUES ('writeoff_bad_debt', p_idempotency_key, jsonb_build_object('record_id', p_record_id));
  END IF;

  RETURN json_build_object('success', true, 'message', '坏账已核销', 'writeoff_amount', v_record.amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_bad_debt_list(
  p_session_token text,
  p_status text DEFAULT NULL,
  p_keyword text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_items json;
  v_total int;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT COUNT(*) INTO v_total
  FROM public.b2b_bad_debt_records r
  JOIN public.b2b_orders o ON o.id = r.order_id
  LEFT JOIN public.wholesaler_profiles wp ON wp.id = r.wholesaler_id
  WHERE (p_status IS NULL OR p_status = 'all' OR r.status = p_status)
    AND (
      p_keyword IS NULL OR p_keyword = ''
      OR o.order_number ILIKE '%' || p_keyword || '%'
      OR wp.company_name ILIKE '%' || p_keyword || '%'
      OR wp.contact_phone ILIKE '%' || p_keyword || '%'
    );

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_items
  FROM (
    SELECT
      r.*,
      o.order_number,
      o.receivable_total,
      o.paid_total,
      o.balance_due,
      o.financial_status,
      o.payment_due_at,
      wp.company_name,
      wp.contact_phone
    FROM public.b2b_bad_debt_records r
    JOIN public.b2b_orders o ON o.id = r.order_id
    LEFT JOIN public.wholesaler_profiles wp ON wp.id = r.wholesaler_id
    WHERE (p_status IS NULL OR p_status = 'all' OR r.status = p_status)
      AND (
        p_keyword IS NULL OR p_keyword = ''
        OR o.order_number ILIKE '%' || p_keyword || '%'
        OR wp.company_name ILIKE '%' || p_keyword || '%'
        OR wp.contact_phone ILIKE '%' || p_keyword || '%'
      )
    ORDER BY r.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 300))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN json_build_object('success', true, 'items', v_items, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_b2b_log_export(
  p_session_token text,
  p_export_type text,
  p_filter_json jsonb DEFAULT '{}'::jsonb,
  p_row_count int DEFAULT 0,
  p_file_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_job_id uuid;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  INSERT INTO public.b2b_export_jobs(export_type, filter_json, row_count, file_name, status, created_by)
  VALUES (p_export_type, COALESCE(p_filter_json, '{}'::jsonb), GREATEST(COALESCE(p_row_count, 0), 0), p_file_name, 'completed', v_admin_id)
  RETURNING id INTO v_job_id;

  RETURN json_build_object('success', true, 'job_id', v_job_id);
END;
$$;

-- ============================================================================
-- P2-10: 覆盖用户侧下单 RPC，新增已审核批发商、授信额度与账期风控
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
    'payment_due_at', v_due_at
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

  INSERT INTO public.b2b_order_operation_logs(entity_type, entity_id, action, user_id, new_value, order_id, actor_id, actor_type, operation, to_state, metadata)
  VALUES (
    'order', v_order_id, 'checkout_create_order', p_user_id,
    jsonb_strip_nulls(jsonb_build_object('order_number', v_order_number, 'total_amount', v_total_amount, 'total_quantity', v_total_quantity, 'item_count', v_item_count)),
    v_order_id, p_user_id, 'customer', 'checkout_create_order', 'pending',
    jsonb_strip_nulls(jsonb_build_object('order_number', v_order_number, 'total_amount', v_total_amount, 'total_quantity', v_total_quantity, 'item_count', v_item_count, 'idempotency_key', CASE WHEN v_has_idempotency THEN p_idempotency_key ELSE NULL END, 'request_hash', v_effective_request_hash, 'session_token_hash', p_session_token_hash, 'credit_limit_snapshot', v_profile.credit_limit, 'credit_used_before', v_credit_used_before, 'credit_used_after', v_credit_used_after, 'payment_due_at', v_due_at))
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
      'credit_used_after', v_credit_used_after,
      'credit_available', GREATEST(v_profile.credit_limit - v_credit_used_after, 0),
      'profit_status', CASE WHEN v_missing_cost THEN 'cost_missing' ELSE 'complete' END
    ),
    'message', '订单创建成功，授信额度已占用，等待配送'
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
'B2B 事务化下单 RPC（P2授信风控版）。要求已审核批发商，校验授信状态和额度，快照账期并写入逾期/风控字段。';

-- ============================================================================
-- P2-11: RPC 授权
-- ============================================================================

REVOKE ALL ON FUNCTION public.b2b_recalculate_credit_for_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_b2b_order_recalculate_credit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.b2b_recalculate_credit_for_user(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.b2b_create_order_from_cart_tx(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_b2b_credit_dashboard(text, text, text, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_update_wholesaler_credit(text, uuid, numeric, int, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_recalculate_credit(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_mark_overdue(text, uuid[], int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_overdue_order_list(text, text, text, int, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_add_collection_record(text, uuid, text, text, text, timestamptz, timestamptz, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_request_bad_debt(text, uuid, numeric, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_review_bad_debt(text, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_writeoff_bad_debt(text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_bad_debt_list(text, text, text, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_b2b_log_export(text, text, jsonb, int, text) TO anon, authenticated;
