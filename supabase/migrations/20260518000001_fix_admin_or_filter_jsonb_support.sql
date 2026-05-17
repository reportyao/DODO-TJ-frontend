-- ============================================================
-- 修复 _admin_parse_or_filter 函数：支持 JSONB 路径操作符 (->> / ->)
--
-- 问题：
--   原正则 '[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_]+\.(?:\([^)]*\)|[^,]*)'
--   只匹配纯列名（如 name.ilike.%value%），不支持 JSONB 路径
--   （如 name_i18n->>zh.ilike.%玻璃%），导致中文搜索条件被完全跳过。
--
-- 修复：
--   1. 扩展正则以匹配 JSONB 路径格式：col->>key 或 col->key
--   2. 解析时正确处理 JSONB 路径，生成 (col->>'key') 的 SQL
--   3. 同时将 limit 从 200 改为全量加载（前端改动）
-- ============================================================

DROP FUNCTION IF EXISTS public._admin_parse_or_filter(text);

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
  v_col_raw TEXT;
  v_col TEXT;
  v_json_key TEXT;
  v_json_op TEXT;  -- '->' or '->>'
  v_op TEXT;
  v_val TEXT;
  v_dot1 INT;
  v_dot2 INT;
  v_clause TEXT;
  v_col_expr TEXT;
  v_in_vals TEXT[];
  v_in_clause TEXT;
  v_in_item TEXT;
  v_arrow_pos INT;
BEGIN
  -- 分割 OR 条件
  -- 扩展正则以支持 JSONB 路径: col->>key.op.value 或 col->key.op.value
  -- 列名部分: [a-zA-Z_][a-zA-Z0-9_]*(?:->>?[a-zA-Z0-9_]+)?
  FOR v_part IN
    SELECT unnest(regexp_matches(p_or_str, '[a-zA-Z_][a-zA-Z0-9_]*(?:->>?[a-zA-Z0-9_]+)?\.[a-zA-Z_]+\.(?:\([^)]*\)|[^,]*)', 'g'))
  LOOP
    -- 解析 col.op.val 格式（col 可能包含 ->>key）
    v_dot1 := position('.' in v_part);
    v_col_raw := left(v_part, v_dot1 - 1);
    v_part := substring(v_part from v_dot1 + 1);
    v_dot2 := position('.' in v_part);
    IF v_dot2 > 0 THEN
      v_op := left(v_part, v_dot2 - 1);
      v_val := substring(v_part from v_dot2 + 1);
    ELSE
      v_op := v_part;
      v_val := NULL;
    END IF;

    -- 解析列名中的 JSONB 路径
    v_json_key := NULL;
    v_json_op := NULL;
    v_arrow_pos := position('->>' in v_col_raw);
    IF v_arrow_pos > 0 THEN
      v_col := left(v_col_raw, v_arrow_pos - 1);
      v_json_key := substring(v_col_raw from v_arrow_pos + 3);
      v_json_op := '->>';
    ELSE
      v_arrow_pos := position('->' in v_col_raw);
      IF v_arrow_pos > 0 THEN
        v_col := left(v_col_raw, v_arrow_pos - 1);
        v_json_key := substring(v_col_raw from v_arrow_pos + 2);
        v_json_op := '->';
      ELSE
        v_col := v_col_raw;
      END IF;
    END IF;

    -- 验证列名（基础列名部分）
    IF v_col !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
      CONTINUE;
    END IF;
    -- 验证 JSON key
    IF v_json_key IS NOT NULL AND v_json_key !~ '^[a-zA-Z0-9_]+$' THEN
      CONTINUE;
    END IF;

    -- 构建列表达式
    IF v_json_key IS NOT NULL THEN
      v_col_expr := format('%I%s%L', v_col, v_json_op, v_json_key);
    ELSE
      v_col_expr := format('%I', v_col);
    END IF;

    -- 构建 SQL 子句
    CASE v_op
      WHEN 'eq' THEN
        v_clause := format('%s = %L', v_col_expr, v_val);
      WHEN 'neq' THEN
        v_clause := format('%s != %L', v_col_expr, v_val);
      WHEN 'ilike' THEN
        v_clause := format('%s ILIKE %L', v_col_expr, v_val);
      WHEN 'like' THEN
        v_clause := format('%s LIKE %L', v_col_expr, v_val);
      WHEN 'gt' THEN
        v_clause := format('%s > %L', v_col_expr, v_val);
      WHEN 'gte' THEN
        v_clause := format('%s >= %L', v_col_expr, v_val);
      WHEN 'lt' THEN
        v_clause := format('%s < %L', v_col_expr, v_val);
      WHEN 'lte' THEN
        v_clause := format('%s <= %L', v_col_expr, v_val);
      WHEN 'is' THEN
        IF v_val = 'null' OR v_val IS NULL THEN
          v_clause := format('%s IS NULL', v_col_expr);
        ELSE
          v_clause := format('%s IS %L', v_col_expr, v_val);
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
        v_clause := format('%s IN (%s)', v_col_expr, v_in_clause);
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
