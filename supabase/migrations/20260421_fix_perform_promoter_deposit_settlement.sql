-- ============================================================
-- 修复: perform_promoter_deposit 函数
-- 问题: 20260325_fix_role_column_not_exist.sql 中重新定义的函数
--       丢失了 promoter_settlements 的创建和更新逻辑，
--       导致地推人员执行充值后缴款管理页面没有数据。
-- 修复方案: 重新创建完整版本的函数，确保包含 settlement 逻辑。
--       基于 20260401_whatsapp_migration.sql 中的 v2.1.0 版本。
-- ============================================================

CREATE OR REPLACE FUNCTION public.perform_promoter_deposit(
  p_promoter_id text,
  p_target_user_id text,
  p_amount numeric,
  p_note text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_promoter        RECORD;
  v_today           DATE := (now() AT TIME ZONE 'Asia/Dushanbe')::date;
  v_today_total     NUMERIC;
  v_today_count     INTEGER;
  v_tjs_wallet      RECORD;
  v_lc_wallet       RECORD;
  v_new_tjs_balance NUMERIC;
  v_new_lc_balance  NUMERIC;
  v_new_total_deposits NUMERIC;
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
  v_existing_deposit RECORD;
BEGIN
  -- ============================================================
  -- Step 0: 幂等性检查
  -- ============================================================
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key != '' THEN
    SELECT id, amount, bonus_amount INTO v_existing_deposit
    FROM promoter_deposits
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'success', true,
        'duplicate', true,
        'deposit_id', v_existing_deposit.id,
        'amount', v_existing_deposit.amount,
        'bonus_amount', COALESCE(v_existing_deposit.bonus_amount, 0),
        'message', '该操作已执行（幂等）'
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

  -- ============================================================
  -- Step 2: 禁止给自己充值
  -- ============================================================
  IF p_promoter_id = p_target_user_id THEN
    RETURN json_build_object('success', false, 'error', 'SELF_DEPOSIT_FORBIDDEN');
  END IF;

  -- ============================================================
  -- Step 3: 验证金额范围且必须为整数
  -- ============================================================
  IF p_amount < 10 OR p_amount > 500 THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF p_amount != FLOOR(p_amount) THEN
    RETURN json_build_object('success', false, 'error', 'AMOUNT_MUST_BE_INTEGER');
  END IF;

  -- ============================================================
  -- Step 3.5: 锁定或创建当日结算记录（缴款管理关键逻辑）
  --   利用 UNIQUE(promoter_id, settlement_date) 约束实现行级锁
  --   所有并发请求在此处排队等待，确保后续额度检查的准确性
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

  -- 对结算记录加行级排他锁，确保串行化
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
    AND created_at >= (v_today::timestamp AT TIME ZONE 'Asia/Dushanbe')
    AND created_at < ((v_today + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Dushanbe');

  IF v_today_count >= COALESCE(v_promoter.daily_count_limit, 10) THEN
    RETURN json_build_object('success', false, 'error', 'DAILY_COUNT_EXCEEDED');
  END IF;

  IF (v_today_total + p_amount) > COALESCE(v_promoter.daily_deposit_limit, 5000) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'DAILY_LIMIT_EXCEEDED',
      'remaining', COALESCE(v_promoter.daily_deposit_limit, 5000) - v_today_total
    );
  END IF;

  -- ============================================================
  -- Step 5: 锁定目标用户 TJS 钱包
  -- ============================================================
  SELECT * INTO v_tjs_wallet
  FROM wallets
  WHERE user_id = p_target_user_id AND type = 'TJS'
  FOR UPDATE;

  IF v_tjs_wallet IS NULL THEN
    INSERT INTO wallets (
      user_id, type, currency, balance,
      total_deposits, first_deposit_bonus_claimed, first_deposit_bonus_amount, version
    )
    VALUES (p_target_user_id, 'TJS', 'TJS', 0, 0, false, 0, 1)
    RETURNING * INTO v_tjs_wallet;
  END IF;

  -- ============================================================
  -- Step 5b: 锁定用户 LUCKY_COIN 钱包（用于赠送积分）
  -- ============================================================
  SELECT * INTO v_lc_wallet
  FROM wallets
  WHERE user_id = p_target_user_id AND type = 'LUCKY_COIN'
  FOR UPDATE;

  IF v_lc_wallet IS NULL THEN
    INSERT INTO wallets (
      user_id, type, currency, balance,
      total_deposits, version
    )
    VALUES (p_target_user_id, 'LUCKY_COIN', 'POINTS', 0, 0, 1)
    RETURNING * INTO v_lc_wallet;
  END IF;

  -- ============================================================
  -- Step 6: 检查充值赠送
  -- ============================================================
  SELECT value INTO v_config_value
  FROM system_config
  WHERE key = 'first_deposit_bonus';

  IF v_config_value IS NOT NULL
     AND (v_config_value->>'enabled')::boolean = true
     AND p_amount >= (v_config_value->>'min_deposit_amount')::numeric THEN
    v_bonus_percent := (v_config_value->>'bonus_percent')::numeric;
    v_bonus_amount := LEAST(
      p_amount * (v_bonus_percent / 100),
      (v_config_value->>'max_bonus_amount')::numeric
    );
  END IF;

  -- ============================================================
  -- Step 7: 更新钱包余额（原子操作）
  -- ============================================================
  v_tjs_balance_before := COALESCE(v_tjs_wallet.balance, 0);
  v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
  v_new_tjs_balance := v_tjs_balance_before + p_amount;
  v_new_lc_balance := v_lc_balance_before + v_bonus_amount;
  v_new_total_deposits := COALESCE(v_tjs_wallet.total_deposits, 0) + p_amount;

  UPDATE wallets
  SET
    balance = v_new_tjs_balance,
    total_deposits = v_new_total_deposits,
    version = COALESCE(version, 1) + 1,
    updated_at = now()
  WHERE id = v_tjs_wallet.id;

  IF v_bonus_amount > 0 THEN
    UPDATE wallets
    SET
      balance = v_new_lc_balance,
      version = COALESCE(version, 1) + 1,
      updated_at = now()
    WHERE id = v_lc_wallet.id;
  END IF;

  -- ============================================================
  -- Step 8: 创建充值交易记录（TJS 钱包）
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
    p_idempotency_key,
    'COMPLETED',
    now()
  );

  -- ============================================================
  -- Step 9: 如果有赠送，创建赠送交易记录（LUCKY_COIN 钱包）
  -- ============================================================
  IF v_bonus_amount > 0 THEN
    v_bonus_tx_id := gen_random_uuid();
    INSERT INTO wallet_transactions (
      id, wallet_id, type, amount,
      balance_before, balance_after,
      description, reference_id, status, created_at
    ) VALUES (
      v_bonus_tx_id,
      v_lc_wallet.id,
      'BONUS',
      v_bonus_amount,
      v_lc_balance_before,
      v_new_lc_balance,
      '充值赠送 (' || v_bonus_percent || '%) - 地推充值触发',
      v_tx_id::text,
      'COMPLETED',
      now()
    );
  END IF;

  -- ============================================================
  -- Step 10: 创建地推充值记录
  -- ============================================================
  v_deposit_id := gen_random_uuid();
  INSERT INTO promoter_deposits (
    id, promoter_id, target_user_id, amount, currency,
    status, note, transaction_id, bonus_amount, idempotency_key, created_at, updated_at
  ) VALUES (
    v_deposit_id,
    p_promoter_id,
    p_target_user_id,
    p_amount,
    'TJS',
    'COMPLETED',
    p_note,
    v_tx_id,
    v_bonus_amount,
    p_idempotency_key,
    now(),
    now()
  );

  -- ============================================================
  -- Step 11: 获取用户名称（用于通知消息）
  -- ============================================================
  SELECT COALESCE(first_name, phone_number, p_target_user_id)
  INTO v_target_name
  FROM users
  WHERE id = p_target_user_id;

  SELECT COALESCE(first_name, phone_number, p_promoter_id)
  INTO v_promoter_name
  FROM users
  WHERE id = p_promoter_id;

  -- ============================================================
  -- Step 12: 插入通知队列 - 通知被充值用户
  -- ============================================================
  INSERT INTO notification_queue (
    user_id, phone_number, notification_type, title, message, data, channel
  ) VALUES (
    p_target_user_id,
    (SELECT phone_number FROM users WHERE id = p_target_user_id),
    'promoter_deposit',
    '线下充值到账',
    '您已收到 ' || p_amount || ' TJS 线下充值' ||
      CASE WHEN v_bonus_amount > 0
           THEN '，另有充值赠送 ' || v_bonus_amount || ' 积分'
           ELSE ''
      END,
    json_build_object(
      'transaction_amount', p_amount,
      'bonus_amount', v_bonus_amount,
      'bonus_wallet', 'LUCKY_COIN',
      'promoter_name', v_promoter_name,
      'deposit_id', v_deposit_id
    )::jsonb,
    'whatsapp'
  );

  -- ============================================================
  -- Step 13: 插入通知队列 - 通知地推人员本人
  -- ============================================================
  INSERT INTO notification_queue (
    user_id, phone_number, notification_type, title, message, data, channel
  ) VALUES (
    p_promoter_id,
    (SELECT phone_number FROM users WHERE id = p_promoter_id),
    'promoter_deposit_confirm',
    '代客充值成功',
    '已为用户 ' || COALESCE(v_target_name, p_target_user_id) ||
      ' 充值 ' || p_amount || ' TJS',
    json_build_object(
      'transaction_amount', p_amount,
      'target_user_id', p_target_user_id,
      'target_user_name', v_target_name,
      'bonus_amount', v_bonus_amount,
      'deposit_id', v_deposit_id
    )::jsonb,
    'whatsapp'
  );

  -- ============================================================
  -- Step 14: 更新当日缴款结算记录（已在 Step 3.5 创建/锁定）
  -- 【关键】这是缴款管理功能的核心数据来源
  -- ============================================================
  UPDATE promoter_settlements
  SET
    total_deposit_amount = total_deposit_amount + p_amount,
    total_deposit_count = total_deposit_count + 1,
    updated_at = now()
  WHERE id = v_settlement.id;

  -- ============================================================
  -- 返回成功结果
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
    'daily_count_limit', COALESCE(v_promoter.daily_count_limit, 10)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'INTERNAL_ERROR',
      'detail', SQLERRM
    );
END;
$function$;

COMMENT ON FUNCTION perform_promoter_deposit(TEXT, TEXT, NUMERIC, TEXT, TEXT)
  IS '地推人员代客充值核心事务函数（v2.2.0），包含完整的 settlement 缴款记录逻辑、幂等性检查、并发锁、时区处理';
