-- ============================================================
-- AI 上架助手 2.0：单图生成任务分片表 + pg_cron 调度
--
-- 目标：
--   1. 突破 Supabase Edge Function 150s Wall Clock 限制
--   2. 每张"带俄文文案的营销海报"作为独立任务入队，由 cron 逐张消费
--   3. 支持断点续传、天然隔离失败、可并发扩展
-- ============================================================

-- ------------------------------------------------------------
-- 1. 单图任务分片表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_image_tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 与前端 AITask.id 关联（非外键，因为 AITask 并未在 DB 持久化）
  parent_task_id        text NOT NULL,

  -- 操作者信息，便于审计与 RLS
  admin_user_id         text,

  -- 任务输入
  base_image_url        text NOT NULL,                        -- 抠好的透明底图（OSS/Supabase Storage URL）
  ref_prompt            text NOT NULL,                        -- 英文场景 prompt（给万相）
  ru_caption            text NOT NULL,                        -- 俄文营销文案
  text_theme            text NOT NULL DEFAULT 'light'
                          CHECK (text_theme IN ('light','dark')),  -- 文案主题（白字 or 黑字）
  caption_position      text NOT NULL DEFAULT 'bottom'
                          CHECK (caption_position IN ('top','center','bottom')),  -- 文案排版位置
  display_order         integer NOT NULL DEFAULT 0,           -- 同一父任务内的展示顺序

  -- 任务状态机
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','completed','failed')),
  attempt_count         integer NOT NULL DEFAULT 0,           -- 失败重试计数
  last_attempt_at       timestamptz,

  -- 中间/最终结果
  wanx_task_id          text,                                 -- 万相 async task id
  clean_bg_url          text,                                 -- 万相返回的纯净背景图（无字）
  marketing_image_url   text,                                 -- 最终合成+压缩后的 JPEG URL
  error_message         text,

  -- 时间戳
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.ai_image_tasks IS 'AI 上架助手 2.0 单图生成任务队列';
COMMENT ON COLUMN public.ai_image_tasks.parent_task_id IS '前端 AITask.id（非外键）';
COMMENT ON COLUMN public.ai_image_tasks.text_theme    IS 'light=白字配深色遮罩, dark=黑字配浅色遮罩';

-- ------------------------------------------------------------
-- 2. 索引
-- ------------------------------------------------------------
-- 按状态 + 创建时间查询待处理任务
CREATE INDEX IF NOT EXISTS idx_ai_image_tasks_status_created
  ON public.ai_image_tasks(status, created_at)
  WHERE status IN ('pending','processing');

-- 按父任务查询所有分片（前端 Realtime 订阅基础）
CREATE INDEX IF NOT EXISTS idx_ai_image_tasks_parent
  ON public.ai_image_tasks(parent_task_id, display_order);

-- ------------------------------------------------------------
-- 3. updated_at 自动维护
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_ai_image_tasks_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_image_tasks_updated_at ON public.ai_image_tasks;
CREATE TRIGGER trg_ai_image_tasks_updated_at
  BEFORE UPDATE ON public.ai_image_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_image_tasks_updated_at();

-- ------------------------------------------------------------
-- 4. RLS（仅 service_role 可直接操作；anon/authenticated 按需通过函数）
-- ------------------------------------------------------------
ALTER TABLE public.ai_image_tasks ENABLE ROW LEVEL SECURITY;

-- 兜底策略：service_role 可读写（service_role 默认跳过 RLS，这里显式说明）
DROP POLICY IF EXISTS ai_image_tasks_service_all ON public.ai_image_tasks;
CREATE POLICY ai_image_tasks_service_all
  ON public.ai_image_tasks
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- anon + authenticated 仅可读自己父任务的记录（Realtime 前端需要）
DROP POLICY IF EXISTS ai_image_tasks_read_public ON public.ai_image_tasks;
CREATE POLICY ai_image_tasks_read_public
  ON public.ai_image_tasks
  FOR SELECT
  TO anon, authenticated
  USING (true);  -- 任务 id 本身是 UUID，前端需带 parent_task_id 过滤，属于低敏数据

-- 将表加入 Realtime 发布，供前端订阅
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='ai_image_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_image_tasks;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. pg_cron：每分钟触发一次后台 worker
--    - 仅在存在 pending 任务时才调用 Edge Function，避免无效冷启动
--    - 采用与项目内其他 cron 一致的 service_role JWT Bearer 鉴权
-- ------------------------------------------------------------
SELECT cron.unschedule('process-ai-image-tasks')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-ai-image-tasks');

SELECT cron.schedule(
  'process-ai-image-tasks',
  '* * * * *',  -- 每分钟
  $CRON$
  DO $body$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.ai_image_tasks WHERE status = 'pending' LIMIT 1) THEN
      PERFORM net.http_post(
        url := 'https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/ai-listing-image-processor',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjcmNncHdsZm91cXNsb2t3YnpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMzMzNywiZXhwIjoyMDg5NTA5MzM3fQ.CB4qQc2gXjZA_LEJG3J2GgMsd0Z1Cr5speVpV3IhRrM'
        ),
        body := '{"source":"pg_cron"}'::jsonb
      );
      RAISE LOG 'process-ai-image-tasks: triggered worker';
    END IF;
  END
  $body$;
  $CRON$
);
