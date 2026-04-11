-- DODO-TJ 抽奖分配函数线上热修复 (2026-04-11)
-- ============================================================
-- 背景：线上 allocate_lottery_tickets 仍存在 "column reference id is ambiguous"
-- 问题，导致一元夺宝购买链路在 RPC 分配参与码阶段返回 500。
--
-- 处理：
--   1. 删除旧版 3/4 参数函数定义，避免签名冲突
--   2. 以全限定列名重建 4 参数版本
--   3. 使用 CTE + 显式别名返回，彻底消除 id 歧义
--   4. 保留 numbers/status/id 返回等既有业务兼容行为
-- ============================================================

DROP FUNCTION IF EXISTS allocate_lottery_tickets(TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS allocate_lottery_tickets(TEXT, TEXT, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION allocate_lottery_tickets(
  p_lottery_id TEXT,
  p_user_id    TEXT,
  p_quantity   INTEGER,
  p_order_id   TEXT DEFAULT NULL
)
RETURNS TABLE(entry_id UUID, ticket_number INT, participation_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_start_ticket INT;
  v_lottery lotteries%ROWTYPE;
  v_base_number INT := 1000000;
BEGIN
  SELECT *
  INTO v_lottery
  FROM lotteries l
  WHERE l.id = p_lottery_id
  FOR UPDATE;

  IF v_lottery IS NULL THEN
    RAISE EXCEPTION 'Lottery not found';
  END IF;

  IF v_lottery.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Lottery is not active';
  END IF;

  IF v_lottery.sold_tickets + p_quantity > v_lottery.total_tickets THEN
    RAISE EXCEPTION 'Not enough tickets available';
  END IF;

  SELECT COALESCE(MAX(le.ticket_number), 0) + 1
  INTO v_start_ticket
  FROM lottery_entries le
  WHERE le.lottery_id = p_lottery_id;

  RETURN QUERY
  WITH inserted_entries AS (
    INSERT INTO lottery_entries (
      user_id,
      lottery_id,
      order_id,
      ticket_number,
      participation_code,
      numbers,
      status,
      is_winning,
      created_at
    )
    SELECT
      p_user_id,
      p_lottery_id,
      p_order_id,
      v_start_ticket + gs.i - 1,
      (v_base_number + v_start_ticket + gs.i - 2)::TEXT,
      (v_base_number + v_start_ticket + gs.i - 2)::TEXT,
      'ACTIVE',
      false,
      NOW()
    FROM generate_series(1, p_quantity) AS gs(i)
    RETURNING
      lottery_entries.id AS entry_id,
      lottery_entries.ticket_number,
      lottery_entries.participation_code
  )
  SELECT
    ie.entry_id,
    ie.ticket_number,
    ie.participation_code
  FROM inserted_entries ie;

  UPDATE lotteries l
  SET sold_tickets = l.sold_tickets + p_quantity,
      updated_at = NOW()
  WHERE l.id = p_lottery_id;
END;
$func$;

COMMENT ON FUNCTION allocate_lottery_tickets(TEXT, TEXT, INTEGER, TEXT) IS
'原子性分配夺宝参与码（2026-04-11 热修复版）：消除 id 列歧义，兼容 participation_code/numbers/status 写入与回滚链路';

GRANT EXECUTE ON FUNCTION allocate_lottery_tickets(TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated, service_role;
