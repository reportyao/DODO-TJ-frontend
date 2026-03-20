-- ============================================================
-- pg_cron 定时任务: process-event-queue
-- 功能: 每分钟检查 event_queue 中是否有 pending 事件
--       如果有，则调用 process-squad-events Worker 进行处理
-- 
-- 设计要点:
--   1. 先检查是否有 pending 事件，避免无谓的 Edge Function 调用
--   2. 使用与现有 cron 任务相同的认证模式（Service Role Key）
--   3. 每分钟执行一次，最大延迟 1 分钟，对佣金/通知场景完全足够
-- ============================================================

-- 先删除可能已存在的同名任务（幂等操作）
SELECT cron.unschedule('process-event-queue') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-event-queue');

-- 创建定时任务
SELECT cron.schedule(
  'process-event-queue',
  '* * * * *',
  $$
  DO $$
  BEGIN
    -- 仅在有 pending 事件时才触发 Worker，避免无谓的冷启动开销
    IF EXISTS (SELECT 1 FROM event_queue WHERE status = 'pending' LIMIT 1) THEN
      PERFORM net.http_post(
        url := 'https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/process-squad-events',
        headers := '"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjcmNncHdsZm91cXNsb2t3YnpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMzMzNywiZXhwIjoyMDg5NTA5MzM3fQ.CB4qQc2gXjZA_LEJG3J2GgMsd0Z1Cr5speVpV3IhRrM"}'::jsonb,,
        body := '{"source": "pg_cron"}'::jsonb
      );
      RAISE LOG 'process-event-queue: triggered Worker for pending events';
    END IF;
  END $$;
  $$
);
