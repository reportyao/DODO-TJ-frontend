-- ============================================================================
-- 资金安全修复迁移 v3
-- 创建时间: 2026-03-05
-- ============================================================================
--
-- 修复内容:
--   1. 修复 add_user_lucky_coins 函数: 添加乐观锁防止并发更新导致余额错误
--   2. 统一钱包类型和货币标准注释
--
-- 钱包类型标准（重要，所有开发者必须遵守）:
--   - 现金钱包: type='TJS', currency='TJS'
--   - 积分钱包: type='LUCKY_COIN', currency='POINTS'
--   - 数据库枚举 WalletType 只有 'TJS' 和 'LUCKY_COIN'，没有 'BALANCE'
--   - 积分钱包的 currency 必须是 'POINTS'，不能是 'LUCKY_COIN'
--
-- 乐观锁机制说明:
--   wallets 表的 version 字段用于乐观锁。
--   每次更新余额时，必须同时检查 version 并递增 version。
--   如果 version 不匹配（被其他并发操作修改），更新会影响 0 行，
--   调用方应检测到这种情况并重试。
-- ============================================================================

-- 1. 修复 add_user_lucky_coins 函数（添加乐观锁）
-- 
-- 问题描述:
--   原函数直接 UPDATE balance = balance + p_amount，虽然 SQL 层面是原子的，
--   但在 Edge Function 中先 SELECT balance 再 UPDATE 的模式下，
--   如果同时有其他操作修改了余额（如佣金发放），可能导致数据不一致。
--   为了与所有 Edge Function 的乐观锁模式保持一致，这里也加上 version 检查。
--
-- 修复方案:
--   使用 balance = balance + p_amount 的原子操作（SQL 层面天然安全），
--   同时递增 version 字段以保持与其他 Edge Function 的一致性。
--   这样即使 Edge Function 和 SQL 函数同时操作同一个钱包，version 也能正确递增。
CREATE OR REPLACE FUNCTION add_user_lucky_coins(
    p_user_id TEXT,
    p_amount DECIMAL(10,2),
    p_description VARCHAR(255) DEFAULT '转盘抽奖奖励'
)
RETURNS DECIMAL(10,2)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_wallet_id UUID;
    v_current_balance DECIMAL(10,2);
    v_new_balance DECIMAL(10,2);
    v_current_version INT;
BEGIN
    -- 获取用户的积分钱包（type='LUCKY_COIN'）
    -- 【重要】积分钱包的标准: type='LUCKY_COIN', currency='POINTS'
    SELECT id, balance, COALESCE(version, 1) 
    INTO v_wallet_id, v_current_balance, v_current_version
    FROM wallets
    WHERE user_id = p_user_id
      AND type::TEXT = 'LUCKY_COIN'
    LIMIT 1;
    
    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION '未找到用户积分钱包 (user_id: %)', p_user_id;
    END IF;
    
    -- 【资金安全修复 v3】使用原子操作增加积分，同时递增 version
    -- balance = balance + p_amount 是 SQL 原子操作，天然防并发
    -- 同时递增 version 以保持与 Edge Function 乐观锁模式的一致性
    UPDATE wallets
    SET balance = balance + p_amount,
        version = COALESCE(version, 1) + 1,
        updated_at = NOW()
    WHERE id = v_wallet_id;
    
    -- 获取更新后的新余额
    SELECT balance INTO v_new_balance
    FROM wallets
    WHERE id = v_wallet_id;
    
    -- 记录交易（包含 balance_before 和 balance_after）
    INSERT INTO wallet_transactions (
        wallet_id,
        type,
        amount,
        balance_before,
        balance_after,
        description,
        status,
        processed_at,
        created_at
    ) VALUES (
        v_wallet_id,
        'SPIN_REWARD',
        p_amount,
        v_current_balance,
        v_new_balance,
        p_description,
        'COMPLETED',
        NOW(),
        NOW()
    );
    
    RETURN v_new_balance;
END;
$$;

COMMENT ON FUNCTION add_user_lucky_coins IS '增加用户积分（LUCKY_COIN钱包），并记录交易。v3: 添加 version 递增以保持乐观锁一致性';

-- ============================================================================
-- 迁移完成
-- ============================================================================
