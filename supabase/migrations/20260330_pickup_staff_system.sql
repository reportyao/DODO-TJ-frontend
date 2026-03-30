-- ============================================================
-- DODO 前端提货核销功能 — 数据库迁移
-- 日期: 2026-03-30
-- 功能:
--   1. 创建核销员档案表 pickup_staff_profiles
--   2. 修复 pickup_logs 表的 operator_id 类型 (UUID → TEXT)
--   3. 修复 pickup_logs 表的 RLS 策略 (user_id → operator_id)
--   4. 扩展 pickup_logs 表 (新增 order_type, source, proof_image_url)
--   5. 创建核销员身份检查 RPC 函数
-- ============================================================

-- ============================================================
-- 1. 创建核销员档案表
-- 设计模式参考 promoter_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS pickup_staff_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    point_id UUID REFERENCES pickup_points(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'inactive')),
    created_by TEXT,          -- 哪个管理员添加的
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE pickup_staff_profiles IS '前端核销员档案，标记拥有核销权限的普通用户';
COMMENT ON COLUMN pickup_staff_profiles.point_id IS '绑定的自提点，核销日志自动关联此自提点';
COMMENT ON COLUMN pickup_staff_profiles.status IS 'active=启用, inactive=停用';

-- 索引
CREATE INDEX IF NOT EXISTS idx_pickup_staff_point 
    ON pickup_staff_profiles(point_id);
CREATE INDEX IF NOT EXISTS idx_pickup_staff_status 
    ON pickup_staff_profiles(status);

-- RLS
ALTER TABLE pickup_staff_profiles ENABLE ROW LEVEL SECURITY;

-- 允许所有人读取（前端通过 anon key 判断入口是否显示）
-- Edge Function 使用 service_role_key 完全访问
CREATE POLICY "anon_select_pickup_staff" ON pickup_staff_profiles
    FOR SELECT USING (true);

-- ============================================================
-- 2. 修复 pickup_logs.operator_id 类型
-- users.id 是 TEXT 类型，但 pickup_logs.operator_id 定义为 UUID
-- 将其改为 TEXT 以保持一致性
-- ============================================================
DO $$
BEGIN
    -- 检查 operator_id 列是否存在且为 UUID 类型
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'pickup_logs' 
        AND column_name = 'operator_id'
        AND data_type = 'uuid'
    ) THEN
        ALTER TABLE pickup_logs ALTER COLUMN operator_id TYPE TEXT USING operator_id::TEXT;
        RAISE NOTICE 'pickup_logs.operator_id 类型已从 UUID 修改为 TEXT';
    ELSE
        RAISE NOTICE 'pickup_logs.operator_id 已经是 TEXT 类型或不存在，跳过';
    END IF;
END $$;

-- ============================================================
-- 3. 修复 pickup_logs 表的 RLS 策略
-- 原策略错误引用了不存在的 user_id 字段，修复为 operator_id
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own pickup logs" ON pickup_logs;

CREATE POLICY "Users can view their own pickup logs"
    ON pickup_logs FOR SELECT
    USING (operator_id = get_session_user_id());

-- 额外添加：允许 service_role 插入（Edge Function 使用）
-- 注意：service_role 默认绕过 RLS，此策略主要为了文档完整性
DROP POLICY IF EXISTS "Service role can insert pickup logs" ON pickup_logs;
CREATE POLICY "Service role can insert pickup logs"
    ON pickup_logs FOR INSERT
    WITH CHECK (true);

-- ============================================================
-- 4. 扩展 pickup_logs 表
-- 新增字段：order_type, source, proof_image_url
-- ============================================================

-- 4.1 订单类型字段（claim-prize 已在使用，但表中缺少此列）
ALTER TABLE pickup_logs 
    ADD COLUMN IF NOT EXISTS order_type TEXT;
COMMENT ON COLUMN pickup_logs.order_type IS '订单类型: lottery / group_buy / full_purchase';

-- 4.2 核销来源字段（区分管理后台核销 vs 前端核销员核销）
ALTER TABLE pickup_logs 
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'admin';
COMMENT ON COLUMN pickup_logs.source IS '核销来源: admin=管理后台, frontend_staff=前端核销员';

-- 4.3 核销凭证照片URL
ALTER TABLE pickup_logs 
    ADD COLUMN IF NOT EXISTS proof_image_url TEXT;
COMMENT ON COLUMN pickup_logs.proof_image_url IS '核销凭证照片URL';

-- ============================================================
-- 5. 创建核销员身份检查 RPC 函数
-- 前端 ProfilePage 调用此函数判断是否显示核销入口
-- 使用 SECURITY DEFINER 确保可以读取 pickup_staff_profiles
-- ============================================================
CREATE OR REPLACE FUNCTION check_pickup_staff_status(p_user_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'is_staff', TRUE,
        'point_id', psp.point_id,
        'point_name', pp.name,
        'point_name_i18n', pp.name_i18n,
        'status', psp.status
    ) INTO result
    FROM pickup_staff_profiles psp
    LEFT JOIN pickup_points pp ON pp.id = psp.point_id
    WHERE psp.user_id = p_user_id 
      AND psp.status = 'active';
    
    IF result IS NULL THEN
        RETURN json_build_object('is_staff', FALSE);
    END IF;
    
    RETURN result;
END;
$$;

-- 授权 anon 角色可以调用（前端需要通过 anon key 调用）
GRANT EXECUTE ON FUNCTION check_pickup_staff_status(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_pickup_staff_status(TEXT) TO authenticated;

-- ============================================================
-- 完成
-- ============================================================
