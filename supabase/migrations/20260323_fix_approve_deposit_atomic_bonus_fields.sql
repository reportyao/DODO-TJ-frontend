-- ============================================================
-- 修复 approve_deposit_atomic 中 deposit_bonus 配置字段名不匹配
-- 
-- Bug 根因：
--   RPC 中读取 value->>'percent' 和 value->>'min_deposit_amount'
--   但 system_config 中实际字段名是 bonus_percent 和 min_amount
--
-- 影响：充值审批通过后，bonus_pct 始终为 0，不赠送任何积分
--
-- 修复：将字段名改为与配置一致
-- ============================================================

CREATE OR REPLACE FUNCTION approve_deposit_atomic(
  p_request_id  TEXT,
  p_action      TEXT,
  p_admin_id    TEXT,
  p_admin_note  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit         deposit_requests%ROWTYPE;
  v_wallet          wallets%ROWTYPE;
  v_lc_wallet       wallets%ROWTYPE;
  v_deposit_amount  NUMERIC;
  v_new_balance     NUMERIC;
  v_bonus           NUMERIC := 0;
  v_bonus_pct       NUMERIC := 0;
  v_lc_balance_before NUMERIC := 0;
  v_new_lc_balance    NUMERIC := 0;
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

    -- 发送拒绝通知
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

    RETURN jsonb_build_object(
      'success', true,
      'action', 'REJECTED',
      'request_id', p_request_id,
      'bonus_amount', 0
    );
  END IF;

  -- ============================================================
  -- Step 4: 获取或创建 TJS 钱包
  -- ============================================================
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = v_deposit.user_id
    AND type = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- 自动创建 TJS 钱包
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (v_deposit.user_id, 'TJS', 'TJS', 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  -- ============================================================
  -- Step 5: 计算充值赠送
  -- 【BUG修复】字段名从 'percent'/'min_deposit_amount' 改为 'bonus_percent'/'min_amount'
  -- 与 system_config 中的实际配置字段名保持一致
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
  -- Step 5.5: 如有赠送，获取或创建 LUCKY_COIN 钱包
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

    v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
    v_new_lc_balance    := v_lc_balance_before + v_bonus;
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

  -- Step 6.5: 如有赠送，更新 LUCKY_COIN 钱包余额
  IF v_bonus > 0 AND v_lc_wallet.id IS NOT NULL THEN
    UPDATE wallets
    SET balance    = v_new_lc_balance,
        version    = COALESCE(version, 0) + 1,
        updated_at = NOW()
    WHERE id = v_lc_wallet.id;
  END IF;

  -- ============================================================
  -- Step 7: 更新充值请求状态
  -- ============================================================
  UPDATE deposit_requests
  SET status      = 'APPROVED',
      admin_note  = p_admin_note,
      reviewed_by = p_admin_id::uuid,
      reviewed_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_request_id::uuid;

  -- ============================================================
  -- Step 8: 记录 TJS 钱包流水
  -- ============================================================
  INSERT INTO wallet_transactions (
    wallet_id, type, amount,
    balance_before, balance_after,
    status, description,
    related_id, reference_id,
    processed_at, created_at
  ) VALUES (
    v_wallet.id,
    'DEPOSIT',
    v_deposit_amount,
    COALESCE(v_wallet.balance, 0),
    v_new_balance,
    'COMPLETED',
    '充值到账 - 订单号: ' || COALESCE(v_deposit.order_number, p_request_id),
    p_request_id,
    p_request_id,
    NOW(), NOW()
  );

  -- Step 8.5: 如有赠送，记录 LUCKY_COIN 流水
  IF v_bonus > 0 AND v_lc_wallet.id IS NOT NULL THEN
    INSERT INTO wallet_transactions (
      wallet_id, type, amount,
      balance_before, balance_after,
      status, description,
      related_id, reference_id,
      processed_at, created_at
    ) VALUES (
      v_lc_wallet.id,
      'BONUS',
      v_bonus,
      v_lc_balance_before,
      v_new_lc_balance,
      'COMPLETED',
      '充值赠送 ' || v_bonus_pct || '% 积分（' || v_bonus || '）',
      p_request_id,
      p_request_id,
      NOW(), NOW()
    );
  END IF;

  -- ============================================================
  -- Step 9: 发送充值到账通知
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
    jsonb_build_object(
      'transaction_amount', v_deposit_amount,
      'bonus_amount', v_bonus
    ),
    'wallet_deposit',
    '充值到账',
    '您的充值 ' || v_deposit_amount || ' TJS 已到账' ||
      CASE WHEN v_bonus > 0 THEN '，赠送 ' || v_bonus || ' 积分' ELSE '' END,
    jsonb_build_object(
      'transaction_amount', v_deposit_amount,
      'bonus_amount', v_bonus
    ),
    'whatsapp',
    u.phone_number,
    1,
    'pending',
    NOW(),
    0, 3,
    NOW(), NOW()
  FROM users u WHERE u.id = v_deposit.user_id;

  -- ============================================================
  -- Step 10: 记录审计日志
  -- ============================================================
  PERFORM log_edge_function_action(
    p_function_name := 'approve_deposit_atomic',
    p_action        := 'APPROVE_DEPOSIT',
    p_user_id       := p_admin_id::text,
    p_target_type   := 'deposit_request',
    p_target_id     := p_request_id::text,
    p_details       := jsonb_build_object(
      'request_id',    p_request_id,
      'user_id',       v_deposit.user_id,
      'amount',        v_deposit_amount,
      'bonus_amount',  v_bonus,
      'bonus_percent', v_bonus_pct,
      'new_balance',   v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success',      true,
    'action',       'APPROVED',
    'request_id',   p_request_id,
    'amount',       v_deposit_amount,
    'bonus_amount', v_bonus,
    'bonus_wallet', CASE WHEN v_bonus > 0 THEN 'LUCKY_COIN' ELSE NULL END,
    'new_balance',  v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
