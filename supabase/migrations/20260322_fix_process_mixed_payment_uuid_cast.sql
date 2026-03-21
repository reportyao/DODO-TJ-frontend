-- =============================================================================
-- Fix: process_mixed_payment RPC - UUID type cast
-- Date: 2026-03-22
-- Problem: wallet_transactions.related_order_id and related_lottery_id are UUID
--          but p_order_id and p_lottery_id parameters are TEXT
--          causing "column is of type uuid but expression is of type text" error
-- Solution: Cast TEXT parameters to UUID when inserting into wallet_transactions
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
