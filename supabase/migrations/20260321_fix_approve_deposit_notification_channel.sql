-- 修复 Bug R21: approve_deposit_atomic 函数写入 notification_queue 时缺少 channel='whatsapp' 字段
-- 导致 telegram-notification-sender 查询 .eq('channel', 'whatsapp') 时找不到记录，通知永远不会发送
--
-- 同时修复 message 字段为空字符串的问题，补充实际通知内容

CREATE OR REPLACE FUNCTION approve_deposit_atomic(
  p_request_id TEXT,
  p_action TEXT,  -- 'approve' or 'reject'
  p_admin_id TEXT,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit RECORD;
  v_deposit_amount NUMERIC;
  v_wallet RECORD;
  v_new_balance NUMERIC;
  v_bonus NUMERIC := 0;
  v_bonus_pct NUMERIC := 0;
  v_is_first_deposit BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  -- Step 1: 锁定充值请求（FOR UPDATE 防止并发）
  SELECT * INTO v_deposit
  FROM deposit_requests
  WHERE id = p_request_id::uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', '充值请求不存在');
  END IF;

  IF v_deposit.status != 'PENDING' THEN
    RETURN json_build_object('success', false, 'error', '该充值请求已处理，状态为: ' || v_deposit.status);
  END IF;

  v_deposit_amount := v_deposit.amount;

  -- Step 2: 处理拒绝逻辑
  IF p_action = 'reject' THEN
    UPDATE deposit_requests
    SET status = 'REJECTED',
        admin_note = p_admin_note,
        reviewed_by = p_admin_id,
        reviewed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id::uuid;

    -- 发送充值被拒通知（包含 channel='whatsapp'）
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
      'wallet_withdraw_failed',
      json_build_object(
        'transaction_amount', v_deposit_amount,
        'failure_reason', COALESCE(p_admin_note, '审核未通过'),
        'current_balance', 0
      )::jsonb,
      'wallet_withdraw_failed',
      '充值失败',
      '您的充值申请（' || v_deposit_amount || ' TJS）未通过审核。原因：' || COALESCE(p_admin_note, '审核未通过'),
      json_build_object(
        'transaction_amount', v_deposit_amount,
        'failure_reason', COALESCE(p_admin_note, '审核未通过'),
        'current_balance', 0
      )::jsonb,
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
      p_action := 'REJECT_DEPOSIT',
      p_user_id := p_admin_id,
      p_target_type := 'deposit_request',
      p_target_id := p_request_id,
      p_details := json_build_object(
        'admin_id', p_admin_id,
        'user_id', v_deposit.user_id,
        'amount', v_deposit_amount,
        'currency', v_deposit.currency,
        'order_number', v_deposit.order_number,
        'admin_note', p_admin_note
      )::jsonb
    );

    RETURN json_build_object('success', true, 'action', 'rejected', 'amount', v_deposit_amount);
  END IF;

  -- Step 3: 处理批准逻辑
  IF p_action != 'approve' THEN
    RETURN json_build_object('success', false, 'error', '无效的操作: ' || p_action);
  END IF;

  -- Step 4: 检查是否首次充值
  SELECT COUNT(*) = 0 INTO v_is_first_deposit
  FROM deposit_requests
  WHERE user_id = v_deposit.user_id
    AND status = 'APPROVED'
    AND id != p_request_id::uuid;

  -- Step 5: 计算首充奖励
  IF v_is_first_deposit THEN
    SELECT COALESCE((value->>'percent')::numeric, 0) INTO v_bonus_pct
    FROM system_config
    WHERE key = 'first_deposit_bonus';

    IF v_bonus_pct > 0 THEN
      v_bonus := ROUND(v_deposit_amount * v_bonus_pct / 100, 2);
    END IF;
  END IF;

  -- Step 6: 锁定并更新钱包余额
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = v_deposit.user_id
    AND type = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- 自动创建钱包
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (v_deposit.user_id, 'TJS', 'TJS', 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  v_new_balance := COALESCE(v_wallet.balance, 0) + v_deposit_amount + v_bonus;

  UPDATE wallets
  SET balance = v_new_balance,
      version = COALESCE(version, 0) + 1,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Step 7: 记录钱包流水
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
    v_new_balance - v_bonus,
    'COMPLETED',
    '充值到账 - 订单号: ' || COALESCE(v_deposit.order_number, p_request_id),
    p_request_id,
    NOW(), NOW()
  );

  -- Step 8: 如果有首充奖励，记录奖励流水
  IF v_bonus > 0 THEN
    INSERT INTO wallet_transactions (
      wallet_id, type, amount,
      balance_before, balance_after,
      status, description,
      related_id, processed_at, created_at
    ) VALUES (
      v_wallet.id,
      'BONUS',
      v_bonus,
      v_new_balance - v_bonus,
      v_new_balance,
      'COMPLETED',
      '首充奖励 ' || v_bonus_pct || '%',
      p_request_id,
      NOW(), NOW()
    );
  END IF;

  -- Step 9: 更新充值请求状态
  UPDATE deposit_requests
  SET status = 'APPROVED',
      admin_note = p_admin_note,
      reviewed_by = p_admin_id,
      reviewed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_request_id::uuid;

  -- Step 10: 更新用户余额缓存（如有）
  UPDATE users
  SET tjs_balance = v_new_balance,
      updated_at = NOW()
  WHERE id = v_deposit.user_id;

  -- Step 11: 发送充值到账通知（包含 channel='whatsapp'）
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
    json_build_object('transaction_amount', v_deposit_amount)::jsonb,
    'wallet_deposit',
    '充值到账',
    '您的充值 ' || v_deposit_amount || ' TJS 已到账，当前余额：' || v_new_balance || ' TJS',
    json_build_object('transaction_amount', v_deposit_amount)::jsonb,
    'whatsapp',
    u.phone_number,
    1,
    'pending',
    NOW(),
    0, 3,
    NOW(), NOW()
  FROM users u WHERE u.id = v_deposit.user_id;

  -- Step 12: 如有首充奖励，发送奖励通知
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
      'first_deposit_bonus',
      json_build_object(
        'deposit_amount', v_deposit_amount,
        'bonus_amount', v_bonus,
        'bonus_percent', v_bonus_pct,
        'total_amount', v_deposit_amount + v_bonus
      )::jsonb,
      'first_deposit_bonus',
      '首充奖励到账',
      '恭喜！您获得首充奖励 ' || v_bonus || ' TJS（' || v_bonus_pct || '%）',
      json_build_object(
        'deposit_amount', v_deposit_amount,
        'bonus_amount', v_bonus,
        'bonus_percent', v_bonus_pct,
        'total_amount', v_deposit_amount + v_bonus
      )::jsonb,
      'whatsapp',
      u.phone_number,
      1,
      'pending',
      NOW(),
      0, 3,
      NOW(), NOW()
    FROM users u WHERE u.id = v_deposit.user_id;
  END IF;

  -- Step 13: 记录操作日志
  PERFORM log_edge_function_action(
    p_function_name := 'approve_deposit_atomic',
    p_action := 'APPROVE_DEPOSIT',
    p_user_id := p_admin_id,
    p_target_type := 'deposit_request',
    p_target_id := p_request_id,
    p_details := json_build_object(
      'admin_id', p_admin_id,
      'user_id', v_deposit.user_id,
      'amount', v_deposit_amount,
      'bonus', v_bonus,
      'currency', v_deposit.currency,
      'order_number', v_deposit.order_number,
      'new_balance', v_new_balance
    )::jsonb
  );

  RETURN json_build_object(
    'success', true,
    'action', 'approved',
    'amount', v_deposit_amount,
    'bonus', v_bonus,
    'new_balance', v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
