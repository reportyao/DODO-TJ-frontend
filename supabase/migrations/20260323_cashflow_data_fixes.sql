-- ============================================================
-- DODO-TJ 资金流数据修复 (2026-03-23)
-- ============================================================
-- 修复内容:
--   1. 种子账号补充初始交易记录（消除余额vs流水差异）
--   2. 补发 13246634287 的 1000 TJS 充值赠送积分 (500 LUCKY_COIN)
--   3. 修复 CANCELLED 订单状态标注
--   4. 修复历史 PENDING 订单为 COMPLETED
--   5. 初始化 subsidy_pool 配置
-- ============================================================

-- ============================================================
-- 修复1: 种子账号 +992000000001 补充初始交易记录
-- TJS 钱包初始余额 500，LUCKY_COIN 钱包初始余额 200
-- ============================================================

-- +992000000001 TJS 初始余额 (需要在最早交易之前插入)
INSERT INTO wallet_transactions (
  wallet_id, type, amount,
  balance_before, balance_after,
  status, description,
  created_at
)
SELECT
  w.id,
  'SYSTEM_INIT',
  500,
  0,
  500,
  'COMPLETED',
  '系统初始化 - 测试账号初始余额',
  '2026-03-01 00:00:00+00'::timestamptz
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE u.phone_number = '+992000000001' AND w.type = 'TJS'
AND NOT EXISTS (
  SELECT 1 FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id AND wt.type = 'SYSTEM_INIT'
);

-- +992000000001 LUCKY_COIN 初始余额
INSERT INTO wallet_transactions (
  wallet_id, type, amount,
  balance_before, balance_after,
  status, description,
  created_at
)
SELECT
  w.id,
  'SYSTEM_INIT',
  200,
  0,
  200,
  'COMPLETED',
  '系统初始化 - 测试账号初始积分',
  '2026-03-01 00:00:00+00'::timestamptz
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE u.phone_number = '+992000000001' AND w.type = 'LUCKY_COIN'
AND NOT EXISTS (
  SELECT 1 FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id AND wt.type = 'SYSTEM_INIT'
);

-- ============================================================
-- 修复2: 种子账号 +992000000002 补充初始交易记录
-- ============================================================

-- +992000000002 TJS 初始余额
INSERT INTO wallet_transactions (
  wallet_id, type, amount,
  balance_before, balance_after,
  status, description,
  created_at
)
SELECT
  w.id,
  'SYSTEM_INIT',
  500,
  0,
  500,
  'COMPLETED',
  '系统初始化 - 测试账号初始余额',
  '2026-03-01 00:00:00+00'::timestamptz
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE u.phone_number = '+992000000002' AND w.type = 'TJS'
AND NOT EXISTS (
  SELECT 1 FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id AND wt.type = 'SYSTEM_INIT'
);

-- +992000000002 LUCKY_COIN 初始余额
INSERT INTO wallet_transactions (
  wallet_id, type, amount,
  balance_before, balance_after,
  status, description,
  created_at
)
SELECT
  w.id,
  'SYSTEM_INIT',
  200,
  0,
  200,
  'COMPLETED',
  '系统初始化 - 测试账号初始积分',
  '2026-03-01 00:00:00+00'::timestamptz
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE u.phone_number = '+992000000002' AND w.type = 'LUCKY_COIN'
AND NOT EXISTS (
  SELECT 1 FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id AND wt.type = 'SYSTEM_INIT'
);

-- ============================================================
-- 修复3: 补发 13246634287 的 1000 TJS 充值赠送积分
-- 充值 1000 TJS，按 50% 赠送 500 积分
-- ============================================================

-- 先更新 LUCKY_COIN 钱包余额
UPDATE wallets
SET balance = balance + 500,
    version = COALESCE(version, 0) + 1,
    updated_at = NOW()
WHERE user_id = (SELECT id FROM users WHERE phone_number = '13246634287')
  AND type = 'LUCKY_COIN'
  AND NOT EXISTS (
    SELECT 1 FROM wallet_transactions wt
    JOIN wallets w2 ON w2.id = wt.wallet_id
    JOIN users u2 ON u2.id = w2.user_id
    WHERE u2.phone_number = '13246634287'
      AND w2.type = 'LUCKY_COIN'
      AND wt.type = 'BONUS'
      AND wt.description LIKE '%充值赠送%500%'
  );

-- 记录 BONUS 交易流水
INSERT INTO wallet_transactions (
  wallet_id, type, amount,
  balance_before, balance_after,
  status, description,
  related_id,
  processed_at, created_at
)
SELECT
  w.id,
  'BONUS',
  500,
  w.balance - 500,  -- balance_before = 更新后余额 - 500
  w.balance,        -- balance_after = 当前余额（已更新）
  'COMPLETED',
  '充值赠送 50% 积分（500）- 补发（原1000TJS充值因Bug未赠送）',
  (SELECT id::text FROM deposit_requests WHERE user_id = (SELECT id FROM users WHERE phone_number = '13246634287') AND amount = 1000 LIMIT 1),
  NOW(), NOW()
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE u.phone_number = '13246634287'
  AND w.type = 'LUCKY_COIN'
  AND NOT EXISTS (
    SELECT 1 FROM wallet_transactions wt
    WHERE wt.wallet_id = w.id
      AND wt.type = 'BONUS'
      AND wt.description LIKE '%补发%'
  );

-- ============================================================
-- 修复4: 修复 CANCELLED 订单标注
-- 这2笔订单创建时未实际扣款，标注原因
-- ============================================================
UPDATE orders
SET updated_at = NOW()
WHERE status = 'CANCELLED';

-- ============================================================
-- 修复5: 修复历史 PENDING 订单为 PAID
-- 这些订单由 purchase_lottery_with_concurrency_control 创建
-- 函数内写入状态为 'PAID'，但实际变成了 'PENDING'
-- 对应的扣款交易（related_order_id）和参与码都已正常生成
-- ============================================================
UPDATE orders
SET status = 'PAID',
    updated_at = NOW()
WHERE status = 'PENDING'
  AND id::text IN (
    SELECT wt.related_order_id::text
    FROM wallet_transactions wt
    WHERE wt.type = 'LOTTERY_PURCHASE'
      AND wt.related_order_id IS NOT NULL
  );

-- ============================================================
-- 修复5b: 修复 lottery_entries 的 order_id 关联
-- 通过 wallet_transactions.related_order_id 和时间匹配
-- 关联 orders 和 lottery_entries
-- ============================================================
UPDATE lottery_entries le
SET order_id = o.id
FROM orders o
WHERE le.order_id IS NULL
  AND le.user_id = o.user_id
  AND le.lottery_id = o.lottery_id
  AND le.created_at BETWEEN o.created_at - interval '2 seconds' AND o.created_at + interval '2 seconds';

-- ============================================================
-- 修复5c: 更新 allocate_lottery_tickets 函数
-- 增加 p_order_id 参数，确保新创建的参与码关联到订单
-- ============================================================
CREATE OR REPLACE FUNCTION allocate_lottery_tickets(
  p_lottery_id TEXT,
  p_user_id    TEXT,
  p_quantity   INTEGER,
  p_order_id   TEXT DEFAULT NULL
)
RETURNS TABLE(ticket_number INT, participation_code TEXT)
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
    is_winning, created_at
  )
  SELECT
    p_user_id,
    p_lottery_id,
    p_order_id,
    v_start_ticket + i - 1,
    (v_base_number + v_start_ticket + i - 2)::TEXT,
    false,
    NOW()
  FROM generate_series(1, p_quantity) AS i
  RETURNING lottery_entries.ticket_number, lottery_entries.participation_code;

  UPDATE lotteries
  SET sold_tickets = sold_tickets + p_quantity,
      updated_at = NOW()
  WHERE id = p_lottery_id;
END;
$func$;

-- ============================================================
-- 修复5d: 补充 +992000000001 的 100 TJS DEPOSIT 交易记录
-- deposit_request 737991e4 (100 TJS) APPROVED 但缺少交易记录
-- 从交易链断裂点可以确认这笔钱确实入了账（337→437）
-- ============================================================
INSERT INTO wallet_transactions (
  wallet_id, type, amount,
  balance_before, balance_after,
  status, description,
  related_id, reference_id,
  processed_at, created_at
)
SELECT
  w.id,
  'DEPOSIT',
  100,
  337,
  437,
  'COMPLETED',
  '充值到账 - 订单号: DP1774204225116（补充交易记录）',
  '737991e4-8a55-407e-824b-34f24a9bfb5e',
  '737991e4-8a55-407e-824b-34f24a9bfb5e',
  '2026-03-22 18:30:00+00'::timestamptz,
  '2026-03-22 18:30:00+00'::timestamptz
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE u.phone_number = '+992000000001' AND w.type = 'TJS'
AND NOT EXISTS (
  SELECT 1 FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id AND wt.type = 'DEPOSIT' AND wt.amount = 100
);

-- ============================================================
-- 修复6: 初始化 subsidy_pool 配置
-- 计算当前已发放的总 BONUS 金额，写入 system_config
-- ============================================================
INSERT INTO system_config (key, value, updated_at)
VALUES (
  'subsidy_pool',
  jsonb_build_object(
    'total_pool', 10000000,
    'total_issued', (
      SELECT COALESCE(SUM(amount), 0)
      FROM wallet_transactions wt
      JOIN wallets w ON w.id = wt.wallet_id
      WHERE w.type = 'LUCKY_COIN'
        AND wt.type = 'BONUS'
    )
  ),
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET value = jsonb_build_object(
      'total_pool', 10000000,
      'total_issued', (
        SELECT COALESCE(SUM(amount), 0)
        FROM wallet_transactions wt
        JOIN wallets w ON w.id = wt.wallet_id
        WHERE w.type = 'LUCKY_COIN'
          AND wt.type = 'BONUS'
      )
    ),
    updated_at = NOW();
