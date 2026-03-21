-- Fix A22: 为 admin_users 表添加登录失败计数和锁定字段
-- 防止暴力破解攻击：连续 5 次失败后锁定 15 分钟

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN admin_users.failed_login_attempts IS '连续登录失败次数，成功登录后重置为 0';
COMMENT ON COLUMN admin_users.locked_until IS '账户锁定截止时间，NULL 表示未锁定';
