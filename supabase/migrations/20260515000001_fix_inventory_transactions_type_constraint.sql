-- ============================================================================
-- Fix: inventory_transactions CHECK constraint missing B2B_CANCEL/B2B_RETURN
-- ============================================================================
-- Bug: admin_b2b_cancel_order RPC fails with 400 because it inserts
--      transaction_type = 'B2B_CANCEL' which is not in the allowed list.
--      The original constraint only allowed:
--        FULL_PURCHASE, LOTTERY_PRIZE, STOCK_IN, STOCK_OUT, ADJUSTMENT,
--        RESERVE, RELEASE_RESERVE, B2B_SALE
--
-- Fix: Drop old constraint and add a new one that includes all required types.
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
  ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check;
  ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check
    CHECK (transaction_type IN (
      'FULL_PURCHASE', 'LOTTERY_PRIZE', 'STOCK_IN', 'STOCK_OUT',
      'ADJUSTMENT', 'RESERVE', 'RELEASE_RESERVE',
      'PURCHASE', 'SALE', 'RETURN', 'TRANSFER', 'MANUAL', 'INITIAL',
      'B2B_SALE', 'B2B_CANCEL', 'B2B_RETURN'
    ));
  RAISE NOTICE 'inventory_transactions_transaction_type_check updated successfully';
END $$;
