-- ============================================================
-- 希望之树 — Admin RPC 白名单更新
-- 日期: 2026-04-27
-- ============================================================
-- 将 gift_tree_task_logs 和 gift_tree_help_logs 添加到
-- admin_query / admin_count / admin_mutate 的 v_allowed_tables 中，
-- 以便管理后台前端可以通过 adminQuery/adminCount 等函数操作这些表。
--
-- 根因：
--   20260426000001_gift_tree_module.sql 创建了 gift_tree_task_logs 和
--   gift_tree_help_logs 表，但未同步更新 Security Definer RPC 的白名单，
--   导致管理后台 GiftTreeWaterLogsPage 查询时报错：
--     FORBIDDEN: 不允许访问表 gift_tree_task_logs
--     admin_count RPC 返回 400 (Bad Request)
-- ============================================================

-- 更新 admin_query 白名单
DO $$
DECLARE
  v_func_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_body
  FROM pg_proc WHERE proname = 'admin_query' LIMIT 1;
  IF v_func_body IS NOT NULL AND v_func_body NOT LIKE '%gift_tree_task_logs%' THEN
    v_func_body := replace(v_func_body,
      '''gift_tree_tasks''',
      '''gift_tree_tasks'', ''gift_tree_task_logs'', ''gift_tree_help_logs'''
    );
    EXECUTE v_func_body;
    RAISE NOTICE 'admin_query 白名单已更新: +gift_tree_task_logs, +gift_tree_help_logs';
  ELSE
    RAISE NOTICE 'admin_query 白名单已包含 gift_tree_task_logs，跳过';
  END IF;
END $$;

-- 更新 admin_count 白名单
DO $$
DECLARE
  v_func_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_body
  FROM pg_proc WHERE proname = 'admin_count' LIMIT 1;
  IF v_func_body IS NOT NULL AND v_func_body NOT LIKE '%gift_tree_task_logs%' THEN
    v_func_body := replace(v_func_body,
      '''gift_tree_tasks''',
      '''gift_tree_tasks'', ''gift_tree_task_logs'', ''gift_tree_help_logs'''
    );
    EXECUTE v_func_body;
    RAISE NOTICE 'admin_count 白名单已更新: +gift_tree_task_logs, +gift_tree_help_logs';
  ELSE
    RAISE NOTICE 'admin_count 白名单已包含 gift_tree_task_logs，跳过';
  END IF;
END $$;

-- 更新 admin_mutate 白名单
DO $$
DECLARE
  v_func_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_body
  FROM pg_proc WHERE proname = 'admin_mutate' LIMIT 1;
  IF v_func_body IS NOT NULL AND v_func_body NOT LIKE '%gift_tree_task_logs%' THEN
    v_func_body := replace(v_func_body,
      '''gift_tree_tasks''',
      '''gift_tree_tasks'', ''gift_tree_task_logs'', ''gift_tree_help_logs'''
    );
    EXECUTE v_func_body;
    RAISE NOTICE 'admin_mutate 白名单已更新: +gift_tree_task_logs, +gift_tree_help_logs';
  ELSE
    RAISE NOTICE 'admin_mutate 白名单已包含 gift_tree_task_logs，跳过';
  END IF;
END $$;
