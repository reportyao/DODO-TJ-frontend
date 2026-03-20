-- 配置 Supabase Cron Job 用于自动检查开奖时间
-- 每分钟运行一次,检查是否有到达开奖时间的夺宝

-- 1. 启用 pg_cron 扩展
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. 删除旧的定时任务(如果存在)
SELECT cron.unschedule('check-lottery-draw-time') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'check-lottery-draw-time'
);

-- 3. 创建新的定时任务
-- Cron 表达式: * * * * * 表示每分钟运行一次
-- 格式: 分钟 小时 日 月 星期
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

-- 4. 查看所有定时任务
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  active
FROM cron.job
ORDER BY jobid;

-- 5. 查看定时任务执行历史
SELECT 
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 10;

-- 使用说明:
-- 1. 在 Supabase SQL Editor 中执行此脚本
-- 2. 定时任务会每分钟自动运行
-- 3. 检查 cron.job_run_details 表查看执行历史
-- 4. 如需停止定时任务: SELECT cron.unschedule('check-lottery-draw-time');
-- 5. 如需手动触发: 直接访问 Edge Function URL

-- 注意事项:
-- 1. 确保 Edge Function 已部署
-- 2. 确保 service_role_key 正确
-- 3. 定时任务失败不会影响数据库操作
-- 4. 可以通过 job_run_details 表监控执行情况
