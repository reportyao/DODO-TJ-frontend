-- ============================================================
-- R18 修复: full_purchase_orders 表补充自提核销相关字段
-- 
-- 问题：full_purchase_orders 表缺少以下字段：
--   - pickup_status: 提货状态（PENDING_CLAIM/PENDING_PICKUP/PICKED_UP/EXPIRED）
--   - picked_up_at: 实际提货时间
--   - picked_up_by: 核销操作员 ID
--   - expires_at: 提货码过期时间
-- 
-- 影响：管理员在 PickupVerificationPage 核销全款购买订单时，
--   更新 pickup_status/picked_up_at/picked_up_by 字段会静默失败，
--   且无法正确判断订单是否可核销或是否已过期。
-- ============================================================

-- 1. 添加 pickup_status 字段
ALTER TABLE full_purchase_orders
  ADD COLUMN IF NOT EXISTS pickup_status TEXT DEFAULT 'PENDING_CLAIM'
    CHECK (pickup_status IN ('PENDING_CLAIM', 'PENDING_PICKUP', 'READY_FOR_PICKUP', 'PICKED_UP', 'EXPIRED'));

-- 2. 添加 picked_up_at 字段（实际提货时间）
ALTER TABLE full_purchase_orders
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP WITH TIME ZONE;

-- 3. 添加 picked_up_by 字段（核销操作员 ID）
ALTER TABLE full_purchase_orders
  ADD COLUMN IF NOT EXISTS picked_up_by TEXT;

-- 4. 添加 expires_at 字段（提货码过期时间，默认30天后）
ALTER TABLE full_purchase_orders
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- 5. 为已存在的记录设置默认 pickup_status
-- 已完成物流的订单设为 PENDING_CLAIM，其他保持 PENDING_CLAIM
UPDATE full_purchase_orders
  SET pickup_status = CASE
    WHEN logistics_status = 'PICKED_UP' THEN 'PICKED_UP'
    WHEN logistics_status = 'ARRIVED' THEN 'PENDING_PICKUP'
    ELSE 'PENDING_CLAIM'
  END
WHERE pickup_status IS NULL OR pickup_status = 'PENDING_CLAIM';

-- 6. 为已存在的记录设置 expires_at（如果为空，设为创建时间 + 30天）
UPDATE full_purchase_orders
  SET expires_at = created_at + INTERVAL '30 days'
WHERE expires_at IS NULL;

-- 7. 创建索引
CREATE INDEX IF NOT EXISTS idx_full_purchase_orders_pickup_status
  ON full_purchase_orders(pickup_status);

CREATE INDEX IF NOT EXISTS idx_full_purchase_orders_expires_at
  ON full_purchase_orders(expires_at);

-- 8. 添加注释
COMMENT ON COLUMN full_purchase_orders.pickup_status IS '提货状态: PENDING_CLAIM(待到货)/PENDING_PICKUP(可提货)/READY_FOR_PICKUP(准备就绪)/PICKED_UP(已提货)/EXPIRED(已过期)';
COMMENT ON COLUMN full_purchase_orders.picked_up_at IS '实际提货时间';
COMMENT ON COLUMN full_purchase_orders.picked_up_by IS '核销操作员 ID';
COMMENT ON COLUMN full_purchase_orders.expires_at IS '提货码过期时间';
