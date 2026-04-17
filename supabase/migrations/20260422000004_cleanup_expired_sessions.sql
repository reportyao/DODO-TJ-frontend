-- ============================================================
-- Migration: 定期清理过期的 admin_sessions 和 user_sessions
-- 问题: 数据库中存在大量已过期但仍标记为 active 的会话记录
-- ============================================================

-- 1. 立即清理已过期的 admin_sessions
UPDATE admin_sessions
SET is_active = false
WHERE is_active = true
  AND expires_at < NOW();

-- 2. 立即清理已过期的 user_sessions
UPDATE user_sessions
SET is_active = false
WHERE is_active = true
  AND expires_at < NOW();

-- 3. 创建数据库函数：定期清理过期会话
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_count INT;
  user_count INT;
BEGIN
  -- 清理过期的 admin_sessions
  UPDATE admin_sessions
  SET is_active = false
  WHERE is_active = true
    AND expires_at < NOW();
  GET DIAGNOSTICS admin_count = ROW_COUNT;

  -- 清理过期的 user_sessions
  UPDATE user_sessions
  SET is_active = false
  WHERE is_active = true
    AND expires_at < NOW();
  GET DIAGNOSTICS user_count = ROW_COUNT;

  -- 记录清理结果
  IF admin_count > 0 OR user_count > 0 THEN
    RAISE LOG 'cleanup_expired_sessions: deactivated % admin sessions, % user sessions',
      admin_count, user_count;
  END IF;
END;
$$;

-- 仅允许 service_role 调用
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sessions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sessions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO service_role;

-- 4. 设置 pg_cron 定时任务：每小时清理一次过期会话
SELECT cron.schedule(
  'cleanup-expired-sessions',
  '0 * * * *',  -- 每小时整点执行
  $$SELECT public.cleanup_expired_sessions()$$
);

-- 5. 为 expires_at + is_active 添加索引（加速清理查询）
CREATE INDEX IF NOT EXISTS idx_admin_sessions_active_expires
  ON admin_sessions (is_active, expires_at)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_sessions_active_expires
  ON user_sessions (is_active, expires_at)
  WHERE is_active = true;
