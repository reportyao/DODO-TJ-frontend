-- ============================================================================
-- Fix #1: b2b_idempotency_keys 缺少 updated_at 列
-- 
-- 问题: trigger trg_b2b_idempotency_keys_updated_at 调用 touch_b2b_p0_updated_at()
--       该函数执行 NEW.updated_at = now()，但表中没有 updated_at 列
--       导致 b2b_create_order_from_cart_tx 在 INSERT INTO b2b_idempotency_keys 时报错:
--       "record \"new\" has no field \"updated_at\""
-- ============================================================================

ALTER TABLE public.b2b_idempotency_keys 
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
