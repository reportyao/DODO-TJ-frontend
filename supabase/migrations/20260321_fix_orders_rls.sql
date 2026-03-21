-- 修复 orders, prizes, full_purchase_orders 等表的 RLS 策略
-- 允许用户通过 session_token 验证身份后查询自己的数据

-- 1. orders 表
DROP POLICY IF EXISTS "Users can view their own orders" ON orders;
CREATE POLICY "Users can view their own orders" ON orders
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub' 
        OR 
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = orders.user_id 
            AND user_sessions.session_token = current_setting('request.headers', true)::json->>'authorization'
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );
-- 2. full_purchase_orderss 表
DROP POLICY IF EXISTS "Users can view their own full purchase orders" ON full_purchase_orders;
CREATE POLICY "Users can view their own full purchase orders" ON full_purchase_orders
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub' 
        OR 
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = full_purchase_orders.user_id 
            AND user_sessions.session_token = current_setting('request.headers', true)::json->>'authorization'
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );
-- 3. prizess 表
DROP POLICY IF EXISTS "Users can view their own prizes" ON prizes;
CREATE POLICY "Users can view their own prizes" ON prizes
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub' 
        OR 
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = prizes.user_id 
            AND user_sessions.session_token = current_setting('request.headers', true)::json->>'authorization'
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );
-- 4. lottery_entriess 表
DROP POLICY IF EXISTS "Users can view their own lottery entries" ON lottery_entries;
CREATE POLICY "Users can view their own lottery entries" ON lottery_entries
    FOR SELECT USING (
        user_id::text = current_setting('request.jwt.claims', true)::json->>'sub' 
        OR 
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = lottery_entries.user_id 
             AND user_sessions.session_token = current_setting('request.headers', true)::json->>'authorization'
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
            AND user_sessions.session_token = current_setting('request.headers', true)::json->>'authorization'
            AND user_sessions.is_active = true
            AND user_sessions.expires_at > NOW()
        )
    );
-- 6. wallet_transactionss 表
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
                    AND user_sessions.session_token = current_setting('request.headers', true)::json->>'authorization'
                    AND user_sessions.is_active = true
                    AND user_sessions.expires_at > NOW()
                )
            )
        )
    );
