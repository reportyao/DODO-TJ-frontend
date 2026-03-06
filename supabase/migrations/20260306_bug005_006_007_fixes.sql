-- ============================================================================
-- Migration: BUG-005 / BUG-006 / BUG-007 安全修复
-- Date: 2026-03-06
-- Description:
--   BUG-005: 创建 exchange_balance_atomic RPC 函数，替代 Edge Function 多步操作
--   BUG-006: 创建 market_purchase_atomic RPC 函数，替代 Edge Function 多步操作
--   BUG-007: 修复 deposit_requests 状态大小写不一致 + 添加 CHECK 约束
-- ============================================================================

-- ============================================================================
-- BUG-005: exchange_balance_atomic RPC 函数
-- 将 TJS 兑换 LUCKY_COIN 的操作封装为数据库事务
-- 使用 FOR UPDATE 行级锁防止并发冲突
-- ============================================================================

CREATE OR REPLACE FUNCTION exchange_balance_atomic(
  p_user_id TEXT,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_wallet RECORD;
  v_target_wallet RECORD;
  v_available_balance NUMERIC;
  v_source_balance_before NUMERIC;
  v_target_balance_before NUMERIC;
  v_source_balance_after NUMERIC;
  v_target_balance_after NUMERIC;
BEGIN
  -- ========== 参数验证 ==========
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '用户ID不能为空');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '兑换金额必须大于0');
  END IF;

  -- ========== 锁定源钱包（TJS） ==========
  SELECT * INTO v_source_wallet
  FROM wallets
  WHERE user_id = p_user_id
    AND type = 'TJS'
    AND currency = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '未找到余额钱包');
  END IF;

  -- ========== 锁定目标钱包（LUCKY_COIN） ==========
  SELECT * INTO v_target_wallet
  FROM wallets
  WHERE user_id = p_user_id
    AND type = 'LUCKY_COIN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '未找到积分钱包');
  END IF;

  -- ========== 检查可用余额 ==========
  v_available_balance := COALESCE(v_source_wallet.balance, 0) - COALESCE(v_source_wallet.frozen_balance, 0);

  IF v_available_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('可用余额不足，当前可用余额: %s TJS', v_available_balance)
    );
  END IF;

  -- ========== 记录兑换前余额 ==========
  v_source_balance_before := COALESCE(v_source_wallet.balance, 0);
  v_target_balance_before := COALESCE(v_target_wallet.balance, 0);
  v_source_balance_after := v_source_balance_before - p_amount;
  v_target_balance_after := v_target_balance_before + p_amount;

  -- ========== 扣除源钱包余额 ==========
  UPDATE wallets
  SET balance = v_source_balance_after,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
  WHERE id = v_source_wallet.id;

  -- ========== 增加目标钱包余额 ==========
  UPDATE wallets
  SET balance = v_target_balance_after,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
  WHERE id = v_target_wallet.id;

  -- ========== 创建兑换记录 ==========
  INSERT INTO exchange_records (
    user_id,
    from_type,
    to_type,
    from_amount,
    to_amount,
    exchange_rate,
    status,
    exchange_type,
    currency,
    source_wallet_id,
    target_wallet_id,
    source_balance_before,
    source_balance_after,
    target_balance_before,
    target_balance_after,
    from_wallet_type,
    to_wallet_type,
    amount
  ) VALUES (
    p_user_id,
    'TJS',
    'LUCKY_COIN',
    p_amount,
    p_amount,
    1.0,
    'COMPLETED',
    'BALANCE_TO_COIN',
    'TJS',
    v_source_wallet.id::TEXT,
    v_target_wallet.id::TEXT,
    v_source_balance_before,
    v_source_balance_after,
    v_target_balance_before,
    v_target_balance_after,
    'TJS',
    'LUCKY_COIN',
    p_amount
  );

  -- ========== 创建钱包交易记录 ==========
  INSERT INTO wallet_transactions (
    wallet_id, type, amount, balance_before, balance_after,
    status, description, processed_at
  ) VALUES
  (
    v_source_wallet.id,
    'COIN_EXCHANGE',
    -p_amount,
    v_source_balance_before,
    v_source_balance_after,
    'COMPLETED',
    format('兑换%sTJS到积分', p_amount),
    NOW()
  ),
  (
    v_target_wallet.id,
    'COIN_EXCHANGE',
    p_amount,
    v_target_balance_before,
    v_target_balance_after,
    'COMPLETED',
    format('从余额兑换%sTJS', p_amount),
    NOW()
  );

  -- ========== 记录审计日志 ==========
  PERFORM log_edge_function_action(
    p_function_name := 'exchange-balance',
    p_action := 'exchange',
    p_user_id := p_user_id,
    p_details := json_build_object(
      'amount', p_amount,
      'source_wallet_id', v_source_wallet.id,
      'target_wallet_id', v_target_wallet.id,
      'source_balance_before', v_source_balance_before,
      'source_balance_after', v_source_balance_after,
      'target_balance_before', v_target_balance_before,
      'target_balance_after', v_target_balance_after
    )::jsonb
  );

  -- ========== 返回成功 ==========
  RETURN jsonb_build_object(
    'success', true,
    'message', '兑换成功',
    'new_balance', v_source_balance_after,
    'lucky_coin_balance', v_target_balance_after
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', format('兑换失败: %s', SQLERRM)
  );
END;
$$;


-- ============================================================================
-- BUG-006: market_purchase_atomic RPC 函数
-- 将二手市场购买操作封装为数据库事务
-- 使用 FOR UPDATE 行级锁防止并发冲突
-- 在单个事务中完成：资金转移 + 彩票转移 + 状态更新
-- ============================================================================

CREATE OR REPLACE FUNCTION market_purchase_atomic(
  p_buyer_id TEXT,
  p_listing_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing RECORD;
  v_buyer_wallet RECORD;
  v_seller_wallet RECORD;
  v_buyer_balance_before NUMERIC;
  v_buyer_balance_after NUMERIC;
  v_seller_balance_before NUMERIC;
  v_seller_balance_after NUMERIC;
  v_price NUMERIC;
BEGIN
  -- ========== 参数验证 ==========
  IF p_buyer_id IS NULL OR p_buyer_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '买家ID不能为空');
  END IF;

  IF p_listing_id IS NULL OR p_listing_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '商品ID不能为空');
  END IF;

  -- ========== 锁定并验证转售商品 ==========
  SELECT * INTO v_listing
  FROM market_listings
  WHERE id = p_listing_id::uuid
    AND status = 'AVAILABLE'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found or already sold');
  END IF;

  -- ========== 防止自购 ==========
  IF v_listing.seller_id = p_buyer_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot purchase your own listing');
  END IF;

  v_price := v_listing.price;

  -- ========== 锁定买家钱包 ==========
  SELECT * INTO v_buyer_wallet
  FROM wallets
  WHERE user_id = p_buyer_id
    AND type = 'TJS'
    AND currency = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '买家钱包不存在');
  END IF;

  v_buyer_balance_before := COALESCE(v_buyer_wallet.balance, 0);

  IF v_buyer_balance_before < v_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  -- ========== 锁定卖家钱包 ==========
  SELECT * INTO v_seller_wallet
  FROM wallets
  WHERE user_id = v_listing.seller_id
    AND type = 'TJS'
    AND currency = 'TJS'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '卖家钱包不存在');
  END IF;

  v_seller_balance_before := COALESCE(v_seller_wallet.balance, 0);

  -- ========== 计算新余额 ==========
  v_buyer_balance_after := v_buyer_balance_before - v_price;
  v_seller_balance_after := v_seller_balance_before + v_price;

  -- ========== 步骤1: 扣除买家余额 ==========
  UPDATE wallets
  SET balance = v_buyer_balance_after,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
  WHERE id = v_buyer_wallet.id;

  -- ========== 步骤2: 增加卖家余额 ==========
  UPDATE wallets
  SET balance = v_seller_balance_after,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
  WHERE id = v_seller_wallet.id;

  -- ========== 步骤3: 转移彩票归属 ==========
  -- market_listings.ticket_id 关联 lottery_entries.id
  IF v_listing.ticket_id IS NOT NULL THEN
    UPDATE lottery_entries
    SET user_id = p_buyer_id
    WHERE id = v_listing.ticket_id;
  END IF;

  -- ========== 步骤4: 更新转售状态 ==========
  UPDATE market_listings
  SET status = 'SOLD',
      buyer_id = p_buyer_id,
      sold_at = NOW(),
      updated_at = NOW()
  WHERE id = v_listing.id;

  -- ========== 步骤5: 创建交易记录 ==========
  INSERT INTO wallet_transactions (
    wallet_id, type, amount, balance_before, balance_after,
    status, description, metadata, processed_at
  ) VALUES
  (
    v_buyer_wallet.id,
    'MARKET_PURCHASE',
    -v_price,
    v_buyer_balance_before,
    v_buyer_balance_after,
    'COMPLETED',
    '购买转售彩票',
    jsonb_build_object('listing_id', p_listing_id),
    NOW()
  ),
  (
    v_seller_wallet.id,
    'MARKET_SALE',
    v_price,
    v_seller_balance_before,
    v_seller_balance_after,
    'COMPLETED',
    '转售彩票收入',
    jsonb_build_object('listing_id', p_listing_id),
    NOW()
  );

  -- ========== 步骤6: 发送通知 ==========
  INSERT INTO notifications (
    user_id, type, title, content,
    related_id, related_type, is_read
  ) VALUES
  (
    p_buyer_id,
    'MARKET_PURCHASED',
    '购买成功',
    format('您已成功购买转售彩票,花费 %s TJS', v_price),
    p_listing_id,
    'market_listing',
    false
  ),
  (
    v_listing.seller_id,
    'MARKET_SOLD',
    '转售成功',
    format('您的彩票已售出,获得 %s TJS', v_price),
    p_listing_id,
    'market_listing',
    false
  );

  -- ========== 记录审计日志 ==========
  PERFORM log_edge_function_action(
    p_function_name := 'market-manage',
    p_action := 'purchase',
    p_user_id := p_buyer_id,
    p_details := json_build_object(
      'listing_id', p_listing_id,
      'seller_id', v_listing.seller_id,
      'price', v_price,
      'ticket_id', v_listing.ticket_id,
      'buyer_balance_before', v_buyer_balance_before,
      'buyer_balance_after', v_buyer_balance_after,
      'seller_balance_before', v_seller_balance_before,
      'seller_balance_after', v_seller_balance_after
    )::jsonb
  );

  -- ========== 返回成功 ==========
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Purchase completed',
    'price', v_price,
    'buyer_new_balance', v_buyer_balance_after,
    'seller_new_balance', v_seller_balance_after
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', format('购买失败: %s', SQLERRM)
  );
END;
$$;


-- ============================================================================
-- BUG-007: 修复 deposit_requests 状态大小写不一致
-- ============================================================================

-- 步骤1: 将所有小写状态值统一为大写
UPDATE deposit_requests SET status = 'APPROVED' WHERE status = 'approved';
UPDATE deposit_requests SET status = 'REJECTED' WHERE status = 'rejected';
UPDATE deposit_requests SET status = 'PENDING' WHERE status = 'pending';

-- 步骤2: 添加 CHECK 约束，防止未来再出现不一致
-- 先检查是否已存在约束，避免重复添加
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'deposit_requests'
      AND constraint_name = 'deposit_requests_status_check'
  ) THEN
    ALTER TABLE deposit_requests
    ADD CONSTRAINT deposit_requests_status_check
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));
  END IF;
END $$;

-- 同时为 withdrawal_requests 也添加状态约束（预防性措施）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'withdrawal_requests'
      AND constraint_name = 'withdrawal_requests_status_check'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_status_check
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'));
  END IF;
END $$;


-- ============================================================================
-- 授权
-- ============================================================================
GRANT EXECUTE ON FUNCTION exchange_balance_atomic(TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION market_purchase_atomic(TEXT, TEXT) TO service_role;
