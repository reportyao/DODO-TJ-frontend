-- ============================================================
-- 1. 创建 execute_sql 辅助函数 (如果不存在)
-- 允许通过 Service Role Key 执行任意 SQL
-- ============================================================
CREATE OR REPLACE FUNCTION public.execute_sql(p_sql TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================
-- 2. 修复: perform_promoter_deposit 函数
-- ============================================================
CREATE OR REPLACE FUNCTION perform_promoter_deposit(
  p_promoter_id      TEXT,
  p_target_user_id   TEXT,
  p_amount           NUMERIC,
  p_note             TEXT DEFAULT '',
  p_idempotency_key  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_promoter     BOOLEAN := FALSE;
  v_is_admin        BOOLEAN := FALSE;
  v_user            RECORD;
  v_wallet          RECORD;
  v_lc_wallet       RECORD;
  v_existing_deposit RECORD;
  v_new_balance     NUMERIC;
  v_lc_balance_before NUMERIC;
  v_new_lc_balance  NUMERIC;
  v_bonus_amount    NUMERIC := 0;
  v_bonus_percent   NUMERIC := 0;
  v_config_value    JSONB;
  v_deposit_id      UUID;
  v_tx_id           UUID;
  v_bonus_tx_id     UUID;
BEGIN
  -- Step 1: 幂等性检查
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key != '' THEN
    SELECT id, amount, bonus_amount INTO v_existing_deposit
    FROM promoter_deposits
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
    
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'deposit_id', v_existing_deposit.id,
        'amount', v_existing_deposit.amount,
        'bonus_amount', COALESCE(v_existing_deposit.bonus_amount, 0),
        'message', '该操作已执行（幂等）'
      );
    END IF;
  END IF;

  -- Step 2: 验证执行者身份
  SELECT EXISTS (
    SELECT 1 FROM promoter_profiles 
    WHERE user_id = p_promoter_id AND promoter_status = 'active'
  ) INTO v_is_promoter;
  
  SELECT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE id::text = p_promoter_id AND status = 'active'
  ) INTO v_is_admin;

  IF NOT v_is_promoter AND NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_ACCESS', 'message', '无权执行代充操作');
  END IF;

  -- Step 3: 禁止给自己充值
  IF NOT v_is_admin AND p_promoter_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_DEPOSIT_FORBIDDEN');
  END IF;

  -- Step 4: 校验目标用户
  SELECT * INTO v_user FROM users WHERE id = p_target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '目标用户不存在'; END IF;

  -- Step 5: 金额校验
  IF p_amount <= 0 THEN RAISE EXCEPTION '充值金额必须大于0'; END IF;

  -- Step 6: 锁定用户 TJS 钱包
  SELECT * INTO v_wallet FROM wallets WHERE user_id = p_target_user_id AND type = 'TJS' FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (p_target_user_id, 'TJS', 'TJS', 0, 1) RETURNING * INTO v_wallet;
  END IF;

  -- Step 7: 计算赠送
  SELECT value INTO v_config_value FROM system_config WHERE key = 'deposit_bonus' AND (value->>'enabled')::boolean = true;
  IF v_config_value IS NOT NULL THEN
    IF p_amount >= COALESCE((v_config_value->>'min_amount')::NUMERIC, 0) THEN
      v_bonus_percent := COALESCE((v_config_value->>'bonus_percent')::NUMERIC, 0);
      v_bonus_amount := ROUND(p_amount * v_bonus_percent / 100, 2);
    END IF;
  END IF;

  -- Step 8: 扣减补贴池
  IF v_is_promoter THEN
    UPDATE promoter_profiles SET subsidy_balance = subsidy_balance - p_amount, updated_at = NOW() WHERE user_id = p_promoter_id;
  END IF;

  -- Step 9: 更新用户 TJS 钱包余额
  v_new_balance := COALESCE(v_wallet.balance, 0) + p_amount;
  UPDATE wallets SET balance = v_new_balance, version = COALESCE(version, 0) + 1, updated_at = NOW() WHERE id = v_wallet.id;

  -- Step 10: 记录 TJS 充值流水
  INSERT INTO wallet_transactions (
    wallet_id, type, amount, balance_before, balance_after,
    status, description, reference_id, processed_at, created_at
  ) VALUES (
    v_wallet.id, 'DEPOSIT', p_amount, COALESCE(v_wallet.balance, 0), v_new_balance,
    'COMPLETED', '地推代充: ' || p_note, p_idempotency_key, NOW(), NOW()
  ) RETURNING id INTO v_tx_id;

  -- Step 11: 记录代充日志
  INSERT INTO promoter_deposits (
    promoter_id, target_user_id, amount, bonus_amount,
    note, idempotency_key, created_at
  ) VALUES (
    p_promoter_id, p_target_user_id, p_amount, v_bonus_amount,
    p_note, p_idempotency_key, NOW()
  ) RETURNING id INTO v_deposit_id;

  -- Step 12: 处理赠送积分
  IF v_bonus_amount > 0 THEN
    SELECT * INTO v_lc_wallet FROM wallets WHERE user_id = p_target_user_id AND type = 'LUCKY_COIN' FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, type, currency, balance, version)
      VALUES (p_target_user_id, 'LUCKY_COIN', 'POINTS', 0, 1) RETURNING * INTO v_lc_wallet;
    END IF;
    v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
    v_new_lc_balance := v_lc_balance_before + v_bonus_amount;
    UPDATE wallets SET balance = v_new_lc_balance, version = COALESCE(version, 0) + 1, updated_at = NOW() WHERE id = v_lc_wallet.id;
    INSERT INTO wallet_transactions (
      wallet_id, type, amount, balance_before, balance_after,
      status, description, reference_id, processed_at, created_at
    ) VALUES (
      v_lc_wallet.id, 'BONUS', v_bonus_amount, v_lc_balance_before, v_new_lc_balance,
      'COMPLETED', '充值赠送积分 (订单: ' || v_deposit_id || ')', p_idempotency_key, NOW(), NOW()
    ) RETURNING id INTO v_bonus_tx_id;
  END IF;

  -- Step 13: 发送通知
  INSERT INTO notification_queue (
    user_id, type, payload, notification_type, title, message, data,
    channel, phone_number, priority, status, scheduled_at,
    retry_count, max_retries, created_at, updated_at
  )
  SELECT
    p_target_user_id, 'wallet_deposit',
    jsonb_build_object('transaction_amount', p_amount, 'bonus_amount', v_bonus_amount),
    'wallet_deposit', '充值到账',
    '您的充值 ' || p_amount || ' TJS 已到账' || CASE WHEN v_bonus_amount > 0 THEN '，赠送 ' || v_bonus_amount || ' 积分' ELSE '' END,
    jsonb_build_object('transaction_amount', p_amount, 'bonus_amount', v_bonus_amount),
    'whatsapp', u.phone_number, 1, 'pending', NOW(), 0, 3, NOW(), NOW()
  FROM users u WHERE u.id = p_target_user_id;

  RETURN jsonb_build_object(
    'success', true, 'deposit_id', v_deposit_id, 'amount', p_amount,
    'bonus_amount', v_bonus_amount, 'bonus_percent', v_bonus_percent, 'new_balance', v_new_balance
  );
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;
