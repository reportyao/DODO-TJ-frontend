-- 创建补贴池聚合 RPC，替代 get-subsidy-pool 的全表扫描回退路径
-- 在数据库端执行 SUM 聚合，避免将所有 amount 行传输到 Edge Function
CREATE OR REPLACE FUNCTION rpc_get_subsidy_pool_total()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(ABS(amount)), 0)
  FROM wallet_transactions
  WHERE type IN ('BONUS', 'DEPOSIT_BONUS', 'FIRST_DEPOSIT_BONUS');
$$;

GRANT EXECUTE ON FUNCTION rpc_get_subsidy_pool_total() TO service_role;
GRANT EXECUTE ON FUNCTION rpc_get_subsidy_pool_total() TO authenticated;
