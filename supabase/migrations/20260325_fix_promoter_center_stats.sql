-- ============================================================
-- 迁移: 修复推广者中心充值统计口径
-- 日期: 2026-03-25
-- 问题: get_promoter_center_data 统计充值时查询的是 deposits 表，
--       但地推代充写入的是 promoter_deposits 表，导致代充数据不被统计
-- 修复: 将充值统计改为同时查询 deposits 和 promoter_deposits 两个表
-- ============================================================

CREATE OR REPLACE FUNCTION get_promoter_center_data(
    p_user_id TEXT,
    p_time_range TEXT DEFAULT 'today'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_start_date TIMESTAMPTZ;
    v_prev_start_date TIMESTAMPTZ;
    v_promoter_record RECORD;
    v_my_stats JSONB;
    v_team_data JSONB;
    v_leaderboard JSONB;
    v_today_log JSONB;
    v_result JSONB;
BEGIN
    -- 验证推广者身份
    SELECT pp.*, pt.name AS team_name, ppt.name AS point_name
    INTO v_promoter_record
    FROM promoter_profiles pp
    LEFT JOIN promoter_teams pt ON pp.team_id = pt.id
    LEFT JOIN promotion_points ppt ON pp.point_id = ppt.id
    WHERE pp.user_id = p_user_id AND pp.promoter_status = 'active';

    IF v_promoter_record IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'NOT_PROMOTER',
            'message', 'User is not an active promoter'
        );
    END IF;

    -- 计算时间范围
    CASE p_time_range
        WHEN 'today' THEN 
            v_start_date := date_trunc('day', now());
            v_prev_start_date := v_start_date - INTERVAL '1 day';
        WHEN 'week' THEN 
            v_start_date := date_trunc('week', now());
            v_prev_start_date := v_start_date - INTERVAL '1 week';
        WHEN 'month' THEN 
            v_start_date := date_trunc('month', now());
            v_prev_start_date := v_start_date - INTERVAL '1 month';
        ELSE 
            v_start_date := date_trunc('day', now());
            v_prev_start_date := v_start_date - INTERVAL '1 day';
    END CASE;

    -- ========== 1. 我的业绩 ==========
    -- 【BUG修复】充值统计同时查询 deposits（用户自主充值）和 promoter_deposits（地推代充）
    WITH my_regs AS (
        SELECT COUNT(*) AS reg_count
        FROM users p
        WHERE p.referred_by_id = p_user_id
        AND p.created_at >= v_start_date
    ),
    my_prev_regs AS (
        SELECT COUNT(*) AS reg_count
        FROM users p
        WHERE p.referred_by_id = p_user_id
        AND p.created_at >= v_prev_start_date
        AND p.created_at < v_start_date
    ),
    -- 用户自主充值（通过推荐关系归因）
    deposit_charges AS (
        SELECT d.user_id, d.amount, d.created_at
        FROM deposits d
        JOIN users ref ON d.user_id = ref.id
        WHERE ref.referred_by_id = p_user_id
        AND d.status = 'APPROVED'
        AND d.created_at >= v_start_date
    ),
    -- 地推代充（推广者直接操作的充值）
    promoter_deposit_charges AS (
        SELECT pd.target_user_id AS user_id, pd.amount, pd.created_at
        FROM promoter_deposits pd
        WHERE pd.promoter_id = p_user_id
        AND pd.status = 'completed'
        AND pd.created_at >= v_start_date
    ),
    -- 合并当期充值
    my_charges AS (
        SELECT 
            COUNT(DISTINCT user_id) AS charge_count,
            COALESCE(SUM(amount), 0) AS charge_amount
        FROM (
            SELECT user_id, amount FROM deposit_charges
            UNION ALL
            SELECT user_id, amount FROM promoter_deposit_charges
        ) combined
    ),
    -- 用户自主充值（上期）
    prev_deposit_charges AS (
        SELECT d.user_id, d.amount
        FROM deposits d
        JOIN users ref ON d.user_id = ref.id
        WHERE ref.referred_by_id = p_user_id
        AND d.status = 'APPROVED'
        AND d.created_at >= v_prev_start_date
        AND d.created_at < v_start_date
    ),
    -- 地推代充（上期）
    prev_promoter_deposit_charges AS (
        SELECT pd.target_user_id AS user_id, pd.amount
        FROM promoter_deposits pd
        WHERE pd.promoter_id = p_user_id
        AND pd.status = 'completed'
        AND pd.created_at >= v_prev_start_date
        AND pd.created_at < v_start_date
    ),
    -- 合并上期充值
    my_prev_charges AS (
        SELECT 
            COUNT(DISTINCT user_id) AS charge_count,
            COALESCE(SUM(amount), 0) AS charge_amount
        FROM (
            SELECT user_id, amount FROM prev_deposit_charges
            UNION ALL
            SELECT user_id, amount FROM prev_promoter_deposit_charges
        ) combined
    ),
    my_commission AS (
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM commissions
        WHERE beneficiary_id = p_user_id
        AND created_at >= v_start_date
    )
    SELECT jsonb_build_object(
        'registrations', (SELECT reg_count FROM my_regs),
        'prev_registrations', (SELECT reg_count FROM my_prev_regs),
        'charges', (SELECT charge_count FROM my_charges),
        'charge_amount', (SELECT charge_amount FROM my_charges),
        'prev_charges', (SELECT charge_count FROM my_prev_charges),
        'prev_charge_amount', (SELECT charge_amount FROM my_prev_charges),
        'commission', (SELECT total FROM my_commission),
        'conversion_rate', CASE 
            WHEN (SELECT reg_count FROM my_regs) > 0 
            THEN ROUND((SELECT charge_count FROM my_charges)::numeric / (SELECT reg_count FROM my_regs) * 100, 1)
            ELSE 0 
        END
    ) INTO v_my_stats;

    -- ========== 2. 我的团队（一二三级下线） ==========
    WITH level1 AS (
        SELECT id, first_name, last_name, avatar_url, created_at
        FROM users
        WHERE referred_by_id = p_user_id
    ),
    level2 AS (
        SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.created_at
        FROM users u
        WHERE u.referred_by_id IN (SELECT id FROM level1)
    ),
    level3 AS (
        SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.created_at
        FROM users u
        WHERE u.referred_by_id IN (SELECT id FROM level2)
    )
    SELECT jsonb_build_object(
        'level1_count', (SELECT COUNT(*) FROM level1),
        'level2_count', (SELECT COUNT(*) FROM level2),
        'level3_count', (SELECT COUNT(*) FROM level3),
        'total_count', (SELECT COUNT(*) FROM level1) + (SELECT COUNT(*) FROM level2) + (SELECT COUNT(*) FROM level3),
        'recent_members', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', id,
                    'name', COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''),
                    'avatar_url', avatar_url,
                    'joined_at', created_at,
                    'level', 1
                ) ORDER BY created_at DESC
            ), '[]'::jsonb)
            FROM (SELECT * FROM level1 ORDER BY created_at DESC LIMIT 10) sub
        )
    ) INTO v_team_data;

    -- ========== 3. 排行榜（注册数前20） ==========
    WITH all_promoters AS (
        SELECT 
            pp.user_id,
            u.first_name,
            u.last_name,
            u.avatar_url,
            pt.name AS team_name,
            COUNT(ref.id) AS reg_count
        FROM promoter_profiles pp
        JOIN users u ON pp.user_id = u.id
        LEFT JOIN promoter_teams pt ON pp.team_id = pt.id
        LEFT JOIN users ref ON ref.referred_by_id = pp.user_id 
            AND ref.created_at >= v_start_date
        WHERE pp.promoter_status = 'active'
        GROUP BY pp.user_id, u.first_name, u.last_name, u.avatar_url, pt.name
        ORDER BY reg_count DESC
        LIMIT 20
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'user_id', user_id,
            'name', COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''),
            'avatar_url', avatar_url,
            'team_name', team_name,
            'registrations', reg_count,
            'is_me', user_id = p_user_id
        )
    ), '[]'::jsonb) INTO v_leaderboard
    FROM all_promoters;

    -- ========== 4. 今日打卡 ==========
    SELECT jsonb_build_object(
        'contact_count', COALESCE(pdl.contact_count, 0),
        'log_date', CURRENT_DATE,
        'has_logged', pdl.id IS NOT NULL
    ) INTO v_today_log
    FROM (SELECT 1) dummy
    LEFT JOIN promoter_daily_logs pdl 
        ON pdl.promoter_id = p_user_id 
        AND pdl.log_date = CURRENT_DATE;

    -- ========== 组装返回结果 ==========
    RETURN jsonb_build_object(
        'success', true,
        'promoter', jsonb_build_object(
            'user_id', v_promoter_record.user_id,
            'team_name', v_promoter_record.team_name,
            'point_name', v_promoter_record.point_name,
            'hire_date', v_promoter_record.hire_date,
            'daily_base_salary', v_promoter_record.base_salary
        ),
        'my_stats', v_my_stats,
        'team', v_team_data,
        'leaderboard', v_leaderboard,
        'today_log', v_today_log,
        'time_range', p_time_range
    );
END;
$$;

-- 确保权限正确
GRANT EXECUTE ON FUNCTION get_promoter_center_data(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_promoter_center_data(TEXT, TEXT) TO service_role;
