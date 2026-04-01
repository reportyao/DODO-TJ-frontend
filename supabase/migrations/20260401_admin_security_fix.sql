-- ============================================================
-- 管理后台安全修复迁移
-- 日期: 2026-04-01
-- 目标: 消除前端 Service Role Key 泄露风险
-- 
-- 方案:
--   1. 管理后台改用 anon key，所有操作通过 RPC 函数执行
--   2. RPC 函数使用 SECURITY DEFINER 以 service_role 权限运行
--   3. RPC 内部通过 admin_session_token 验证管理员身份
--   4. 管理员登录后获得 session token，存储在 admin_sessions 表中
-- ============================================================

-- ============================================================
-- 1. 创建管理员会话表
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token 
  ON public.admin_sessions (session_token) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id 
  ON public.admin_sessions (admin_id) WHERE is_active = true;

-- RLS: 禁止 anon 角色直接访问 admin_sessions 表
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_sessions_deny_all ON public.admin_sessions;
CREATE POLICY admin_sessions_deny_all ON public.admin_sessions
  FOR ALL TO anon USING (false);

-- ============================================================
-- 2. 内部辅助函数：验证管理员 session token
--    返回 admin_id，如果无效则抛出异常
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_admin_session(p_session_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_admin_status TEXT;
BEGIN
  -- 查找有效的 session
  SELECT s.admin_id INTO v_admin_id
  FROM admin_sessions s
  WHERE s.session_token = p_session_token
    AND s.is_active = true
    AND s.expires_at > now();

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AUTH_FAILED: 会话无效或已过期';
  END IF;

  -- 验证管理员账户状态
  SELECT status INTO v_admin_status
  FROM admin_users
  WHERE id = v_admin_id;

  IF v_admin_status IS NULL OR v_admin_status != 'active' THEN
    RAISE EXCEPTION 'ADMIN_AUTH_FAILED: 管理员账户已被禁用';
  END IF;

  RETURN v_admin_id;
END;
$$;

-- ============================================================
-- 3. 管理员登录 RPC
--    验证用户名和密码哈希，创建 session，返回管理员信息
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_login(
  p_username TEXT,
  p_password_hash TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
  v_session_token TEXT;
  v_new_attempts INT;
  v_max_attempts INT := 5;
  v_lockout_minutes INT := 15;
  v_result JSON;
BEGIN
  -- 查询管理员账户
  SELECT * INTO v_admin
  FROM admin_users
  WHERE username = p_username;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'LOGIN_FAILED: 用户名或密码错误';
  END IF;

  IF v_admin.status != 'active' THEN
    RAISE EXCEPTION 'LOGIN_FAILED: 账户已被禁用';
  END IF;

  -- 检查锁定状态
  IF v_admin.locked_until IS NOT NULL AND v_admin.locked_until > now() THEN
    RAISE EXCEPTION 'LOGIN_LOCKED: 账户已被临时锁定，请 % 分钟后再试',
      CEIL(EXTRACT(EPOCH FROM (v_admin.locked_until - now())) / 60)::INT;
  END IF;

  -- 校验密码
  IF v_admin.password_hash IS NULL OR v_admin.password_hash != p_password_hash THEN
    -- 密码错误：增加失败计数
    v_new_attempts := COALESCE(v_admin.failed_login_attempts, 0) + 1;

    IF v_new_attempts >= v_max_attempts THEN
      -- 锁定账户
      UPDATE admin_users SET
        failed_login_attempts = 0,
        locked_until = now() + (v_lockout_minutes || ' minutes')::INTERVAL
      WHERE id = v_admin.id;
      RAISE EXCEPTION 'LOGIN_LOCKED: 密码错误次数过多，账户已被锁定 % 分钟', v_lockout_minutes;
    ELSE
      UPDATE admin_users SET
        failed_login_attempts = v_new_attempts
      WHERE id = v_admin.id;
      RAISE EXCEPTION 'LOGIN_FAILED: 用户名或密码错误，还剩 % 次尝试机会', (v_max_attempts - v_new_attempts);
    END IF;
  END IF;

  -- 登录成功：重置失败计数
  UPDATE admin_users SET
    last_login_at = now(),
    failed_login_attempts = 0,
    locked_until = NULL
  WHERE id = v_admin.id;

  -- 创建 session
  INSERT INTO admin_sessions (admin_id)
  VALUES (v_admin.id)
  RETURNING session_token INTO v_session_token;

  -- 记录审计日志
  INSERT INTO admin_audit_logs (admin_id, action)
  VALUES (v_admin.id, 'login');

  -- 返回管理员信息和 session token
  SELECT json_build_object(
    'session_token', v_session_token,
    'admin', json_build_object(
      'id', v_admin.id,
      'username', v_admin.username,
      'display_name', v_admin.display_name,
      'role', v_admin.role,
      'status', v_admin.status
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4. 管理员登出 RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_logout(p_session_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  -- 使当前 session 失效
  UPDATE admin_sessions SET is_active = false
  WHERE session_token = p_session_token;

  -- 记录审计日志
  INSERT INTO admin_audit_logs (admin_id, action)
  VALUES (v_admin_id, 'logout');

  RETURN json_build_object('success', true);
END;
$$;

-- ============================================================
-- 5. 获取管理员权限 RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_permissions(p_session_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_role TEXT;
  v_permissions JSONB;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT role INTO v_role FROM admin_users WHERE id = v_admin_id;

  SELECT rp.permissions INTO v_permissions
  FROM role_permissions rp
  WHERE rp.role = v_role;

  RETURN json_build_object(
    'role', v_role,
    'permissions', COALESCE(v_permissions, '[]'::JSONB)
  );
END;
$$;

-- ============================================================
-- 6. 通用管理后台查询 RPC
--    支持管理后台对白名单内表的 SELECT 操作
--    [修复 S1] p_select 增加合法字符验证，防止 SQL 注入
--    [修复 X1] 新增 p_or_filters 支持 OR 条件
--    [修复 X3] 新增 p_head 参数支持 head:true 模式
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_query(
  p_session_token TEXT,
  p_table TEXT,
  p_select TEXT DEFAULT '*',
  p_filters JSONB DEFAULT '[]'::JSONB,
  p_order_by TEXT DEFAULT NULL,
  p_order_asc BOOLEAN DEFAULT false,
  p_limit INT DEFAULT NULL,
  p_offset INT DEFAULT NULL,
  p_or_filters TEXT DEFAULT NULL,
  p_head BOOLEAN DEFAULT false
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
    'admin_sessions'
  ];
BEGIN
  -- 验证管理员身份
  v_admin_id := verify_admin_session(p_session_token);

  -- 白名单校验表名
  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不允许访问表 %', p_table;
  END IF;

  -- [修复 S1] 验证 p_select 只包含合法字符（防止 SQL 注入）
  -- 允许: 字母、数字、下划线、逗号、星号、空格
  -- 禁止: 括号、冒号、感叹号、点号等（关联查询已在前端 proxy 层处理，不会传到 SQL 层）
  IF p_select !~ '^[a-zA-Z0-9_,\*\s]+$' THEN
    RAISE EXCEPTION 'INVALID_SELECT: select 参数包含非法字符';
  END IF;

  -- 如果是 head:true 模式，只返回 count
  IF p_head THEN
    v_sql := format('SELECT COUNT(*) FROM %I', p_table);

    -- 应用过滤条件
    IF jsonb_array_length(p_filters) > 0 THEN
      v_sql := v_sql || ' WHERE true';
      FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
      LOOP
        v_sql := v_sql || _admin_build_filter_clause(v_filter);
      END LOOP;
    END IF;

    -- 应用 OR 条件
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

  -- 应用过滤条件
  IF jsonb_array_length(p_filters) > 0 OR (p_or_filters IS NOT NULL AND p_or_filters != '') THEN
    v_sql := v_sql || ' WHERE true';
    IF jsonb_array_length(p_filters) > 0 THEN
      FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
      LOOP
        v_sql := v_sql || _admin_build_filter_clause(v_filter);
      END LOOP;
    END IF;

    -- 应用 OR 条件
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

  -- 执行查询
  EXECUTE v_sql INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 6.1 内部辅助函数：构建单个过滤条件子句
-- ============================================================
CREATE OR REPLACE FUNCTION public._admin_build_filter_clause(v_filter JSONB)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col TEXT;
  v_op TEXT;
  v_val TEXT;
  v_vals TEXT[];
  v_in_clause TEXT;
  v_item TEXT;
BEGIN
  v_col := v_filter->>'col';
  v_op := v_filter->>'op';
  v_val := v_filter->>'val';

  -- 验证列名合法性
  IF v_col !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'INVALID_FILTER: 非法列名 %', v_col;
  END IF;

  CASE v_op
    WHEN 'eq' THEN
      RETURN format(' AND %I = %L', v_col, v_val);
    WHEN 'neq' THEN
      RETURN format(' AND %I != %L', v_col, v_val);
    WHEN 'gt' THEN
      RETURN format(' AND %I > %L', v_col, v_val);
    WHEN 'gte' THEN
      RETURN format(' AND %I >= %L', v_col, v_val);
    WHEN 'lt' THEN
      RETURN format(' AND %I < %L', v_col, v_val);
    WHEN 'lte' THEN
      RETURN format(' AND %I <= %L', v_col, v_val);
    WHEN 'like' THEN
      RETURN format(' AND %I LIKE %L', v_col, v_val);
    WHEN 'ilike' THEN
      RETURN format(' AND %I ILIKE %L', v_col, v_val);
    WHEN 'is_null' THEN
      RETURN format(' AND %I IS NULL', v_col);
    WHEN 'is_not_null' THEN
      RETURN format(' AND %I IS NOT NULL', v_col);
    WHEN 'in' THEN
      -- [修复 X1] 支持 IN 操作符
      -- val 是逗号分隔的值列表
      v_vals := string_to_array(v_val, ',');
      v_in_clause := '';
      FOREACH v_item IN ARRAY v_vals
      LOOP
        IF v_in_clause != '' THEN v_in_clause := v_in_clause || ','; END IF;
        v_in_clause := v_in_clause || quote_literal(trim(v_item));
      END LOOP;
      RETURN format(' AND %I IN (%s)', v_col, v_in_clause);
    ELSE
      RAISE EXCEPTION 'INVALID_FILTER: 不支持的操作符 %', v_op;
  END CASE;
END;
$$;

-- ============================================================
-- 6.2 内部辅助函数：解析 Supabase OR 过滤字符串
--     输入格式: "col1.op.val1,col2.op.val2"
--     输出格式: "col1 OP val1 OR col2 OP val2"
-- ============================================================
CREATE OR REPLACE FUNCTION public._admin_parse_or_filter(p_or_str TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts TEXT[];
  v_part TEXT;
  v_result TEXT := '';
  v_col TEXT;
  v_op TEXT;
  v_val TEXT;
  v_dot1 INT;
  v_dot2 INT;
  v_clause TEXT;
  v_in_vals TEXT[];
  v_in_clause TEXT;
  v_in_item TEXT;
BEGIN
  -- 分割 OR 条件（按逗号分割，但需要处理 in.(...) 中的逗号）
  -- 使用正则匹配每个条件片段
  FOR v_part IN
    SELECT unnest(regexp_matches(p_or_str, '[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_]+\.(?:\([^)]*\)|[^,]*)', 'g'))
  LOOP
    -- 解析 col.op.val 格式
    v_dot1 := position('.' in v_part);
    v_col := left(v_part, v_dot1 - 1);
    v_part := substring(v_part from v_dot1 + 1);
    v_dot2 := position('.' in v_part);

    IF v_dot2 > 0 THEN
      v_op := left(v_part, v_dot2 - 1);
      v_val := substring(v_part from v_dot2 + 1);
    ELSE
      v_op := v_part;
      v_val := NULL;
    END IF;

    -- 验证列名
    IF v_col !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
      CONTINUE;
    END IF;

    -- 构建 SQL 子句
    CASE v_op
      WHEN 'eq' THEN
        v_clause := format('%I = %L', v_col, v_val);
      WHEN 'neq' THEN
        v_clause := format('%I != %L', v_col, v_val);
      WHEN 'ilike' THEN
        v_clause := format('%I ILIKE %L', v_col, v_val);
      WHEN 'like' THEN
        v_clause := format('%I LIKE %L', v_col, v_val);
      WHEN 'gt' THEN
        v_clause := format('%I > %L', v_col, v_val);
      WHEN 'gte' THEN
        v_clause := format('%I >= %L', v_col, v_val);
      WHEN 'lt' THEN
        v_clause := format('%I < %L', v_col, v_val);
      WHEN 'lte' THEN
        v_clause := format('%I <= %L', v_col, v_val);
      WHEN 'is' THEN
        IF v_val = 'null' OR v_val IS NULL THEN
          v_clause := format('%I IS NULL', v_col);
        ELSE
          v_clause := format('%I IS %L', v_col, v_val);
        END IF;
      WHEN 'in' THEN
        -- 处理 in.(val1,val2,...) 格式
        v_val := trim(both '()' from v_val);
        v_in_vals := string_to_array(v_val, ',');
        v_in_clause := '';
        FOREACH v_in_item IN ARRAY v_in_vals
        LOOP
          IF v_in_clause != '' THEN v_in_clause := v_in_clause || ','; END IF;
          v_in_clause := v_in_clause || quote_literal(trim(v_in_item));
        END LOOP;
        v_clause := format('%I IN (%s)', v_col, v_in_clause);
      ELSE
        CONTINUE;
    END CASE;

    IF v_result != '' THEN
      v_result := v_result || ' OR ';
    END IF;
    v_result := v_result || v_clause;
  END LOOP;

  IF v_result = '' THEN
    RETURN 'true';
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 7. 通用管理后台计数 RPC
--    [修复 S3] 白名单与 admin_query 保持一致
--    [修复 X1] 新增 IN 支持
--    [修复 X2] 新增 OR 支持
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_count(
  p_session_token TEXT,
  p_table TEXT,
  p_filters JSONB DEFAULT '[]'::JSONB,
  p_or_filters TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_sql TEXT;
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
    'admin_sessions'
  ];
  v_filter JSONB;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不允许访问表 %', p_table;
  END IF;

  v_sql := format('SELECT COUNT(*) FROM %I', p_table);

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

  EXECUTE v_sql INTO v_count;

  RETURN json_build_object('count', v_count);
END;
$$;

-- ============================================================
-- 8. 通用管理后台写入 RPC（INSERT / UPDATE / DELETE / UPSERT）
--    [修复 S2] 使用 jsonb_typeof 正确检测 null 值
--    [修复 X5] 新增 UPSERT 支持
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_mutate(
  p_session_token TEXT,
  p_action TEXT,        -- 'insert', 'update', 'delete', 'upsert'
  p_table TEXT,
  p_data JSONB DEFAULT NULL,
  p_filters JSONB DEFAULT '[]'::JSONB,
  p_on_conflict TEXT DEFAULT NULL  -- upsert 时的冲突列
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
    'promoter_deposits'
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
      -- [修复 S2] 使用 jsonb_typeof 正确检测 null
      v_val_type := jsonb_typeof(p_data->v_key);
      IF v_val_type = 'null' OR (p_data->v_key) IS NULL THEN
        v_vals := v_vals || 'NULL';
      ELSIF v_val_type = 'object' OR v_val_type = 'array' THEN
        -- JSONB 对象/数组直接作为 JSONB 值插入
        v_vals := v_vals || quote_literal((p_data->v_key)::TEXT) || '::JSONB';
      ELSE
        v_vals := v_vals || quote_literal(p_data->>v_key);
      END IF;
    END LOOP;
    v_sql := format('INSERT INTO %I (%s) VALUES (%s) RETURNING row_to_json(%I.*)', p_table, v_cols, v_vals, p_table);

  ELSIF p_action = 'upsert' THEN
    -- [修复 X5] 构建 UPSERT (INSERT ... ON CONFLICT ... DO UPDATE)
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
      -- 跳过冲突列本身
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
      -- 没有指定冲突列，退化为普通 INSERT
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

    -- 必须有过滤条件
    IF jsonb_array_length(p_filters) = 0 THEN
      RAISE EXCEPTION 'FORBIDDEN: UPDATE 操作必须指定过滤条件';
    END IF;

    v_sql := v_sql || ' WHERE true';
    FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
    LOOP
      v_sql := v_sql || _admin_build_filter_clause(v_filter);
    END LOOP;

    v_sql := v_sql || format(' RETURNING row_to_json(%I.*)', p_table);

  ELSIF p_action = 'delete' THEN
    -- 构建 DELETE
    IF jsonb_array_length(p_filters) = 0 THEN
      RAISE EXCEPTION 'FORBIDDEN: DELETE 操作必须指定过滤条件';
    END IF;

    v_sql := format('DELETE FROM %I WHERE true', p_table);
    FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
    LOOP
      v_sql := v_sql || _admin_build_filter_clause(v_filter);
    END LOOP;

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

-- ============================================================
-- 9. Storage 上传辅助 RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_create_signed_upload_url(
  p_session_token TEXT,
  p_bucket TEXT,
  p_file_path TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  RETURN json_build_object(
    'bucket', p_bucket,
    'path', p_file_path,
    'admin_id', v_admin_id
  );
END;
$$;

-- ============================================================
-- 10. 授予 anon 角色调用这些 RPC 函数的权限
-- ============================================================
GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_logout(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_get_permissions(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_query(TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, INT, INT, TEXT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_count(TEXT, TEXT, JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_mutate(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_create_signed_upload_url(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public._admin_build_filter_clause(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public._admin_parse_or_filter(TEXT) TO anon;

-- ============================================================
-- 11. 清理过期的管理员 session
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_admin_sessions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM admin_sessions
    WHERE expires_at < now() OR is_active = false
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM deleted;

  RETURN v_count;
END;
$$;
