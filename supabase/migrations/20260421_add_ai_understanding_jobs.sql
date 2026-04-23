-- ============================================================
-- 20260421_add_ai_understanding_jobs.sql
--
-- 目的：解决 ai-understanding-generate 504 IDLE_TIMEOUT 问题
--   背景：Supabase Edge Functions 网关存在 150s idle timeout 硬限制，
--         无法通过函数代码或控制台修改。原 ai-understanding-generate
--         同步调用 qwen-vl-max + qwen3.5-plus（两步串行 + 各自 thinking
--         模式 + 最多 3 次重试），最坏 540s，远超 150s 阈值。
--
--   方案：引入异步任务表，由 Edge Function 同步快速返回 job_id，
--         真实 LLM 调用通过 EdgeRuntime.waitUntil 在后台执行；
--         前端通过 ai-understanding-job-status 接口轮询状态。
--
-- 字段说明：
--   id              主键
--   product_id      关联 inventory_products.id
--   status          pending | processing | succeeded | failed
--   force_regenerate 是否强制重生成（哪怕已有 ai_understanding）
--   stage           当前阶段（用于前端进度展示）
--   progress        0~100
--   error           失败原因
--   result          成功后的 ai_understanding JSON 镜像，便于审计
--   model_used      实际使用的模型链
--   started_at      处理开始时间
--   finished_at     结束时间
--   created_by      触发的 admin_id
--   created_at/updated_at 时间戳
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_understanding_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','succeeded','failed')),
  force_regenerate boolean NOT NULL DEFAULT false,
  stage            text,
  progress         integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error            text,
  result           jsonb,
  model_used       text,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_understanding_jobs_product_id
  ON public.ai_understanding_jobs (product_id);

CREATE INDEX IF NOT EXISTS idx_ai_understanding_jobs_status_created
  ON public.ai_understanding_jobs (status, created_at DESC);

-- updated_at 触发器
CREATE OR REPLACE FUNCTION public.set_updated_at_ai_understanding_jobs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_understanding_jobs_updated_at
  ON public.ai_understanding_jobs;

CREATE TRIGGER trg_ai_understanding_jobs_updated_at
  BEFORE UPDATE ON public.ai_understanding_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ai_understanding_jobs();

-- 启用 RLS：只允许 service_role 完全访问；普通客户端不能直接读写。
-- Edge Function 使用 service role key 执行写入；前端通过 Edge Function
-- 进行读取（job-status 接口），不直连此表。
ALTER TABLE public.ai_understanding_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_understanding_jobs_service_role_all
  ON public.ai_understanding_jobs;

CREATE POLICY ai_understanding_jobs_service_role_all
  ON public.ai_understanding_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- ⚠️ 重要提醒（给 AI 和开发者）：
-- 本迁移文件创建了 ai_understanding_jobs 表，但遗漏了将其加入
-- admin RPC 白名单，已由后续补丁
-- 20260423000001_fix_ai_image_tasks_admin_whitelist.sql 修复。
--
-- 📋 新建表时必须同时更新 admin_query / admin_count / admin_mutate 白名单！
-- 👉 详见 docs/ADMIN_RPC_WHITELIST_GUIDE.md
-- ============================================================
