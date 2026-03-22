-- ============================================================
-- 修复代充幂等性保护
-- 
-- 问题：promoter-deposit Edge Function 的幂等性检查依赖 audit_logs 表，
--       但 audit_logs 写入是异步的，导致并发请求可以绕过幂等性检查。
-- 
-- 解决方案：
--   1. 在 promoter_deposits 表添加 idempotency_key 列（带唯一约束）
--   2. 修改 perform_promoter_deposit RPC 函数，在 DB 层面做幂等性检查
--   3. 如果 idempotency_key 已存在，直接返回已有记录（不重复充值）
-- ============================================================

-- Step 1: 给 promoter_deposits 表添加 idempotency_key 列
ALTER TABLE promoter_deposits
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Step 2: 添加唯一约束（同一个 promoter_id + idempotency_key 只能有一条记录）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promoter_deposits_idempotency_key_unique'
  ) THEN
    ALTER TABLE promoter_deposits
      ADD CONSTRAINT promoter_deposits_idempotency_key_unique
      UNIQUE (promoter_id, idempotency_key);
  END IF;
END $$;

-- Step 3: 修改 perform_promoter_deposit RPC 函数，支持 idempotency_key 参数
CREATE OR REPLACE FUNCTION perform_promoter_deposit(
  p_promoter_id     TEXT,
  p_target_user_id  TEXT,
  p_amount          NUMERIC,
  p_note            TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promoter        RECORD;
  v_today           DATE := (now() AT TIME ZONE 'Asia/Dushanbe')::date;
  v_today_total     NUMERIC;
  v_today_count     INTEGER;
  v_tjs_wallet      RECORD;
  v_lc_wallet       RECORD;
  v_new_tjs_balance NUMERIC;
  v_new_lc_balance  NUMERIC;
  v_bonus_amount    NUMERIC := 0;
  v_bonus_percent   NUMERIC := 0;
  v_config_value    JSONB;
  v_deposit_id      UUID;
  v_tx_id           UUID;
  v_bonus_tx_id     UUID;
  v_target_name     TEXT;
  v_promoter_name   TEXT;
  v_settlement      RECORD;
  v_tjs_balance_before NUMERIC;
  v_lc_balance_before  NUMERIC;
  v_daily_count_limit INTEGER;
  v_existing_deposit RECORD;
BEGIN
  -- ============================================================
  -- Step 0: 幂等性检查（数据库级别，原子操作）
  -- ============================================================
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, amount, bonus_amount INTO v_existing_deposit
    FROM promoter_deposits
    WHERE promoter_id = p_promoter_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;
    
    IF v_existing_deposit IS NOT NULL THEN
      -- 已处理过，直接返回已有结果（不重复充值）
      RETURN json_build_object(
        'success', true,
        'deposit_id', v_existing_deposit.id,
        'amount', v_existing_deposit.amount,
        'bonus_amount', COALESCE(v_existing_deposit.bonus_amount, 0),
        'idempotent', true,
        'message', '充值已成功处理（重复请求）'
      );
    END IF;
  END IF;

  -- ============================================================
  -- Step 1: 验证地推人员身份和状态
  -- ============================================================
  SELECT pp.user_id, pp.promoter_status, pp.daily_deposit_limit, pp.daily_count_limit
  INTO v_promoter
  FROM promoter_profiles pp
  WHERE pp.user_id = p_promoter_id;

  IF v_promoter IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NOT_PROMOTER');
  END IF;

  IF v_promoter.promoter_status != 'active' THEN
    RETURN json_build_object('success', false, 'error', 'PROMOTER_INACTIVE');
  END IF;

  v_daily_count_limit := COALESCE(v_promoter.daily_count_limit, 10);

  -- ============================================================
  -- Step 2: 禁止给自己充值
  -- ============================================================
  IF p_promoter_id = p_target_user_id THEN
    RETURN json_build_object('success', false, 'error', 'SELF_DEPOSIT_FORBIDDEN');
  END IF;

  -- ============================================================
  -- Step 3: 验证金额范围 (10 ~ 500 TJS) 且必须为整数
  -- ============================================================
  IF p_amount < 10 OR p_amount > 500 THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF p_amount != FLOOR(p_amount) THEN
    RETURN json_build_object('success', false, 'error', 'AMOUNT_MUST_BE_INTEGER');
  END IF;

  -- ============================================================
  -- Step 3.5: 锁定或创建当日结算记录
  -- ============================================================
  INSERT INTO promoter_settlements (
    promoter_id, settlement_date,
    total_deposit_amount, total_deposit_count,
    settlement_status
  ) VALUES (
    p_promoter_id, v_today,
    0, 0,
    'pending'
  )
  ON CONFLICT (promoter_id, settlement_date)
  DO UPDATE SET updated_at = now()
  RETURNING * INTO v_settlement;

  -- 对结算记录加行级排他锁
  PERFORM 1 FROM promoter_settlements
  WHERE id = v_settlement.id
  FOR UPDATE;

  -- ============================================================
  -- Step 4: 检查今日充值次数和额度
  -- ============================================================
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*)::INTEGER
  INTO v_today_total, v_today_count
  FROM promoter_deposits
  WHERE promoter_id = p_promoter_id
    AND created_at >= v_today
    AND created_at < v_today + INTERVAL '1 day'
    AND status = 'COMPLETED';

  IF v_today_count >= v_daily_count_limit THEN
    RETURN json_build_object(
      'success', false,
      'error', 'DAILY_COUNT_EXCEEDED',
      'today_count', v_today_count,
      'daily_count_limit', v_daily_count_limit
    );
  END IF;

  IF (v_today_total + p_amount) > COALESCE(v_promoter.daily_deposit_limit, 5000) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'DAILY_LIMIT_EXCEEDED',
      'remaining', COALESCE(v_promoter.daily_deposit_limit, 5000) - v_today_total,
      'daily_limit', COALESCE(v_promoter.daily_deposit_limit, 5000)
    );
  END IF;

  -- ============================================================
  -- Step 5: 查询目标用户的 TJS 钱包（加锁）
  -- ============================================================
  SELECT * INTO v_tjs_wallet
  FROM wallets
  WHERE user_id = p_target_user_id
    AND type = 'TJS'
  FOR UPDATE;

  IF v_tjs_wallet IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'TARGET_WALLET_NOT_FOUND');
  END IF;

  v_tjs_balance_before := v_tjs_wallet.balance;
  v_new_tjs_balance := v_tjs_wallet.balance + p_amount;

  -- ============================================================
  -- Step 6: 计算赠送金额（LUCKY_COIN）
  -- ============================================================
  SELECT value INTO v_config_value
  FROM system_config
  WHERE key = 'promoter_deposit_bonus_rules'
  LIMIT 1;

  IF v_config_value IS NOT NULL THEN
    DECLARE
      v_rule JSONB;
    BEGIN
      FOR v_rule IN SELECT * FROM jsonb_array_elements(v_config_value)
      LOOP
        IF p_amount >= (v_rule->>'min_amount')::NUMERIC
           AND p_amount <= COALESCE((v_rule->>'max_amount')::NUMERIC, 999999)
        THEN
          v_bonus_percent := COALESCE((v_rule->>'bonus_percent')::NUMERIC, 0);
          EXIT;
        END IF;
      END LOOP;
    END;
  END IF;

  v_bonus_amount := FLOOR(p_amount * v_bonus_percent / 100);

  -- ============================================================
  -- Step 7: 查询 LUCKY_COIN 钱包（如有赠送则加锁）
  -- ============================================================
  IF v_bonus_amount > 0 THEN
    SELECT * INTO v_lc_wallet
    FROM wallets
    WHERE user_id = p_target_user_id
      AND type = 'LUCKY_COIN'
    FOR UPDATE;

    v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
    v_new_lc_balance := v_lc_balance_before + v_bonus_amount;
  ELSE
    SELECT * INTO v_lc_wallet
    FROM wallets
    WHERE user_id = p_target_user_id
      AND type = 'LUCKY_COIN';
    v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
    v_new_lc_balance := v_lc_balance_before;
  END IF;

  -- ============================================================
  -- Step 8: 更新 TJS 钱包余额
  -- ============================================================
  UPDATE wallets
  SET balance = v_new_tjs_balance,
      updated_at = now()
  WHERE id = v_tjs_wallet.id;

  -- ============================================================
  -- Step 8.5: 如有赠送，更新 LUCKY_COIN 钱包余额
  -- ============================================================
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    UPDATE wallets
    SET balance = v_new_lc_balance,
        updated_at = now()
    WHERE id = v_lc_wallet.id;
  END IF;

  -- ============================================================
  -- Step 9: 创建 promoter_deposits 记录（含 idempotency_key）
  -- ============================================================
  v_deposit_id := gen_random_uuid();

  INSERT INTO promoter_deposits (
    id, promoter_id, target_user_id,
    amount, currency, status, note,
    bonus_amount, idempotency_key,
    created_at, updated_at
  ) VALUES (
    v_deposit_id,
    p_promoter_id,
    p_target_user_id,
    p_amount,
    'TJS',
    'COMPLETED',
    p_note,
    v_bonus_amount,
    p_idempotency_key,
    now(),
    now()
  );

  -- ============================================================
  -- Step 10: 创建 TJS 钱包交易记录
  -- ============================================================
  v_tx_id := gen_random_uuid();

  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    description, reference_id, status, created_at
  ) VALUES (
    v_tx_id,
    v_tjs_wallet.id,
    'PROMOTER_DEPOSIT',
    p_amount,
    v_tjs_balance_before,
    v_new_tjs_balance,
    '线下充值 - 操作员: ' || p_promoter_id,
    v_deposit_id,
    'COMPLETED',
    now()
  );

  -- ============================================================
  -- Step 11: 如有赠送，创建 LUCKY_COIN 交易记录
  -- ============================================================
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    v_bonus_tx_id := gen_random_uuid();

    INSERT INTO wallet_transactions (
      id, wallet_id, type, amount,
      balance_before, balance_after,
      description, reference_id, status, created_at
    ) VALUES (
      v_bonus_tx_id,
      v_lc_wallet.id,
      'PROMOTER_DEPOSIT_BONUS',
      v_bonus_amount,
      v_lc_balance_before,
      v_new_lc_balance,
      '线下充值赠送 - 操作员: ' || p_promoter_id,
      v_deposit_id,
      'COMPLETED',
      now()
    );
  END IF;

  -- ============================================================
  -- Step 12: 更新当日结算记录
  -- ============================================================
  UPDATE promoter_settlements
  SET total_deposit_amount = total_deposit_amount + p_amount,
      total_deposit_count  = total_deposit_count + 1,
      updated_at           = now()
  WHERE promoter_id = p_promoter_id
    AND settlement_date = v_today;

  -- ============================================================
  -- Step 13: 发送充值通知
  -- ============================================================
  SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_target_name
  FROM users WHERE id::text = p_target_user_id;

  SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_promoter_name
  FROM users WHERE id::text = p_promoter_id;

  BEGIN
    INSERT INTO notification_queue (
      user_id, type, payload,
      notification_type, title, message, data,
      channel, status, created_at
    ) VALUES (
      p_target_user_id::uuid,
      'wallet_promoter_deposit',
      json_build_object(
        'amount', p_amount,
        'bonus_amount', v_bonus_amount,
        'promoter_id', p_promoter_id,
        'deposit_id', v_deposit_id
      ),
      'wallet_promoter_deposit',
      '充值到账',
      '您已通过地推人员 ' || TRIM(v_promoter_name) || ' 充值 ' || p_amount || ' TJS，当前余额：' || v_new_tjs_balance || ' TJS',
      json_build_object(
        'amount', p_amount,
        'new_balance', v_new_tjs_balance,
        'bonus_amount', v_bonus_amount
      ),
      'whatsapp',
      'pending',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- 通知失败不影响主流程
    NULL;
  END;

  -- ============================================================
  -- 返回结果
  -- ============================================================
  RETURN json_build_object(
    'success', true,
    'deposit_id', v_deposit_id,
    'amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_wallet', 'LUCKY_COIN',
    'new_tjs_balance', v_new_tjs_balance,
    'new_lc_balance', v_new_lc_balance,
    'today_count', v_today_count + 1,
    'today_total', v_today_total + p_amount,
    'daily_limit', COALESCE(v_promoter.daily_deposit_limit, 5000),
    'daily_count_limit', v_daily_count_limit
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'INTERNAL_ERROR',
      'detail', SQLERRM
    );
END;
$$;
