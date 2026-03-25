-- ============================================================
-- 重写 search_user_for_deposit 函数
-- 支持手机号模糊搜索 / 姓名模糊搜索 / 精确邀请码 / 精确UUID
-- 返回多条结果供地推人员选择
-- ============================================================

CREATE OR REPLACE FUNCTION search_user_for_deposit(
  p_query TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_users JSON;
  v_count INT;
BEGIN
  -- 清理输入
  p_query := TRIM(p_query);

  IF p_query = '' THEN
    RETURN json_build_object('success', false, 'error', 'EMPTY_QUERY');
  END IF;

  -- 精确匹配 UUID
  IF p_query ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT json_agg(
      json_build_object(
        'id', u.id,
        'phone_number', u.phone_number,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'avatar_url', u.avatar_url,
        'referral_code', u.referral_code
      )
    )
    INTO v_users
    FROM users u
    WHERE u.id = p_query
      AND (u.is_blocked IS NOT TRUE)
      AND (u.deleted_at IS NULL)
    LIMIT 1;

    IF v_users IS NOT NULL THEN
      SELECT json_array_length(v_users) INTO v_count;
      IF v_count = 1 THEN
        RETURN json_build_object('success', true, 'user', v_users->0);
      END IF;
    END IF;
  END IF;

  -- 精确匹配邀请码 / referral_code（不区分大小写）
  SELECT json_agg(
    json_build_object(
      'id', u.id,
      'phone_number', u.phone_number,
      'first_name', u.first_name,
      'last_name', u.last_name,
      'avatar_url', u.avatar_url,
      'referral_code', u.referral_code
    )
  )
  INTO v_users
  FROM users u
  WHERE UPPER(u.referral_code) = UPPER(p_query)
    AND (u.is_blocked IS NOT TRUE)
    AND (u.deleted_at IS NULL)
  LIMIT 1;

  IF v_users IS NOT NULL THEN
    SELECT json_array_length(v_users) INTO v_count;
    IF v_count = 1 THEN
      RETURN json_build_object('success', true, 'user', v_users->0);
    END IF;
  END IF;

  -- 模糊搜索：手机号包含 / 姓名包含（最多返回10条）
  SELECT json_agg(row_data)
  INTO v_users
  FROM (
    SELECT json_build_object(
      'id', u.id,
      'phone_number', u.phone_number,
      'first_name', u.first_name,
      'last_name', u.last_name,
      'avatar_url', u.avatar_url,
      'referral_code', u.referral_code
    ) AS row_data
    FROM users u
    WHERE (
      u.phone_number ILIKE '%' || p_query || '%'
      OR u.first_name ILIKE '%' || p_query || '%'
      OR u.last_name ILIKE '%' || p_query || '%'
    )
      AND (u.is_blocked IS NOT TRUE)
      AND (u.deleted_at IS NULL)
    ORDER BY
      -- 手机号精确匹配优先
      CASE WHEN u.phone_number = p_query THEN 0 ELSE 1 END,
      -- 手机号前缀匹配次之
      CASE WHEN u.phone_number ILIKE p_query || '%' THEN 0 ELSE 1 END,
      u.created_at DESC
    LIMIT 10
  ) sub;

  IF v_users IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  SELECT json_array_length(v_users) INTO v_count;

  -- 只有一条结果，直接返回单用户
  IF v_count = 1 THEN
    RETURN json_build_object('success', true, 'user', v_users->0);
  END IF;

  -- 多条结果，返回列表
  RETURN json_build_object('success', true, 'multiple', true, 'users', v_users);
END;
$$;

COMMENT ON FUNCTION search_user_for_deposit(TEXT)
  IS '地推人员搜索目标用户，支持手机号模糊搜索 / 姓名模糊搜索 / 精确邀请码 / 精确UUID，最多返回10条结果';
