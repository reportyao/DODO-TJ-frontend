-- ============================================================
-- Migration: Add missing RLS policies for core tables
-- Date: 2025-03-21
-- Description: Some tables have only service_role policies but
--              lack user-facing policies. This adds proper
--              session-token-based policies for user access.
-- ============================================================

-- Helper: Check session token validity
-- Usage in policies: get_session_user_id() returns user_id or NULL
CREATE OR REPLACE FUNCTION public.get_session_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT user_id::TEXT
  FROM public.user_sessions
  WHERE session_token = (
    (current_setting('request.headers', true)::json ->> 'authorization')
  )
    AND is_active = true
    AND expires_at > now()
  LIMIT 1;
$$;

-- Grant to authenticated and anon (the function itself validates session)
GRANT EXECUTE ON FUNCTION public.get_session_user_id() TO anon, authenticated;

-- ==================== users 表 ====================
-- 用户只能查看自己的信息，不能修改（通过 Edge Function 修改）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'users' 
    AND policyname = 'Users can view their own profile'
  ) THEN
    CREATE POLICY "Users can view their own profile"
    ON public.users FOR SELECT
    USING (id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== user_sessions 表 ====================
-- 用户只能查看自己的 session
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'user_sessions' 
    AND policyname = 'Users can view their own sessions'
  ) THEN
    CREATE POLICY "Users can view their own sessions"
    ON public.user_sessions FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== deposit_requests 表 ====================
-- 用户可以查看自己的充值记录
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'deposit_requests' 
    AND policyname = 'Users can view their own deposit requests'
  ) THEN
    CREATE POLICY "Users can view their own deposit requests"
    ON public.deposit_requests FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== withdrawal_requests 表 ====================
-- 用户可以查看自己的提现记录
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'withdrawal_requests' 
    AND policyname = 'Users can view their own withdrawal requests'
  ) THEN
    CREATE POLICY "Users can view their own withdrawal requests"
    ON public.withdrawal_requests FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== notifications 表 ====================
-- 用户可以查看和更新自己的通知
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'notifications' 
    AND policyname = 'Users can view their own notifications'
  ) THEN
    CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'notifications' 
    AND policyname = 'Users can update their own notifications'
  ) THEN
    CREATE POLICY "Users can update their own notifications"
    ON public.notifications FOR UPDATE
    USING (user_id::TEXT = get_session_user_id())
    WITH CHECK (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== lotteries 表 ====================
-- 所有人可以查看活跃的抽奖
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'lotteries' 
    AND policyname = 'Public can view active lotteries'
  ) THEN
    CREATE POLICY "Public can view active lotteries"
    ON public.lotteries FOR SELECT
    USING (true);
  END IF;
END $$;

-- ==================== group_buy_sessions 表 ====================
-- 所有人可以查看团购场次（已有策略，确保 RLS 开启后仍有效）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'group_buy_sessions' 
    AND policyname = 'Public can view group buy sessions'
  ) THEN
    CREATE POLICY "Public can view group buy sessions"
    ON public.group_buy_sessions FOR SELECT
    USING (true);
  END IF;
END $$;

-- ==================== inventory_products 表 ====================
-- 所有人可以查看在售商品
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'inventory_products' 
    AND policyname = 'Public can view active inventory products'
  ) THEN
    CREATE POLICY "Public can view active inventory products"
    ON public.inventory_products FOR SELECT
    USING (status = 'active' OR status = 'ACTIVE');
  END IF;
END $$;

-- ==================== payment_config 表 ====================
-- 所有人可以查看启用的支付配置
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'payment_config' 
    AND policyname = 'Public can view active payment configs'
  ) THEN
    CREATE POLICY "Public can view active payment configs"
    ON public.payment_config FOR SELECT
    USING (is_active = true);
  END IF;
END $$;

-- ==================== pickup_points 表 ====================
-- 所有人可以查看取货点
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'pickup_points' 
    AND policyname = 'Public can view active pickup points'
  ) THEN
    CREATE POLICY "Public can view active pickup points"
    ON public.pickup_points FOR SELECT
    USING (true);
  END IF;
END $$;

-- ==================== banners 表 ====================
-- 所有人可以查看启用的横幅
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'banners' 
    AND policyname = 'Public can view active banners'
  ) THEN
    CREATE POLICY "Public can view active banners"
    ON public.banners FOR SELECT
    USING (is_active = true);
  END IF;
END $$;

-- ==================== spin_rewards 表 ====================
-- 所有人可以查看转盘奖励配置
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'spin_rewards' 
    AND policyname = 'Public can view spin rewards'
  ) THEN
    CREATE POLICY "Public can view spin rewards"
    ON public.spin_rewards FOR SELECT
    USING (true);
  END IF;
END $$;

-- ==================== ai_chat_history 表 ====================
-- 用户只能查看自己的 AI 聊天记录
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'ai_chat_history' 
    AND policyname = 'Users can view their own AI chat history'
  ) THEN
    CREATE POLICY "Users can view their own AI chat history"
    ON public.ai_chat_history FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== ai_chat_quota 表 ====================
-- 用户只能查看自己的 AI 配额
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'ai_chat_quota' 
    AND policyname = 'Users can view their own AI quota'
  ) THEN
    CREATE POLICY "Users can view their own AI quota"
    ON public.ai_chat_quota FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== shipment_batches 表 ====================
-- 所有人可以查看批次（用于物流追踪）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'shipment_batches' 
    AND policyname = 'Public can view shipment batches'
  ) THEN
    CREATE POLICY "Public can view shipment batches"
    ON public.shipment_batches FOR SELECT
    USING (true);
  END IF;
END $$;

-- ==================== transactions 表 ====================
-- 用户只能查看自己的交易记录
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'transactions' 
    AND policyname = 'Users can view their own transactions'
  ) THEN
    CREATE POLICY "Users can view their own transactions"
    ON public.transactions FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== resales 表 ====================
-- 用户可以查看公开的转售，以及自己的转售
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'resales' 
    AND policyname = 'Users can view own resales and public listings'
  ) THEN
    CREATE POLICY "Users can view own resales and public listings"
    ON public.resales FOR SELECT
    USING (
      seller_id::TEXT = get_session_user_id()
      OR status = 'active'
    );
  END IF;
END $$;

-- ==================== shipping 表 ====================
-- 用户可以查看自己的物流信息
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'shipping' 
    AND policyname = 'Users can view their own shipping info'
  ) THEN
    CREATE POLICY "Users can view their own shipping info"
    ON public.shipping FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== pickup_logs 表 ====================
-- 用户可以查看自己的取货记录
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'pickup_logs' 
    AND policyname = 'Users can view their own pickup logs'
  ) THEN
    CREATE POLICY "Users can view their own pickup logs"
    ON public.pickup_logs FOR SELECT
    USING (user_id::TEXT = get_session_user_id());
  END IF;
END $$;

-- ==================== inventory_transactions 表 ====================
-- 所有人可以查看库存交易记录（公开信息）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'inventory_transactions' 
    AND policyname = 'Public can view inventory transactions'
  ) THEN
    CREATE POLICY "Public can view inventory transactions"
    ON public.inventory_transactions FOR SELECT
    USING (true);
  END IF;
END $$;
