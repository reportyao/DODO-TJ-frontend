-- ============================================================
-- 20260323: 统一充值赠送逻辑修复
-- ============================================================
-- 问题：
--   1. approve_deposit_atomic 查找 config key='deposit_bonus'，DB中不存在
--   2. approve_deposit_atomic 读取 value->>'percent'，实际字段名是 'bonus_percent'
--   3. approve_deposit_atomic 创建LUCKY_COIN钱包时 currency='LUCKY_COIN'，应为'POINTS'
--   4. perform_promoter_deposit 查找 config key='promoter_deposit_bonus_rules'，DB中不存在
--   5. 业务规则统一：每次充值 ≥100 TJS 赠送 50% 积分（用户充值和代充规则一致）
-- ============================================================

-- Step 1: 创建统一的充值赠送配置
-- 删除旧的不一致配置，创建统一的 deposit_bonus 配置
INSERT INTO system_config (key, value)
VALUES (
  'deposit_bonus',
  '{"enabled": true, "min_amount": 100, "bonus_percent": 50}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Step 2: 重建 approve_deposit_atomic 函数
-- 修复：config key、字段名、currency、描述文案
CREATE OR REPLACE FUNCTION public.approve_deposit_atomic(
  p_request_id TEXT,
  p_action     TEXT,
  p_admin_id   TEXT,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit         RECORD;
  v_deposit_amount  NUMERIC;
  v_wallet          RECORD;
  v_lc_wallet       RECORD;
  v_new_balance     NUMERIC;
  v_new_lc_balance  NUMERIC;
  v_bonus           NUMERIC := 0;
  v_bonus_pct       NUMERIC := 0;
  v_action_upper    TEXT;
BEGIN
  -- 统一转为大写，兼容 'APPROVED'/'approved'/'APPROVE' 等写法
  v_action_upper := UPPER(TRIM(p_action));

  -- ============================================================
  -- Step 1: 参数校验
  -- ============================================================
  IF p_request_id IS NULL OR p_request_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '请求ID不能为空');
  END IF;

  IF v_action_upper NOT IN ('APPROVED', 'REJECTED', 'APPROVE', 'REJECT') THEN
    RETURN jsonb_build_object('success', false, 'error', '无效的审核操作，必须为 APPROVED 或 REJECTED，收到: ' || p_action);
  END IF;

  -- ============================================================
  -- Step 2: 锁定充值请求（FOR UPDATE 防止并发 TOCTOU）
  -- ============================================================
  SELECT * INTO v_deposit
  FROM deposit_requests
  WHERE id = p_request_id::uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '充值请求不存在');
  END IF;

  IF v_deposit.status != 'PENDING' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '该充值请求已处理，状态为: ' || v_deposit.status
    );
  END IF;

  v_deposit_amount := v_deposit.amount;

  -- ============================================================
  -- Step 3: 处理拒绝操作
  -- ============================================================
  IF v_action_upper IN ('REJECTED', 'REJECT') THEN
    UPDATE deposit_requests
    SET status      = 'REJECTED',
        admin_note  = p_admin_note,
        reviewed_by = p_admin_id::uuid,
        reviewed_at = NOW(),
        updated_at  = NOW()
    WHERE id = p_request_id::uuid;

    INSERT INTO notification_queue (
      user_id, type, payload,
      notification_type, title, message, data,
      channel, phone_number,
      priority, status, scheduled_at,
      retry_count, max_retries,
      created_at, updated_at
    )
    SELECT
      v_deposit.user_id,
      'wallet_deposit_rejected',
      jsonb_build_object(
        'transaction_amount', v_deposit_amount,
        'failure_reason', COALESCE(p_admin_note, '审核未通过'),
        'current_balance', 0
      ),
      'wallet_deposit_rejected',
      '充值申请被拒绝',
      '您的充值申请（' || v_deposit_amount || ' TJS）未通过审核。原因：' || COALESCE(p_admin_note, '审核未通过'),
      jsonb_build_object(
        'transaction_amount', v_deposit_amount,
        'failure_reason', COALESCE(p_admin_note, '审核未通过'),
        'current_balance', 0
      ),
      'whatsapp',
      u.phone_number,
      2,
      'pending',
      NOW(),
      0, 3,
      NOW(), NOW()
    FROM users u WHERE u.id = v_deposit.user_id;

    PERFORM log_edge_function_action(
      p_function_name := 'approve_deposit_atomic',
      p_action        := 'REJECT_DEPOSIT',
      p_user_id       := p_admin_id,
      p_target_type   := 'deposit_request',
      p_target_id     := p_request_id,
      p_details       := jsonb_build_object(
        'admin_id',    p_admin_id,
        'user_id',     v_deposit.user_id,
        'amount',      v_deposit_amount,
        'currency',    v_deposit.currency,
        'order_number',v_deposit.order_number,
        'admin_note',  p_admin_note
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'action',  'REJECTED',
      'amount',  v_deposit_amount
    );
  END IF;

  -- ============================================================
  -- Step 4: 处理批准操作 - 锁定 TJS 钱包
  -- ============================================================
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = v_deposit.user_id
    AND type = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (v_deposit.user_id, 'TJS', 'TJS', 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  -- ============================================================
  -- Step 5: 计算充值赠送（统一规则：≥100 TJS 赠送 50% 积分）
  -- 【修复】config key: 'deposit_bonus'
  -- 【修复】字段名: 'bonus_percent', 'min_amount'
  -- ============================================================
  SELECT COALESCE((value->>'bonus_percent')::numeric, 0) INTO v_bonus_pct
  FROM system_config
  WHERE key = 'deposit_bonus'
    AND (value->>'enabled')::boolean = true
    AND v_deposit_amount >= COALESCE((value->>'min_amount')::numeric, 0);

  IF v_bonus_pct > 0 THEN
    v_bonus := ROUND(v_deposit_amount * v_bonus_pct / 100, 2);
  END IF;

  -- ============================================================
  -- Step 6: 更新 TJS 钱包余额（本金入 TJS）
  -- ============================================================
  v_new_balance := COALESCE(v_wallet.balance, 0) + v_deposit_amount;

  UPDATE wallets
  SET balance    = v_new_balance,
      version    = COALESCE(version, 0) + 1,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Step 7: 记录 TJS 钱包流水
  INSERT INTO wallet_transactions (
    wallet_id, type, amount,
    balance_before, balance_after,
    status, description,
    related_id, processed_at, created_at
  ) VALUES (
    v_wallet.id,
    'DEPOSIT',
    v_deposit_amount,
    COALESCE(v_wallet.balance, 0),
    v_new_balance,
    'COMPLETED',
    '充值到账 - 订单号: ' || COALESCE(v_deposit.order_number, p_request_id),
    p_request_id,
    NOW(), NOW()
  );

  -- ============================================================
  -- Step 8: 如有赠送，打入 LUCKY_COIN 积分钱包
  -- 【修复】currency = 'POINTS'（不是 'LUCKY_COIN'）
  -- ============================================================
  IF v_bonus > 0 THEN
    SELECT * INTO v_lc_wallet
    FROM wallets
    WHERE user_id = v_deposit.user_id
      AND type = 'LUCKY_COIN'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, type, currency, balance, version)
      VALUES (v_deposit.user_id, 'LUCKY_COIN', 'POINTS', 0, 1)
      RETURNING * INTO v_lc_wallet;
    END IF;

    v_new_lc_balance := COALESCE(v_lc_wallet.balance, 0) + v_bonus;

    UPDATE wallets
    SET balance    = v_new_lc_balance,
        version    = COALESCE(version, 0) + 1,
        updated_at = NOW()
    WHERE id = v_lc_wallet.id;

    INSERT INTO wallet_transactions (
      wallet_id, type, amount,
      balance_before, balance_after,
      status, description,
      related_id, processed_at, created_at
    ) VALUES (
      v_lc_wallet.id,
      'BONUS',
      v_bonus,
      COALESCE(v_lc_wallet.balance, 0),
      v_new_lc_balance,
      'COMPLETED',
      '充值赠送 ' || v_bonus_pct || '% 积分（' || v_bonus || '）',
      p_request_id,
      NOW(), NOW()
    );
  END IF;

  -- ============================================================
  -- Step 9: 更新充值请求状态
  -- ============================================================
  UPDATE deposit_requests
  SET status      = 'APPROVED',
      admin_note  = p_admin_note,
      reviewed_by = p_admin_id::uuid,
      reviewed_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_request_id::uuid;

  -- ============================================================
  -- Step 10: 发送充值到账通知
  -- ============================================================
  INSERT INTO notification_queue (
    user_id, type, payload,
    notification_type, title, message, data,
    channel, phone_number,
    priority, status, scheduled_at,
    retry_count, max_retries,
    created_at, updated_at
  )
  SELECT
    v_deposit.user_id,
    'wallet_deposit',
    jsonb_build_object('transaction_amount', v_deposit_amount),
    'wallet_deposit',
    '充值到账',
    '您的充值 ' || v_deposit_amount || ' TJS 已到账，当前余额：' || v_new_balance || ' TJS',
    jsonb_build_object('transaction_amount', v_deposit_amount),
    'whatsapp',
    u.phone_number,
    1,
    'pending',
    NOW(),
    0, 3,
    NOW(), NOW()
  FROM users u WHERE u.id = v_deposit.user_id;

  -- Step 11: 如有赠送，发送赠送通知
  IF v_bonus > 0 THEN
    INSERT INTO notification_queue (
      user_id, type, payload,
      notification_type, title, message, data,
      channel, phone_number,
      priority, status, scheduled_at,
      retry_count, max_retries,
      created_at, updated_at
    )
    SELECT
      v_deposit.user_id,
      'deposit_bonus',
      jsonb_build_object(
        'deposit_amount', v_deposit_amount,
        'bonus_amount',   v_bonus,
        'bonus_percent',  v_bonus_pct
      ),
      'deposit_bonus',
      '充值赠送到账',
      '恭喜！您获得充值赠送 ' || v_bonus || ' 积分（' || v_bonus_pct || '%）',
      jsonb_build_object(
        'deposit_amount', v_deposit_amount,
        'bonus_amount',   v_bonus,
        'bonus_percent',  v_bonus_pct
      ),
      'whatsapp',
      u.phone_number,
      1,
      'pending',
      NOW(),
      0, 3,
      NOW(), NOW()
    FROM users u WHERE u.id = v_deposit.user_id;
  END IF;

  -- Step 12: 记录操作日志
  PERFORM log_edge_function_action(
    p_function_name := 'approve_deposit_atomic',
    p_action        := 'APPROVE_DEPOSIT',
    p_user_id       := p_admin_id,
    p_target_type   := 'deposit_request',
    p_target_id     := p_request_id,
    p_details       := jsonb_build_object(
      'admin_id',    p_admin_id,
      'user_id',     v_deposit.user_id,
      'amount',      v_deposit_amount,
      'bonus',       v_bonus,
      'currency',    v_deposit.currency,
      'order_number',v_deposit.order_number,
      'new_balance', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success',      true,
    'action',       'APPROVED',
    'amount',       v_deposit_amount,
    'bonus_amount', v_bonus,
    'new_balance',  v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Step 3: 重建 perform_promoter_deposit 函数
-- 修复：使用统一的 deposit_bonus 配置（与用户充值规则一致）
CREATE OR REPLACE FUNCTION public.perform_promoter_deposit(
  p_promoter_id     UUID,
  p_user_id         UUID,
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
  -- ============================================================
  -- Step 1: 幂等性检查（数据库层面）
  -- ============================================================
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

  -- ============================================================
  -- Step 2: 验证地推人员
  -- ============================================================
  SELECT * INTO v_promoter
  FROM promoter_profiles
  WHERE user_id = p_promoter_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '地推人员不存在或未激活');
  END IF;

  -- ============================================================
  -- Step 3: 验证目标用户
  -- ============================================================
  SELECT * INTO v_user
  FROM users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '目标用户不存在');
  END IF;

  -- ============================================================
  -- Step 4: 金额校验
  -- ============================================================
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '充值金额必须大于0');
  END IF;

  -- ============================================================
  -- Step 5: 锁定用户 TJS 钱包
  -- ============================================================
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = p_user_id
    AND type = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (p_user_id, 'TJS', 'TJS', 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  -- ============================================================
  -- Step 6: 计算赠送金额（统一规则：≥100 TJS 赠送 50% 积分）
  -- 【修复】使用统一的 deposit_bonus 配置
  -- ============================================================
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

  -- ============================================================
  -- Step 7: 查询 LUCKY_COIN 钱包（如有赠送则加锁）
  -- ============================================================
  IF v_bonus_amount > 0 THEN
    SELECT * INTO v_lc_wallet
    FROM wallets
    WHERE user_id = p_user_id
      AND type = 'LUCKY_COIN'
    FOR UPDATE;

    IF NOT FOUND THEN
      -- 【修复】currency = 'POINTS'（不是 'LUCKY_COIN'）
      INSERT INTO wallets (user_id, type, currency, balance, version)
      VALUES (p_user_id, 'LUCKY_COIN', 'POINTS', 0, 1)
      RETURNING * INTO v_lc_wallet;
    END IF;

    v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
    v_new_lc_balance := v_lc_balance_before + v_bonus_amount;
  END IF;

  -- ============================================================
  -- Step 8: 更新 TJS 钱包余额
  -- ============================================================
  v_new_balance := COALESCE(v_wallet.balance, 0) + p_amount;

  UPDATE wallets
  SET balance    = v_new_balance,
      version    = COALESCE(version, 0) + 1,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Step 8.5: 如有赠送，更新 LUCKY_COIN 钱包余额
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    UPDATE wallets
    SET balance    = v_new_lc_balance,
        version    = COALESCE(version, 0) + 1,
        updated_at = NOW()
    WHERE id = v_lc_wallet.id;
  END IF;

  -- ============================================================
  -- Step 9: 创建代充记录
  -- ============================================================
  v_deposit_id := gen_random_uuid();

  INSERT INTO promoter_deposits (
    id, promoter_id, user_id,
    amount, currency, status, note,
    bonus_amount, idempotency_key,
    created_at, updated_at
  ) VALUES (
    v_deposit_id,
    p_promoter_id,
    p_user_id,
    p_amount,
    'TJS',
    'COMPLETED',
    p_note,
    v_bonus_amount,
    p_idempotency_key,
    NOW(), NOW()
  );

  -- ============================================================
  -- Step 10: 创建 TJS 钱包交易记录
  -- ============================================================
  v_tx_id := gen_random_uuid();

  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    status, description,
    related_id, reference_id,
    processed_at, created_at
  ) VALUES (
    v_tx_id,
    v_wallet.id,
    'PROMOTER_DEPOSIT',
    p_amount,
    COALESCE(v_wallet.balance, 0),
    v_new_balance,
    'COMPLETED',
    '代充到账 - ' || COALESCE(p_note, '地推充值'),
    v_deposit_id::text,
    v_deposit_id::text,
    NOW(), NOW()
  );

  -- ============================================================
  -- Step 11: 如有赠送，创建 LUCKY_COIN 交易记录
  -- ============================================================
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    v_bonus_tx_id := gen_random_uuid();

    INSERT INTO wallet_transactions (
      id, wallet_id, type, amount,
      balance_before, balance_after,
      status, description,
      related_id, reference_id,
      processed_at, created_at
    ) VALUES (
      v_bonus_tx_id,
      v_lc_wallet.id,
      'BONUS',
      v_bonus_amount,
      v_lc_balance_before,
      v_new_lc_balance,
      'COMPLETED',
      '代充赠送 ' || v_bonus_percent || '% 积分（' || v_bonus_amount || '）',
      v_deposit_id::text,
      v_deposit_id::text,
      NOW(), NOW()
    );
  END IF;

  -- ============================================================
  -- Step 12: 更新地推人员统计
  -- ============================================================
  UPDATE promoter_profiles
  SET total_deposit_amount = COALESCE(total_deposit_amount, 0) + p_amount,
      total_deposit_count  = COALESCE(total_deposit_count, 0) + 1,
      updated_at           = NOW()
  WHERE user_id = p_promoter_id;

  -- ============================================================
  -- Step 13: 发送充值到账通知
  -- ============================================================
  INSERT INTO notification_queue (
    user_id, type, payload,
    notification_type, title, message, data,
    channel, phone_number,
    priority, status, scheduled_at,
    retry_count, max_retries,
    created_at, updated_at
  )
  SELECT
    p_user_id,
    'wallet_deposit',
    jsonb_build_object(
      'transaction_amount', p_amount,
      'bonus_amount', v_bonus_amount
    ),
    'wallet_deposit',
    '充值到账',
    '您的充值 ' || p_amount || ' TJS 已到账' ||
      CASE WHEN v_bonus_amount > 0 THEN '，赠送 ' || v_bonus_amount || ' 积分' ELSE '' END,
    jsonb_build_object(
      'transaction_amount', p_amount,
      'bonus_amount', v_bonus_amount
    ),
    'whatsapp',
    v_user.phone_number,
    1,
    'pending',
    NOW(),
    0, 3,
    NOW(), NOW()
  FROM users u WHERE u.id = p_user_id;

  -- Step 14: 记录操作日志
  PERFORM log_edge_function_action(
    p_function_name := 'perform_promoter_deposit',
    p_action        := 'PROMOTER_DEPOSIT',
    p_user_id       := p_promoter_id::text,
    p_target_type   := 'user',
    p_target_id     := p_user_id::text,
    p_details       := jsonb_build_object(
      'promoter_id',  p_promoter_id,
      'user_id',      p_user_id,
      'amount',       p_amount,
      'bonus_amount', v_bonus_amount,
      'bonus_percent', v_bonus_percent,
      'new_balance',  v_new_balance,
      'deposit_id',   v_deposit_id
    )
  );

  RETURN jsonb_build_object(
    'success',      true,
    'deposit_id',   v_deposit_id,
    'amount',       p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_wallet', 'LUCKY_COIN',
    'new_balance',  v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
