-- 修复 RLS 策略中 session_token 与 Authorization header 不匹配的问题
-- 
-- 问题根因：
--   前端通过 supabase-js 发送 Authorization: Bearer {session_token}
--   但 RLS 策略直接比较 session_token = request.headers->>'authorization'
--   导致 'uuid' != 'Bearer uuid'，查询返回空
--
-- 修复方案：
--   在 RLS 策略中去掉 Bearer 前缀后再比较
--   使用 REPLACE(header, 'Bearer ', '') 兼容有/无 Bearer 前缀两种情况

-- 辅助函数：从 Authorization header 中提取纯 token（去掉 Bearer 前缀）
CREATE OR REPLACE FUNCTION get_session_token_from_header()
RETURNS TEXT AS $$
DECLARE
  auth_header TEXT;
BEGIN
  auth_header := current_setting('request.headers', true)::json->>'authorization';
  IF auth_header IS NULL THEN
    RETURN NULL;
  END IF;
  -- 去掉 "Bearer " 前缀（大小写兼容）
  RETURN REPLACE(REPLACE(auth_header, 'Bearer ', ''), 'bearer ', '');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 1. orders 表
DROP POLICY IF EXISTS "Users can view their own orders" ON orders;
CREATE POLICY "Users can view their own orders" ON orders
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        OR
        EXISTS (
            SELECT 1 FROM user_sessions
            WHERE user_sessions.user_id = orders.user_id
            AND user_sessions.session_token = get_session_token_from_header()
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );

-- 2. full_purchase_orders 表
DROP POLICY IF EXISTS "Users can view their own full purchase orders" ON full_purchase_orders;
CREATE POLICY "Users can view their own full purchase orders" ON full_purchase_orders
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        OR
        EXISTS (
            SELECT 1 FROM user_sessions
            WHERE user_sessions.user_id = full_purchase_orders.user_id
            AND user_sessions.session_token = get_session_token_from_header()
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );

-- 3. prizes 表
DROP POLICY IF EXISTS "Users can view their own prizes" ON prizes;
CREATE POLICY "Users can view their own prizes" ON prizes
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        OR
        EXISTS (
            SELECT 1 FROM user_sessions
            WHERE user_sessions.user_id = prizes.user_id
            AND user_sessions.session_token = get_session_token_from_header()
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );

-- 4. lottery_entries 表
DROP POLICY IF EXISTS "Users can view their own lottery entries" ON lottery_entries;
CREATE POLICY "Users can view their own lottery entries" ON lottery_entries
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        OR
        EXISTS (
            SELECT 1 FROM user_sessions
            WHERE user_sessions.user_id = lottery_entries.user_id
            AND user_sessions.session_token = get_session_token_from_header()
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );

-- 5. wallets 表
DROP POLICY IF EXISTS "Users can view their own wallets" ON wallets;
CREATE POLICY "Users can view their own wallets" ON wallets
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        OR
        EXISTS (
            SELECT 1 FROM user_sessions
            WHERE user_sessions.user_id = wallets.user_id
            AND user_sessions.session_token = get_session_token_from_header()
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );

-- 6. wallet_transactions 表
DROP POLICY IF EXISTS "Users can view their own wallet transactions" ON wallet_transactions;
CREATE POLICY "Users can view their own wallet transactions" ON wallet_transactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM wallets
            WHERE wallets.id = wallet_transactions.wallet_id
            AND (
                wallets.user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
                OR
                EXISTS (
                    SELECT 1 FROM user_sessions
                    WHERE user_sessions.user_id = wallets.user_id
                    AND user_sessions.session_token = get_session_token_from_header()
                    AND user_sessions.is_active = true
                    AND user_sessions.expires_at > NOW()
                )
            )
        )
    );

-- 7. group_buy_results 表（如果有 RLS）
DROP POLICY IF EXISTS "Users can view their own group buy results" ON group_buy_results;
CREATE POLICY "Users can view their own group buy results" ON group_buy_results
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        OR
        EXISTS (
            SELECT 1 FROM user_sessions
            WHERE user_sessions.user_id = group_buy_results.user_id
            AND user_sessions.session_token = get_session_token_from_header()
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );
