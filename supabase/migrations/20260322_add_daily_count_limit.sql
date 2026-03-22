-- 添加 daily_count_limit 字段到 promoter_profiles 表
-- 用于管理员灵活配置每个地推人员的每日充值次数上限
ALTER TABLE promoter_profiles 
ADD COLUMN IF NOT EXISTS daily_count_limit INTEGER DEFAULT 10;

COMMENT ON COLUMN promoter_profiles.daily_count_limit IS '每日充值次数上限，默认10次';
