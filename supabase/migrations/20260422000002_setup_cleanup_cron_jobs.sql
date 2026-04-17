-- ============================================================
-- 配置定时清理任务
-- 1. cleanup-expired-lotteries: 每5分钟清理过期的 ACTIVE 夺宝商品
-- 2. cleanup-stale-orders: 每10分钟清理卡滞的 PENDING 全款订单
-- ============================================================

-- 1. 定时清理过期夺宝商品（每5分钟）
SELECT cron.schedule(
  'cleanup-expired-lotteries',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/cleanup-expired-lotteries',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- 2. 定时清理卡滞全款订单（每10分钟）
SELECT cron.schedule(
  'cleanup-stale-orders',
  '*/10 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/cleanup-stale-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- 添加 EXPIRED 状态到首页查询索引（提升过滤性能）
CREATE INDEX IF NOT EXISTS idx_lotteries_expired_end_time
  ON lotteries(status, end_time)
  WHERE status = 'ACTIVE';

-- 添加 PENDING 全款订单查询索引
CREATE INDEX IF NOT EXISTS idx_full_purchase_orders_pending_created
  ON full_purchase_orders(status, created_at)
  WHERE status = 'PENDING';
