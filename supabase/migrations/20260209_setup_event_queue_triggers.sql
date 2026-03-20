-- ============================================================================
-- 迁移脚本: 配置事件队列的自动触发机制
-- 日期: 2026-02-09
-- 依赖: 20260209_create_event_queue.sql
--
-- 本脚本配置两种触发机制:
--   1. pg_net Webhook: 当 event_queue 有新事件插入时，自动调用 Worker
--   2. pg_cron 定时任务: 每分钟检查一次队列，处理可能遗漏的事件
--
-- 注意:
--   - pg_net 和 pg_cron 是 Supabase 的内置扩展
--   - 如果扩展未启用，需要在 Supabase Dashboard > Database > Extensions 中启用
--   - Webhook 触发是"尽力而为"的，不保证 100% 触发，所以需要 Cron 作为兜底
-- ============================================================================

-- ============================================================================
-- 1. 确保 pg_net 和 pg_cron 扩展已启用
-- ============================================================================
-- 注意: 这些扩展需要在 Supabase Dashboard 中手动启用
-- 如果已经启用，以下语句会安全地跳过
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- pg_cron 通常已预装在 Supabase 中

-- ============================================================================
-- 2. 创建触发器函数: 当新事件插入 event_queue 时，通过 pg_net 调用 Worker
-- ============================================================================
-- 
-- 工作原理:
--   INSERT INTO event_queue -> 触发器 -> pg_net.http_post() -> process-squad-events
--
-- 为什么使用 pg_net 而不是直接在触发器中处理:
--   1. 触发器中不能执行长时间操作（会阻塞事务）
--   2. pg_net.http_post() 是异步的，不会阻塞 INSERT 操作
--   3. 即使 Worker 调用失败，INSERT 事务也不会回滚
--
-- 防止频繁触发:
--   使用 pg_net.http_post() 的异步特性，即使短时间内有大量 INSERT，
--   每次 Worker 调用都会处理一批事件（最多 10 个），不会造成问题。
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_event_queue_worker()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- 从 Vault 或环境变量获取配置
  -- 注意: 在 Supabase 中，可以通过 current_setting 获取自定义配置
  -- 如果无法获取，使用硬编码的 URL（需要在部署时更新）
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);

  -- 如果配置不可用，尝试从环境获取
  IF supabase_url IS NULL OR supabase_url = '' THEN
    -- 回退方案: 使用 Supabase 项目的固定 URL
    -- 【部署时需要更新此 URL】
    supabase_url := 'https://qcrcgpwlfouqslokwbzl.supabase.co';
  END IF;

  IF service_role_key IS NULL OR service_role_key = '' THEN
    -- 回退方案: 使用 service_role key
    -- 【部署时需要更新此 Key】
    -- 安全说明: 此 key 存储在数据库中，只有 service_role 和 superuser 可以访问
    service_role_key := current_setting('app.settings.service_role_key', true);
  END IF;

  -- 使用 pg_net 异步调用 Worker
  -- pg_net.http_post 是非阻塞的，不会影响 INSERT 性能
  IF supabase_url IS NOT NULL AND supabase_url != '' THEN
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/process-squad-events',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
      ),
      body := jsonb_build_object(
        'trigger', 'database_webhook',
        'event_id', NEW.id,
        'event_type', NEW.event_type
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION
  -- 即使 pg_net 调用失败，也不能影响 INSERT 操作
  -- 事件已经写入队列，Cron Job 会兜底处理
  WHEN OTHERS THEN
    RAISE WARNING '[EventQueue] Failed to notify worker: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建触发器
-- 只在 INSERT 时触发，UPDATE（如状态变更）不触发
DROP TRIGGER IF EXISTS trigger_notify_event_queue_worker ON event_queue;
CREATE TRIGGER trigger_notify_event_queue_worker
  AFTER INSERT ON event_queue
  FOR EACH ROW
  EXECUTE FUNCTION notify_event_queue_worker();

COMMENT ON FUNCTION notify_event_queue_worker IS '当新事件插入 event_queue 时，通过 pg_net 异步调用 process-squad-events Worker';

-- ============================================================================
-- 3. 创建 Cron Job: 每分钟检查一次队列（兜底机制）
-- ============================================================================
--
-- 为什么需要 Cron 兜底:
--   1. pg_net Webhook 是"尽力而为"的，网络问题可能导致调用失败
--   2. 指数退避的重试事件需要在 scheduled_at 到达后被重新处理
--   3. Worker 崩溃导致的锁超时事件需要被释放和重新处理
--
-- 执行频率: 每分钟一次
-- 执行内容: 调用 process-squad-events Worker
-- 
-- 注意: 以下 SQL 需要在 Supabase Dashboard > SQL Editor 中执行
-- 因为 pg_cron 需要 superuser 权限
-- ============================================================================

-- 先删除已存在的同名任务（如果有）
-- SELECT cron.unschedule('process-squad-events-cron');

-- 创建定时任务: 每分钟调用一次 Worker
-- 注意: 需要将 URL 和 Key 替换为实际值
/*
SELECT cron.schedule(
  'process-squad-events-cron',           -- 任务名称
  '* * * * *',                           -- 每分钟执行
  $$
  SELECT net.http_post(
    url := 'https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/process-squad-events',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{"trigger": "cron_job"}'::jsonb
  );
  $$
);
*/

-- ============================================================================
-- 4. 创建清理 Cron Job: 每天凌晨 3 点清理已完成的事件
-- ============================================================================
/*
SELECT cron.schedule(
  'cleanup-completed-events',            -- 任务名称
  '0 3 * * *',                           -- 每天凌晨 3 点
  $$
  SELECT cleanup_completed_events(7);    -- 保留 7 天
  $$
);
*/

-- ============================================================================
-- 5. 手动部署说明
-- ============================================================================
-- 
-- 由于 pg_cron 需要 superuser 权限，以下步骤需要在 Supabase Dashboard 中手动执行:
--
-- 步骤 1: 启用扩展
--   进入 Supabase Dashboard > Database > Extensions
--   搜索并启用: pg_net, pg_cron
--
-- 步骤 2: 配置 Cron Job
--   进入 Supabase Dashboard > SQL Editor
--   执行上面注释中的 cron.schedule SQL（取消注释并替换 Key）
--
-- 步骤 3: 验证
--   -- 查看已注册的 Cron Jobs
--   SELECT * FROM cron.job;
--   
--   -- 查看 Cron 执行历史
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--   
--   -- 查看事件队列状态
--   SELECT status, COUNT(*) FROM event_queue GROUP BY status;
--   
--   -- 查看死信队列
--   SELECT * FROM dead_letter_queue WHERE resolution_status = 'unresolved';
-- ============================================================================
