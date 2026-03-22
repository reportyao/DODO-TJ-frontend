-- =============================================================================
-- Deep Check Fixes Migration
-- Date: 2026-03-22
-- 
-- BUG-1: perform_promoter_deposit 中 daily_count_limit 硬编码为10
--         修复为从 promoter_profiles.daily_count_limit 动态读取
--
-- BUG-2: search_user_for_deposit 手机号搜索分支缺少 is_blocked/deleted_at 过滤
--         修复为所有搜索路径统一添加安全过滤条件
-- =============================================================================


-- -----------------------------------------------------------------------
-- Fix 1: perform_promoter_deposit - 使用动态 daily_count_limit
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.perform_promoter_deposit(p_promoter_id text, p_target_user_id text, p_amount numeric, p_note text DEFAULT NULL::text)
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
  v_daily_count_limit INTEGER;  -- 【BUG-1 FIX】动态次数上限
BEGIN
  -- ============================================================
  -- Step 1: 验证地推人员身份和状态
  -- 【BUG-1 FIX】额外查询 daily_count_limit 字段
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

  -- 【BUG-1 FIX】从 promoter_profiles 读取次数上限，默认10次
  v_daily_count_limit := COALESCE(v_promoter.daily_count_limit, 10);

  -- ============================================================
  -- Step 2: 禁止给自己充值
  -- ============================================================
  IF p_promoter_id = p_target_user_id THEN
    RETURN json_build_object('success', false, 'error', 'SELF_DEPOSIT_FORBIDDEN');
  END IF;
  -- ============================================================
  -- Step 3: 验证金额范围 (10 ~ 500 TJS) 且必须为整数
  -- ============================================================
  IF p_amount < 10 OR p_amount > 500 THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF p_amount != FLOOR(p_amount) THEN
    RETURN json_build_object('success', false, 'error', 'AMOUNT_MUST_BE_INTEGER');
  END IF;
  -- ============================================================
  -- Step 3.5: 锁定或创建当日结算记录
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
  -- 对结算记录加行级排他锁
  PERFORM 1 FROM promoter_settlements
  WHERE id = v_settlement.id
  FOR UPDATE;
  -- ============================================================
  -- Step 4: 检查今日充值次数和额度
  -- 【BUG-1 FIX】使用 v_daily_count_limit 替代硬编码的 10
  -- ============================================================
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*)::INTEGER
  INTO v_today_total, v_today_count
  FROM promoter_deposits
  WHERE promoter_id = p_promoter_id
    AND created_at >= (v_today::timestamp AT TIME ZONE 'Asia/Dushanbe')
    AND created_at < ((v_today + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Dushanbe');

  -- 【BUG-1 FIX】使用动态次数上限
  IF v_today_count >= v_daily_count_limit THEN
    RETURN json_build_object('success', false, 'error', 'DAILY_COUNT_EXCEEDED');
  END IF;
  -- 每日额度上限（默认 5000 TJS）
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
  SELECT *
  INTO v_tjs_wallet
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
  SELECT *
  INTO v_lc_wallet
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
  -- Step 7: 更新钱包余额
  -- ============================================================
  v_tjs_balance_before := COALESCE(v_tjs_wallet.balance, 0);
  v_lc_balance_before := COALESCE(v_lc_wallet.balance, 0);
  v_new_tjs_balance := v_tjs_balance_before + p_amount;
  v_new_lc_balance := v_lc_balance_before + v_bonus_amount;
  v_new_total_deposits := COALESCE(v_tjs_wallet.total_deposits, 0) + p_amount;

  -- 更新 TJS 钱包（本金）
  UPDATE wallets
  SET
    balance = v_new_tjs_balance,
    total_deposits = v_new_total_deposits,
    version = COALESCE(version, 1) + 1,
    updated_at = now()
  WHERE id = v_tjs_wallet.id;

  -- 更新 LUCKY_COIN 钱包（赠送积分）
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
    NULL,
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
    status, note, transaction_id, bonus_amount, created_at, updated_at
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
  -- Step 12: 通知被充值用户
  -- ============================================================
  INSERT INTO notification_queue (
    user_id,
    phone_number,
    notification_type,
    title,
    message,
    data,
    channel
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
  -- Step 13: 通知地推人员本人
  -- ============================================================
  INSERT INTO notification_queue (
    user_id,
    phone_number,
    notification_type,
    title,
    message,
    data,
    channel
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
  -- Step 14: 更新当日缴款结算记录
  -- ============================================================
  UPDATE promoter_settlements
  SET
    total_deposit_amount = total_deposit_amount + p_amount,
    total_deposit_count = total_deposit_count + 1,
    updated_at = now()
  WHERE id = v_settlement.id;

  -- ============================================================
  -- 返回成功结果
  -- 【BUG-1 FIX】返回中增加 daily_count_limit 字段
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
    'daily_count_limit', v_daily_count_limit
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


-- -----------------------------------------------------------------------
-- Fix 2: search_user_for_deposit - 手机号搜索分支添加安全过滤
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_user_for_deposit(p_query text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user RECORD;
BEGIN
  -- 1. 完整 UUID 匹配
  IF p_query ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, phone_number, first_name, last_name, avatar_url
    INTO v_user
    FROM users
    WHERE id = p_query
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL);
  END IF;

  -- 2. 手机号匹配（纯数字，支持带+号和不带+号）
  -- 【BUG-2 FIX】添加 is_blocked 和 deleted_at 过滤条件
  IF v_user IS NULL AND p_query ~ '^\+?\d{9,15}$' THEN
    SELECT id, phone_number, first_name, last_name, avatar_url
    INTO v_user
    FROM users
    WHERE (phone_number = REPLACE(p_query, '+', '')
       OR phone_number = p_query
       OR phone_number = '+' || REPLACE(p_query, '+', ''))
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL)
    LIMIT 1;
  END IF;

  -- 3. referral_code 匹配（不区分大小写）
  IF v_user IS NULL THEN
    SELECT id, phone_number, first_name, last_name, avatar_url
    INTO v_user
    FROM users
    WHERE UPPER(referral_code) = UPPER(p_query)
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL);
  END IF;

  -- 4. UUID 前8位 hex 前缀匹配
  IF v_user IS NULL AND LENGTH(p_query) = 8 AND p_query ~ '^[0-9a-f]+$' THEN
    SELECT id, phone_number, first_name, last_name, avatar_url
    INTO v_user
    FROM users
    WHERE id LIKE p_query || '%'
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL)
    LIMIT 1;
  END IF;

  -- 未找到
  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'success', true,
    'user', json_build_object(
      'id', v_user.id,
      'phone_number', v_user.phone_number,
      'first_name', v_user.first_name,
      'last_name', v_user.last_name,
      'avatar_url', v_user.avatar_url
    )
  );
END;
$function$;
