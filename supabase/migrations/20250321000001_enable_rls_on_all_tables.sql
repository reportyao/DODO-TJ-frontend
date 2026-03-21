-- ============================================================
-- Migration: Enable RLS on all core tables
-- Date: 2025-03-21
-- Description: 32 tables have RLS policies but RLS is disabled,
--              making all policies completely ineffective.
--              This migration enables RLS on all affected tables.
-- ============================================================

-- ==================== 核心用户数据表 ====================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- ==================== 订单与奖品表 ====================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.full_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_entries ENABLE ROW LEVEL SECURITY;

-- ==================== 抽奖与团购表 ====================
ALTER TABLE public.lotteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_buy_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_buy_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_buy_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_buy_results ENABLE ROW LEVEL SECURITY;

-- ==================== 财务表 ====================
ALTER TABLE public.deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ==================== 通知与日志表 ====================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_logs ENABLE ROW LEVEL SECURITY;

-- ==================== 商品与库存表 ====================
ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_points ENABLE ROW LEVEL SECURITY;

-- ==================== 转售与杂项表 ====================
ALTER TABLE public.resales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping ENABLE ROW LEVEL SECURITY;

-- ==================== 积分与奖励表 ====================
ALTER TABLE public.spin_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spin_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_spin_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_rewards ENABLE ROW LEVEL SECURITY;

-- ==================== 广告与内容表 ====================
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

-- ==================== AI 功能表 ====================
ALTER TABLE public.ai_chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_quota ENABLE ROW LEVEL SECURITY;

-- ==================== 验证 RLS 已启用 ====================
DO $$
DECLARE
  table_name TEXT;
  tables_without_rls TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR table_name IN 
    SELECT t.tablename 
    FROM pg_tables t
    LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
    WHERE t.schemaname = 'public' 
      AND t.rowsecurity = false
      AND p.tablename IS NOT NULL
  LOOP
    tables_without_rls := array_append(tables_without_rls, table_name);
  END LOOP;
  
  IF array_length(tables_without_rls, 1) > 0 THEN
    RAISE WARNING 'Tables with policies but RLS still disabled: %', array_to_string(tables_without_rls, ', ');
  ELSE
    RAISE NOTICE 'All tables with policies now have RLS enabled.';
  END IF;
END $$;
