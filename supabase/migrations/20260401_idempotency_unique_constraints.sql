-- ============================================================
-- 幂等性保护：为 deposit_requests 和 withdrawal_requests 表
-- 的 idempotency_key 字段添加 UNIQUE 约束
-- ============================================================
-- 
-- 背景：
--   充值和提现云函数已实现基于 idempotency_key 的应用层幂等性检查，
--   但数据库层面缺乏唯一约束，在高并发场景下仍可能出现竞态条件
--   导致重复提交。本迁移通过添加数据库级 UNIQUE 约束来彻底解决此问题。
-- 
-- 注意：
--   idempotency_key 允许为 NULL（向后兼容旧数据），
--   PostgreSQL 的 UNIQUE 约束天然允许多个 NULL 值，
--   因此不会影响历史数据。
-- ============================================================

-- 1. 确保 deposit_requests 表有 idempotency_key 列
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'deposit_requests'
      AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.deposit_requests
      ADD COLUMN idempotency_key TEXT DEFAULT NULL;
    COMMENT ON COLUMN public.deposit_requests.idempotency_key
      IS '幂等键：防止重复充值提交，前端生成 UUID 传入';
  END IF;
END $$;

-- 2. 为 deposit_requests.idempotency_key 添加 UNIQUE 约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_deposit_requests_idempotency_key'
      AND conrelid = 'public.deposit_requests'::regclass
  ) THEN
    ALTER TABLE public.deposit_requests
      ADD CONSTRAINT uq_deposit_requests_idempotency_key
      UNIQUE (idempotency_key);
  END IF;
END $$;

-- 3. 确保 withdrawal_requests 表有 idempotency_key 列
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'withdrawal_requests'
      AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.withdrawal_requests
      ADD COLUMN idempotency_key TEXT DEFAULT NULL;
    COMMENT ON COLUMN public.withdrawal_requests.idempotency_key
      IS '幂等键：防止重复提现提交，前端生成 UUID 传入';
  END IF;
END $$;

-- 4. 为 withdrawal_requests.idempotency_key 添加 UNIQUE 约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_withdrawal_requests_idempotency_key'
      AND conrelid = 'public.withdrawal_requests'::regclass
  ) THEN
    ALTER TABLE public.withdrawal_requests
      ADD CONSTRAINT uq_withdrawal_requests_idempotency_key
      UNIQUE (idempotency_key);
  END IF;
END $$;

-- 5. 为 idempotency_key 创建索引（加速幂等性查询）
CREATE INDEX IF NOT EXISTS idx_deposit_requests_idempotency_key
  ON public.deposit_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_idempotency_key
  ON public.withdrawal_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
