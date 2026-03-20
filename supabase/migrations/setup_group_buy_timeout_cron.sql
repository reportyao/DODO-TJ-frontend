-- =====================================================
-- 配置拼团超时检查定时任务
-- 每5分钟执行一次 group-buy-timeout-check Edge Function
-- =====================================================

-- 1. 确保 pg_cron 扩展已安装
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. 确保 pg_net 扩展已安装(用于HTTP请求)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. 删除旧的定时任务(如果存在)
SELECT cron.unschedule('group-buy-timeout-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'group-buy-timeout-check'
);

-- 4. 创建新的定时任务
-- 注意: 需要替换 YOUR_SUPABASE_URL 和 YOUR_SERVICE_ROLE_KEY
-- 
-- 获取方式:
-- - SUPABASE_URL: 在 Supabase Dashboard > Settings > API > Project URL
-- - SERVICE_ROLE_KEY: 在 Supabase Dashboard > Settings > API > service_role key (secret)

DO $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- 从环境变量或配置表中获取(需要先设置)
  -- 如果没有配置表,需要手动替换下面的值
  
  -- 方案1: 从配置表获取(推荐)
  -- SELECT value->>'supabase_url' INTO supabase_url FROM system_configs WHERE key = 'supabase_url';
  -- SELECT value->>'service_role_key' INTO service_role_key FROM system_configs WHERE key = 'service_role_key';
  
  -- 方案2: 硬编码(不推荐,但方便测试)
  -- supabase_url := 'https://qcrcgpwlfouqslokwbzl.supabase.co';
  -- service_role_key := 'YOUR_SERVICE_ROLE_KEY_HERE';
  
  -- 如果配置不存在,抛出错误提示
  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE NOTICE '==========================================================';
    RAISE NOTICE 'Please manually configure the cron job with the following SQL:';
    RAISE NOTICE '';
    RAISE NOTICE 'SELECT cron.schedule(';
    RAISE NOTICE '  ''group-buy-timeout-check'',';
    RAISE NOTICE '  ''*/5 * * * *'',  -- Every 5 minutes';
    RAISE NOTICE '  $$';
    RAISE NOTICE '  SELECT';
    RAISE NOTICE '    net.http_post(';
    RAISE NOTICE '      url := ''https://YOUR_SUPABASE_URL/functions/v1/group-buy-timeout-check'',';
    RAISE NOTICE '      headers := jsonb_build_object(';
    RAISE NOTICE '        ''Content-Type'', ''application/json'',';
    RAISE NOTICE '        ''Authorization'', ''Bearer YOUR_SERVICE_ROLE_KEY''';
    RAISE NOTICE '      ),';
    RAISE NOTICE '      body := ''{}''::jsonb';
    RAISE NOTICE '    ) AS request_id;';
    RAISE NOTICE '  $$';
    RAISE NOTICE ');';
    RAISE NOTICE '';
    RAISE NOTICE 'Replace YOUR_SUPABASE_URL and YOUR_SERVICE_ROLE_KEY with actual values.';
    RAISE NOTICE '==========================================================';
  ELSE
    -- 创建定时任务
    PERFORM cron.schedule(
      'group-buy-timeout-check',
      '*/5 * * * *',  -- 每5分钟执行一次
      format(
        $$
        SELECT
          net.http_post(
            url := '%s/functions/v1/group-buy-timeout-check',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer %s'
            ),
            body := '{}'::jsonb
          ) AS request_id;
        $$,
        supabase_url,
        service_role_key
      )
    );
    
    RAISE NOTICE 'Cron job created successfully!';
  END IF;
END $$;

-- 5. 查看所有定时任务
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname = 'group-buy-timeout-check';

-- 6. 查看定时任务执行历史(最近10条)
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
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'group-buy-timeout-check')
ORDER BY start_time DESC
LIMIT 10;

-- 7. 手动测试定时任务(可选)
-- 取消注释下面的代码来立即执行一次
/*
SELECT
  net.http_post(
    url := 'https://YOUR_SUPABASE_URL/functions/v1/group-buy-timeout-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  ) AS request_id;
*/

-- 8. 如果需要删除定时任务
-- SELECT cron.unschedule('group-buy-timeout-check');

-- 9. 如果需要暂停定时任务
-- UPDATE cron.job SET active = false WHERE jobname = 'group-buy-timeout-check';

-- 10. 如果需要恢复定时任务
-- UPDATE cron.job SET active = true WHERE jobname = 'group-buy-timeout-check';
