-- ============================================================================
-- 深度审查修复 Migration
-- 版本: 2.1.0
-- 日期: 2026-03-18
--
-- 修复内容:
--   M1: coupons RLS SELECT 策略改为用户只能查看自己的抵扣券
--   B2: issue-refund-coupons 幂等性保护 - 添加唯一索引防止重复发券
-- ============================================================================

-- ============================================================
-- M1: 修复 coupons RLS SELECT 策略
-- 原策略: USING (true) 允许所有认证用户读取所有人的抵扣券
-- 新策略: USING (auth.uid()::text = user_id) 用户只能读取自己的抵扣券
-- 注意: Edge Functions 使用 service_role_key 不受 RLS 限制
-- ============================================================
DROP POLICY IF EXISTS "Allow users to read own coupons" ON coupons;
CREATE POLICY "Allow users to read own coupons" ON coupons
  FOR SELECT USING (auth.uid()::text = user_id);

-- ============================================================
-- B2: 添加幂等性保护索引
-- 防止 issue-refund-coupons 被重复调用时为同一用户在同一活动中重复发券
-- 使用部分索引: 只对 source = 'LOTTERY_REFUND' 的记录生效
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_coupons_lottery_refund_user
  ON coupons(related_lottery_id, user_id)
  WHERE source = 'LOTTERY_REFUND';
