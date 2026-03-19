-- ============================================================================
-- TezBarakat → DODO.TJ 迁移文件
-- 文件名: 20260401_whatsapp_migration.sql
-- 目的: 阶段一 - 数据库结构重构，移除 Telegram 强依赖，建立手机号登录体系
-- 执行顺序: 在完整 Schema 复制到新 Supabase 项目之后执行
-- ============================================================================

BEGIN;

-- ============================================================================
-- 第一部分：修改 users 表结构
-- ============================================================================

-- 1.1 移除 telegram_id 的 NOT NULL 约束（允许新用户不提供 telegram_id）
ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL;

-- 1.2 移除 telegram_id 的 UNIQUE 约束（不再作为唯一标识）
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_telegram_id_key;

-- 1.3 添加密码哈希字段（用于手机号+密码登录）
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 1.4 强化 phone_number 为核心身份标识
-- 注意: 现有数据中 phone_number 可能为 NULL，需要先清理或允许渐进迁移
-- 添加 UNIQUE 约束（允许 NULL 值，PostgreSQL 的 UNIQUE 约束天然允许多个 NULL）
ALTER TABLE users ADD CONSTRAINT users_phone_number_key UNIQUE (phone_number);

-- 1.5 添加 WhatsApp 消息接收偏好字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN DEFAULT true;


-- ============================================================================
-- 第二部分：修改 notification_queue 表结构
-- ============================================================================

-- 2.1 添加 phone_number 列作为新的消息发送目标
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- 2.2 允许 telegram_chat_id 为空（兼容旧数据，新数据不再写入此字段）
-- 注意: 当前 telegram_chat_id 已经是 nullable 的，此语句为幂等保护
ALTER TABLE notification_queue ALTER COLUMN telegram_chat_id DROP NOT NULL;

-- 2.3 将默认通知渠道从 telegram 改为 whatsapp
ALTER TABLE notification_queue ALTER COLUMN channel SET DEFAULT 'whatsapp';


-- ============================================================================
-- 第三部分：重写 RPC 函数 - 移除 Telegram 依赖
-- ============================================================================

-- -----------------------------------------------------------------------
-- 3.1 search_user_for_deposit
-- 变更说明:
--   - 移除 "纯数字 → telegram_id 匹配" 的搜索路径
--   - 移除 "telegram_username 匹配" 的搜索路径
--   - 新增 "手机号匹配" 的搜索路径
--   - 返回字段中 telegram_id/telegram_username 替换为 phone_number
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
  IF v_user IS NULL AND p_query ~ '^\+?\d{9,15}$' THEN
    SELECT id, phone_number, first_name, last_name, avatar_url
    INTO v_user
    FROM users
    WHERE phone_number = REPLACE(p_query, '+', '')
       OR phone_number = p_query
       OR phone_number = '+' || REPLACE(p_query, '+', '')
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


-- -----------------------------------------------------------------------
-- 3.2 perform_promoter_deposit
-- 变更说明:
--   - Step 11: 获取用户名时，回退链从 telegram_username/telegram_id
--     改为 phone_number/id
--   - 其余业务逻辑（金额校验、钱包操作、首充奖励等）完全保持不变
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
  v_wallet          RECORD;
  v_new_balance     NUMERIC;
  v_new_total_deposits NUMERIC;
  v_is_first_deposit BOOLEAN;
  v_bonus_amount    NUMERIC := 0;
  v_bonus_percent   NUMERIC := 0;
  v_config_value    JSONB;
  v_deposit_id      UUID;
  v_tx_id           UUID;
  v_bonus_tx_id     UUID;
  v_target_name     TEXT;
  v_promoter_name   TEXT;
  v_settlement      RECORD;
BEGIN
  -- ============================================================
  -- Step 1: 验证地推人员身份和状态
  -- ============================================================
  SELECT pp.user_id, pp.promoter_status, pp.daily_deposit_limit
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
  -- Step 3: 验证金额范围 (10 ~ 500 TJS) 且必须为整数
  -- [ISSUE-AMT-001 FIX] 增加整数验证
  -- ============================================================
  IF p_amount < 10 OR p_amount > 500 THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF p_amount != FLOOR(p_amount) THEN
    RETURN json_build_object('success', false, 'error', 'AMOUNT_MUST_BE_INTEGER');
  END IF;

  -- ============================================================
  -- Step 3.5 (PD-003 修复): 锁定或创建当日结算记录
  --   [ISSUE-TZ-001 FIX] 使用塔吉克斯坦时区的日期
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
  -- Step 4: 检查今日充值次数和额度（现在是在锁保护下执行）
  -- [ISSUE-TZ-001 FIX] 使用塔吉克斯坦时区的日期范围
  -- ============================================================
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*)::INTEGER
  INTO v_today_total, v_today_count
  FROM promoter_deposits
  WHERE promoter_id = p_promoter_id
    AND created_at >= (v_today::timestamp AT TIME ZONE 'Asia/Dushanbe')
    AND created_at < ((v_today + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Dushanbe');

  -- 每日最多 10 次
  IF v_today_count >= 10 THEN
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
  -- Step 5: 锁定目标用户钱包（FOR UPDATE 防止余额并发修改）
  -- ============================================================
  SELECT *
  INTO v_wallet
  FROM wallets
  WHERE user_id = p_target_user_id AND type = 'TJS'
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    -- 自动创建钱包（新用户可能还没有钱包）
    -- 【资金安全修复 v4】创建钱包时显式设置 version = 1
    INSERT INTO wallets (
      user_id, type, currency, balance,
      total_deposits, first_deposit_bonus_claimed, first_deposit_bonus_amount, version
    )
    VALUES (p_target_user_id, 'TJS', 'TJS', 0, 0, false, 0, 1)
    RETURNING * INTO v_wallet;
  END IF;

  -- ============================================================
  -- Step 6: 检查是否为首充，计算首充奖励
  -- ============================================================
  v_is_first_deposit := (COALESCE(v_wallet.total_deposits, 0) = 0)
                        AND (v_wallet.first_deposit_bonus_claimed IS NOT TRUE);

  IF v_is_first_deposit THEN
    -- 从 system_config 获取首充奖励配置（key = 'first_deposit_bonus'）
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
  END IF;

  -- ============================================================
  -- Step 7: 更新钱包余额（原子操作）
  -- 【资金安全修复 v4】添加 version 递增，保持与 Edge Function 乐观锁模式的一致性
  -- ============================================================
  v_new_balance := COALESCE(v_wallet.balance, 0) + p_amount + v_bonus_amount;
  v_new_total_deposits := COALESCE(v_wallet.total_deposits, 0) + p_amount;

  UPDATE wallets
  SET
    balance = v_new_balance,
    total_deposits = v_new_total_deposits,
    version = COALESCE(version, 1) + 1,
    first_deposit_bonus_claimed = CASE
      WHEN v_bonus_amount > 0 THEN true
      ELSE first_deposit_bonus_claimed
    END,
    first_deposit_bonus_amount = CASE
      WHEN v_bonus_amount > 0 THEN v_bonus_amount
      ELSE first_deposit_bonus_amount
    END,
    updated_at = now()
  WHERE id = v_wallet.id;

  -- ============================================================
  -- Step 8: 创建充值交易记录
  -- ============================================================
  v_tx_id := gen_random_uuid();

  INSERT INTO wallet_transactions (
    id, wallet_id, type, amount,
    balance_before, balance_after,
    description, reference_id, status, created_at
  ) VALUES (
    v_tx_id,
    v_wallet.id,
    'PROMOTER_DEPOSIT',
    p_amount,
    COALESCE(v_wallet.balance, 0),
    COALESCE(v_wallet.balance, 0) + p_amount,
    '线下充值 - 操作员: ' || p_promoter_id,
    NULL,
    'COMPLETED',
    now()
  );

  -- ============================================================
  -- Step 9: 如果有首充奖励，创建奖励交易记录
  -- ============================================================
  IF v_bonus_amount > 0 THEN
    v_bonus_tx_id := gen_random_uuid();

    INSERT INTO wallet_transactions (
      id, wallet_id, type, amount,
      balance_before, balance_after,
      description, reference_id, status, created_at
    ) VALUES (
      v_bonus_tx_id,
      v_wallet.id,
      'BONUS',
      v_bonus_amount,
      COALESCE(v_wallet.balance, 0) + p_amount,
      v_new_balance,
      '首充奖励 (' || v_bonus_percent || '%) - 地推充值触发',
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
  -- Step 11: 获取目标用户名称和地推人员名称（用于通知消息）
  -- [MIGRATION] 用户名回退链改为 phone_number/id
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
  -- [MIGRATION] 使用 phone_number 作为通知目标
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
           THEN '，另有首充奖励 ' || v_bonus_amount || ' TJS'
           ELSE ''
      END,
    json_build_object(
      'transaction_amount', p_amount,
      'bonus_amount', v_bonus_amount,
      'promoter_name', v_promoter_name,
      'deposit_id', v_deposit_id
    )::jsonb,
    'whatsapp'
  );

  -- ============================================================
  -- Step 13: 插入通知队列 - 通知地推人员本人
  -- [MIGRATION] 使用 phone_number 作为通知目标
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
  -- Step 14: 更新当日缴款结算记录（已在 Step 3.5 创建/锁定）
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
    'new_balance', v_new_balance,
    'today_count', v_today_count + 1,
    'today_total', v_today_total + p_amount,
    'daily_limit', COALESCE(v_promoter.daily_deposit_limit, 5000),
    'is_first_deposit', v_is_first_deposit
  );

EXCEPTION
  WHEN OTHERS THEN
    -- 捕获所有异常，返回错误信息（事务自动回滚）
    RETURN json_build_object(
      'success', false,
      'error', 'INTERNAL_ERROR',
      'detail', SQLERRM
    );
END;
$function$;


-- -----------------------------------------------------------------------
-- 3.3 get_admin_deposit_list
-- 变更说明:
--   - 搜索条件中移除 telegram_id/telegram_username 匹配，
--     新增 phone_number 匹配
--   - 返回字段中 promoter_telegram_id/target_telegram_id/target_telegram_username
--     替换为 promoter_phone_number/target_phone_number
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_deposit_list(p_start_date date, p_end_date date, p_status text DEFAULT NULL::text, p_promoter_id text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSON;
  v_records JSON;
  v_total_count INTEGER;
  v_offset INTEGER;
  v_tz TEXT := 'Asia/Dushanbe';
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_search TEXT;
BEGIN
  v_start := (p_start_date::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_end := ((p_end_date + INTERVAL '1 day')::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_offset := (p_page - 1) * p_page_size;
  v_search := CASE WHEN p_search IS NOT NULL AND TRIM(p_search) != '' 
              THEN '%' || LOWER(TRIM(p_search)) || '%' 
              ELSE NULL END;

  SELECT COUNT(*)
  INTO v_total_count
  FROM promoter_deposits pd
  LEFT JOIN users pu ON pu.id::TEXT = pd.promoter_id
  LEFT JOIN users tu ON tu.id::TEXT = pd.target_user_id
  WHERE pd.created_at >= v_start
    AND pd.created_at < v_end
    AND (p_status IS NULL OR pd.status = p_status)
    AND (p_promoter_id IS NULL OR pd.promoter_id = p_promoter_id)
    AND (v_search IS NULL OR (
      LOWER(COALESCE(pu.first_name, '') || ' ' || COALESCE(pu.last_name, '')) LIKE v_search
      OR LOWER(COALESCE(tu.first_name, '') || ' ' || COALESCE(tu.last_name, '')) LIKE v_search
      OR COALESCE(pu.phone_number, '') LIKE v_search
      OR COALESCE(tu.phone_number, '') LIKE v_search
      OR LOWER(pd.id::TEXT) LIKE v_search
    ));

  SELECT COALESCE(json_agg(row_data ORDER BY row_data->>'created_at' DESC), '[]'::JSON)
  INTO v_records
  FROM (
    SELECT json_build_object(
      'id', pd.id,
      'promoter_id', pd.promoter_id,
      'target_user_id', pd.target_user_id,
      'amount', pd.amount::NUMERIC(12,2),
      'currency', pd.currency,
      'status', pd.status,
      'note', pd.note,
      'bonus_amount', COALESCE(pd.bonus_amount, 0)::NUMERIC(12,2),
      'created_at', pd.created_at,
      'promoter_name', COALESCE(
        NULLIF(TRIM(COALESCE(pu.first_name, '') || ' ' || COALESCE(pu.last_name, '')), ''),
        pu.phone_number,
        '未知'
      ),
      'promoter_phone_number', COALESCE(pu.phone_number, ''),
      'target_user_name', COALESCE(
        NULLIF(TRIM(COALESCE(tu.first_name, '') || ' ' || COALESCE(tu.last_name, '')), ''),
        tu.phone_number,
        '未知'
      ),
      'target_phone_number', COALESCE(tu.phone_number, '')
    ) AS row_data
    FROM promoter_deposits pd
    LEFT JOIN users pu ON pu.id::TEXT = pd.promoter_id
    LEFT JOIN users tu ON tu.id::TEXT = pd.target_user_id
    WHERE pd.created_at >= v_start
      AND pd.created_at < v_end
      AND (p_status IS NULL OR pd.status = p_status)
      AND (p_promoter_id IS NULL OR pd.promoter_id = p_promoter_id)
      AND (v_search IS NULL OR (
        LOWER(COALESCE(pu.first_name, '') || ' ' || COALESCE(pu.last_name, '')) LIKE v_search
        OR LOWER(COALESCE(tu.first_name, '') || ' ' || COALESCE(tu.last_name, '')) LIKE v_search
        OR COALESCE(pu.phone_number, '') LIKE v_search
        OR COALESCE(tu.phone_number, '') LIKE v_search
        OR LOWER(pd.id::TEXT) LIKE v_search
      ))
    ORDER BY pd.created_at DESC
    LIMIT p_page_size
    OFFSET v_offset
  ) sub;

  RETURN json_build_object(
    'records', v_records,
    'total_count', v_total_count,
    'page', p_page,
    'page_size', p_page_size,
    'total_pages', CEIL(v_total_count::NUMERIC / p_page_size)::INTEGER
  );
END;
$function$;


-- -----------------------------------------------------------------------
-- 3.4 get_admin_promoter_stats
-- 变更说明:
--   - 返回字段中 telegram_id 替换为 phone_number
--   - promoter_name 回退链从 telegram_username 改为 phone_number
--   - GROUP BY 中对应字段同步修改
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_promoter_stats(p_start_date date, p_end_date date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSON;
  v_tz TEXT := 'Asia/Dushanbe';
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
BEGIN
  v_start := (p_start_date::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_end := ((p_end_date + INTERVAL '1 day')::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  
  v_today_start := ((now() AT TIME ZONE v_tz)::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_today_end := v_today_start + INTERVAL '1 day';

  SELECT COALESCE(json_agg(stat_row ORDER BY (stat_row->>'total_amount')::NUMERIC DESC), '[]'::JSON)
  INTO v_result
  FROM (
    SELECT json_build_object(
      'promoter_id', pd.promoter_id,
      'promoter_name', COALESCE(
        NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        u.phone_number,
        '未知'
      ),
      'phone_number', COALESCE(u.phone_number, ''),
      'team_name', COALESCE(pt.name, '--'),
      'deposit_count', COUNT(*)::INTEGER,
      'total_amount', SUM(pd.amount)::NUMERIC(12,2),
      'total_bonus', COALESCE(SUM(pd.bonus_amount), 0)::NUMERIC(12,2),
      'daily_deposit_limit', COALESCE(pp.daily_deposit_limit, 5000)::NUMERIC(12,2),
      'today_used', COALESCE((
        SELECT SUM(pd2.amount)
        FROM promoter_deposits pd2
        WHERE pd2.promoter_id = pd.promoter_id
          AND pd2.status = 'COMPLETED'
          AND pd2.created_at >= v_today_start
          AND pd2.created_at < v_today_end
      ), 0)::NUMERIC(12,2)
    ) AS stat_row
    FROM promoter_deposits pd
    LEFT JOIN users u ON u.id::TEXT = pd.promoter_id
    LEFT JOIN promoter_profiles pp ON pp.user_id = pd.promoter_id
    LEFT JOIN promoter_teams pt ON pt.id = pp.team_id
    WHERE pd.status = 'COMPLETED'
      AND pd.created_at >= v_start
      AND pd.created_at < v_end
    GROUP BY pd.promoter_id, u.first_name, u.last_name, u.phone_number, 
             pp.daily_deposit_limit, pt.name
  ) sub;

  RETURN v_result;
END;
$function$;


-- -----------------------------------------------------------------------
-- 3.5 get_promoter_command_center
-- 变更说明:
--   - active_promoters CTE 中的 name 字段回退链从 telegram_username
--     改为 phone_number
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_promoter_command_center(p_range_start timestamp with time zone, p_range_end timestamp with time zone, p_prev_start timestamp with time zone, p_prev_end timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result JSON;
BEGIN
  WITH
  -- 1. Active promoter profiles with user info, team, point
  active_promoters AS (
    SELECT
      pp.user_id,
      pp.team_id,
      pp.point_id,
      pp.daily_base_salary,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
        u.phone_number,
        u.id
      ) AS name,
      COALESCE(u.referral_code, '') AS referral_code,
      COALESCE(pt.name, '') AS team_name,
      COALESCE(prp.name, '') AS point_name,
      COALESCE(prp.area_size, 'medium') AS area_size
    FROM promoter_profiles pp
    JOIN users u ON u.id = pp.user_id
    LEFT JOIN promoter_teams pt ON pt.id = pp.team_id
    LEFT JOIN promotion_points prp ON prp.id = pp.point_id
    WHERE pp.promoter_status = 'active'
  ),

  -- 2. Registrations in current range (users referred by promoters)
  current_regs AS (
    SELECT
      u.referred_by_id AS promoter_id,
      COUNT(*) AS reg_count
    FROM users u
    WHERE u.referred_by_id IN (SELECT user_id FROM active_promoters)
      AND u.created_at >= p_range_start
      AND u.created_at < p_range_end
    GROUP BY u.referred_by_id
  ),

  -- 3. Registrations in previous range
  prev_regs AS (
    SELECT COUNT(*) AS total
    FROM users u
    WHERE u.referred_by_id IN (SELECT user_id FROM active_promoters)
      AND u.created_at >= p_prev_start
      AND u.created_at < p_prev_end
  ),

  -- 4. All users referred by promoters (for deposit matching)
  referred_users AS (
    SELECT id, referred_by_id
    FROM users
    WHERE referred_by_id IN (SELECT user_id FROM active_promoters)
  ),

  -- 5. First-time deposits only: find each referred user's first approved deposit
  first_deposits AS (
    SELECT DISTINCT ON (dr.user_id)
      dr.user_id,
      dr.amount,
      dr.created_at
    FROM deposit_requests dr
    WHERE dr.user_id IN (SELECT id FROM referred_users)
      AND dr.status = 'APPROVED'
    ORDER BY dr.user_id, dr.created_at ASC
  ),

  -- 6. First deposits in current range
  current_first_deposits AS (
    SELECT
      ru.referred_by_id AS promoter_id,
      fd.user_id,
      COALESCE(fd.amount, 0) AS amount
    FROM first_deposits fd
    JOIN referred_users ru ON ru.id = fd.user_id
    WHERE fd.created_at >= p_range_start
      AND fd.created_at < p_range_end
  ),

  -- 7. First deposits in previous range
  prev_first_deposits AS (
    SELECT
      COUNT(DISTINCT fd.user_id) AS charged_users,
      COALESCE(SUM(fd.amount), 0) AS total_amount
    FROM first_deposits fd
    JOIN referred_users ru ON ru.id = fd.user_id
    WHERE fd.created_at >= p_prev_start
      AND fd.created_at < p_prev_end
  ),

  -- 8. Daily logs for contacts in current range
  current_logs AS (
    SELECT
      promoter_id,
      SUM(contact_count) AS total_contacts
    FROM promoter_daily_logs
    WHERE promoter_id IN (SELECT user_id FROM active_promoters)
      AND log_date >= (p_range_start::date)
      AND log_date < (p_range_end::date)
    GROUP BY promoter_id
  ),

  -- 9. Daily logs for contacts in previous range (FIX for BUG-004)
  prev_logs AS (
    SELECT
      COALESCE(SUM(contact_count), 0) AS total_contacts
    FROM promoter_daily_logs
    WHERE promoter_id IN (SELECT user_id FROM active_promoters)
      AND log_date >= (p_prev_start::date)
      AND log_date < (p_prev_end::date)
  ),

  -- 10. Per-promoter stats
  promoter_stats AS (
    SELECT
      ap.user_id,
      ap.name,
      ap.referral_code,
      ap.team_id,
      ap.team_name,
      ap.point_id,
      ap.point_name,
      ap.area_size,
      COALESCE(cr.reg_count, 0) AS registrations,
      COALESCE(cl.total_contacts, 0) AS contacts,
      COUNT(DISTINCT cfd.user_id) AS first_charges,
      COALESCE(SUM(cfd.amount), 0) AS first_charge_amount
    FROM active_promoters ap
    LEFT JOIN current_regs cr ON cr.promoter_id = ap.user_id
    LEFT JOIN current_logs cl ON cl.promoter_id = ap.user_id
    LEFT JOIN current_first_deposits cfd ON cfd.promoter_id = ap.user_id
    GROUP BY ap.user_id, ap.name, ap.referral_code, ap.team_id, ap.team_name,
             ap.point_id, ap.point_name, ap.area_size, cr.reg_count, cl.total_contacts
  ),

  -- 11. Summary
  summary AS (
    SELECT
      SUM(registrations) AS total_registrations,
      SUM(first_charges) AS total_first_charges,
      SUM(first_charge_amount) AS total_first_charge_amount,
      SUM(contacts) AS total_contacts
    FROM promoter_stats
  ),

  -- 12. Point aggregation
  point_stats AS (
    SELECT
      ps.point_id,
      ps.point_name,
      ps.area_size,
      COUNT(*) AS staff_count,
      SUM(ps.registrations) AS registrations,
      SUM(ps.first_charges) AS charges,
      SUM(ps.first_charge_amount) AS charge_amount
    FROM promoter_stats ps
    WHERE ps.point_id IS NOT NULL AND ps.point_name != ''
    GROUP BY ps.point_id, ps.point_name, ps.area_size
  )

  SELECT json_build_object(
    'summary', (
      SELECT json_build_object(
        'total_registrations', COALESCE(s.total_registrations, 0),
        'total_first_charges', COALESCE(s.total_first_charges, 0),
        'total_first_charge_amount', COALESCE(s.total_first_charge_amount, 0),
        'total_contacts', COALESCE(s.total_contacts, 0),
        'prev_registrations', COALESCE(pr.total, 0),
        'prev_first_charges', COALESCE(pfd.charged_users, 0),
        'prev_first_charge_amount', COALESCE(pfd.total_amount, 0),
        'prev_contacts', COALESCE(pl.total_contacts, 0)
      )
      FROM summary s, prev_regs pr, prev_first_deposits pfd, prev_logs pl
    ),
    'promoters', COALESCE((
      SELECT json_agg(
        json_build_object(
          'user_id', ps.user_id,
          'name', ps.name,
          'referral_code', ps.referral_code,
          'team_name', ps.team_name,
          'point_name', ps.point_name,
          'contacts', ps.contacts,
          'registrations', ps.registrations,
          'first_charges', ps.first_charges,
          'first_charge_amount', ps.first_charge_amount,
          'reg_conversion_rate', CASE WHEN ps.contacts > 0 THEN ROUND(ps.registrations::numeric / ps.contacts * 100, 1) ELSE 0 END,
          'charge_conversion_rate', CASE WHEN ps.registrations > 0 THEN ROUND(ps.first_charges::numeric / ps.registrations * 100, 1) ELSE 0 END
        )
        ORDER BY ps.registrations DESC
      )
      FROM promoter_stats ps
    ), '[]'::json),
    'points', COALESCE((
      SELECT json_agg(
        json_build_object(
          'point_id', pt.point_id,
          'point_name', pt.point_name,
          'area_size', pt.area_size,
          'staff_count', pt.staff_count,
          'registrations', pt.registrations,
          'charges', pt.charges,
          'charge_amount', pt.charge_amount,
          'reg_per_staff', CASE WHEN pt.staff_count > 0 THEN ROUND(pt.registrations::numeric / pt.staff_count, 1) ELSE 0 END,
          'health', CASE
            WHEN pt.registrations = 0 THEN 'inactive'
            WHEN pt.charges::numeric / GREATEST(pt.registrations, 1) >= 0.25 THEN 'good'
            WHEN pt.charges::numeric / GREATEST(pt.registrations, 1) >= 0.15 THEN 'fair'
            ELSE 'poor'
          END
        )
        ORDER BY pt.registrations DESC
      )
      FROM point_stats pt
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$function$;


-- -----------------------------------------------------------------------
-- 3.6 get_promoter_leaderboard
-- 变更说明:
--   - name 字段回退链从 telegram_username 改为 phone_number
--   - GROUP BY 中对应字段同步修改
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_promoter_leaderboard(p_start_date date DEFAULT (CURRENT_DATE - '7 days'::interval), p_end_date date DEFAULT CURRENT_DATE, p_limit integer DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_data) INTO result
  FROM (
    SELECT
      pp.user_id,
      COALESCE(
        NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
        u.phone_number,
        u.id
      ) AS name,
      pt.name AS team_name,
      COUNT(DISTINCT ref.id) AS registrations,
      COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL THEN ref.id END) AS charges,
      COALESCE(SUM(dr.amount), 0) AS charge_amount
    FROM promoter_profiles pp
    JOIN users u ON u.id = pp.user_id
    LEFT JOIN promoter_teams pt ON pt.id = pp.team_id
    LEFT JOIN users ref ON ref.referred_by_id = pp.user_id
      AND ref.created_at::date BETWEEN p_start_date AND p_end_date
    LEFT JOIN deposit_requests dr ON dr.user_id = ref.id
      AND dr.status = 'APPROVED'
      AND dr.created_at::date BETWEEN p_start_date AND p_end_date
    WHERE pp.promoter_status = 'active'
    GROUP BY pp.user_id, u.first_name, u.last_name, u.phone_number, u.id, pt.name
    ORDER BY registrations DESC
    LIMIT p_limit
  ) AS row_data;

  RETURN COALESCE(result, '[]'::json);
END;
$function$;


-- -----------------------------------------------------------------------
-- 3.7 approve_deposit_atomic
-- 变更说明:
--   - Step 11: 向 notification_queue 插入数据时，使用 phone_number 替代
--     telegram_chat_id，并设置 channel = 'whatsapp'
--   - 其余所有业务逻辑（钱包操作、首充奖励、操作日志等）完全保持不变
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_deposit_atomic(p_request_id text, p_action text, p_admin_id text, p_admin_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

    -- [MIGRATION] 插入通知队列（充值被拒绝）- 使用 phone_number 作为通知目标
    INSERT INTO notification_queue (
      user_id, phone_number, type, payload,
      notification_type, title, message, data,
      priority, status, scheduled_at,
      retry_count, max_retries,
      channel, created_at, updated_at
    ) VALUES (
      v_deposit.user_id,
      v_user_phone,
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
    processed_by = p_admin_id::uuid,
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
  -- Step 11: 插入通知队列 - 充值到账
  -- [MIGRATION] 使用 phone_number 作为通知目标，channel 设为 whatsapp
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

  -- 如果有首充奖励，发送首充奖励通知
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
$function$;


-- ============================================================================
-- 第四部分：为 phone_number 添加索引（优化查询性能）
-- ============================================================================

-- 用户表手机号索引（加速登录和搜索）
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users (phone_number);

-- 通知队列手机号索引（加速消息发送查询）
CREATE INDEX IF NOT EXISTS idx_notification_queue_phone_number ON notification_queue (phone_number);


-- ============================================================================
-- 迁移完成
-- ============================================================================

COMMIT;
