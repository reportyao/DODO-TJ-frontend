-- ============================================================================
-- AI 上架助手 & AI 商品理解：admin RPC 白名单补丁
-- 日期: 2026-04-23
-- 目的:
--   1. 将 ai_image_tasks 加入 admin_query / admin_count / admin_mutate 白名单
--   2. 将 ai_understanding_jobs 加入 admin_query / admin_count / admin_mutate 白名单
--
-- 根因:
--   20260425000001_ai_listing_image_tasks.sql 创建了 ai_image_tasks 表，
--   20260421_add_ai_understanding_jobs.sql 创建了 ai_understanding_jobs 表，
--   但均未同步更新 Security Definer RPC 的白名单，导致：
--     - AI 上架助手查询海报任务状态时报错：FORBIDDEN: 不允许访问表 ai_image_tasks
--     - admin_query RPC 返回 400 (Bad Request)
--     - 前端 AIListingPage 的 DB 轮询和 Realtime 恢复机制失效
--
-- 修复方式:
--   使用 pg_get_functiondef + replace 做增量补丁，避免复制整段大型函数，
--   同时兼容当前线上已存在的函数体版本。
-- ============================================================================

-- ─── 1. admin_query: 添加 ai_image_tasks ─────────────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)'::regprocedure
  );
  IF position('ai_image_tasks' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_listing_generation_tasks'',',
      '''ai_listing_generation_tasks'',
    ''ai_image_tasks'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;

-- ─── 2. admin_query: 添加 ai_understanding_jobs ──────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)'::regprocedure
  );
  IF position('ai_understanding_jobs' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_image_tasks'',',
      '''ai_image_tasks'',
    ''ai_understanding_jobs'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;

-- ─── 3. admin_count: 添加 ai_image_tasks ─────────────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_count(text,text,jsonb,text)'::regprocedure
  );
  IF position('ai_image_tasks' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_listing_generation_tasks'',',
      '''ai_listing_generation_tasks'',
    ''ai_image_tasks'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;

-- ─── 4. admin_count: 添加 ai_understanding_jobs ──────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_count(text,text,jsonb,text)'::regprocedure
  );
  IF position('ai_understanding_jobs' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_image_tasks'',',
      '''ai_image_tasks'',
    ''ai_understanding_jobs'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;

-- ─── 5. admin_mutate: 添加 ai_image_tasks ────────────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_mutate(text,text,text,jsonb,jsonb,text,text)'::regprocedure
  );
  IF position('ai_image_tasks' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_listing_generation_tasks'',',
      '''ai_listing_generation_tasks'',
    ''ai_image_tasks'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;

-- ─── 6. admin_mutate: 添加 ai_understanding_jobs ─────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_mutate(text,text,text,jsonb,jsonb,text,text)'::regprocedure
  );
  IF position('ai_understanding_jobs' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      '''ai_image_tasks'',',
      '''ai_image_tasks'',
    ''ai_understanding_jobs'','
    );
    EXECUTE v_def;
  END IF;
END;
$$;
