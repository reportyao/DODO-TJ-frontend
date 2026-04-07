-- ============================================================================
-- 修复: search_user_for_deposit 模糊搜索功能恢复
-- 文件名: 20260407_fix_search_user_fuzzy.sql
--
-- 问题描述:
--   20260401_whatsapp_migration.sql 在迁移过程中用 CREATE OR REPLACE 覆盖了
--   search_user_for_deposit 函数，移除了模糊搜索能力。
--   导致 promoter-deposit 页面搜索（如搜索 "1"）时只能精确匹配，
--   无法进行手机号/姓名的模糊搜索，前端提示"查不到用户"。
--
-- 修复方案:
--   恢复模糊搜索能力（手机号包含 / 姓名包含 / display_name 包含），
--   同时保持 whatsapp 迁移的改动（使用 phone_number 而非 telegram 字段），
--   并保留所有安全过滤条件。
--   精确匹配优先级高于模糊匹配，模糊匹配最多返回 10 条结果。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_user_for_deposit(p_query text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user       RECORD;
  v_users      JSON;
  v_count      INT;
  v_clean_query TEXT;
BEGIN
  -- 清理输入：去除首尾空格
  v_clean_query := TRIM(p_query);

  IF v_clean_query = '' THEN
    RETURN json_build_object('success', false, 'error', 'EMPTY_QUERY');
  END IF;

  -- ================================================================
  -- 1. 精确匹配: 完整 UUID
  -- ================================================================
  IF v_clean_query ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, phone_number, first_name, last_name, avatar_url, referral_code
    INTO v_user
    FROM users
    WHERE id = v_clean_query
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL);

    IF v_user IS NOT NULL THEN
      RETURN json_build_object(
        'success', true,
        'user', json_build_object(
          'id', v_user.id,
          'phone_number', v_user.phone_number,
          'first_name', v_user.first_name,
          'last_name', v_user.last_name,
          'avatar_url', v_user.avatar_url,
          'referral_code', v_user.referral_code
        )
      );
    END IF;
  END IF;

  -- ================================================================
  -- 2. 精确匹配: 手机号（纯数字 7-15 位，支持带+号和不带+号）
  -- ================================================================
  IF v_clean_query ~ '^\+?\d{7,15}$' THEN
    -- 2a. 精确匹配
    SELECT id, phone_number, first_name, last_name, avatar_url, referral_code
    INTO v_user
    FROM users
    WHERE (phone_number = v_clean_query
       OR phone_number = REPLACE(v_clean_query, '+', '')
       OR phone_number = '+' || REPLACE(v_clean_query, '+', ''))
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL)
    LIMIT 1;

    IF v_user IS NOT NULL THEN
      RETURN json_build_object(
        'success', true,
        'user', json_build_object(
          'id', v_user.id,
          'phone_number', v_user.phone_number,
          'first_name', v_user.first_name,
          'last_name', v_user.last_name,
          'avatar_url', v_user.avatar_url,
          'referral_code', v_user.referral_code
        )
      );
    END IF;

    -- 2b. 后缀模糊匹配：用户可能输入不带国际区号的号码
    SELECT id, phone_number, first_name, last_name, avatar_url, referral_code
    INTO v_user
    FROM users
    WHERE phone_number LIKE '%' || REPLACE(v_clean_query, '+', '')
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL)
    LIMIT 1;

    IF v_user IS NOT NULL THEN
      RETURN json_build_object(
        'success', true,
        'user', json_build_object(
          'id', v_user.id,
          'phone_number', v_user.phone_number,
          'first_name', v_user.first_name,
          'last_name', v_user.last_name,
          'avatar_url', v_user.avatar_url,
          'referral_code', v_user.referral_code
        )
      );
    END IF;
  END IF;

  -- ================================================================
  -- 3. 精确匹配: referral_code（不区分大小写）
  -- ================================================================
  SELECT id, phone_number, first_name, last_name, avatar_url, referral_code
  INTO v_user
  FROM users
  WHERE UPPER(referral_code) = UPPER(v_clean_query)
    AND (is_blocked IS NOT TRUE)
    AND (deleted_at IS NULL);

  IF v_user IS NOT NULL THEN
    RETURN json_build_object(
      'success', true,
      'user', json_build_object(
        'id', v_user.id,
        'phone_number', v_user.phone_number,
        'first_name', v_user.first_name,
        'last_name', v_user.last_name,
        'avatar_url', v_user.avatar_url,
        'referral_code', v_user.referral_code
      )
    );
  END IF;

  -- ================================================================
  -- 4. 精确匹配: UUID 前8位 hex 前缀
  -- ================================================================
  IF LENGTH(v_clean_query) = 8 AND v_clean_query ~ '^[0-9a-f]+$' THEN
    SELECT id, phone_number, first_name, last_name, avatar_url, referral_code
    INTO v_user
    FROM users
    WHERE id::text LIKE v_clean_query || '%'
      AND (is_blocked IS NOT TRUE)
      AND (deleted_at IS NULL)
    LIMIT 1;

    IF v_user IS NOT NULL THEN
      RETURN json_build_object(
        'success', true,
        'user', json_build_object(
          'id', v_user.id,
          'phone_number', v_user.phone_number,
          'first_name', v_user.first_name,
          'last_name', v_user.last_name,
          'avatar_url', v_user.avatar_url,
          'referral_code', v_user.referral_code
        )
      );
    END IF;
  END IF;

  -- ================================================================
  -- 5. 模糊搜索: 手机号包含 / 姓名包含 / display_name 包含
  --    最多返回 10 条，支持多结果供地推人员选择
  -- ================================================================
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
      u.phone_number ILIKE '%' || v_clean_query || '%'
      OR u.first_name ILIKE '%' || v_clean_query || '%'
      OR u.last_name ILIKE '%' || v_clean_query || '%'
      OR u.display_name ILIKE '%' || v_clean_query || '%'
    )
      AND (u.is_blocked IS NOT TRUE)
      AND (u.deleted_at IS NULL)
    ORDER BY
      -- 手机号精确匹配优先
      CASE WHEN u.phone_number = v_clean_query THEN 0 ELSE 1 END,
      -- 手机号前缀匹配次之
      CASE WHEN u.phone_number ILIKE v_clean_query || '%' THEN 0 ELSE 1 END,
      -- 姓名精确匹配
      CASE WHEN LOWER(u.first_name) = LOWER(v_clean_query) THEN 0
           WHEN LOWER(u.display_name) = LOWER(v_clean_query) THEN 1
           ELSE 2 END,
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
$function$;

COMMENT ON FUNCTION search_user_for_deposit(TEXT)
  IS '地推人员搜索目标用户，支持精确匹配（UUID/手机号/邀请码/UUID前缀）和模糊搜索（手机号/姓名/display_name包含），最多返回10条结果';
