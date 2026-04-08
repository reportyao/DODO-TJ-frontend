-- ============================================================================
-- DODO 首页场景化改造 · 阶段 1 · 更新 admin_query / admin_mutate 白名单
-- 日期: 2026-04-08
-- 说明: 将新增的 10 张表加入 admin_query 和 admin_mutate 的白名单
-- ============================================================================

-- ============================================================================
-- 1. 更新 admin_query 白名单
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_query(
    p_session_token text,
    p_table text,
    p_select text DEFAULT '*'::text,
    p_filters jsonb DEFAULT '[]'::jsonb,
    p_order_by text DEFAULT NULL::text,
    p_order_asc boolean DEFAULT false,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT NULL::integer,
    p_or_filters text DEFAULT NULL::text,
    p_head boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_sql TEXT;
  v_result JSON;
  v_filter JSONB;
  v_count BIGINT;
  v_allowed_tables TEXT[] := ARRAY[
    'users', 'admin_users', 'lotteries', 'lottery_entries', 'lottery_results',
    'orders', 'full_purchase_orders', 'prizes', 'deposit_requests', 'withdrawal_requests',
    'wallet_transactions', 'wallets', 'commissions', 'commission_settings',
    'banners', 'showoffs', 'showoff_likes', 'showoff_comments',
    'resales', 'draw_algorithms', 'draw_logs', 'payment_config',
    'system_config', 'admin_audit_logs', 'edge_function_logs', 'error_logs',
    'notification_queue', 'notifications', 'role_permissions',
    'shipment_batches', 'batch_order_items', 'shipping', 'shipping_history',
    'pickup_points', 'pickup_logs', 'pickup_staff_profiles',
    'promoter_profiles', 'promoter_teams', 'promoter_daily_logs',
    'promotion_points', 'managed_invite_codes', 'promoter_deposits',
    'group_buy_products', 'group_buy_sessions', 'group_buy_orders', 'group_buy_results',
    'inventory_products', 'inventory_transactions',
    'ai_chat_history', 'user_sessions', 'market_listings',
    'admin_sessions',
    -- ▼ 首页场景化改造新增表 ▼
    'homepage_categories', 'homepage_tags',
    'product_categories', 'product_tags',
    'homepage_topics', 'topic_products', 'topic_placements',
    'user_behavior_events', 'ai_topic_generation_tasks',
    'localization_lexicon'
  ];
BEGIN
  -- 验证管理员身份
  v_admin_id := verify_admin_session(p_session_token);

  -- 白名单校验表名
  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不允许访问表 %', p_table;
  END IF;

  -- 验证 p_select 只包含合法字符（防止 SQL 注入）
  IF p_select !~ '^[a-zA-Z0-9_,\*\s]+$' THEN
    RAISE EXCEPTION 'INVALID_SELECT: select 参数包含非法字符';
  END IF;

  -- 如果是 head:true 模式，只返回 count
  IF p_head THEN
    v_sql := format('SELECT COUNT(*) FROM %I', p_table);

    IF jsonb_array_length(p_filters) > 0 THEN
      v_sql := v_sql || ' WHERE true';
      FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
      LOOP
        v_sql := v_sql || _admin_build_filter_clause(v_filter);
      END LOOP;
    END IF;

    IF p_or_filters IS NOT NULL AND p_or_filters != '' THEN
      IF jsonb_array_length(p_filters) = 0 THEN
        v_sql := v_sql || ' WHERE (' || _admin_parse_or_filter(p_or_filters) || ')';
      ELSE
        v_sql := v_sql || ' AND (' || _admin_parse_or_filter(p_or_filters) || ')';
      END IF;
    END IF;

    EXECUTE v_sql INTO v_count;
    RETURN json_build_object('count', v_count, 'data', '[]'::JSON);
  END IF;

  -- 构建动态 SQL（普通查询）
  v_sql := format('SELECT COALESCE(json_agg(t), ''[]''::JSON) FROM (SELECT %s FROM %I', p_select, p_table);

  IF jsonb_array_length(p_filters) > 0 OR (p_or_filters IS NOT NULL AND p_or_filters != '') THEN
    v_sql := v_sql || ' WHERE true';
    IF jsonb_array_length(p_filters) > 0 THEN
      FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
      LOOP
        v_sql := v_sql || _admin_build_filter_clause(v_filter);
      END LOOP;
    END IF;

    IF p_or_filters IS NOT NULL AND p_or_filters != '' THEN
      v_sql := v_sql || ' AND (' || _admin_parse_or_filter(p_or_filters) || ')';
    END IF;
  END IF;

  -- 排序
  IF p_order_by IS NOT NULL THEN
    v_sql := v_sql || format(' ORDER BY %I %s', p_order_by, CASE WHEN p_order_asc THEN 'ASC' ELSE 'DESC' END);
  END IF;

  -- 分页
  IF p_limit IS NOT NULL THEN
    v_sql := v_sql || format(' LIMIT %s', p_limit);
  END IF;
  IF p_offset IS NOT NULL THEN
    v_sql := v_sql || format(' OFFSET %s', p_offset);
  END IF;

  v_sql := v_sql || ') t';

  EXECUTE v_sql INTO v_result;

  RETURN v_result;
END;
$function$;

-- ============================================================================
-- 2. 更新 admin_mutate 白名单
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_mutate(
    p_session_token text,
    p_action text,
    p_table text,
    p_data jsonb DEFAULT NULL::jsonb,
    p_filters jsonb DEFAULT '[]'::jsonb,
    p_on_conflict text DEFAULT NULL::text,
    p_or_filters text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_sql TEXT;
  v_result JSON;
  v_filter JSONB;
  v_allowed_tables TEXT[] := ARRAY[
    'admin_users', 'lotteries', 'lottery_entries',
    'orders', 'full_purchase_orders', 'prizes', 'deposit_requests', 'withdrawal_requests',
    'banners', 'showoffs', 'resales', 'draw_algorithms', 'payment_config',
    'system_config', 'admin_audit_logs', 'role_permissions',
    'shipment_batches', 'batch_order_items', 'shipping',
    'pickup_points', 'pickup_logs', 'pickup_staff_profiles',
    'promoter_profiles', 'promoter_teams',
    'promotion_points', 'managed_invite_codes',
    'group_buy_products', 'group_buy_sessions',
    'inventory_products', 'inventory_transactions',
    'commission_settings', 'error_logs',
    'commissions', 'wallets', 'wallet_transactions',
    'promoter_deposits',
    'users',
    'promoter_daily_logs',
    -- ▼ 首页场景化改造新增表 ▼
    'homepage_categories', 'homepage_tags',
    'product_categories', 'product_tags',
    'homepage_topics', 'topic_products', 'topic_placements',
    'ai_topic_generation_tasks',
    'localization_lexicon'
  ];
  v_cols TEXT := '';
  v_vals TEXT := '';
  v_sets TEXT := '';
  v_key TEXT;
  v_conflict_cols TEXT[];
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不允许写入表 %', p_table;
  END IF;

  -- 将 p_on_conflict 拆分为数组，用于排除冲突列
  IF p_on_conflict IS NOT NULL AND p_on_conflict != '' THEN
    v_conflict_cols := string_to_array(p_on_conflict, ',');
    FOR i IN 1..array_length(v_conflict_cols, 1)
    LOOP
      v_conflict_cols[i] := trim(v_conflict_cols[i]);
    END LOOP;
  ELSE
    v_conflict_cols := ARRAY[]::TEXT[];
  END IF;

  IF p_action = 'insert' THEN
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_cols != '' THEN v_cols := v_cols || ', '; v_vals := v_vals || ', '; END IF;
      v_cols := v_cols || quote_ident(v_key);
      v_vals := v_vals || _admin_build_value_expr(p_table, v_key, p_data);
    END LOOP;
    v_sql := format('INSERT INTO %I (%s) VALUES (%s) RETURNING row_to_json(%I.*)', p_table, v_cols, v_vals, p_table);

  ELSIF p_action = 'upsert' THEN
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_cols != '' THEN v_cols := v_cols || ', '; v_vals := v_vals || ', '; END IF;
      v_cols := v_cols || quote_ident(v_key);
      v_vals := v_vals || _admin_build_value_expr(p_table, v_key, p_data);
    END LOOP;

    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_key = ANY(v_conflict_cols) THEN CONTINUE; END IF;
      IF v_sets != '' THEN v_sets := v_sets || ', '; END IF;
      v_sets := v_sets || format('%I = %s', v_key, _admin_build_value_expr(p_table, v_key, p_data));
    END LOOP;

    IF p_on_conflict IS NOT NULL AND p_on_conflict != '' THEN
      v_sql := format('INSERT INTO %I (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s RETURNING row_to_json(%I.*)',
        p_table, v_cols, v_vals, _admin_quote_conflict_cols(p_on_conflict), v_sets, p_table);
    ELSE
      v_sql := format('INSERT INTO %I (%s) VALUES (%s) RETURNING row_to_json(%I.*)', p_table, v_cols, v_vals, p_table);
    END IF;

  ELSIF p_action = 'update' THEN
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_sets != '' THEN v_sets := v_sets || ', '; END IF;
      v_sets := v_sets || format('%I = %s', v_key, _admin_build_value_expr(p_table, v_key, p_data));
    END LOOP;
    v_sql := format('UPDATE %I SET %s', p_table, v_sets);

    IF jsonb_array_length(p_filters) = 0 AND (p_or_filters IS NULL OR p_or_filters = '') THEN
      RAISE EXCEPTION 'FORBIDDEN: UPDATE 操作必须指定过滤条件';
    END IF;

    v_sql := v_sql || ' WHERE true';
    FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
    LOOP
      v_sql := v_sql || _admin_build_filter_clause(v_filter);
    END LOOP;

    IF p_or_filters IS NOT NULL AND p_or_filters != '' THEN
      v_sql := v_sql || ' AND (' || _admin_parse_or_filter(p_or_filters) || ')';
    END IF;

    v_sql := v_sql || format(' RETURNING row_to_json(%I.*)', p_table);

  ELSIF p_action = 'delete' THEN
    IF jsonb_array_length(p_filters) = 0 AND (p_or_filters IS NULL OR p_or_filters = '') THEN
      RAISE EXCEPTION 'FORBIDDEN: DELETE 操作必须指定过滤条件';
    END IF;

    v_sql := format('DELETE FROM %I WHERE true', p_table);
    FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
    LOOP
      v_sql := v_sql || _admin_build_filter_clause(v_filter);
    END LOOP;

    IF p_or_filters IS NOT NULL AND p_or_filters != '' THEN
      v_sql := v_sql || ' AND (' || _admin_parse_or_filter(p_or_filters) || ')';
    END IF;

    v_sql := v_sql || format(' RETURNING row_to_json(%I.*)', p_table);
  ELSE
    RAISE EXCEPTION 'INVALID_ACTION: 不支持的操作 %', p_action;
  END IF;

  EXECUTE v_sql INTO v_result;

  -- 记录审计日志
  INSERT INTO admin_audit_logs (admin_id, action, target_type, details)
  VALUES (v_admin_id, 'admin_mutate_' || p_action, p_table,
    jsonb_build_object('filters', p_filters, 'data_keys',
      CASE WHEN p_data IS NOT NULL THEN (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_data) k) ELSE '[]'::JSONB END
    )
  );

  RETURN COALESCE(v_result, '{}'::JSON);
END;
$function$;
