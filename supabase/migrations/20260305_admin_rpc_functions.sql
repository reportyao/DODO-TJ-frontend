-- ============================================================
-- Admin后台专用 RPC 聚合函数
-- 
-- 设计原则：
-- 1. 所有金额计算在数据库层面完成，使用 NUMERIC 类型，精确到分
-- 2. 所有时间范围统一使用 Asia/Dushanbe 时区
-- 3. 单次查询返回所有需要的数据，避免多次往返
-- 4. 只查 promoter_deposits 表（地推代充），不碰 deposit_requests（用户自主充值）
-- 5. SECURITY DEFINER 确保 service_role 权限
-- 
-- 注意：
-- promoter_deposits.promoter_id 和 target_user_id 是 TEXT 类型
-- users.id 是 UUID 类型
-- JOIN 时需要 u.id::TEXT = pd.promoter_id 进行类型转换
-- ============================================================

-- ============================================================
-- 函数1: get_admin_deposit_summary
-- 功能: 返回指定日期范围内的充值统计概览
-- 用途: Admin后台统计卡片（充值总额、笔数、奖励、活跃地推数、充值用户数）
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_deposit_summary(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_result JSON;
  v_tz TEXT := 'Asia/Dushanbe';
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  -- 将日期转换为 Asia/Dushanbe 时区的时间范围
  v_start := (p_start_date::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_end := ((p_end_date + INTERVAL '1 day')::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;

  SELECT json_build_object(
    'total_count', COALESCE(COUNT(*), 0)::INTEGER,
    'total_amount', COALESCE(SUM(amount), 0)::NUMERIC(12,2),
    'total_bonus', COALESCE(SUM(bonus_amount), 0)::NUMERIC(12,2),
    'unique_promoters', COUNT(DISTINCT promoter_id)::INTEGER,
    'unique_users', COUNT(DISTINCT target_user_id)::INTEGER
  )
  INTO v_result
  FROM promoter_deposits
  WHERE status = 'COMPLETED'
    AND created_at >= v_start
    AND created_at < v_end;

  RETURN v_result;
END;
$function$;

-- ============================================================
-- 函数2: get_admin_deposit_list
-- 功能: 返回充值记录列表，含关联的用户信息，支持服务端搜索、筛选和分页
-- 用途: Admin后台充值记录表格
-- 
-- 关键设计:
-- - 搜索在数据库层面完成（不再客户端过滤）
-- - 金额以 NUMERIC 返回，前端不需要 parseFloat
-- - 一次查询完成所有 JOIN，不需要多次往返
-- - p_promoter_id 为 TEXT 类型（匹配表结构）
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_deposit_list(
  p_start_date DATE,
  p_end_date DATE,
  p_status TEXT DEFAULT NULL,
  p_promoter_id TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20
)
RETURNS JSON
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
  -- 时区转换
  v_start := (p_start_date::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_end := ((p_end_date + INTERVAL '1 day')::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_offset := (p_page - 1) * p_page_size;
  v_search := CASE WHEN p_search IS NOT NULL AND TRIM(p_search) != '' 
              THEN '%' || LOWER(TRIM(p_search)) || '%' 
              ELSE NULL END;

  -- 获取总记录数
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
      OR COALESCE(pu.telegram_id, '') LIKE v_search
      OR COALESCE(tu.telegram_id, '') LIKE v_search
      OR LOWER(COALESCE(tu.telegram_username, '')) LIKE v_search
      OR LOWER(pd.id::TEXT) LIKE v_search
    ));

  -- 获取分页记录（含关联用户信息）
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
        pu.telegram_username,
        '未知'
      ),
      'promoter_telegram_id', COALESCE(pu.telegram_id, ''),
      'target_user_name', COALESCE(
        NULLIF(TRIM(COALESCE(tu.first_name, '') || ' ' || COALESCE(tu.last_name, '')), ''),
        tu.telegram_username,
        '未知'
      ),
      'target_telegram_id', COALESCE(tu.telegram_id, ''),
      'target_telegram_username', COALESCE(tu.telegram_username, '')
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
        OR COALESCE(pu.telegram_id, '') LIKE v_search
        OR COALESCE(tu.telegram_id, '') LIKE v_search
        OR LOWER(COALESCE(tu.telegram_username, '')) LIKE v_search
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

-- ============================================================
-- 函数3: get_admin_promoter_stats
-- 功能: 返回按地推人员分组的充值统计
-- 用途: Admin后台"地推人员统计"标签页
-- 
-- 关键设计:
-- - 一次查询完成分组聚合 + 用户信息 + 团队信息
-- - 金额使用 SUM + NUMERIC，精确到分
-- - 包含每日已用额度（基于 Dushanbe 时区的当日）
-- - JOIN 使用 u.id::TEXT 匹配 TEXT 类型的 promoter_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_promoter_stats(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
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
  -- 时区转换
  v_start := (p_start_date::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_end := ((p_end_date + INTERVAL '1 day')::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  
  -- 当日时间范围（Dushanbe时区）
  v_today_start := ((now() AT TIME ZONE v_tz)::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_tz;
  v_today_end := v_today_start + INTERVAL '1 day';

  SELECT COALESCE(json_agg(stat_row ORDER BY (stat_row->>'total_amount')::NUMERIC DESC), '[]'::JSON)
  INTO v_result
  FROM (
    SELECT json_build_object(
      'promoter_id', pd.promoter_id,
      'promoter_name', COALESCE(
        NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        u.telegram_username,
        '未知'
      ),
      'telegram_id', COALESCE(u.telegram_id, ''),
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
    GROUP BY pd.promoter_id, u.first_name, u.last_name, u.telegram_username, 
             u.telegram_id, pp.daily_deposit_limit, pt.name
  ) sub;

  RETURN v_result;
END;
$function$;

-- ============================================================
-- 函数4: get_admin_deposit_cross_check
-- 功能: 数据一致性交叉验证
-- 用途: 管理员可以随时运行此函数验证资金数据是否一致
-- 
-- 检查项:
-- 1. promoter_deposits 总额 vs wallet_transactions(PROMOTER_DEPOSIT) 总额
-- 2. promoter_deposits 奖励总额 vs wallet_transactions(BONUS) 总额
-- 3. promoter_settlements 总额 vs promoter_deposits 按日聚合总额
-- 4. 每笔充值的 wallet_transactions 是否都存在
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_deposit_cross_check()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_deposits_total NUMERIC(12,2);
  v_deposits_bonus_total NUMERIC(12,2);
  v_deposits_count INTEGER;
  v_wallet_tx_total NUMERIC(12,2);
  v_wallet_tx_count INTEGER;
  v_wallet_bonus_total NUMERIC(12,2);
  v_wallet_bonus_count INTEGER;
  v_settlements_total NUMERIC(12,2);
  v_settlements_count INTEGER;
  v_orphan_deposits INTEGER;
  v_amount_match BOOLEAN;
  v_bonus_match BOOLEAN;
  v_settlement_match BOOLEAN;
  v_issues JSON;
BEGIN
  -- 1. promoter_deposits 汇总
  SELECT 
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(bonus_amount), 0),
    COUNT(*)
  INTO v_deposits_total, v_deposits_bonus_total, v_deposits_count
  FROM promoter_deposits
  WHERE status = 'COMPLETED';

  -- 2. wallet_transactions 中 PROMOTER_DEPOSIT 类型汇总
  SELECT 
    COALESCE(SUM(amount), 0),
    COUNT(*)
  INTO v_wallet_tx_total, v_wallet_tx_count
  FROM wallet_transactions
  WHERE type = 'PROMOTER_DEPOSIT'
    AND status = 'COMPLETED';

  -- 3. wallet_transactions 中地推充值触发的 BONUS 类型汇总
  SELECT 
    COALESCE(SUM(amount), 0),
    COUNT(*)
  INTO v_wallet_bonus_total, v_wallet_bonus_count
  FROM wallet_transactions
  WHERE type = 'BONUS'
    AND status = 'COMPLETED'
    AND description LIKE '%地推充值%';

  -- 4. promoter_settlements 汇总
  SELECT 
    COALESCE(SUM(total_deposit_amount), 0),
    COALESCE(SUM(total_deposit_count), 0)
  INTO v_settlements_total, v_settlements_count
  FROM promoter_settlements;

  -- 5. 检查是否有孤立的充值记录（没有对应的 wallet_transaction）
  SELECT COUNT(*)
  INTO v_orphan_deposits
  FROM promoter_deposits pd
  WHERE pd.status = 'COMPLETED'
    AND pd.transaction_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM wallet_transactions wt 
      WHERE wt.id = pd.transaction_id
    );

  -- 比较结果
  v_amount_match := (v_deposits_total = v_wallet_tx_total);
  v_bonus_match := (v_deposits_bonus_total = v_wallet_bonus_total);
  v_settlement_match := (v_deposits_total = v_settlements_total AND v_deposits_count = v_settlements_count);

  -- 构建问题列表
  SELECT COALESCE(json_agg(issue), '[]'::JSON)
  INTO v_issues
  FROM (
    SELECT '充值总额与钱包交易不匹配: deposits=' || v_deposits_total || ' vs wallet=' || v_wallet_tx_total AS issue
    WHERE NOT v_amount_match
    UNION ALL
    SELECT '奖励总额与钱包交易不匹配: deposits=' || v_deposits_bonus_total || ' vs wallet=' || v_wallet_bonus_total AS issue
    WHERE NOT v_bonus_match
    UNION ALL
    SELECT '结算总额与充值总额不匹配: settlements=' || v_settlements_total || '/' || v_settlements_count || ' vs deposits=' || v_deposits_total || '/' || v_deposits_count AS issue
    WHERE NOT v_settlement_match
    UNION ALL
    SELECT '存在 ' || v_orphan_deposits || ' 笔孤立充值记录（无对应钱包交易）' AS issue
    WHERE v_orphan_deposits > 0
  ) sub;

  RETURN json_build_object(
    'check_time', now(),
    'all_consistent', v_amount_match AND v_bonus_match AND v_settlement_match AND v_orphan_deposits = 0,
    'deposits', json_build_object(
      'total_amount', v_deposits_total,
      'total_bonus', v_deposits_bonus_total,
      'count', v_deposits_count
    ),
    'wallet_transactions', json_build_object(
      'deposit_total', v_wallet_tx_total,
      'deposit_count', v_wallet_tx_count,
      'bonus_total', v_wallet_bonus_total,
      'bonus_count', v_wallet_bonus_count
    ),
    'settlements', json_build_object(
      'total_amount', v_settlements_total,
      'total_count', v_settlements_count
    ),
    'orphan_deposits', v_orphan_deposits,
    'amount_match', v_amount_match,
    'bonus_match', v_bonus_match,
    'settlement_match', v_settlement_match,
    'issues', v_issues
  );
END;
$function$;
