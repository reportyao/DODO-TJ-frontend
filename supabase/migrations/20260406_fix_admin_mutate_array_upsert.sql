-- ============================================================
-- 修复 admin_mutate:
--   [F1] TEXT[] 数组类型 vs JSONB 类型不兼容
--        当 p_data 包含 JS 数组（如 image_urls: ["url1","url2"]）时，
--        原代码强制加 ::JSONB 转换，但 image_urls 等列的实际类型是 TEXT[]，
--        导致 "column is of type text[] but expression is of type jsonb" 错误。
--        修复：查询 information_schema 获取列的实际类型，
--        TEXT[] 列使用 ARRAY 构造器，JSONB 列保持 ::JSONB 转换。
--
--   [F2] 多列 onConflict 在 upsert 中被 %I 错误引用
--        format('ON CONFLICT (%I)', 'promoter_id,log_date') 生成
--        ON CONFLICT ("promoter_id,log_date") 而非 ON CONFLICT (promoter_id, log_date)。
--        修复：将逗号分隔的列名拆分后逐个 quote_ident 再拼接。
--
--   [F3] upsert DO UPDATE SET 排除冲突列逻辑不完整
--        当 p_on_conflict 是多列时，v_key = p_on_conflict 永远不匹配。
--        修复：将 p_on_conflict 拆分为数组，检查 v_key 是否在数组中。
-- ============================================================

-- 先删除旧签名（7 参数版本）
DROP FUNCTION IF EXISTS public.admin_mutate(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT);
-- 也删除旧的 6 参数版本（以防残留）
DROP FUNCTION IF EXISTS public.admin_mutate(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT);

-- 内部辅助函数：构建值表达式（根据列的实际类型选择转换方式）
CREATE OR REPLACE FUNCTION _admin_build_value_expr(
  p_table TEXT,
  p_key TEXT,
  p_data JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_val_type TEXT;
  v_col_data_type TEXT;
  v_elem JSONB;
  v_arr_literal TEXT := '';
BEGIN
  v_val_type := jsonb_typeof(p_data->p_key);

  -- NULL 值
  IF v_val_type = 'null' OR (p_data->p_key) IS NULL THEN
    RETURN 'NULL';
  END IF;

  -- 非 object/array：直接用 quote_literal
  IF v_val_type != 'object' AND v_val_type != 'array' THEN
    RETURN quote_literal(p_data->>p_key);
  END IF;

  -- object 类型：始终是 JSONB
  IF v_val_type = 'object' THEN
    RETURN quote_literal((p_data->p_key)::TEXT) || '::JSONB';
  END IF;

  -- array 类型：需要区分 JSONB 列和 TEXT[] 列
  -- 查询目标列的实际数据类型
  SELECT data_type INTO v_col_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = p_table
    AND column_name = p_key;

  IF v_col_data_type = 'ARRAY' THEN
    -- TEXT[] 类型：将 JSON array 转为 PostgreSQL ARRAY 构造器
    -- ["url1","url2"] → ARRAY['url1','url2']::TEXT[]
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_data->p_key)
    LOOP
      IF v_arr_literal != '' THEN
        v_arr_literal := v_arr_literal || ', ';
      END IF;
      -- 每个元素用 quote_literal 防注入
      IF jsonb_typeof(v_elem) = 'null' THEN
        v_arr_literal := v_arr_literal || 'NULL';
      ELSE
        v_arr_literal := v_arr_literal || quote_literal(v_elem #>> '{}');
      END IF;
    END LOOP;
    RETURN 'ARRAY[' || v_arr_literal || ']::TEXT[]';
  ELSE
    -- JSONB 列或未知列：使用 ::JSONB 转换
    RETURN quote_literal((p_data->p_key)::TEXT) || '::JSONB';
  END IF;
END;
$$;

-- 内部辅助函数：将逗号分隔的列名转为安全引用的列名列表
-- 'promoter_id,log_date' → '"promoter_id", "log_date"'
CREATE OR REPLACE FUNCTION _admin_quote_conflict_cols(p_cols TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts TEXT[];
  v_result TEXT := '';
  v_part TEXT;
BEGIN
  v_parts := string_to_array(p_cols, ',');
  FOREACH v_part IN ARRAY v_parts
  LOOP
    IF v_result != '' THEN
      v_result := v_result || ', ';
    END IF;
    v_result := v_result || quote_ident(trim(v_part));
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mutate(
  p_session_token TEXT,
  p_action TEXT,        -- 'insert', 'update', 'delete', 'upsert'
  p_table TEXT,
  p_data JSONB DEFAULT NULL,
  p_filters JSONB DEFAULT '[]'::JSONB,
  p_on_conflict TEXT DEFAULT NULL,  -- upsert 时的冲突列（支持逗号分隔多列）
  p_or_filters TEXT DEFAULT NULL    -- OR 条件
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
    'users',
    'promoter_daily_logs'
  ];
  v_cols TEXT := '';
  v_vals TEXT := '';
  v_sets TEXT := '';
  v_key TEXT;
  v_conflict_cols TEXT[];  -- [F3] 冲突列数组
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不允许写入表 %', p_table;
  END IF;

  -- [F3] 将 p_on_conflict 拆分为数组，用于排除冲突列
  IF p_on_conflict IS NOT NULL AND p_on_conflict != '' THEN
    v_conflict_cols := string_to_array(p_on_conflict, ',');
    -- 去除空格
    FOR i IN 1..array_length(v_conflict_cols, 1)
    LOOP
      v_conflict_cols[i] := trim(v_conflict_cols[i]);
    END LOOP;
  ELSE
    v_conflict_cols := ARRAY[]::TEXT[];
  END IF;

  IF p_action = 'insert' THEN
    -- 构建 INSERT
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_cols != '' THEN v_cols := v_cols || ', '; v_vals := v_vals || ', '; END IF;
      v_cols := v_cols || quote_ident(v_key);
      -- [F1] 使用辅助函数构建值表达式（自动区分 JSONB 和 TEXT[]）
      v_vals := v_vals || _admin_build_value_expr(p_table, v_key, p_data);
    END LOOP;
    v_sql := format('INSERT INTO %I (%s) VALUES (%s) RETURNING row_to_json(%I.*)', p_table, v_cols, v_vals, p_table);

  ELSIF p_action = 'upsert' THEN
    -- 构建 UPSERT (INSERT ... ON CONFLICT ... DO UPDATE)
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_cols != '' THEN v_cols := v_cols || ', '; v_vals := v_vals || ', '; END IF;
      v_cols := v_cols || quote_ident(v_key);
      -- [F1] 使用辅助函数
      v_vals := v_vals || _admin_build_value_expr(p_table, v_key, p_data);
    END LOOP;

    -- 构建 ON CONFLICT DO UPDATE SET
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      -- [F3] 检查 v_key 是否在冲突列数组中（支持多列）
      IF v_key = ANY(v_conflict_cols) THEN CONTINUE; END IF;
      IF v_sets != '' THEN v_sets := v_sets || ', '; END IF;
      -- [F1] 使用辅助函数
      v_sets := v_sets || format('%I = %s', v_key, _admin_build_value_expr(p_table, v_key, p_data));
    END LOOP;

    IF p_on_conflict IS NOT NULL AND p_on_conflict != '' THEN
      -- [F2] 使用辅助函数安全引用多列冲突列名
      v_sql := format('INSERT INTO %I (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s RETURNING row_to_json(%I.*)',
        p_table, v_cols, v_vals, _admin_quote_conflict_cols(p_on_conflict), v_sets, p_table);
    ELSE
      v_sql := format('INSERT INTO %I (%s) VALUES (%s) RETURNING row_to_json(%I.*)', p_table, v_cols, v_vals, p_table);
    END IF;

  ELSIF p_action = 'update' THEN
    -- 构建 UPDATE
    FOR v_key IN SELECT jsonb_object_keys(p_data)
    LOOP
      IF v_sets != '' THEN v_sets := v_sets || ', '; END IF;
      -- [F1] 使用辅助函数
      v_sets := v_sets || format('%I = %s', v_key, _admin_build_value_expr(p_table, v_key, p_data));
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

    -- 应用 OR 条件
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

    -- 应用 OR 条件
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
GRANT EXECUTE ON FUNCTION public._admin_build_value_expr(TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public._admin_build_value_expr(TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public._admin_quote_conflict_cols(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public._admin_quote_conflict_cols(TEXT) TO authenticated;
