-- ============================================================
-- 批量商品上架 — Admin RPC 白名单更新
-- ============================================================
-- 将 batch_upload_tasks 和 batch_upload_items 添加到
-- admin_query / admin_count / admin_mutate 的 v_allowed_tables 中，
-- 以便管理后台前端可以通过 adminQuery/adminUpdate 等函数操作这些表。
-- ============================================================

-- 更新 admin_query 白名单
DO $$
DECLARE
  v_func_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_body
  FROM pg_proc WHERE proname = 'admin_query' LIMIT 1;

  IF v_func_body IS NOT NULL AND v_func_body NOT LIKE '%batch_upload_tasks%' THEN
    v_func_body := replace(v_func_body,
      '''localization_lexicon''',
      '''localization_lexicon'', ''batch_upload_tasks'', ''batch_upload_items'''
    );
    EXECUTE v_func_body;
    RAISE NOTICE 'admin_query 白名单已更新';
  ELSE
    RAISE NOTICE 'admin_query 白名单已包含 batch_upload_tasks，跳过';
  END IF;
END $$;

-- 更新 admin_count 白名单
DO $$
DECLARE
  v_func_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_body
  FROM pg_proc WHERE proname = 'admin_count' LIMIT 1;

  IF v_func_body IS NOT NULL AND v_func_body NOT LIKE '%batch_upload_tasks%' THEN
    v_func_body := replace(v_func_body,
      '''localization_lexicon''',
      '''localization_lexicon'', ''batch_upload_tasks'', ''batch_upload_items'''
    );
    EXECUTE v_func_body;
    RAISE NOTICE 'admin_count 白名单已更新';
  ELSE
    RAISE NOTICE 'admin_count 白名单已包含 batch_upload_tasks，跳过';
  END IF;
END $$;

-- 更新 admin_mutate 白名单
DO $$
DECLARE
  v_func_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_body
  FROM pg_proc WHERE proname = 'admin_mutate' LIMIT 1;

  IF v_func_body IS NOT NULL AND v_func_body NOT LIKE '%batch_upload_tasks%' THEN
    v_func_body := replace(v_func_body,
      '''localization_lexicon''',
      '''localization_lexicon'', ''batch_upload_tasks'', ''batch_upload_items'''
    );
    EXECUTE v_func_body;
    RAISE NOTICE 'admin_mutate 白名单已更新';
  ELSE
    RAISE NOTICE 'admin_mutate 白名单已包含 batch_upload_tasks，跳过';
  END IF;
END $$;
