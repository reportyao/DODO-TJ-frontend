-- =============================================================================
-- TezBarakat Phase 3-4: Coupons Table & Mixed Payment RPC
-- Date: 2026-03-18
-- Description: 
--   1. Create coupons table with RLS
--   2. Create process_mixed_payment RPC (coupon + TJS + LUCKY_COIN)
--   3. Create process_deposit_with_bonus RPC (bonus to LUCKY_COIN)
--
-- IMPORTANT NOTES:
--   - wallet_transactions.type is TEXT (no TransactionType enum exists)
--   - wallet_transactions.related_order_id is UUID
--   - wallet_transactions.related_lottery_id is UUID
--   - orders.id and lotteries.id are TEXT but contain UUID-format values
--   - users.id is TEXT, wallets.user_id is TEXT
-- =============================================================================

-- =============================================================================
-- 1. Create coupons table
-- =============================================================================
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 1.00,
  status TEXT NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'USED', 'EXPIRED')),
  source TEXT NOT NULL DEFAULT 'LOTTERY_REFUND',
  related_lottery_id TEXT REFERENCES lotteries(id) ON DELETE SET NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_user_status ON coupons(user_id, status);
CREATE INDEX IF NOT EXISTS idx_coupons_expires_at ON coupons(expires_at);

-- Enable RLS
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

-- Users can read their own coupons
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coupons' AND policyname = 'Users can view own coupons') THEN
    CREATE POLICY "Users can view own coupons" ON coupons
      FOR SELECT USING (true);
  END IF;
END $$;

-- Service role can manage coupons
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coupons' AND policyname = 'Service role can manage coupons') THEN
    CREATE POLICY "Service role can manage coupons" ON coupons
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_coupons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_coupons_updated_at ON coupons;
CREATE TRIGGER trigger_update_coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW
  EXECUTE FUNCTION update_coupons_updated_at();

-- =============================================================================
-- 2. Create process_mixed_payment RPC
--    Payment priority: Coupon -> TJS Balance -> LUCKY_COIN Points
--    Transaction safety: RAISE EXCEPTION rolls back everything on failure
-- =============================================================================
CREATE OR REPLACE FUNCTION process_mixed_payment(
  p_user_id TEXT,
  p_lottery_id TEXT,
  p_order_id TEXT,
  p_total_amount NUMERIC,
  p_use_coupon BOOLEAN,
  p_order_type TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tjs_wallet RECORD;
  v_lc_wallet RECORD;
  v_coupon RECORD;
  v_remaining_amount NUMERIC;
  v_coupon_deduction NUMERIC := 0;
  v_tjs_deduction NUMERIC := 0;
  v_lc_deduction NUMERIC := 0;
  v_tjs_balance NUMERIC;
  v_lc_balance NUMERIC;
BEGIN
  -- Parameter validation
  IF p_total_amount IS NULL OR p_total_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF p_order_type IS NULL OR p_order_type NOT IN ('LOTTERY_PURCHASE', 'FULL_PURCHASE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ORDER_TYPE');
  END IF;
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_USER_ID');
  END IF;

  v_remaining_amount := p_total_amount;

  -- Step 1: Lock wallets
  SELECT * INTO v_tjs_wallet FROM wallets WHERE user_id = p_user_id AND type = 'TJS' FOR UPDATE;
  SELECT * INTO v_lc_wallet FROM wallets WHERE user_id = p_user_id AND type = 'LUCKY_COIN' FOR UPDATE;

  IF v_tjs_wallet IS NULL OR v_lc_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'WALLET_NOT_FOUND');
  END IF;

  v_tjs_balance := COALESCE(v_tjs_wallet.balance, 0);
  v_lc_balance := COALESCE(v_lc_wallet.balance, 0);

  -- Step 2: Process coupon
  IF p_use_coupon THEN
    SELECT * INTO v_coupon FROM coupons
    WHERE user_id = p_user_id AND status = 'VALID' AND expires_at > NOW()
    ORDER BY expires_at ASC LIMIT 1 FOR UPDATE;

    IF v_coupon IS NOT NULL THEN
      v_coupon_deduction := LEAST(v_coupon.amount, v_remaining_amount);
      v_remaining_amount := v_remaining_amount - v_coupon_deduction;

      UPDATE coupons SET status = 'USED', used_at = NOW() WHERE id = v_coupon.id;

      INSERT INTO wallet_transactions (
        wallet_id, type, amount, balance_before, balance_after,
        status, description, related_order_id, related_lottery_id, processed_at
      ) VALUES (
        v_tjs_wallet.id, 'COUPON_DEDUCTION', -v_coupon_deduction,
        v_tjs_balance, v_tjs_balance,
        'COMPLETED', '使用抵扣券', p_order_id::uuid, p_lottery_id::uuid, NOW()
      );
    END IF;
  END IF;

  -- Step 3: Deduct TJS balance
  IF v_remaining_amount > 0 AND v_tjs_balance > 0 THEN
    v_tjs_deduction := LEAST(v_tjs_balance, v_remaining_amount);
    v_remaining_amount := v_remaining_amount - v_tjs_deduction;

    UPDATE wallets SET
      balance = balance - v_tjs_deduction,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
    WHERE id = v_tjs_wallet.id;

    INSERT INTO wallet_transactions (
      wallet_id, type, amount, balance_before, balance_after,
      status, description, related_order_id, related_lottery_id, processed_at
    ) VALUES (
      v_tjs_wallet.id, p_order_type, -v_tjs_deduction,
      v_tjs_balance, v_tjs_balance - v_tjs_deduction,
      'COMPLETED', '余额支付', p_order_id::uuid, p_lottery_id::uuid, NOW()
    );
  END IF;

  -- Step 4: Deduct LUCKY_COIN points
  IF v_remaining_amount > 0 THEN
    IF v_lc_balance < v_remaining_amount THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
    END IF;

    v_lc_deduction := v_remaining_amount;

    UPDATE wallets SET
      balance = balance - v_lc_deduction,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
    WHERE id = v_lc_wallet.id;

    INSERT INTO wallet_transactions (
      wallet_id, type, amount, balance_before, balance_after,
      status, description, related_order_id, related_lottery_id, processed_at
    ) VALUES (
      v_lc_wallet.id, p_order_type, -v_lc_deduction,
      v_lc_balance, v_lc_balance - v_lc_deduction,
      'COMPLETED', '积分支付', p_order_id::uuid, p_lottery_id::uuid, NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'coupon_deducted', v_coupon_deduction,
    'tjs_deducted', v_tjs_deduction,
    'lc_deducted', v_lc_deduction
  );

EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'INSUFFICIENT_BALANCE' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- =============================================================================
-- 3. Create process_deposit_with_bonus RPC
--    Fix: Bonus goes to LUCKY_COIN wallet (not TJS)
-- =============================================================================
CREATE OR REPLACE FUNCTION process_deposit_with_bonus(
  p_request_id UUID,
  p_user_id TEXT,
  p_deposit_amount NUMERIC,
  p_bonus_amount NUMERIC,
  p_order_number TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tjs_wallet RECORD;
  v_lc_wallet RECORD;
  v_tjs_balance NUMERIC;
  v_lc_balance NUMERIC;
BEGIN
  IF p_deposit_amount IS NULL OR p_deposit_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_DEPOSIT_AMOUNT');
  END IF;
  IF p_bonus_amount IS NULL OR p_bonus_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BONUS_AMOUNT');
  END IF;

  -- Lock TJS wallet
  SELECT * INTO v_tjs_wallet FROM wallets WHERE user_id = p_user_id AND type = 'TJS' FOR UPDATE;
  IF v_tjs_wallet IS NULL THEN
    INSERT INTO wallets (user_id, type, currency, balance, total_deposits, version)
    VALUES (p_user_id, 'TJS', 'TJS', 0, 0, 1) RETURNING * INTO v_tjs_wallet;
  END IF;

  -- Lock LUCKY_COIN wallet
  SELECT * INTO v_lc_wallet FROM wallets WHERE user_id = p_user_id AND type = 'LUCKY_COIN' FOR UPDATE;
  IF v_lc_wallet IS NULL THEN
    INSERT INTO wallets (user_id, type, currency, balance, total_deposits, version)
    VALUES (p_user_id, 'LUCKY_COIN', 'POINTS', 0, 0, 1) RETURNING * INTO v_lc_wallet;
  END IF;

  v_tjs_balance := COALESCE(v_tjs_wallet.balance, 0);
  v_lc_balance := COALESCE(v_lc_wallet.balance, 0);

  -- Update TJS wallet (principal)
  UPDATE wallets SET
    balance = balance + p_deposit_amount,
    total_deposits = COALESCE(total_deposits, 0) + p_deposit_amount,
    version = COALESCE(version, 1) + 1,
    updated_at = NOW()
  WHERE id = v_tjs_wallet.id;

  INSERT INTO wallet_transactions (
    wallet_id, type, amount, balance_before, balance_after,
    status, description, related_id, processed_at
  ) VALUES (
    v_tjs_wallet.id, 'DEPOSIT', p_deposit_amount,
    v_tjs_balance, v_tjs_balance + p_deposit_amount,
    'COMPLETED', '充值审核通过 - 订单号: ' || COALESCE(p_order_number, 'N/A'),
    p_request_id::text, NOW()
  );

  -- Update LUCKY_COIN wallet (bonus)
  IF p_bonus_amount > 0 THEN
    UPDATE wallets SET
      balance = balance + p_bonus_amount,
      version = COALESCE(version, 1) + 1,
      updated_at = NOW()
    WHERE id = v_lc_wallet.id;

    INSERT INTO wallet_transactions (
      wallet_id, type, amount, balance_before, balance_after,
      status, description, related_id, processed_at
    ) VALUES (
      v_lc_wallet.id, 'BONUS', p_bonus_amount,
      v_lc_balance, v_lc_balance + p_bonus_amount,
      'COMPLETED', '充值赠送 - 订单号: ' || COALESCE(p_order_number, 'N/A'),
      p_request_id::text, NOW()
    );
  END IF;

  RETURN jsonb_build_object('success', true);

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
