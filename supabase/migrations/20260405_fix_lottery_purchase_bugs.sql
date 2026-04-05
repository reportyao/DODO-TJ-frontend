-- ============================================================
-- DODO-TJ 一元夺宝购买Bug修复 (2026-04-05)
-- ============================================================
-- 修复内容:
--   1. 修复 allocate_lottery_tickets: 添加 status='ACTIVE' 和 numbers 字段
--      确保新旧两种查询方式都能正确获取参与码
--   2. 修复 allocate_lottery_tickets: RETURNING 加上 id 字段
--      确保 rollbackAllocatedTickets 能正确获取 entry id
--   3. 创建 rollback_lottery_sold_tickets RPC 函数
--      用于支付失败时原子性回滚 sold_tickets
-- ============================================================

-- ============================================================
-- 修复1: 重建 allocate_lottery_tickets 函数
-- 修复点:
--   a. INSERT 时同时设置 status='ACTIVE' 和 numbers 字段（兼容旧版查询）
--   b. RETURNING 加上 id 字段（供 rollback 使用）
--   c. numbers 字段设置为与 participation_code 相同的值
-- ============================================================
CREATE OR REPLACE FUNCTION allocate_lottery_tickets(
  p_lottery_id TEXT,
  p_user_id    TEXT,
  p_quantity   INTEGER,
  p_order_id   TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, ticket_number INT, participation_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_start_ticket INT;
  v_lottery RECORD;
  v_base_number INT := 1000000;
BEGIN
  SELECT * INTO v_lottery
  FROM lotteries
  WHERE id = p_lottery_id
  FOR UPDATE;

  IF v_lottery IS NULL THEN
    RAISE EXCEPTION 'Lottery not found';
  END IF;

  IF v_lottery.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Lottery is not active';
  END IF;

  IF v_lottery.sold_tickets + p_quantity > v_lottery.total_tickets THEN
    RAISE EXCEPTION 'Not enough tickets available';
  END IF;

  SELECT COALESCE(MAX(le.ticket_number), 0) + 1 INTO v_start_ticket
  FROM lottery_entries le
  WHERE le.lottery_id = p_lottery_id;

  RETURN QUERY
  INSERT INTO lottery_entries (
    user_id, lottery_id, order_id,
    ticket_number, participation_code,
    numbers, status,
    is_winning, created_at, updated_at
  )
  SELECT
    p_user_id,
    p_lottery_id,
    p_order_id,
    v_start_ticket + i - 1,
    (v_base_number + v_start_ticket + i - 2)::TEXT,
    to_jsonb((v_base_number + v_start_ticket + i - 2)::TEXT),
    'ACTIVE',
    false,
    NOW(),
    NOW()
  FROM generate_series(1, p_quantity) AS i
  RETURNING lottery_entries.id, lottery_entries.ticket_number, lottery_entries.participation_code;

  UPDATE lotteries
  SET sold_tickets = sold_tickets + p_quantity,
      updated_at = NOW()
  WHERE id = p_lottery_id;
END;
$func$;

COMMENT ON FUNCTION allocate_lottery_tickets IS 
'原子性分配夺宝参与码（修复版）- 同时写入 participation_code、numbers、status 字段，RETURNING 包含 id';

-- ============================================================
-- 修复2: 创建 rollback_lottery_sold_tickets RPC 函数
-- 用于支付失败时原子性回滚 sold_tickets
-- 参考 cancel_order_and_refund 中的回滚逻辑
-- ============================================================
CREATE OR REPLACE FUNCTION rollback_lottery_sold_tickets(
  p_lottery_id TEXT,
  p_quantity   INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  UPDATE lotteries
  SET sold_tickets = GREATEST(0, sold_tickets - p_quantity),
      updated_at = NOW()
  WHERE id = p_lottery_id;
END;
$func$;

COMMENT ON FUNCTION rollback_lottery_sold_tickets IS 
'回滚夺宝已售数量 - 用于支付失败时将 sold_tickets 减回，确保与 lottery_entries 数量一致';

-- ============================================================
-- 修复3: 修复历史数据 - 为缺少 participation_code 的旧 entry 补充该字段
-- 旧版 purchase_lottery_with_concurrency_control 只写入 numbers 字段
-- 新版 allocate_lottery_tickets 只写入 participation_code 字段
-- 这里将 numbers 字段的值同步到 participation_code
-- ============================================================
UPDATE lottery_entries
SET participation_code = 
  CASE 
    WHEN numbers IS NOT NULL AND numbers::text != 'null' THEN
      -- numbers 可能是 JSON 字符串如 '"1000000"' 或纯数字
      TRIM(BOTH '"' FROM numbers::text)
    ELSE NULL
  END,
  updated_at = NOW()
WHERE participation_code IS NULL
  AND numbers IS NOT NULL
  AND numbers::text != 'null';

-- 同时为缺少 numbers 的新 entry 补充该字段
UPDATE lottery_entries
SET numbers = to_jsonb(participation_code),
    updated_at = NOW()
WHERE numbers IS NULL
  AND participation_code IS NOT NULL;

-- 为缺少 status 的 entry 设置默认值
UPDATE lottery_entries
SET status = 'ACTIVE',
    updated_at = NOW()
WHERE status IS NULL;
