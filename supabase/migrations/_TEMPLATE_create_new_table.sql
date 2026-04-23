-- ============================================================
-- 📋 新建表迁移模板 — DODO.TJ
--
-- ⚠️ AI 和开发者注意：
--   创建新表后，必须完成以下所有步骤，缺一不可！
--   特别是第 6 步（admin RPC 白名单），这是最容易遗漏的步骤。
--   遗漏白名单会导致管理后台报错：FORBIDDEN: 不允许访问表 xxx
--
-- 使用方法：
--   1. 复制本文件并重命名为 YYYYMMDD_create_xxx.sql
--   2. 替换所有 your_table_name 为实际表名
--   3. 按需修改字段定义
--   4. 确保第 6 步白名单更新已包含
--
-- 👉 详细指引见 docs/ADMIN_RPC_WHITELIST_GUIDE.md
-- ============================================================

-- ─── 1. 建表 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.your_table_name (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ... 你的字段 ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. 索引 ─────────────────────────────────────────────────
-- CREATE INDEX IF NOT EXISTS idx_your_table_name_xxx
--   ON public.your_table_name(xxx);

-- ─── 3. updated_at 触发器 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_your_table_name_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_your_table_name_updated_at ON public.your_table_name;
CREATE TRIGGER trg_your_table_name_updated_at
  BEFORE UPDATE ON public.your_table_name
  FOR EACH ROW EXECUTE FUNCTION public.touch_your_table_name_updated_at();

-- ─── 4. RLS ──────────────────────────────────────────────────
ALTER TABLE public.your_table_name ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS your_table_name_service_all ON public.your_table_name;
CREATE POLICY your_table_name_service_all
  ON public.your_table_name
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 按需添加 anon/authenticated 策略
-- DROP POLICY IF EXISTS your_table_name_read_public ON public.your_table_name;
-- CREATE POLICY your_table_name_read_public
--   ON public.your_table_name FOR SELECT TO anon, authenticated USING (true);

-- ─── 5. Realtime（如需前端实时订阅） ────────────────────────
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_publication_tables
--     WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='your_table_name'
--   ) THEN
--     ALTER PUBLICATION supabase_realtime ADD TABLE public.your_table_name;
--   END IF;
-- END $$;

-- ─── 6. ⚠️ admin RPC 白名单（必须！） ───────────────────────
-- 将新表加入 admin_query / admin_count / admin_mutate 的 v_allowed_tables 数组
-- 不做此步骤，管理后台将无法访问该表！
--
-- 替换锚点说明：
--   当前白名单最后一个表名是 'ai_understanding_jobs'
--   如果之后又有新表加入，请更新替换锚点为最新的最后一个表名

-- 6a. admin_query
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)'::regprocedure
  );
  IF position('your_table_name' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''your_table_name'''
    );
    EXECUTE v_def;
  END IF;
END; $$;

-- 6b. admin_count
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_count(text,text,jsonb,text)'::regprocedure
  );
  IF position('your_table_name' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''your_table_name'''
    );
    EXECUTE v_def;
  END IF;
END; $$;

-- 6c. admin_mutate
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_mutate(text,text,text,jsonb,jsonb,text,text)'::regprocedure
  );
  IF position('your_table_name' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''your_table_name'''
    );
    EXECUTE v_def;
  END IF;
END; $$;
