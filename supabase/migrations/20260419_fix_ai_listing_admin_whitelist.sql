-- ============================================================================
-- AI Listing 持久化任务表：admin RPC 白名单补丁
-- 日期: 2026-04-19
-- 目的:
--   1. 将 ai_listing_generation_tasks 加入 admin_query 白名单
--   2. 将 ai_listing_generation_tasks 加入 admin_count 白名单
--   3. 将 ai_listing_generation_tasks 加入 admin_mutate 白名单
--
-- 根因:
--   20260419_create_ai_listing_generation_tasks.sql 只创建了表，但没有同步更新
--   Security Definer RPC 的白名单，导致管理后台在 SSE 断流后尝试从
--   ai_listing_generation_tasks 恢复任务状态时，被 admin_query / admin_mutate
--   拒绝并报错：FORBIDDEN: 不允许访问表 ai_listing_generation_tasks。
--
-- 说明:
--   这里使用 pg_get_functiondef + replace 做增量补丁，避免复制整段大型函数，
--   同时兼容当前线上已存在的函数体版本。
-- ============================================================================

DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)'::regprocedure
  );

  IF position('ai_listing_generation_tasks' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_topic_generation_tasks'',',
      '''ai_topic_generation_tasks'',
    ''ai_listing_generation_tasks'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;

DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_count(text,text,jsonb,text)'::regprocedure
  );

  IF position('ai_listing_generation_tasks' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_topic_generation_tasks'',',
      '''ai_topic_generation_tasks'',
    ''ai_listing_generation_tasks'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;

DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_mutate(text,text,text,jsonb,jsonb,text,text)'::regprocedure
  );

  IF position('ai_listing_generation_tasks' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_topic_generation_tasks'',',
      '''ai_topic_generation_tasks'',
    ''ai_listing_generation_tasks'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;
