-- ============================================
-- 统一佣金体系：删除废弃字段，确保只有一套佣金配置
-- ============================================
-- 问题根因：
--   commission_settings 表同时存在 rate (小数) 和 percent (整数) 两个佣金比例字段
--   管理后台只读写 rate，percent 是遗留字段，从未被管理后台更新
--   导致 rate 和 percent 数值不一致，造成混淆
--
-- 修复方案：
--   1. 删除 commission_settings 表的 percent 列（废弃）
--   2. 删除 commission_settings 表的 key 和 value 列（旧体系遗留）
--   3. 修正 description 与 rate 保持一致
-- ============================================

-- Step 1: 删除 commission_settings 表的废弃列
ALTER TABLE commission_settings DROP COLUMN IF EXISTS percent;
ALTER TABLE commission_settings DROP COLUMN IF EXISTS key;
ALTER TABLE commission_settings DROP COLUMN IF EXISTS value;

-- Step 1b: 删除 commissions 表的废弃 percent 列
-- 该列由 Edge Function 写入 (percent = rate * 100)，但没有任何代码读取它
-- 管理后台佣金记录页面使用 rate 字段显示比例
ALTER TABLE commissions DROP COLUMN IF EXISTS percent;

-- Step 2: 修正 description 与 rate 保持一致
-- L1: rate=0.1 (10%), description 之前写的是 "8%"
UPDATE commission_settings 
SET description = '一级分销佣金：直接下级购买金额的 ' || (rate * 100)::text || '%',
    updated_at = NOW()
WHERE level = 1;

-- L2: rate=0.04 (4%), description 正确
UPDATE commission_settings 
SET description = '二级分销佣金：二级下级购买金额的 ' || (rate * 100)::text || '%',
    updated_at = NOW()
WHERE level = 2;

-- L3: rate=0.01 (1%), description 之前写的是 "2%"
UPDATE commission_settings 
SET description = '三级分销佣金：三级下级购买金额的 ' || (rate * 100)::text || '%',
    updated_at = NOW()
WHERE level = 3;

-- Step 3: 添加注释说明
COMMENT ON TABLE commission_settings IS '返利比例配置表 - 唯一权威来源，管理后台读写 rate 字段';
COMMENT ON COLUMN commission_settings.rate IS '返利比例（小数形式），0.1 表示 10%。管理后台唯一读写的佣金比例字段';
