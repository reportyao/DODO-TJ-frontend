-- =============================================================================
-- 20260323_fix_approve_deposit_atomic_v2.sql
--
-- 修复 approve_deposit_atomic RPC 函数的多个 Bug：
--
--   Bug 1 (严重): reviewed_by = p_admin_id 缺少 ::uuid 类型转换
--     - deposit_requests.reviewed_by 列是 UUID 类型
--     - p_admin_id 参数是 TEXT 类型
--     - PostgreSQL 不会自动将 TEXT 转换为 UUID，导致 "column is of type uuid but
--       expression is of type text" 错误
--     - 修复：reviewed_by = p_admin_id::uuid
--
--   Bug 2 (逻辑): 操作值大小写不一致
--     - 管理后台传入 'APPROVED' / 'REJECTED'（大写）
--     - 函数内部比较 'approve' / 'reject'（小写）
--     - 导致所有审核操作都返回"无效操作"错误
--     - 修复：使用 UPPER() 统一转换后比较，同时兼容大小写
--
--   Bug 3 (通知): 拒绝通知类型错误
--     - 使用了 wallet_withdraw_failed（提现失败模板）
--     - 应使用 wallet_deposit_rejected（充值拒绝模板）
--     - 修复：改回 wallet_deposit_rejected
--
--   Bug 4 (逻辑): 首充奖励逻辑与业务需求不符
--     - 当前逻辑：只有首次充值才有奖励
--     - 业务需求（20260319 版本已确认）：每次充值都有奖励
--     - 修复：移除首充判断，改为每次充值都检查奖励配置
-- =============================================================================

CREATE OR REPLACE FUNCTION approve_deposit_atomic(
  p_request_id TEXT,
  p_action TEXT,        -- 'APPROVED' 或 'REJECTED'（大小写均可）
  p_admin_id TEXT,
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
    -- Bug 1 修复：reviewed_by = p_admin_id::uuid（显式类型转换）
    UPDATE deposit_requests
    SET status      = 'REJECTED',
        admin_note  = p_admin_note,
        reviewed_by = p_admin_id::uuid,
        reviewed_at = NOW(),
        updated_at  = NOW()
    WHERE id = p_request_id::uuid;

    -- Bug 3 修复：使用 wallet_deposit_rejected（充值拒绝模板）
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
    -- 自动创建 TJS 钱包
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (v_deposit.user_id, 'TJS', 'TJS', 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  -- ============================================================
  -- Step 5: 计算充值赠送（每次充值均可获得，非首充限制）
  -- ============================================================
  SELECT COALESCE((value->>'percent')::numeric, 0) INTO v_bonus_pct
  FROM system_config
  WHERE key = 'deposit_bonus'
    AND (value->>'enabled')::boolean = true
    AND v_deposit_amount >= COALESCE((value->>'min_deposit_amount')::numeric, 0);

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
  -- Step 8: 如有赠送，打入 LUCKY_COIN 钱包
  -- ============================================================
  IF v_bonus > 0 THEN
    SELECT * INTO v_lc_wallet
    FROM wallets
    WHERE user_id = v_deposit.user_id
      AND type = 'LUCKY_COIN'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, type, currency, balance, version)
      VALUES (v_deposit.user_id, 'LUCKY_COIN', 'LUCKY_COIN', 0, 1)
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
      '充值赠送 ' || v_bonus_pct || '% (' || v_bonus || ' LUCKY_COIN)',
      p_request_id,
      NOW(), NOW()
    );
  END IF;

  -- ============================================================
  -- Step 9: Bug 1 修复 - reviewed_by = p_admin_id::uuid
  -- ============================================================
  UPDATE deposit_requests
  SET status      = 'APPROVED',
      admin_note  = p_admin_note,
      reviewed_by = p_admin_id::uuid,
      reviewed_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_request_id::uuid;

  -- Step 10: (已移除 tjs_balance 缓存更新 - users 表中该列不存在)

  -- ============================================================
  -- Step 11: 发送充值到账通知
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

  -- Step 12: 如有赠送，发送赠送通知
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
      '恭喜！您获得充值赠送 ' || v_bonus || ' LUCKY_COIN（' || v_bonus_pct || '%）',
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

  -- Step 13: 记录操作日志
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

-- 更新函数注释
COMMENT ON FUNCTION approve_deposit_atomic(TEXT, TEXT, TEXT, TEXT) IS
  '原子审核充值申请。p_action 支持 APPROVED/REJECTED（大小写均可）。
   Bug 修复 v2 (2026-03-23):
   - Bug 1: reviewed_by = p_admin_id::uuid（UUID 类型转换）
   - Bug 2: 使用 UPPER() 统一操作值大小写，兼容 APPROVED/approved/APPROVE
   - Bug 3: 拒绝通知类型改为 wallet_deposit_rejected
   - Bug 4: 赠送逻辑改为每次充值均可获得（非首充限制），赠送打入 LUCKY_COIN 钱包';
