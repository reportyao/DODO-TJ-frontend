-- ============================================================
-- 修复 admin_mutate: 
--   [P2] 新增 p_or_filters 参数支持 OR 条件（与 admin_query 对齐）
--   [P4] 补充 users、promoter_daily_logs 到写入白名单
--   [P6] DROP 旧的 6 参数签名，避免 PostgreSQL 函数重载冲突
--
-- 根因分析:
--   admin_query 和 admin_count 都支持 p_or_filters 参数，
--   但 admin_mutate 遗漏了该参数，导致代理层传递的 OR 条件
--   在写操作中完全丢失。
--   
--   核销页面使用 .update().or('pickup_status.in.(...)') 来防止
--   并发重复核销，但 OR 条件丢失后，该防护完全失效。
--
--   [P6] PostgreSQL CREATE OR REPLACE 只替换参数类型列表完全匹配的函数。
--   旧签名 (TEXT,TEXT,TEXT,JSONB,JSONB,TEXT) 与新签名 (TEXT,TEXT,TEXT,JSONB,JSONB,TEXT,TEXT)
--   类型数量不同，会创建重载函数而非替换，导致调用时 "function is not unique" 错误。
-- ============================================================

-- [修复 P6] 先删除旧的 6 参数签名函数，避免重载冲突
DROP FUNCTION IF EXISTS public.admin_mutate(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.admin_mutate(
  p_session_token TEXT,
  p_action TEXT,        -- 'insert', 'update', 'delete', 'upsert'
  p_table TEXT,
  p_data JSONB DEFAULT NULL,
  p_filters JSONB DEFAULT '[]'::JSONB,
  p_on_conflict TEXT DEFAULT NULL,  -- upsert 时的冲突列
  p_or_filters TEXT DEFAULT NULL    -- [修复 P2] OR 条件（与 admin_query 对齐）
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    'users',                -- [修复 P4] 管理后台需要封禁/修改用户等级
    'promoter_daily_logs'   -- [修复 P4] 推广员日志 upsert
  ];
  v_cols TEXT := '';
  v_vals TEXT := '';
  v_sets TEXT := '';
  v_key TEXT;
  v_val_type TEXT;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不允许写入表 %', p_table;
  END IF;

  IF p_action = 'insert' THEN
    -- 构建 INSERT
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_cols != '' THEN v_cols := v_cols || ', '; v_vals := v_vals || ', '; END IF;
      v_cols := v_cols || quote_ident(v_key);
      v_val_type := jsonb_typeof(p_data->v_key);
      IF v_val_type = 'null' OR (p_data->v_key) IS NULL THEN
        v_vals := v_vals || 'NULL';
      ELSIF v_val_type = 'object' OR v_val_type = 'array' THEN
        v_vals := v_vals || quote_literal((p_data->v_key)::TEXT) || '::JSONB';
      ELSE
        v_vals := v_vals || quote_literal(p_data->>v_key);
      END IF;
    END LOOP;
    v_sql := format('INSERT INTO %I (%s) VALUES (%s) RETURNING row_to_json(%I.*)', p_table, v_cols, v_vals, p_table);

  ELSIF p_action = 'upsert' THEN
    -- 构建 UPSERT (INSERT ... ON CONFLICT ... DO UPDATE)
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_cols != '' THEN v_cols := v_cols || ', '; v_vals := v_vals || ', '; END IF;
      v_cols := v_cols || quote_ident(v_key);
      v_val_type := jsonb_typeof(p_data->v_key);
      IF v_val_type = 'null' OR (p_data->v_key) IS NULL THEN
        v_vals := v_vals || 'NULL';
      ELSIF v_val_type = 'object' OR v_val_type = 'array' THEN
        v_vals := v_vals || quote_literal((p_data->v_key)::TEXT) || '::JSONB';
      ELSE
        v_vals := v_vals || quote_literal(p_data->>v_key);
      END IF;
    END LOOP;

    -- 构建 ON CONFLICT DO UPDATE SET
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF p_on_conflict IS NOT NULL AND v_key = p_on_conflict THEN CONTINUE; END IF;
      IF v_sets != '' THEN v_sets := v_sets || ', '; END IF;
      v_val_type := jsonb_typeof(p_data->v_key);
      IF v_val_type = 'null' OR (p_data->v_key) IS NULL THEN
        v_sets := v_sets || format('%I = NULL', v_key);
      ELSIF v_val_type = 'object' OR v_val_type = 'array' THEN
        v_sets := v_sets || format('%I = %s::JSONB', v_key, quote_literal((p_data->v_key)::TEXT));
      ELSE
        v_sets := v_sets || format('%I = %L', v_key, p_data->>v_key);
      END IF;
    END LOOP;

    IF p_on_conflict IS NOT NULL AND p_on_conflict != '' THEN
      v_sql := format('INSERT INTO %I (%s) VALUES (%s) ON CONFLICT (%I) DO UPDATE SET %s RETURNING row_to_json(%I.*)',
        p_table, v_cols, v_vals, p_on_conflict, v_sets, p_table);
    ELSE
      v_sql := format('INSERT INTO %I (%s) VALUES (%s) RETURNING row_to_json(%I.*)', p_table, v_cols, v_vals, p_table);
    END IF;

  ELSIF p_action = 'update' THEN
    -- 构建 UPDATE
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_sets != '' THEN v_sets := v_sets || ', '; END IF;
      v_val_type := jsonb_typeof(p_data->v_key);
      IF v_val_type = 'null' OR (p_data->v_key) IS NULL THEN
        v_sets := v_sets || format('%I = NULL', v_key);
      ELSIF v_val_type = 'object' OR v_val_type = 'array' THEN
        v_sets := v_sets || format('%I = %s::JSONB', v_key, quote_literal((p_data->v_key)::TEXT));
      ELSE
        v_sets := v_sets || format('%I = %L', v_key, p_data->>v_key);
      END IF;
    END LOOP;
    v_sql := format('UPDATE %I SET %s', p_table, v_sets);

    -- 必须有过滤条件（AND 或 OR 至少有一个）
    IF jsonb_array_length(p_filters) = 0 AND (p_or_filters IS NULL OR p_or_filters = '') THEN
      RAISE EXCEPTION 'FORBIDDEN: UPDATE 操作必须指定过滤条件';
    END IF;

    v_sql := v_sql || ' WHERE true';
    FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
    LOOP
      v_sql := v_sql || _admin_build_filter_clause(v_filter);
    END LOOP;

    -- [修复 P2] 应用 OR 条件
    IF p_or_filters IS NOT NULL AND p_or_filters != '' THEN
      v_sql := v_sql || ' AND (' || _admin_parse_or_filter(p_or_filters) || ')';
    END IF;

    v_sql := v_sql || format(' RETURNING row_to_json(%I.*)', p_table);

  ELSIF p_action = 'delete' THEN
    -- 构建 DELETE
    IF jsonb_array_length(p_filters) = 0 AND (p_or_filters IS NULL OR p_or_filters = '') THEN
      RAISE EXCEPTION 'FORBIDDEN: DELETE 操作必须指定过滤条件';
    END IF;

    v_sql := format('DELETE FROM %I WHERE true', p_table);
    FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
    LOOP
      v_sql := v_sql || _admin_build_filter_clause(v_filter);
    END LOOP;

    -- [修复 P2] 应用 OR 条件
    IF p_or_filters IS NOT NULL AND p_or_filters != '' THEN
      v_sql := v_sql || ' AND (' || _admin_parse_or_filter(p_or_filters) || ')';
    END IF;

    v_sql := v_sql || format(' RETURNING row_to_json(%I.*)', p_table);
  ELSE
    RAISE EXCEPTION 'INVALID_ACTION: 不支持的操作 %', p_action;
  END IF;

  -- 执行并返回结果
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
$$;

-- 确保权限
GRANT EXECUTE ON FUNCTION public.admin_mutate(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_mutate(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT) TO authenticated;
