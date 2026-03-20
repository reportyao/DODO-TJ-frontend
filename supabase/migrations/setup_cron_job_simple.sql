-- 简化版 Cron Job 配置
-- 只创建定时任务,不修改权限

-- 1. 删除旧的定时任务(如果存在)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-lottery-draw-time') THEN
    PERFORM cron.unschedule('check-lottery-draw-time');
  END IF;
END $$;

-- 2. 创建新的定时任务
-- 每分钟运行一次,检查是否有到达开奖时间的夺宝
SELECT cron.schedule(
  'check-lottery-draw-time',  -- 任务名称
  '* * * * *',                 -- 每分钟运行一次
  $$
  SELECT net.http_post(
    url:='https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/check-draw-time',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eWl0eHd4bXh3YmtxZ3pmZmR3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjQyMzg1MywiZXhwIjoyMDc3OTk5ODUzfQ.Yqu0OluUMtVC73H_bHC6nCqEtjllzhz2HfltbffF_HA"}'::jsonb
  ) as request_id;
  $$
);

-- 3. 查看定时任务状态
SELECT 
  jobid,
  jobname,
  schedule,
  active
FROM cron.job
WHERE jobname = 'check-lottery-draw-time';
