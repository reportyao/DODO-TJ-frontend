-- ============================================================================
-- 20260319_fix_approve_deposit_atomic.sql
-- 
-- 修复 approve_deposit_atomic RPC 函数的多个严重问题:
--
--   C1: 移除"首充限制"逻辑，改为"每次充值赠送"
--       - 不再检查 total_deposits = 0 和 first_deposit_bonus_claimed
--       - 只要 enabled 且金额 >= min_deposit_amount 即可获得赠送
--
--   C2: 赠送金额打入 LUCKY_COIN 钱包（而非 TJS 钱包）
--       - 本金入 TJS 钱包，赠送入 LUCKY_COIN 钱包
--       - 与 approve-deposit Edge Function 和 process_deposit_with_bonus 保持一致
--
--   C3: 通知文案从"首充奖励"改为"充值赠送"
--       - notification_type 从 first_deposit_bonus 改为 deposit_bonus
--       - 通知标题从"首充奖励到账"改为"充值赠送到账"
--
--   H3: 充值拒绝通知类型从 wallet_withdraw_failed 改为 wallet_deposit_rejected
--       - 使用正确的 Telegram 通知模板
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
  v_tjs_wallet    RECORD;
  v_lc_wallet     RECORD;
  v_new_tjs_balance   NUMERIC;
  v_new_lc_balance    NUMERIC;
  v_new_total     NUMERIC;
  v_bonus         NUMERIC := 0;
  v_bonus_pct     NUMERIC := 0;
  v_config        JSONB;
  v_tx_id         UUID;
  v_bonus_tx_id   UUID;
  v_deposit_amount NUMERIC;
  v_tjs_balance_before NUMERIC;
  v_lc_balance_before  NUMERIC;
  v_user_phone    TEXT;
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

  -- [MIGRATION] 预先获取用户手机号，用于通知队列
  SELECT phone_number INTO v_user_phone
  FROM users WHERE id = v_deposit.user_id;

  -- ============================================================
  -- Step 3: 处理拒绝操作（简单路径）
  -- ============================================================
  IF p_action = 'REJECTED' THEN
    UPDATE deposit_requests SET
      status = 'REJECTED',
      processed_by = p_admin_id::uuid,
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

    -- 【修复 H3】使用正确的 wallet_deposit_rejected 通知类型（而非 wallet_withdraw_failed）
    -- [MIGRATION] 使用 phone_number + channel='whatsapp'
    INSERT INTO notification_queue (
      user_id, phone_number, type, payload,
      notification_type, title, message, data,
      priority, status, scheduled_at,
      retry_count, max_retries,
      channel, created_at, updated_at
    ) VALUES (
      v_deposit.user_id,
      v_user_phone,
      'wallet_deposit_rejected',
      json_build_object(
        'transaction_amount', v_deposit_amount,
        'failure_reason', COALESCE(p_admin_note, '审核未通过'),
        'current_balance', 0
      )::jsonb,
      'wallet_deposit_rejected',
      '充值申请被拒绝',
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
      'whatsapp',
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
  -- Step 4: 处理批准操作 - 锁定用户 TJS 钱包
  -- ============================================================
  SELECT * INTO v_tjs_wallet
  FROM wallets
  WHERE user_id = v_deposit.user_id AND type = 'TJS'
  FOR UPDATE;

  IF v_tjs_wallet IS NULL THEN
    INSERT INTO wallets (
      user_id, type, currency, balance,
      total_deposits, first_deposit_bonus_claimed,
      first_deposit_bonus_amount, version
    ) VALUES (
      v_deposit.user_id, 'TJS', 'TJS', 0, 0, false, 0, 1
    )
    RETURNING * INTO v_tjs_wallet;
  END IF;

  -- ============================================================
  -- 【修复 C2】Step 4b: 锁定用户 LUCKY_COIN 钱包（用于赠送积分）
  -- ============================================================
  SELECT * INTO v_lc_wallet
  FROM wallets
  WHERE user_id = v_deposit.user_id AND type = 'LUCKY_COIN'
  FOR UPDATE;

  IF v_lc_wallet IS NULL THEN
    INSERT INTO wallets (
      user_id, type, currency, balance,
      total_deposits, version
    ) VALUES (
      v_deposit.user_id, 'LUCKY_COIN', 'POINTS', 0, 0, 1
    )
    RETURNING * INTO v_lc_wallet;
  END IF;

  -- ============================================================
  -- 【修复 C1】Step 5: 检查充值赠送（移除首充限制）
  -- 不再检查 total_deposits = 0 和 first_deposit_bonus_claimed
  -- 只要 enabled 且金额 >= min_deposit_amount 即可获得赠送
  -- ============================================================
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

  -- ============================================================
  -- 【修复 C2】Step 6: 计算新余额
  -- 本金入 TJS 钱包，赠送入 LUCKY_COIN 钱包
  -- ============================================================
  v_tjs_balance_before := COALESCE(v_tjs_wallet.balance, 0);
  v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
  v_new_tjs_balance := v_tjs_balance_before + v_deposit_amount;
  v_new_lc_balance := v_lc_balance_before + v_bonus;
  v_new_total := COALESCE(v_tjs_wallet.total_deposits, 0) + v_deposit_amount;

  -- 更新 TJS 钱包（本金）
  UPDATE wallets SET
    balance = v_new_tjs_balance,
    total_deposits = v_new_total,
    version = COALESCE(version, 1) + 1,
    updated_at = NOW()
  WHERE id = v_tjs_wallet.id;

  -- 更新 LUCKY_COIN 钱包（赠送积分）
  IF v_bonus > 0 THEN
    UPDATE wallets SET
      balance = v_new_lc_balance,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
    WHERE id = v_lc_wallet.id;
  END IF;

  -- ============================================================
  -- Step 7: 更新充值申请状态
  -- ============================================================
  UPDATE deposit_requests SET
    status = 'APPROVED',
    processed_by = p_admin_id::uuid,
    admin_note = p_admin_note,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_deposit.id;

  -- ============================================================
  -- Step 8: 创建充值交易记录（TJS 钱包）
  -- ============================================================
  v_tx_id := gen_random_uuid();

  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    description, related_id, status,
    processed_at, created_at
  ) VALUES (
    v_tx_id,
    v_tjs_wallet.id,
    'DEPOSIT',
    v_deposit_amount,
    v_tjs_balance_before,
    v_new_tjs_balance,
    '充值审核通过 - 订单号: ' || COALESCE(v_deposit.order_number, 'N/A'),
    p_request_id,
    'COMPLETED',
    NOW(),
    NOW()
  );

  -- ============================================================
  -- 【修复 C2】Step 9: 如果有赠送，创建赠送交易记录（LUCKY_COIN 钱包）
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
      v_lc_wallet.id,
      'BONUS',
      v_bonus,
      v_lc_balance_before,
      v_new_lc_balance,
      '充值赠送 (' || v_bonus_pct || '%) - 订单号: ' || COALESCE(v_deposit.order_number, 'N/A'),
      p_request_id,
      'COMPLETED',
      NOW(),
      NOW()
    );
  END IF;

  -- ============================================================
  -- Step 10: 插入应用内通知
  -- 【修复 C3】通知文案从"首充奖励"改为"充值赠送"
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
      THEN '您的充值申请已审核通过,金额' || v_deposit_amount || ' ' || v_deposit.currency || '已到账，赠送+' || v_bonus || ' 积分'
      ELSE '您的充值申请已审核通过,金额' || v_deposit_amount || ' ' || v_deposit.currency || '已到账'
    END,
    CASE WHEN v_bonus > 0 THEN
      json_build_object(
        'zh', '您的充值申请已审核通过，金额 ' || v_deposit_amount || ' ' || v_deposit.currency || ' 已到账，赠送 +' || v_bonus || ' 积分',
        'ru', 'Ваш запрос на пополнение одобрен. ' || v_deposit_amount || ' ' || v_deposit.currency || ' зачислено, бонус +' || v_bonus || ' баллов',
        'tg', 'Дархости пуркунии шумо тасдиқ шуд. ' || v_deposit_amount || ' ' || v_deposit.currency || ' ворид шуд, мукофот +' || v_bonus || ' хол'
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
  -- Step 11: 插入通知队列 - 充值到账
  -- [MIGRATION] 使用 phone_number + channel='whatsapp'
  -- ============================================================
  INSERT INTO notification_queue (
    user_id, phone_number, type, payload,
    notification_type, title, message, data,
    priority, status, scheduled_at,
    retry_count, max_retries,
    channel, created_at, updated_at
  ) VALUES (
    v_deposit.user_id,
    v_user_phone,
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
    'whatsapp',
    NOW(), NOW()
  );

  -- 【修复 C3】如果有赠送，发送充值赠送通知（而非“首充奖励”）
  IF v_bonus > 0 THEN
    INSERT INTO notification_queue (
      user_id, phone_number, type, payload,
      notification_type, title, message, data,
      priority, status, scheduled_at,
      retry_count, max_retries,
      channel, created_at, updated_at
    ) VALUES (
      v_deposit.user_id,
      v_user_phone,
      'first_deposit_bonus',
      json_build_object(
        'deposit_amount', v_deposit_amount,
        'bonus_amount', v_bonus,
        'bonus_percent', v_bonus_pct,
        'total_amount', v_deposit_amount + v_bonus
      )::jsonb,
      'first_deposit_bonus',
      '充值赠送到账',
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
      'whatsapp',
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
      'bonus_wallet', 'LUCKY_COIN',
      'currency', v_deposit.currency,
      'order_number', v_deposit.order_number,
      'admin_note', p_admin_note,
      'new_tjs_balance', v_new_tjs_balance,
      'new_lc_balance', v_new_lc_balance
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
    'bonus_wallet', 'LUCKY_COIN',
    'new_tjs_balance', v_new_tjs_balance,
    'new_lc_balance', v_new_lc_balance,
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
  IS '充值审批原子操作函数（v2.0.0），修复：C1移除首充限制改为每次赠送，C2赠送入LUCKY_COIN钱包，C3通知文案修正，H3拒绝通知类型修正';
