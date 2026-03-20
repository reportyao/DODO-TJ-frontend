-- ============================================================
-- 修复 deduct_user_spin_count 函数的 TOCTOU 竞态条件
-- 
-- 问题：原函数先 SELECT spin_count，再 UPDATE，两步之间无行锁
-- 在高并发下（用户快速双击），可能导致 spin_count 变为负数
-- 
-- 修复：使用单条原子 UPDATE ... WHERE spin_count >= p_count
-- 通过检查 affected rows 判断是否成功，无需额外 SELECT
-- ============================================================

CREATE OR REPLACE FUNCTION deduct_user_spin_count(
    p_user_id TEXT,
    p_count INTEGER DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rows_affected INTEGER;
BEGIN
    -- 【竞态修复】使用单条原子 UPDATE，WHERE 条件包含余额检查
    -- 只有 spin_count >= p_count 时才会更新，避免 TOCTOU 竞态
    UPDATE user_spin_balance
    SET spin_count = spin_count - p_count,
        total_spins_used = total_spins_used + p_count,
        last_spin_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND spin_count >= p_count;  -- 原子性检查：余额充足才扣减
    
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    
    -- 如果没有行被更新，说明余额不足或用户不存在
    RETURN v_rows_affected > 0;
END;
$$;

COMMENT ON FUNCTION deduct_user_spin_count IS '【竞态修复 v2】原子性扣减用户抽奖次数，使用单条 UPDATE 避免 TOCTOU 竞态条件';
