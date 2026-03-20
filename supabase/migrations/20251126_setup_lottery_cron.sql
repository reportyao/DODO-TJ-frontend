-- 配置 pg_cron 定时任务用于自动开奖
-- 每分钟检查一次是否有需要开奖的夺宝活动

-- 创建定时任务：每分钟调用 scheduled-lottery-draw Edge Function
SELECT cron.schedule(
  'lottery-draw-check',                    -- 任务名称
  '* * * * *',                             -- Cron 表达式：每分钟执行一次
  $$
  SELECT
    net.http_post(
      url := 'https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/scheduled-lottery-draw',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
