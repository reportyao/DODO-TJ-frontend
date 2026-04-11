-- 阶段3+4: 添加 AI 商品理解字段
-- 为 inventory_products 和 lotteries 表添加 ai_understanding JSONB 列

-- 1. inventory_products 表
ALTER TABLE inventory_products
ADD COLUMN IF NOT EXISTS ai_understanding JSONB DEFAULT NULL;

COMMENT ON COLUMN inventory_products.ai_understanding IS 'AI 商品理解数据（target_people, selling_angle, best_scene, local_life_connection, recommended_badge 等）';

-- 2. lotteries 表（商城商品同步）
ALTER TABLE lotteries
ADD COLUMN IF NOT EXISTS ai_understanding JSONB DEFAULT NULL;

COMMENT ON COLUMN lotteries.ai_understanding IS 'AI 商品理解数据（从关联的 inventory_products 同步）';

-- 3. 创建索引（用于查询有/无 AI 理解的商品）
CREATE INDEX IF NOT EXISTS idx_inventory_products_ai_understanding_not_null
ON inventory_products ((ai_understanding IS NOT NULL));
