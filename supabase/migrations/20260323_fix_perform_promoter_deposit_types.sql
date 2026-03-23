-- 删除所有旧版本
DROP FUNCTION IF EXISTS public.perform_promoter_deposit(text, text, numeric, text, text);
DROP FUNCTION IF EXISTS public.perform_promoter_deposit(uuid, uuid, numeric, text, text);

-- 重建：所有参数都是 TEXT 类型（与 Edge Function 匹配）
-- 关键类型映射（全部已验证）：
--   public.users.id = TEXT（不是UUID！）
--   wallets.user_id = TEXT
--   wallets.id = UUID
--   promoter_profiles.user_id = TEXT
--   promoter_deposits.promoter_id = TEXT, target_user_id = TEXT
--   notification_queue.user_id = TEXT
--   wallet_transactions.wallet_id = UUID
CREATE OR REPLACE FUNCTION public.perform_promoter_deposit(
  p_promoter_id     TEXT,
  p_target_user_id  TEXT,
  p_amount          NUMERIC,
  p_note            TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promoter        RECORD;
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
        'deposit_id', v_existing_deposit.id,
        'amount', v_existing_deposit.amount,
        'bonus_amount', COALESCE(v_existing_deposit.bonus_amount, 0),
        'idempotent', true
      );
    END IF;
  END IF;

  -- Step 2: 验证地推人员 (promoter_profiles.user_id is TEXT)
  SELECT * INTO v_promoter
  FROM promoter_profiles
  WHERE user_id = p_promoter_id
    AND promoter_status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '地推人员不存在或未激活');
  END IF;

  -- Step 3: 验证目标用户 (public.users.id is TEXT, NO cast needed)
  SELECT * INTO v_user
  FROM users
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '目标用户不存在');
  END IF;

  -- Step 4: 金额校验
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '充值金额必须大于0');
  END IF;

  -- Step 5: 锁定用户 TJS 钱包 (wallets.user_id is TEXT)
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = p_target_user_id
    AND type = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (p_target_user_id, 'TJS', 'TJS', 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  -- Step 6: 计算赠送（统一规则：deposit_bonus 配置）
  SELECT value INTO v_config_value
  FROM system_config
  WHERE key = 'deposit_bonus'
    AND (value->>'enabled')::boolean = true;

  IF v_config_value IS NOT NULL THEN
    IF p_amount >= COALESCE((v_config_value->>'min_amount')::NUMERIC, 0) THEN
      v_bonus_percent := COALESCE((v_config_value->>'bonus_percent')::NUMERIC, 0);
    END IF;
  END IF;

  v_bonus_amount := FLOOR(p_amount * v_bonus_percent / 100);

  -- Step 7: 如有赠送，锁定 LUCKY_COIN 钱包 (wallets.user_id is TEXT)
  IF v_bonus_amount > 0 THEN
    SELECT * INTO v_lc_wallet
    FROM wallets
    WHERE user_id = p_target_user_id
      AND type = 'LUCKY_COIN'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, type, currency, balance, version)
      VALUES (p_target_user_id, 'LUCKY_COIN', 'POINTS', 0, 1)
      RETURNING * INTO v_lc_wallet;
    END IF;

    v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
    v_new_lc_balance := v_lc_balance_before + v_bonus_amount;
  END IF;

  -- Step 8: 更新 TJS 钱包余额
  v_new_balance := COALESCE(v_wallet.balance, 0) + p_amount;

  UPDATE wallets
  SET balance = v_new_balance,
      version = COALESCE(version, 0) + 1,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Step 8.5: 如有赠送，更新 LUCKY_COIN 钱包
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    UPDATE wallets
    SET balance = v_new_lc_balance,
        version = COALESCE(version, 0) + 1,
        updated_at = NOW()
    WHERE id = v_lc_wallet.id;
  END IF;

  -- Step 9: 创建代充记录 (promoter_deposits columns are TEXT)
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
    p_amount, 'TJS', 'COMPLETED', p_note,
    v_bonus_amount, p_idempotency_key,
    NOW(), NOW()
  );

  -- Step 10: TJS 钱包交易记录
  v_tx_id := gen_random_uuid();

  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    status, description,
    related_id,
    processed_at, created_at
  ) VALUES (
    v_tx_id, v_wallet.id, 'PROMOTER_DEPOSIT', p_amount,
    COALESCE(v_wallet.balance, 0), v_new_balance,
    'COMPLETED',
    '代充到账 - ' || COALESCE(p_note, '地推充值'),
    v_deposit_id::text,
    NOW(), NOW()
  );

  -- Step 11: 赠送交易记录
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    v_bonus_tx_id := gen_random_uuid();

    INSERT INTO wallet_transactions (
      id, wallet_id, type, amount,
      balance_before, balance_after,
      status, description,
      related_id,
      processed_at, created_at
    ) VALUES (
      v_bonus_tx_id, v_lc_wallet.id, 'BONUS', v_bonus_amount,
      v_lc_balance_before, v_new_lc_balance,
      'COMPLETED',
      '代充赠送 ' || v_bonus_percent || '% 积分（' || v_bonus_amount || '）',
      v_deposit_id::text,
      NOW(), NOW()
    );
  END IF;

  -- Step 12: 发送通知 (notification_queue.user_id is TEXT)
  INSERT INTO notification_queue (
    user_id, type, payload,
    notification_type, title, message, data,
    channel, phone_number,
    priority, status, scheduled_at,
    retry_count, max_retries,
    created_at, updated_at
  )
  VALUES (
    p_target_user_id,
    'wallet_deposit',
    jsonb_build_object('transaction_amount', p_amount, 'bonus_amount', v_bonus_amount),
    'wallet_deposit',
    '充值到账',
    '您的充值 ' || p_amount || ' TJS 已到账' ||
      CASE WHEN v_bonus_amount > 0 THEN '，赠送 ' || v_bonus_amount || ' 积分' ELSE '' END,
    jsonb_build_object('transaction_amount', p_amount, 'bonus_amount', v_bonus_amount),
    'whatsapp',
    v_user.phone_number,
    1, 'pending', NOW(),
    0, 3, NOW(), NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'deposit_id', v_deposit_id,
    'amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_percent', v_bonus_percent,
    'new_balance', v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
