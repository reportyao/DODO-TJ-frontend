-- ============================================================
-- Migration: Revoke PUBLIC EXECUTE on SECURITY DEFINER functions
-- Date: 2025-03-21
-- Description: All 56 SECURITY DEFINER functions had PUBLIC
--              (=X/postgres in ACL) EXECUTE permission, meaning
--              ANY role including anon could call them directly.
--              This migration revokes PUBLIC access and grants
--              only to specific roles as needed.
--
-- Root cause: PostgreSQL grants EXECUTE to PUBLIC by default
--             when functions are created. SECURITY DEFINER
--             functions bypass RLS, so this is critical.
-- ============================================================

-- ==================== 撤销所有 SECURITY DEFINER 函数的 PUBLIC 执行权限 ====================

REVOKE EXECUTE ON FUNCTION public.add_bonus_balance(p_user_id text, p_amount numeric, p_description text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_user_lucky_coins(p_user_id text, p_amount numeric, p_description character varying) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_user_spin_count(p_user_id text, p_count integer, p_source text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_deposit_atomic(p_request_id text, p_action text, p_admin_id text, p_admin_note text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_withdrawal_request(p_withdrawal_id text, p_admin_id text, p_admin_note text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_draw_lotteries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_promoter_settlement(p_promoter_id text, p_settlement_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrease_commission_balance(p_user_id text, p_amount numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrease_user_balance(p_user_id text, p_amount numeric, p_wallet_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrement_likes_count(p_post_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrement_likes_count(p_target_type text, p_target_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrement_user_balance(p_user_id text, p_amount numeric, p_wallet_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_user_spin_count(p_user_id text, p_count integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.draw_lottery(p_lottery_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exchange_balance_atomic(p_user_id text, p_amount numeric, p_from_type text, p_to_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exchange_real_to_bonus_balance(p_user_id text, p_amount numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_active_products_with_sessions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_deposit_cross_check() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_deposit_list(p_start_date date, p_end_date date, p_status text, p_promoter_id text, p_search text, p_page integer, p_page_size integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_deposit_summary(p_start_date date, p_end_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_promoter_stats(p_start_date date, p_end_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_settlement_list(p_settlement_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_channel_stats(p_range_start timestamp with time zone, p_range_end timestamp with time zone, p_prev_start timestamp with time zone, p_prev_end timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_commission_settings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_promoter_center_data(p_user_id text, p_time_range text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_promoter_command_center(p_range_start timestamp with time zone, p_range_end timestamp with time zone, p_prev_start timestamp with time zone, p_prev_end timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_promoter_daily_trend(p_start_date date, p_end_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_promoter_dashboard_stats(p_start_date date, p_end_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_promoter_deposit_stats(p_promoter_id text, p_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_promoter_leaderboard(p_start_date date, p_end_date date, p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_revenue_by_day(p_days integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_referral_stats(p_user_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_wallet_balance(p_user_id uuid, p_currency text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increase_commission_balance(p_user_id text, p_amount numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increase_user_balance(p_user_id text, p_amount numeric, p_wallet_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_ai_quota_bonus(p_user_id text, p_date date, p_amount integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_ai_quota_used(p_user_id text, p_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_contact_count(p_promoter_id text, p_log_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_likes_count(p_post_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_likes_count(p_target_type text, p_target_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_sold_quantity(p_lottery_id text, p_quantity integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_user_balance(p_user_id text, p_amount numeric, p_wallet_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_admin_action(p_admin_id uuid, p_action text, p_target_type text, p_target_id text, p_old_data jsonb, p_new_data jsonb, p_details jsonb, p_source text, p_status text, p_error_message text, p_ip_address text, p_user_agent text, p_duration_ms integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_edge_function_action(p_function_name text, p_action text, p_user_id text, p_target_type text, p_target_id text, p_request_body jsonb, p_response_status integer, p_details jsonb, p_status text, p_error_message text, p_duration_ms integer, p_ip_address text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.market_purchase_atomic(p_buyer_id text, p_listing_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.perform_promoter_deposit(p_promoter_id text, p_target_user_id text, p_amount numeric, p_note text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_deposit_with_bonus(p_request_id uuid, p_user_id text, p_deposit_amount numeric, p_bonus_amount numeric, p_order_number text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_mixed_payment(p_user_id text, p_lottery_id text, p_order_id text, p_total_amount numeric, p_use_coupon boolean, p_order_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purchase_lottery_atomic(p_lottery_id text, p_user_id text, p_quantity integer, p_total_amount numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_withdrawal_request(p_withdrawal_id text, p_admin_id text, p_admin_note text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_wallet_deduction(p_wallet_id text, p_amount numeric, p_description text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_user_for_deposit(p_query text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_commission_for_exchange() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_commission_settings(p_key text, p_value text) FROM PUBLIC;

-- ==================== 为特定角色授予必要权限 ====================

-- 公开商品列表：anon 和 authenticated 均可访问
GRANT EXECUTE ON FUNCTION public.get_active_products_with_sessions() TO anon, authenticated;

-- 用户专属函数：仅 authenticated 可访问
GRANT EXECUTE ON FUNCTION public.get_user_wallet_balance(p_user_id uuid, p_currency text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_referral_stats(p_user_id text) TO authenticated;

-- 管理员专用函数：仅 service_role 可访问（通过 Edge Functions 调用）
GRANT EXECUTE ON FUNCTION public.get_commission_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_deposit_list(date, date, text, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_deposit_summary(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_deposit_cross_check() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_promoter_stats(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_settlement_list(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_day(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_channel_stats(timestamptz, timestamptz, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_promoter_command_center(timestamptz, timestamptz, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_promoter_daily_trend(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_promoter_dashboard_stats(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_promoter_deposit_stats(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_promoter_leaderboard(date, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_user_for_deposit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_deposit_atomic(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_request(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_request(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_deposit_with_bonus(uuid, text, numeric, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.draw_lottery(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_draw_lotteries() TO service_role;
GRANT EXECUTE ON FUNCTION public.purchase_lottery_atomic(text, text, integer, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_purchase_atomic(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exchange_balance_atomic(text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exchange_real_to_bonus_balance(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_mixed_payment(text, text, text, numeric, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.increase_user_balance(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrease_user_balance(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_balance(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_user_balance(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_bonus_balance(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.increase_commission_balance(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrease_commission_balance(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_wallet_deduction(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.perform_promoter_deposit(text, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_commission_settings(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_promoter_settlement(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_admin_action(uuid, text, text, text, jsonb, jsonb, jsonb, text, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_edge_function_action(text, text, text, text, text, jsonb, integer, jsonb, text, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_user_lucky_coins(text, numeric, varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_user_spin_count(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_user_spin_count(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_ai_quota_bonus(text, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_ai_quota_used(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_contact_count(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_sold_quantity(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_likes_count(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_likes_count(text, text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_likes_count(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_likes_count(text, text) TO service_role, authenticated;

-- ==================== 验证 ====================
DO $$
DECLARE
  dangerous_count INT;
BEGIN
  SELECT COUNT(*) INTO dangerous_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname IN (
      'approve_deposit_atomic', 'approve_withdrawal_request',
      'draw_lottery', 'process_deposit_with_bonus',
      'increase_user_balance', 'decrease_user_balance'
    );
  
  IF dangerous_count > 0 THEN
    RAISE WARNING 'Some critical functions still allow anon execution: % functions', dangerous_count;
  ELSE
    RAISE NOTICE 'All critical financial functions successfully restricted from anon/public access.';
  END IF;
END $$;
