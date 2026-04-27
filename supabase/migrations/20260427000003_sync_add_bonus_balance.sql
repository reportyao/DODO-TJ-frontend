-- ============================================================
-- 同步 add_bonus_balance 为线上实际运行的版本
--
-- 背景：
--   历史 migration 20251118_referral_optimization.sql 中定义的
--   add_bonus_balance(UUID, DECIMAL) 使用 profiles.bonus_balance 字段，
--   但该字段早已被废弃。线上实际运行版本签名为
--   add_bonus_balance(text, numeric, text)，逻辑基于 wallets('BONUS') +
--   wallet_transactions 流水记录。
--
--   希望之树 rpc_water_tree_internal 调用的即为三参数签名，本迁移把
--   该函数源码落地到仓库，避免数据库被重置时无法恢复。
--
--   注意：先 DROP 旧的双参数签名（如果存在），避免 PG 因多重载产生歧义。
-- ============================================================

-- 1. 清理历史双参数签名（若存在）
DROP FUNCTION IF EXISTS public.add_bonus_balance(UUID, DECIMAL);
DROP FUNCTION IF EXISTS public.add_bonus_balance(uuid, numeric);

-- 2. 创建/更新三参数版本（与生产库完全一致）
CREATE OR REPLACE FUNCTION public.add_bonus_balance(
    p_user_id text,
    p_amount numeric,
    p_description text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_wallet_id UUID;
    v_current_balance DECIMAL(10,2);
BEGIN
    -- 锁定用户的 BONUS 钱包
    SELECT id, balance INTO v_wallet_id, v_current_balance
    FROM wallets
    WHERE user_id = p_user_id AND type = 'BONUS'
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        -- 首次赠送：自动创建 BONUS 钱包
        INSERT INTO wallets (user_id, type, balance)
        VALUES (p_user_id, 'BONUS', p_amount)
        RETURNING id INTO v_wallet_id;
        v_current_balance := 0;
    ELSE
        UPDATE wallets
        SET balance = balance + p_amount,
            updated_at = NOW()
        WHERE id = v_wallet_id;
    END IF;

    -- 记录流水
    INSERT INTO wallet_transactions (
        wallet_id, type, amount,
        balance_before, balance_after, description
    )
    VALUES (
        v_wallet_id, 'BONUS_ADD', p_amount,
        v_current_balance, v_current_balance + p_amount, p_description
    );

    RETURN TRUE;
END;
$function$;

-- 3. 权限：与既有安全策略保持一致（参考 20250321000002_revoke_anon_function_execute.sql）
REVOKE EXECUTE ON FUNCTION public.add_bonus_balance(text, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_bonus_balance(text, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_bonus_balance(text, numeric, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.add_bonus_balance(text, numeric, text) TO service_role;

COMMENT ON FUNCTION public.add_bonus_balance(text, numeric, text)
    IS '为用户 BONUS 钱包增加余额并记录流水；被 rpc_water_tree_internal、auth-register 等上游调用。';
