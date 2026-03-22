-- ============================================================
-- 系统级深度审查 - 触发器和辅助函数修复
-- 日期: 2026-03-22
-- ============================================================

-- ============================================================
-- FIX-12: trigger_commission_for_exchange
-- 问题: 
--   1. 硬编码 5% 佣金率，未读取 commission_settings 表
--   2. 使用已弃用的 referred_by 字段，应兼容 referred_by_id
--   3. 只处理一级佣金，未处理二三级
--   4. 调用 increase_commission_balance 而非发到积分钱包
-- 修复: 从 commission_settings 读取配置，兼容双字段，发到积分钱包
-- ============================================================
CREATE OR REPLACE FUNCTION public.trigger_commission_for_exchange()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_referrer_id TEXT;
    v_commission_rate DECIMAL(5,4);
    v_commission_amount DECIMAL(10,2);
    v_setting RECORD;
BEGIN
    -- 【兼容修复】同时查询 referred_by_id 和 referrer_id，优先使用 referred_by_id
    SELECT COALESCE(referred_by_id, referrer_id)
    INTO v_referrer_id
    FROM users
    WHERE id = NEW.user_id;

    IF v_referrer_id IS NOT NULL THEN
        -- 【配置修复】从 commission_settings 读取一级佣金率
        -- 如果配置不存在或未启用，则跳过（不再硬编码 5%）
        SELECT rate INTO v_commission_rate
        FROM commission_settings
        WHERE level = 1 AND is_active = true
        LIMIT 1;

        IF v_commission_rate IS NULL THEN
            -- 没有有效的佣金配置，静默跳过
            RETURN NEW;
        END IF;

        v_commission_amount := NEW.from_amount * v_commission_rate;

        -- 【安全校验】佣金金额必须大于 0
        IF v_commission_amount <= 0 THEN
            RETURN NEW;
        END IF;

        -- 【防重复】检查是否已存在该兑换记录的佣金
        IF EXISTS (
            SELECT 1 FROM commissions
            WHERE order_id = NEW.id::TEXT
              AND user_id = v_referrer_id
              AND level = 1
        ) THEN
            RETURN NEW;
        END IF;

        -- 创建佣金记录
        INSERT INTO commissions (
            user_id, from_user_id, source_user_id, beneficiary_id,
            order_id, order_type, level, amount, rate, status, type
        )
        VALUES (
            v_referrer_id, NEW.user_id, NEW.user_id, v_referrer_id,
            NEW.id::TEXT, 'EXCHANGE', 1, v_commission_amount, v_commission_rate,
            'settled', 'REFERRAL_COMMISSION'
        );

        -- 【修复】发放到积分钱包（LUCKY_COIN），与 handle-purchase-commission 保持一致
        -- 不再使用 increase_commission_balance（那个函数写入 COMMISSION 类型钱包）
        UPDATE wallets
        SET balance = balance + v_commission_amount,
            version = COALESCE(version, 1) + 1,
            updated_at = NOW()
        WHERE user_id = v_referrer_id AND type = 'LUCKY_COIN';

        -- 记录钱包交易流水
        INSERT INTO wallet_transactions (
            wallet_id, type, amount, balance_before, balance_after,
            status, description, reference_id, created_at
        )
        SELECT
            w.id,
            'COMMISSION',
            v_commission_amount,
            w.balance - v_commission_amount,  -- balance_before (已更新后反推)
            w.balance,                         -- balance_after (当前值)
            'COMPLETED',
            'L1佣金 - 来自下级兑换',
            NEW.id::TEXT,
            NOW()
        FROM wallets w
        WHERE w.user_id = v_referrer_id AND w.type = 'LUCKY_COIN';
    END IF;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- 触发器异常不应阻断主操作（兑换本身）
    RAISE WARNING 'trigger_commission_for_exchange error: %', SQLERRM;
    RETURN NEW;
END;
$$;


-- ============================================================
-- FIX-13: add_user_lucky_coins 增强
-- 问题: 缺少参数校验，p_amount 为 NULL/负数时行为异常
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_user_lucky_coins(
    p_user_id TEXT,
    p_amount NUMERIC,
    p_description VARCHAR DEFAULT '转盘抽奖奖励'
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_wallet_id UUID;
    v_current_balance DECIMAL(10,2);
    v_new_balance DECIMAL(10,2);
BEGIN
    -- 【安全校验】金额必须为正数
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION '积分奖励金额必须大于0';
    END IF;

    -- 【并发安全】FOR UPDATE 锁定积分钱包行
    SELECT id, balance
    INTO v_wallet_id, v_current_balance
    FROM wallets
    WHERE user_id = p_user_id AND type = 'LUCKY_COIN'
    LIMIT 1
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION '未找到用户积分钱包';
    END IF;

    -- 原子更新余额
    UPDATE wallets
    SET balance = balance + p_amount,
        version = COALESCE(version, 1) + 1,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    -- 获取更新后的余额
    SELECT balance INTO v_new_balance
    FROM wallets
    WHERE id = v_wallet_id;

    -- 记录交易流水
    INSERT INTO wallet_transactions (
        wallet_id, type, amount,
        balance_before, balance_after,
        description, status, created_at
    ) VALUES (
        v_wallet_id, 'SPIN_REWARD', p_amount,
        v_current_balance, v_new_balance,
        p_description, 'COMPLETED', NOW()
    );

    RETURN v_new_balance;
END;
$$;
