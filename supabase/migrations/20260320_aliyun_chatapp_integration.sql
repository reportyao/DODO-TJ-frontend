-- ============================================================
-- 阿里云 ChatApp API 集成补充迁移
-- 日期: 2026-03-20
-- 说明: 为 notification_queue 表添加阿里云 CAMS API 返回的消息 ID 字段
-- ============================================================

-- 添加 external_message_id 字段，用于存储阿里云 CAMS API 返回的 MessageId
-- 便于后续查询消息状态和排查发送问题
ALTER TABLE notification_queue
  ADD COLUMN IF NOT EXISTS external_message_id TEXT;

-- 为 external_message_id 添加注释
COMMENT ON COLUMN notification_queue.external_message_id
  IS '外部消息平台返回的消息ID（如阿里云 CAMS 的 MessageId），用于追踪消息状态';

-- 为常用查询添加索引（可选，按需启用）
-- CREATE INDEX IF NOT EXISTS idx_notification_queue_external_message_id
--   ON notification_queue(external_message_id)
--   WHERE external_message_id IS NOT NULL;

-- ============================================================
-- 通知类型白名单说明（仅以下类型会被 WhatsApp 发送器处理）：
--   1. promoter_deposit  - 地推充值到账（含赠送积分）
--   2. wallet_deposit    - 普通充值到账
--   3. batch_arrived     - 提货码通知（商品到达自提点）
-- 其他类型会被标记为 skipped，不发送 WhatsApp 消息
-- ============================================================
