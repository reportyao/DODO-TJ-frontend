-- ============================================================
-- DODO-TJ 资金流审查修复 (2026-03-23)
-- ============================================================
-- 修复内容:
--   1. 创建 cancel_order_and_refund RPC 函数（退款机制）
--   2. approve_deposit_atomic 增加补贴池扣减逻辑
--   3. 修复种子账号初始交易记录缺失
--   4. 补发 13246634287 的 1000 TJS 充值赠送积分
--   5. 修复 CANCELLED 订单状态（确认无需退款）
--   6. 修复历史 PENDING 订单状态
-- ============================================================

-- ============================================================
-- 修复1: 创建 cancel_order_and_refund RPC 函数
-- 用于取消订单并退还用户资金
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_order_and_refund(
  p_order_id TEXT,
  p_reason   TEXT DEFAULT '订单取消退款'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order   RECORD;
  v_wallet  RECORD;
  v_new_balance NUMERIC;
  v_refund_tx_id UUID;
BEGIN
  -- Step 1: 锁定订单
  SELECT o.*, u.phone_number
  INTO v_order
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.id = p_order_id::uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '订单不存在');
  END IF;

  -- 只能取消 PENDING / PAID 状态的订单
  IF v_order.status NOT IN ('PENDING', 'PAID') THEN
    RETURN jsonb_build_object('success', false, 'error', '订单状态不允许取消: ' || v_order.status);
  END IF;

  -- Step 2: 查找对应的扣款交易，确定退款钱包
  -- 先查找是否有对应的扣款交易
  SELECT w.*
  INTO v_wallet
  FROM wallet_transactions wt
  JOIN wallets w ON w.id = wt.wallet_id
  WHERE (wt.related_order_id = p_order_id::uuid
         OR wt.metadata->>'order_id' = p_order_id)
    AND wt.type IN ('LOTTERY_PURCHASE', 'FULL_PURCHASE')
    AND wt.amount < 0
  FOR UPDATE;

  IF NOT FOUND THEN
    -- 没有扣款交易，直接标记取消（无需退款）
    UPDATE orders
    SET status = 'CANCELLED',
        updated_at = NOW()
    WHERE id = p_order_id::uuid;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'CANCELLED_NO_REFUND',
      'message', '订单已取消（无扣款记录，无需退款）'
    );
  END IF;

  -- Step 3: 执行退款
  v_new_balance := v_wallet.balance + v_order.total_amount;

  UPDATE wallets
  SET balance = v_new_balance,
      version = COALESCE(version, 0) + 1,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Step 4: 记录退款交易
  v_refund_tx_id := gen_random_uuid();
  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    status, description,
    related_order_id,
    processed_at, created_at
  ) VALUES (
    v_refund_tx_id,
    v_wallet.id,
    'REFUND',
    v_order.total_amount,
    v_wallet.balance,
    v_new_balance,
    'COMPLETED',
    '订单取消退款 - ' || p_reason,
    p_order_id::uuid,
    NOW(), NOW()
  );

  -- Step 5: 删除对应的参与码
  DELETE FROM lottery_entries
  WHERE order_id = p_order_id::uuid;

  -- Step 6: 回退 lotteries 的 sold_tickets
  UPDATE lotteries
  SET sold_tickets = GREATEST(0, sold_tickets - v_order.quantity),
      updated_at = NOW()
  WHERE id = v_order.lottery_id;

  -- Step 7: 更新订单状态
  UPDATE orders
  SET status = 'CANCELLED',
      updated_at = NOW()
  WHERE id = p_order_id::uuid;

  -- Step 8: 记录审计日志
  PERFORM log_edge_function_action(
    p_function_name := 'cancel_order_and_refund',
    p_action        := 'REFUND',
    p_user_id       := v_order.user_id::text,
    p_target_type   := 'order',
    p_target_id     := p_order_id,
    p_details       := jsonb_build_object(
      'order_id',      p_order_id,
      'refund_amount', v_order.total_amount,
      'wallet_id',     v_wallet.id,
      'reason',        p_reason,
      'new_balance',   v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success',        true,
    'action',         'REFUNDED',
    'order_id',       p_order_id,
    'refund_amount',  v_order.total_amount,
    'new_balance',    v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;


-- ============================================================
-- 修复2: 更新 approve_deposit_atomic 增加补贴池扣减
-- 在赠送 BONUS 积分时，同步更新 system_config 中的补贴池已发放金额
-- ============================================================
CREATE OR REPLACE FUNCTION approve_deposit_atomic(
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
  v_subsidy_pool    JSONB;
  v_pool_total_issued NUMERIC := 0;
BEGIN
  v_action_upper := UPPER(TRIM(p_action));

  -- Step 1: 参数校验
  IF p_request_id IS NULL OR p_request_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '请求ID不能为空');
  END IF;

  IF v_action_upper NOT IN ('APPROVED', 'REJECTED', 'APPROVE', 'REJECT') THEN
    RETURN jsonb_build_object('success', false, 'error', '无效的审核操作，必须为 APPROVED 或 REJECTED，收到: ' || p_action);
  END IF;

  -- Step 2: 锁定充值请求
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

  -- Step 3: 处理拒绝操作
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

    RETURN jsonb_build_object(
      'success', true,
      'action', 'REJECTED',
      'request_id', p_request_id,
      'bonus_amount', 0
    );
  END IF;

  -- Step 4: 获取或创建 TJS 钱包
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

  -- Step 5: 计算充值赠送
  SELECT COALESCE((value->>'bonus_percent')::numeric, 0) INTO v_bonus_pct
  FROM system_config
  WHERE key = 'deposit_bonus'
    AND (value->>'enabled')::boolean = true
    AND v_deposit_amount >= COALESCE((value->>'min_amount')::numeric, 0);

  IF v_bonus_pct > 0 THEN
    v_bonus := ROUND(v_deposit_amount * v_bonus_pct / 100, 2);
  END IF;

  -- Step 5.5: 如有赠送，获取或创建 LUCKY_COIN 钱包
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

  -- Step 6: 更新 TJS 钱包余额
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
  -- Step 6.6 [新增]: 补贴池扣减
  -- 更新 system_config 中的 subsidy_pool 记录已发放金额
  -- ============================================================
  IF v_bonus > 0 THEN
    -- 尝试更新已有的 subsidy_pool 配置
    UPDATE system_config
    SET value = jsonb_set(
          value,
          '{total_issued}',
          to_jsonb(COALESCE((value->>'total_issued')::numeric, 0) + v_bonus)
        ),
        updated_at = NOW()
    WHERE key = 'subsidy_pool';

    -- 如果不存在则创建
    IF NOT FOUND THEN
      INSERT INTO system_config (key, value, updated_at)
      VALUES (
        'subsidy_pool',
        jsonb_build_object(
          'total_pool', 10000000,
          'total_issued', v_bonus
        ),
        NOW()
      );
    END IF;
  END IF;

  -- Step 7: 更新充值请求状态
  UPDATE deposit_requests
  SET status      = 'APPROVED',
      admin_note  = p_admin_note,
      reviewed_by = p_admin_id::uuid,
      reviewed_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_request_id::uuid;

  -- Step 8: 记录 TJS 钱包流水
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

  -- Step 9: 发送充值到账通知
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

  -- Step 10: 记录审计日志
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
      'new_balance',   v_new_balance,
      'subsidy_deducted', v_bonus
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


-- ============================================================
-- 修复2b: 同步更新 perform_promoter_deposit 增加补贴池扣减
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
  -- 幂等性检查
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

  -- 校验推广员
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_promoter_id AND role IN ('promoter', 'admin')) THEN
    RAISE EXCEPTION '无权执行代充操作';
  END IF;

  -- 校验目标用户
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION '目标用户不存在';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION '充值金额必须大于0';
  END IF;

  -- 锁定用户 TJS 钱包
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = p_target_user_id AND type = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, type, currency, balance, version)
    VALUES (p_target_user_id, 'TJS', 'TJS', 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  -- 计算赠送
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

  -- 如有赠送，锁定 LUCKY_COIN 钱包
  IF v_bonus_amount > 0 THEN
    SELECT * INTO v_lc_wallet
    FROM wallets
    WHERE user_id = p_target_user_id AND type = 'LUCKY_COIN'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, type, currency, balance, version)
      VALUES (p_target_user_id, 'LUCKY_COIN', 'POINTS', 0, 1)
      RETURNING * INTO v_lc_wallet;
    END IF;

    v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
    v_new_lc_balance := v_lc_balance_before + v_bonus_amount;
  END IF;

  -- 更新 TJS 余额
  v_new_balance := COALESCE(v_wallet.balance, 0) + p_amount;

  UPDATE wallets
  SET balance = v_new_balance,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- 更新 LUCKY_COIN 余额
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    UPDATE wallets
    SET balance = v_new_lc_balance,
        version = COALESCE(version, 1) + 1,
        updated_at = NOW()
    WHERE id = v_lc_wallet.id;
  END IF;

  -- ============================================================
  -- [新增] 补贴池扣减
  -- ============================================================
  IF v_bonus_amount > 0 THEN
    UPDATE system_config
    SET value = jsonb_set(
          value,
          '{total_issued}',
          to_jsonb(COALESCE((value->>'total_issued')::numeric, 0) + v_bonus_amount)
        ),
        updated_at = NOW()
    WHERE key = 'subsidy_pool';

    IF NOT FOUND THEN
      INSERT INTO system_config (key, value, updated_at)
      VALUES (
        'subsidy_pool',
        jsonb_build_object('total_pool', 10000000, 'total_issued', v_bonus_amount),
        NOW()
      );
    END IF;
  END IF;

  -- 记录代充记录
  v_deposit_id := gen_random_uuid();
  INSERT INTO promoter_deposits (
    id, promoter_id, target_user_id,
    amount, currency, status, note,
    bonus_amount, idempotency_key,
    created_at, updated_at
  ) VALUES (
    v_deposit_id, p_promoter_id, p_target_user_id,
    p_amount, 'TJS', 'COMPLETED', p_note,
    v_bonus_amount, p_idempotency_key,
    NOW(), NOW()
  );

  -- TJS 交易流水
  v_tx_id := gen_random_uuid();
  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    status, description,
    reference_id, created_at
  ) VALUES (
    v_tx_id, v_wallet.id, 'PROMOTER_DEPOSIT', p_amount,
    COALESCE(v_wallet.balance, 0), v_new_balance,
    'COMPLETED',
    '推广员代充 ' || p_amount || ' TJS',
    v_deposit_id::text,
    NOW()
  );

  -- BONUS 交易流水
  IF v_bonus_amount > 0 AND v_lc_wallet IS NOT NULL THEN
    v_bonus_tx_id := gen_random_uuid();

    INSERT INTO wallet_transactions (
      id, wallet_id, type, amount,
      balance_before, balance_after,
      status, description,
      reference_id, created_at
    ) VALUES (
      v_bonus_tx_id, v_lc_wallet.id, 'BONUS', v_bonus_amount,
      v_lc_balance_before, v_new_lc_balance,
      'COMPLETED',
      '代充赠送 ' || v_bonus_percent || '% 积分（' || v_bonus_amount || '）',
      v_deposit_id::text,
      NOW()
    );
  END IF;

  -- 通知
  INSERT INTO notification_queue (
    user_id, type, payload,
    notification_type, title, message, data,
    channel, phone_number,
    priority, status, scheduled_at,
    retry_count, max_retries,
    created_at, updated_at
  )
  SELECT
    p_target_user_id,
    'wallet_deposit',
    jsonb_build_object('transaction_amount', p_amount, 'bonus_amount', v_bonus_amount),
    'wallet_deposit',
    '充值到账',
    '您的充值 ' || p_amount || ' TJS 已到账' ||
      CASE WHEN v_bonus_amount > 0 THEN '，赠送 ' || v_bonus_amount || ' 积分' ELSE '' END,
    jsonb_build_object('transaction_amount', p_amount, 'bonus_amount', v_bonus_amount),
    'whatsapp',
    u.phone_number,
    1, 'pending', NOW(),
    0, 3,
    NOW(), NOW()
  FROM users u WHERE u.id = p_target_user_id;

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
