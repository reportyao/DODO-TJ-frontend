-- ============================================================
-- Full Purchase Payment Performance Indexes
-- Date: 2026-04-13
--
-- 目标：为全款支付主链路补充关键热点索引，减少以下慢路径：
--   1. Edge Function / RLS 通过 session_token 校验 user_sessions
--   2. process_mixed_payment 查找用户钱包与可用优惠券
--   3. create-full-purchase-order 的幂等日志查找
--   4. 支付成功后订单详情与订单列表的回查
--
-- 设计原则：
--   - 全部使用 CREATE INDEX IF NOT EXISTS，保证可重复执行
--   - 针对 is_active = true / status = 'VALID' 等高频过滤条件使用部分索引
--   - 不在部分索引中使用 NOW()，避免非 immutable 表达式带来的问题
-- ============================================================

BEGIN;

-- ============================================================
-- 1. user_sessions：优化支付前会话校验与 RLS EXISTS 子查询
--
-- 常见查询模式：
--   WHERE session_token = ? AND is_active = true AND expires_at > NOW()
--   WHERE user_id = ? AND session_token = ? AND is_active = true AND expires_at > NOW()
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_sessions_active_token_user_expiry
  ON public.user_sessions (session_token, user_id, expires_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_sessions_active_user_token_expiry
  ON public.user_sessions (user_id, session_token, expires_at DESC)
  WHERE is_active = true;

-- ============================================================
-- 2. coupons：优化 process_mixed_payment 中最早到期有效券查找
--
-- 常见查询模式：
--   WHERE user_id = ? AND status = 'VALID' AND expires_at > NOW()
--   ORDER BY expires_at ASC LIMIT 1 FOR UPDATE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_coupons_user_valid_expires_at
  ON public.coupons (user_id, expires_at ASC)
  WHERE status = 'VALID';

-- ============================================================
-- 3. edge_function_logs：优化支付幂等命中查询
--
-- 常见查询模式：
--   function_name = 'create-full-purchase-order'
--   action = 'FULL_PURCHASE'
--   user_id = ?
--   status = 'success'
--   details @> {'idempotency_key': ...}
--   ORDER BY created_at DESC LIMIT 1
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_edge_function_logs_payment_lookup
  ON public.edge_function_logs (function_name, action, user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_function_logs_details_gin
  ON public.edge_function_logs
  USING GIN (details jsonb_path_ops);

-- ============================================================
-- 4. full_purchase_orders：优化支付成功后详情页/列表页回查
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_full_purchase_orders_user_created_at
  ON public.full_purchase_orders (user_id, created_at DESC);

COMMIT;
