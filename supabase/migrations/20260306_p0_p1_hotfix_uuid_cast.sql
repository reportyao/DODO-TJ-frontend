-- ============================================================================
-- P0 & P1 安全修复 - 热修复: UUID 类型转换
-- 版本: 1.0.1
-- 日期: 2026-03-06
--
-- 修复内容:
--   deposit_requests.processed_by 列类型为 uuid，
--   withdrawal_requests.admin_id 列类型为 uuid，
--   但 RPC 函数中 p_admin_id 参数为 TEXT 类型，
--   直接赋值会导致 "column is of type uuid but expression is of type text" 错误。
--   本热修复为所有涉及的赋值添加 ::uuid 显式类型转换。
-- ============================================================================


-- ============================================================================
-- 重建 approve_deposit_atomic 函数（添加 ::uuid 转换）
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_deposit_atomic(
  p_request_id TEXT,
  p_action TEXT,        -- 'APPROVED' 或 'REJECTED'
  p_admin_id TEXT,
  p_admin_note TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit       RECORD;
  v_wallet        RECORD;
  v_new_balance   NUMERIC;
  v_new_total     NUMERIC;
  v_bonus         NUMERIC := 0;
  v_bonus_pct     NUMERIC := 0;
  v_config        JSONB;
  v_tx_id         UUID;
  v_bonus_tx_id   UUID;
  v_deposit_amount NUMERIC;
  v_balance_after_deposit NUMERIC;
BEGIN
  -- ============================================================
  -- Step 1: 参数校验
  -- ============================================================
  IF p_request_id IS NULL OR p_request_id = '' THEN
    RETURN json_build_object('success', false, 'error', '请求ID不能为空');
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('APPROVED', 'REJECTED') THEN
    RETURN json_build_object('success', false, 'error', '无效的审核操作，必须为 APPROVED 或 REJECTED');
  END IF;

  -- ============================================================
  -- Step 2: 锁定充值申请并检查状态（原子操作，防止 TOCTOU）
  -- ============================================================
  SELECT * INTO v_deposit
  FROM deposit_requests
  WHERE id::TEXT = p_request_id
  FOR UPDATE;

  IF v_deposit IS NULL THEN
    RETURN json_build_object('success', false, 'error', '未找到充值申请');
  END IF;

  IF v_deposit.status != 'PENDING' THEN
    RETURN json_build_object('success', false, 'error', '该申请已被处理，当前状态: ' || v_deposit.status);
  END IF;

  v_deposit_amount := v_deposit.amount;

  -- ============================================================
  -- Step 3: 处理拒绝操作（简单路径）
  -- ============================================================
  IF p_action = 'REJECTED' THEN
    UPDATE deposit_requests SET
      status = 'REJECTED',
      processed_by = p_admin_id::uuid,  -- 热修复: 显式转换为 uuid
      admin_note = p_admin_note,
      processed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_deposit.id;

    -- 插入拒绝通知
    INSERT INTO notifications (
      user_id, type, title, title_i18n,
      content, message_i18n,
      related_id, related_type
    ) VALUES (
      v_deposit.user_id,
      'PAYMENT_FAILED',
      '充值失败',
      '{"zh": "充值失败", "ru": "Ошибка пополнения", "tg": "Хатои пуркунӣ"}'::jsonb,
      '您的充值申请已被拒绝' || CASE WHEN p_admin_note IS NOT NULL AND p_admin_note != '' THEN '，原因: ' || p_admin_note ELSE '' END,
      json_build_object(
        'zh', '您的充值申请已被拒绝' || CASE WHEN p_admin_note IS NOT NULL AND p_admin_note != '' THEN '，原因：' || p_admin_note ELSE '' END,
        'ru', 'Ваш запрос на пополнение отклонён' || CASE WHEN p_admin_note IS NOT NULL AND p_admin_note != '' THEN '. Причина: ' || p_admin_note ELSE '' END,
        'tg', 'Дархости пуркунии шумо рад карда шуд' || CASE WHEN p_admin_note IS NOT NULL AND p_admin_note != '' THEN '. Сабаб: ' || p_admin_note ELSE '' END
      )::jsonb,
      p_request_id,
      'DEPOSIT_REQUEST'
    );

    -- 插入 Telegram 通知队列（充值被拒绝）
    INSERT INTO notification_queue (
      user_id, type, payload,
      notification_type, title, message, data,
      priority, status, scheduled_at,
      retry_count, max_retries,
      created_at, updated_at
    ) VALUES (
      v_deposit.user_id,
      'wallet_withdraw_failed',
      json_build_object(
        'transaction_amount', v_deposit_amount,
        'failure_reason', COALESCE(p_admin_note, '审核未通过'),
        'current_balance', 0
      )::jsonb,
      'wallet_withdraw_failed',
      '充值失败',
      '',
      json_build_object(
        'transaction_amount', v_deposit_amount,
        'failure_reason', COALESCE(p_admin_note, '审核未通过'),
        'current_balance', 0
      )::jsonb,
      2,
      'pending',
      NOW(),
      0, 3,
      NOW(), NOW()
    );

    -- 记录操作日志
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
      )::jsonb,
      p_status := 'success'
    );

    RETURN json_build_object(
      'success', true,
      'message', '已拒绝',
      'action', 'REJECTED'
    );
  END IF;

  -- ============================================================
  -- Step 4: 处理批准操作 - 锁定用户钱包
  -- ============================================================
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = v_deposit.user_id AND type = 'TJS'
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO wallets (
      user_id, type, currency, balance,
      total_deposits, first_deposit_bonus_claimed,
      first_deposit_bonus_amount, version
    ) VALUES (
      v_deposit.user_id, 'TJS', 'TJS', 0, 0, false, 0, 1
    )
    RETURNING * INTO v_wallet;
  END IF;

  -- ============================================================
  -- Step 5: 检查首充奖励
  -- ============================================================
  IF COALESCE(v_wallet.total_deposits, 0) = 0
     AND v_wallet.first_deposit_bonus_claimed IS NOT TRUE THEN
    SELECT value INTO v_config
    FROM system_config
    WHERE key = 'first_deposit_bonus';

    IF v_config IS NOT NULL
       AND (v_config->>'enabled')::boolean = true
       AND v_deposit_amount >= (v_config->>'min_deposit_amount')::numeric THEN
      v_bonus_pct := (v_config->>'bonus_percent')::numeric;
      v_bonus := LEAST(
        v_deposit_amount * (v_bonus_pct / 100),
        (v_config->>'max_bonus_amount')::numeric
      );
    END IF;
  END IF;

  -- ============================================================
  -- Step 6: 计算新余额并更新钱包
  -- ============================================================
  v_balance_after_deposit := COALESCE(v_wallet.balance, 0) + v_deposit_amount;
  v_new_balance := v_balance_after_deposit + v_bonus;
  v_new_total := COALESCE(v_wallet.total_deposits, 0) + v_deposit_amount;

  UPDATE wallets SET
    balance = v_new_balance,
    total_deposits = v_new_total,
    version = COALESCE(version, 1) + 1,
    first_deposit_bonus_claimed = CASE
      WHEN v_bonus > 0 THEN true
      ELSE first_deposit_bonus_claimed
    END,
    first_deposit_bonus_amount = CASE
      WHEN v_bonus > 0 THEN v_bonus
      ELSE first_deposit_bonus_amount
    END,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  -- ============================================================
  -- Step 7: 更新充值申请状态
  -- ============================================================
  UPDATE deposit_requests SET
    status = 'APPROVED',
    processed_by = p_admin_id::uuid,  -- 热修复: 显式转换为 uuid
    admin_note = p_admin_note,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_deposit.id;

  -- ============================================================
  -- Step 8: 创建充值交易记录
  -- ============================================================
  v_tx_id := gen_random_uuid();

  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    description, related_id, status,
    processed_at, created_at
  ) VALUES (
    v_tx_id,
    v_wallet.id,
    'DEPOSIT',
    v_deposit_amount,
    COALESCE(v_wallet.balance, 0),
    v_balance_after_deposit,
    '充值审核通过 - 订单号: ' || COALESCE(v_deposit.order_number, 'N/A'),
    p_request_id,
    'COMPLETED',
    NOW(),
    NOW()
  );

  -- ============================================================
  -- Step 9: 如果有首充奖励，创建奖励交易记录
  -- ============================================================
  IF v_bonus > 0 THEN
    v_bonus_tx_id := gen_random_uuid();

    INSERT INTO wallet_transactions (
      id, wallet_id, type, amount,
      balance_before, balance_after,
      description, related_id, status,
      processed_at, created_at
    ) VALUES (
      v_bonus_tx_id,
      v_wallet.id,
      'BONUS',
      v_bonus,
      v_balance_after_deposit,
      v_new_balance,
      '首充奖励 (' || v_bonus_pct || '%) - 订单号: ' || COALESCE(v_deposit.order_number, 'N/A'),
      p_request_id,
      'COMPLETED',
      NOW(),
      NOW()
    );
  END IF;

  -- ============================================================
  -- Step 10: 插入应用内通知
  -- ============================================================
  INSERT INTO notifications (
    user_id, type, title, title_i18n,
    content, message_i18n,
    related_id, related_type
  ) VALUES (
    v_deposit.user_id,
    'PAYMENT_SUCCESS',
    '充值成功',
    '{"zh": "充值成功", "ru": "Пополнение успешно", "tg": "Пуркунӣ бомуваффақият"}'::jsonb,
    CASE WHEN v_bonus > 0
      THEN '您的充值申请已审核通过,金额' || v_deposit_amount || ' ' || v_deposit.currency || '已到账，首充奖励+' || v_bonus || ' ' || v_deposit.currency
      ELSE '您的充值申请已审核通过,金额' || v_deposit_amount || ' ' || v_deposit.currency || '已到账'
    END,
    CASE WHEN v_bonus > 0 THEN
      json_build_object(
        'zh', '您的充值申请已审核通过，金额 ' || v_deposit_amount || ' ' || v_deposit.currency || ' 已到账，首充奖励 +' || v_bonus || ' ' || v_deposit.currency,
        'ru', 'Ваш запрос на пополнение одобрен. ' || v_deposit_amount || ' ' || v_deposit.currency || ' зачислено, бонус за первое пополнение +' || v_bonus || ' ' || v_deposit.currency,
        'tg', 'Дархости пуркунии шумо тасдиқ шуд. ' || v_deposit_amount || ' ' || v_deposit.currency || ' ворид шуд, мукофоти аввалин пуркунӣ +' || v_bonus || ' ' || v_deposit.currency
      )::jsonb
    ELSE
      json_build_object(
        'zh', '您的充值申请已审核通过，金额 ' || v_deposit_amount || ' ' || v_deposit.currency || ' 已到账',
        'ru', 'Ваш запрос на пополнение одобрен. ' || v_deposit_amount || ' ' || v_deposit.currency || ' зачислено',
        'tg', 'Дархости пуркунии шумо тасдиқ шуд. ' || v_deposit_amount || ' ' || v_deposit.currency || ' ворид шуд'
      )::jsonb
    END,
    p_request_id,
    'DEPOSIT_REQUEST'
  );

  -- ============================================================
  -- Step 11: 插入 Telegram 通知队列 - 充值到账
  -- ============================================================
  INSERT INTO notification_queue (
    user_id, type, payload,
    notification_type, title, message, data,
    priority, status, scheduled_at,
    retry_count, max_retries,
    created_at, updated_at
  ) VALUES (
    v_deposit.user_id,
    'wallet_deposit',
    json_build_object('transaction_amount', v_deposit_amount)::jsonb,
    'wallet_deposit',
    '充值到账',
    '',
    json_build_object('transaction_amount', v_deposit_amount)::jsonb,
    1,
    'pending',
    NOW(),
    0, 3,
    NOW(), NOW()
  );

  -- 如果有首充奖励，发送首充奖励通知
  IF v_bonus > 0 THEN
    INSERT INTO notification_queue (
      user_id, type, payload,
      notification_type, title, message, data,
      priority, status, scheduled_at,
      retry_count, max_retries,
      created_at, updated_at
    ) VALUES (
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
      '',
      json_build_object(
        'deposit_amount', v_deposit_amount,
        'bonus_amount', v_bonus,
        'bonus_percent', v_bonus_pct,
        'total_amount', v_deposit_amount + v_bonus
      )::jsonb,
      1,
      'pending',
      NOW(),
      0, 3,
      NOW(), NOW()
    );
  END IF;

  -- ============================================================
  -- Step 12: 记录操作日志
  -- ============================================================
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
      'bonus_amount', v_bonus,
      'currency', v_deposit.currency,
      'order_number', v_deposit.order_number,
      'admin_note', p_admin_note,
      'new_balance', v_new_balance
    )::jsonb,
    p_status := 'success'
  );

  -- ============================================================
  -- 返回成功结果
  -- ============================================================
  RETURN json_build_object(
    'success', true,
    'message', '审核通过',
    'action', 'APPROVED',
    'deposit_amount', v_deposit_amount,
    'bonus_amount', v_bonus,
    'bonus_percent', v_bonus_pct,
    'new_balance', v_new_balance,
    'user_id', v_deposit.user_id,
    'order_number', v_deposit.order_number
  );

EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      PERFORM log_edge_function_action(
        p_function_name := 'approve_deposit_atomic',
        p_action := 'DEPOSIT_REVIEW_ERROR',
        p_user_id := p_admin_id,
        p_target_type := 'deposit_request',
        p_target_id := p_request_id,
        p_status := 'error',
        p_error_message := SQLERRM
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION approve_deposit_atomic(TEXT, TEXT, TEXT, TEXT)
  IS '充值审批原子操作函数（v1.0.1 热修复），修复 processed_by uuid 类型转换';


-- ============================================================================
-- 重建 approve_withdrawal_request 函数（添加 ::uuid 转换）
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_withdrawal_request(
  p_withdrawal_id TEXT,
  p_admin_id TEXT,
  p_admin_note TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id TEXT;
  v_amount DECIMAL;
  v_currency TEXT;
  v_wallet RECORD;
  v_status TEXT;
  v_new_balance DECIMAL;
  v_new_frozen DECIMAL;
BEGIN
  -- 锁定提现申请
  SELECT user_id, amount, currency::TEXT, status::TEXT
  INTO v_user_id, v_amount, v_currency, v_status
  FROM withdrawal_requests
  WHERE id::TEXT = p_withdrawal_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '提现申请不存在';
  END IF;
  IF v_status != 'PENDING' THEN
    RAISE EXCEPTION '提现申请状态不正确，当前状态: %', v_status;
  END IF;

  -- 锁定钱包
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = v_user_id AND type::TEXT = 'TJS' AND currency::TEXT = v_currency
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RAISE EXCEPTION '未找到用户钱包';
  END IF;
  IF v_wallet.balance < v_amount THEN
    RAISE EXCEPTION '余额不足，当前余额: %, 提现金额: %', v_wallet.balance, v_amount;
  END IF;

  -- 同时减少 balance 和 frozen_balance
  v_new_balance := v_wallet.balance - v_amount;
  v_new_frozen := GREATEST(0, COALESCE(v_wallet.frozen_balance, 0) - v_amount);

  UPDATE wallets SET
    balance = v_new_balance,
    frozen_balance = v_new_frozen,
    total_withdrawals = COALESCE(total_withdrawals, 0) + v_amount,
    version = COALESCE(version, 1) + 1,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  -- 更新提现状态（热修复: admin_id 添加 ::uuid 转换）
  UPDATE withdrawal_requests SET
    status = 'APPROVED',
    reviewed_at = NOW(),
    admin_id = p_admin_id::uuid,  -- 热修复: 显式转换为 uuid
    admin_note = p_admin_note,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id::TEXT = p_withdrawal_id;

  -- 交易记录
  INSERT INTO wallet_transactions (
    wallet_id, type, amount,
    balance_before, balance_after,
    description, status, created_at
  ) VALUES (
    v_wallet.id, 'WITHDRAWAL', -v_amount,
    v_wallet.balance, v_new_balance,
    '提现申请已批准: ' || p_withdrawal_id,
    'COMPLETED', NOW()
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION approve_withdrawal_request(TEXT, TEXT, TEXT)
  IS '提现审批通过函数（v2.0.1 热修复），修复 admin_id uuid 类型转换';


-- ============================================================================
-- 重建 reject_withdrawal_request 函数（添加 ::uuid 转换）
-- ============================================================================

CREATE OR REPLACE FUNCTION reject_withdrawal_request(
  p_withdrawal_id TEXT,
  p_admin_id TEXT,
  p_admin_note TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id TEXT;
  v_amount DECIMAL;
  v_currency TEXT;
  v_wallet RECORD;
  v_status TEXT;
BEGIN
  -- 锁定提现申请
  SELECT user_id, amount, currency::TEXT, status::TEXT
  INTO v_user_id, v_amount, v_currency, v_status
  FROM withdrawal_requests
  WHERE id::TEXT = p_withdrawal_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '提现申请不存在';
  END IF;
  IF v_status != 'PENDING' THEN
    RAISE EXCEPTION '提现申请状态不正确，当前状态: %', v_status;
  END IF;

  -- 锁定钱包
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = v_user_id AND type::TEXT = 'TJS' AND currency::TEXT = v_currency
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RAISE EXCEPTION '未找到用户钱包';
  END IF;

  -- 拒绝时只减少 frozen_balance，不修改 balance
  UPDATE wallets SET
    frozen_balance = GREATEST(0, COALESCE(frozen_balance, 0) - v_amount),
    version = COALESCE(version, 1) + 1,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  -- 更新提现申请状态（热修复: admin_id 添加 ::uuid 转换）
  UPDATE withdrawal_requests SET
    status = 'REJECTED',
    reviewed_at = NOW(),
    admin_id = p_admin_id::uuid,  -- 热修复: 显式转换为 uuid
    admin_note = p_admin_note,
    updated_at = NOW()
  WHERE id::TEXT = p_withdrawal_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION reject_withdrawal_request(TEXT, TEXT, TEXT)
  IS '提现审批拒绝函数（v2.0.1 热修复），修复 admin_id uuid 类型转换';
