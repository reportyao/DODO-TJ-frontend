-- ============================================================
-- 迁移: 修复 pickup_status 为 null 的历史数据
-- 日期: 2026-03-25
-- 问题: update-batch-status 和 add-orders-to-batch 中
--       FULL_PURCHASE 类型订单未同步设置 pickup_status，
--       导致核销失败和 pending-pickups 页面无法显示数据
-- 修复: 根据 logistics_status 回填 pickup_status
-- ============================================================

-- 1. 修复 full_purchase_orders 中 pickup_status 为 null 的记录
-- 已有提货码且物流状态为 READY_FOR_PICKUP 的，设置为 PENDING_PICKUP
UPDATE full_purchase_orders
SET pickup_status = 'PENDING_PICKUP'
WHERE pickup_status IS NULL
  AND pickup_code IS NOT NULL
  AND logistics_status = 'READY_FOR_PICKUP';

-- 已有提货码但物流状态不是 PICKED_UP 的，也设置为 PENDING_PICKUP
UPDATE full_purchase_orders
SET pickup_status = 'PENDING_PICKUP'
WHERE pickup_status IS NULL
  AND pickup_code IS NOT NULL
  AND (logistics_status IS NULL OR logistics_status NOT IN ('PICKED_UP'));

-- 物流状态为 PICKED_UP 的，设置为 PICKED_UP
UPDATE full_purchase_orders
SET pickup_status = 'PICKED_UP'
WHERE pickup_status IS NULL
  AND logistics_status = 'PICKED_UP';

-- 没有提货码的保持默认 PENDING_CLAIM
UPDATE full_purchase_orders
SET pickup_status = 'PENDING_CLAIM'
WHERE pickup_status IS NULL
  AND pickup_code IS NULL;

-- 2. 修复 prizes 中 pickup_status 为 null 的记录
UPDATE prizes
SET pickup_status = 'PENDING_PICKUP'
WHERE pickup_status IS NULL
  AND pickup_code IS NOT NULL
  AND logistics_status = 'READY_FOR_PICKUP';

UPDATE prizes
SET pickup_status = 'PENDING_PICKUP'
WHERE pickup_status IS NULL
  AND pickup_code IS NOT NULL
  AND (logistics_status IS NULL OR logistics_status NOT IN ('PICKED_UP'));

UPDATE prizes
SET pickup_status = 'PICKED_UP'
WHERE pickup_status IS NULL
  AND logistics_status = 'PICKED_UP';

UPDATE prizes
SET pickup_status = 'PENDING_CLAIM'
WHERE pickup_status IS NULL
  AND pickup_code IS NULL;

-- 3. 修复 group_buy_results 中 pickup_status 为 null 的记录
UPDATE group_buy_results
SET pickup_status = 'PENDING_PICKUP'
WHERE pickup_status IS NULL
  AND pickup_code IS NOT NULL
  AND logistics_status = 'READY_FOR_PICKUP';

UPDATE group_buy_results
SET pickup_status = 'PENDING_PICKUP'
WHERE pickup_status IS NULL
  AND pickup_code IS NOT NULL
  AND (logistics_status IS NULL OR logistics_status NOT IN ('PICKED_UP'));

UPDATE group_buy_results
SET pickup_status = 'PICKED_UP'
WHERE pickup_status IS NULL
  AND logistics_status = 'PICKED_UP';

UPDATE group_buy_results
SET pickup_status = 'PENDING_CLAIM'
WHERE pickup_status IS NULL
  AND pickup_code IS NULL;
