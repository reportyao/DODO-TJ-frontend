-- ============================================================
-- 修复: PL/pgSQL 函数中列引用歧义 (column reference is ambiguous)
-- 日期: 2026-04-07
-- 
-- 根因分析:
-- PostgreSQL 的 PL/pgSQL 中，RETURNS TABLE 声明的输出列名会在函数体内
-- 作为隐式变量存在。当输出列名（如 "id"）与查询目标表的列名相同时，
-- WHERE id = p_lottery_id 这样的表达式会产生歧义：
-- PostgreSQL 无法判断 "id" 指的是 RETURNS TABLE 中的输出变量，
-- 还是 lotteries 表的 id 列。
--
-- 修复策略:
-- 1. 在所有 SQL 查询中使用表别名限定列引用 (如 l.id 而非 id)
-- 2. RETURNS TABLE 中的输出列名添加前缀避免与表列名冲突
-- 3. DECLARE 变量统一使用 v_ 前缀
-- ============================================================

-- ============================================================
-- 修复1: allocate_lottery_tickets (直接导致一元夺宝报错)
-- 
-- BUG: RETURNS TABLE(id uuid, ...) 声明了 "id" 输出列，
--      导致 WHERE id = p_lottery_id 中的 "id" 歧义
-- FIX: 所有表列引用添加表别名限定
-- ============================================================
CREATE OR REPLACE FUNCTION allocate_lottery_tickets(
  p_lottery_id TEXT,
  p_user_id    TEXT,
  p_quantity   INTEGER,
  p_order_id   TEXT DEFAULT NULL
)
RETURNS TABLE(id uuid, ticket_number INT, participation_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_start_ticket INT;
  v_lottery RECORD;
  v_base_number INT := 1000000;
BEGIN
  -- 【修复】使用表别名 l 限定 id 列，消除与 RETURNS TABLE 中 id 输出列的歧义
  SELECT l.* INTO v_lottery
  FROM lotteries l
  WHERE l.id = p_lottery_id
  FOR UPDATE;

  IF v_lottery IS NULL THEN
    RAISE EXCEPTION 'Lottery not found';
  END IF;

  IF v_lottery.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Lottery is not active';
  END IF;

  IF v_lottery.sold_tickets + p_quantity > v_lottery.total_tickets THEN
    RAISE EXCEPTION 'Not enough tickets available';
  END IF;

  SELECT COALESCE(MAX(le.ticket_number), 0) + 1 INTO v_start_ticket
  FROM lottery_entries le
  WHERE le.lottery_id = p_lottery_id;

  RETURN QUERY
  INSERT INTO lottery_entries (
    user_id, lottery_id, order_id,
    ticket_number, participation_code,
    numbers, status,
    is_winning, created_at
  )
  SELECT
    p_user_id,
    p_lottery_id,
    p_order_id,
    v_start_ticket + gs.i - 1,
    (v_base_number + v_start_ticket + gs.i - 2)::TEXT,
    (v_base_number + v_start_ticket + gs.i - 2)::TEXT,
    'ACTIVE',
    false,
    NOW()
  FROM generate_series(1, p_quantity) AS gs(i)
  -- 【修复】RETURNING 使用表限定名，避免与 RETURNS TABLE 输出列歧义
  RETURNING lottery_entries.id, lottery_entries.ticket_number, lottery_entries.participation_code;

  -- 【修复】UPDATE 使用表别名限定
  UPDATE lotteries l2
  SET sold_tickets = l2.sold_tickets + p_quantity,
      updated_at = NOW()
  WHERE l2.id = p_lottery_id;
END;
$func$;

-- ============================================================
-- 修复2: draw_lottery 
-- 
-- 风险: DECLARE 中 v_prize_id UUID 使用了 RETURNING id INTO v_prize_id
--       虽然当前未触发歧义（因为没有 RETURNS TABLE 含 id），
--       但函数体中多处 WHERE id = 未使用表别名，属于潜在风险
-- FIX: 所有表列引用添加表别名限定
-- ============================================================
CREATE OR REPLACE FUNCTION draw_lottery(p_lottery_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_lottery RECORD;
    v_winning_entry RECORD;
    v_timestamp_sum BIGINT := 0;
    v_winning_index INT;
    v_count INT := 0;
    v_result JSONB;
    v_draw_time TIMESTAMPTZ := NOW();
    v_prize_id UUID;
    v_winning_code TEXT;
    v_winning_ticket_number INT;
BEGIN
    -- 【修复】使用表别名 l 限定 id 列
    SELECT l.* INTO v_lottery FROM lotteries l WHERE l.id = p_lottery_id FOR UPDATE;
    
    IF v_lottery IS NULL THEN
        RAISE EXCEPTION 'Lottery not found';
    END IF;
    
    -- 幂等性保护：如果已经开奖，返回已有结果
    IF v_lottery.status = 'COMPLETED' THEN
        v_result := jsonb_build_object(
            'lottery_id', p_lottery_id,
            'winner_user_id', v_lottery.winning_user_id,
            'winning_number', v_lottery.winning_ticket_number,
            'already_drawn', true
        );
        RETURN v_result;
    END IF;
    
    IF v_lottery.status NOT IN ('ACTIVE', 'SOLD_OUT') THEN
        RAISE EXCEPTION 'Lottery cannot be drawn, current status: %', v_lottery.status;
    END IF;
    
    -- 【修复】使用表别名 le 限定列
    SELECT count(*) INTO v_count FROM lottery_entries le
    WHERE le.lottery_id = p_lottery_id AND le.status = 'ACTIVE';
    
    IF v_count = 0 THEN
        RAISE EXCEPTION 'No lottery entries found';
    END IF;
    
    -- 时间戳求和算法
    SELECT COALESCE(SUM((EXTRACT(EPOCH FROM le.created_at) * 1000)::BIGINT), 0)
    INTO v_timestamp_sum
    FROM lottery_entries le
    WHERE le.lottery_id = p_lottery_id AND le.status = 'ACTIVE';
    
    v_winning_index := (v_timestamp_sum % v_count)::INT;
    
    -- 获取中奖记录
    SELECT le.* INTO v_winning_entry
    FROM lottery_entries le
    WHERE le.lottery_id = p_lottery_id AND le.status = 'ACTIVE'
    ORDER BY le.created_at ASC
    OFFSET v_winning_index LIMIT 1;
    
    IF v_winning_entry IS NULL THEN
        RAISE EXCEPTION 'Winning entry not found at index %', v_winning_index;
    END IF;
    
    v_winning_code := COALESCE(v_winning_entry.participation_code, v_winning_entry.numbers);
    v_winning_ticket_number := v_winning_code::INT;
    
    -- 【修复】UPDATE 使用表别名
    UPDATE lotteries l SET 
        status = 'COMPLETED',
        winning_user_id = v_winning_entry.user_id::UUID,
        winning_numbers = ARRAY[v_winning_ticket_number],
        winning_ticket_number = v_winning_ticket_number,
        draw_time = v_draw_time,
        actual_draw_time = v_draw_time,
        updated_at = v_draw_time,
        draw_algorithm_data = jsonb_build_object(
            'algorithm', 'timestamp_sum',
            'timestamp_sum', v_timestamp_sum::TEXT,
            'total_entries', v_count,
            'winning_index', v_winning_index,
            'winning_number', v_winning_code
        )
    WHERE l.id = p_lottery_id;
    
    -- 【修复】UPDATE 使用表别名
    UPDATE lottery_entries le SET is_winning = TRUE, updated_at = v_draw_time
    WHERE le.id = v_winning_entry.id;
    
    -- 创建奖品记录
    INSERT INTO prizes (user_id, lottery_id, ticket_id, winning_code, prize_name, prize_image, 
                        prize_value, status, pickup_status, logistics_status, won_at, created_at, updated_at)
    VALUES (v_winning_entry.user_id, p_lottery_id, v_winning_entry.id, 
            v_winning_code,
            v_lottery.title, v_lottery.image_url, 
            v_lottery.ticket_price * v_lottery.total_tickets,
            'PENDING', 'PENDING_CLAIM', 'PENDING_SHIPMENT',
            v_draw_time, v_draw_time, v_draw_time)
    RETURNING prizes.id INTO v_prize_id;
    
    -- 创建开奖结果记录
    INSERT INTO lottery_results (lottery_id, winner_id, winner_ticket_number, draw_time, algorithm_data, created_at)
    VALUES (p_lottery_id, v_winning_entry.user_id, 
            v_winning_ticket_number,
            v_draw_time,
            jsonb_build_object('algorithm', 'timestamp_sum', 'timestamp_sum', v_timestamp_sum::TEXT, 'winning_index', v_winning_index),
            v_draw_time);
    
    v_result := jsonb_build_object(
        'lottery_id', p_lottery_id,
        'winner_user_id', v_winning_entry.user_id,
        'winning_number', v_winning_code,
        'prize_id', v_prize_id
    );
    
    RETURN v_result;
END;
$function$;

-- ============================================================
-- 修复3: increase_user_balance
-- 
-- 风险: SELECT id, balance INTO v_wallet_id, v_current_balance
--       FROM wallets WHERE user_id = ... 
--       虽然当前 id/balance 不在 RETURNS TABLE 中（函数返回 boolean），
--       但 DECLARE 中的变量名不规范，且 WHERE id = v_wallet_id 有潜在风险
-- FIX: 使用表别名限定
-- ============================================================
CREATE OR REPLACE FUNCTION increase_user_balance(
  p_user_id TEXT, 
  p_amount NUMERIC, 
  p_wallet_type TEXT DEFAULT 'TJS'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_wallet_id UUID;
    v_current_balance DECIMAL(10,2);
    v_currency TEXT;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN FALSE;
    END IF;

    IF p_wallet_type = 'TJS' THEN
        v_currency := 'TJS';
    ELSIF p_wallet_type = 'LUCKY_COIN' THEN
        v_currency := 'POINTS';
    ELSE
        v_currency := p_wallet_type;
    END IF;

    -- 【修复】使用表别名 w 限定列引用
    SELECT w.id, w.balance INTO v_wallet_id, v_current_balance
    FROM wallets w
    WHERE w.user_id = p_user_id AND w.type = p_wallet_type
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        INSERT INTO wallets (
            user_id, type, currency, balance, frozen_balance, version,
            total_deposits, total_withdrawals,
            first_deposit_bonus_claimed, first_deposit_bonus_amount,
            is_active, is_bonus, created_at, updated_at
        ) VALUES (
            p_user_id, p_wallet_type, v_currency, p_amount, 0, 1,
            0, 0, false, 0, true, false, NOW(), NOW()
        )
        RETURNING wallets.id INTO v_wallet_id;
        v_current_balance := 0;
    ELSE
        -- 【修复】使用表别名限定
        UPDATE wallets w2
        SET balance = w2.balance + p_amount, updated_at = NOW()
        WHERE w2.id = v_wallet_id;
    END IF;

    INSERT INTO wallet_transactions (wallet_id, type, amount, balance_before, balance_after, status, created_at)
    VALUES (v_wallet_id, 'INCREASE', p_amount, v_current_balance, v_current_balance + p_amount, 'COMPLETED', NOW());

    RETURN TRUE;
END;
$function$;

-- ============================================================
-- 修复4: decrease_user_balance
-- 同 increase_user_balance 的对称修复
-- ============================================================
CREATE OR REPLACE FUNCTION decrease_user_balance(
  p_user_id TEXT, 
  p_amount NUMERIC, 
  p_wallet_type TEXT DEFAULT 'TJS'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_wallet_id UUID;
    v_current_balance DECIMAL(10,2);
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN FALSE;
    END IF;

    -- 【修复】使用表别名 w 限定列引用
    SELECT w.id, w.balance INTO v_wallet_id, v_current_balance
    FROM wallets w
    WHERE w.user_id = p_user_id AND w.type = p_wallet_type
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_current_balance < p_amount THEN
        RETURN FALSE;
    END IF;

    -- 【修复】使用表别名限定
    UPDATE wallets w2
    SET balance = w2.balance - p_amount, updated_at = NOW()
    WHERE w2.id = v_wallet_id;

    INSERT INTO wallet_transactions (wallet_id, type, amount, balance_before, balance_after, status, created_at)
    VALUES (v_wallet_id, 'DECREASE', p_amount, v_current_balance, v_current_balance - p_amount, 'COMPLETED', NOW());

    RETURN TRUE;
END;
$function$;

-- ============================================================
-- 修复5: verify_admin_session
-- 
-- 风险: SELECT status INTO v_admin_status FROM admin_users WHERE id = v_admin_id
--       变量名 v_admin_status 已正确，但 WHERE id = 未限定表名
-- FIX: 使用表别名限定
-- ============================================================
CREATE OR REPLACE FUNCTION verify_admin_session(p_session_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_admin_status TEXT;
BEGIN
  -- 【修复】使用表别名 s 限定列引用
  SELECT s.admin_id INTO v_admin_id
  FROM admin_sessions s
  WHERE s.session_token = p_session_token
    AND s.is_active = true
    AND s.expires_at > now();

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AUTH_FAILED: 会话无效或已过期';
  END IF;

  -- 【修复】使用表别名 au 限定列引用
  SELECT au.status INTO v_admin_status
  FROM admin_users au
  WHERE au.id = v_admin_id;

  IF v_admin_status IS NULL OR v_admin_status != 'active' THEN
    RAISE EXCEPTION 'ADMIN_AUTH_FAILED: 管理员账户已被禁用';
  END IF;

  RETURN v_admin_id;
END;
$function$;
