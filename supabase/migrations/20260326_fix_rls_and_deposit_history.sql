-- ============================================================
-- 修复1: get_session_token_from_header 函数
-- 问题: 函数只读取 authorization header，但前端通过 x-session-token 传递 session token
-- RLS 策略依赖此函数验证用户身份，导致前端查询返回空
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_session_token_from_header()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  session_header TEXT;
  auth_header TEXT;
BEGIN
  -- 优先读取 x-session-token header（前端自定义认证方式）
  session_header := current_setting('request.headers', true)::json->>'x-session-token';
  IF session_header IS NOT NULL AND session_header != '' THEN
    RETURN session_header;
  END IF;

  -- 兼容旧方式：从 authorization header 中提取 token
  auth_header := current_setting('request.headers', true)::json->>'authorization';
  IF auth_header IS NULL THEN
    RETURN NULL;
  END IF;
  -- 去掉 "Bearer " 前缀（大小写兼容）
  RETURN REPLACE(REPLACE(auth_header, 'Bearer ', ''), 'bearer ', '');
END;
$function$;

-- ============================================================
-- 修复2: 修复历史数据中地推代充的 type 和 description
-- 问题: 旧版 perform_promoter_deposit 写入了 type='DEPOSIT' 而非 'PROMOTER_DEPOSIT'
-- 通过 promoter_deposits 表的 transaction_id 关联修复
-- ============================================================

-- 修复 wallet_transactions 中的 type
UPDATE wallet_transactions wt
SET 
  type = 'PROMOTER_DEPOSIT',
  description = COALESCE(
    '地推代充 - 操作员: ' || (
      SELECT COALESCE(u.phone_number, pd.promoter_id::text)
      FROM promoter_deposits pd
      LEFT JOIN users u ON u.id = pd.promoter_id
      WHERE pd.transaction_id = wt.id
      LIMIT 1
    ),
    wt.description
  )
WHERE wt.type = 'DEPOSIT'
  AND wt.id IN (
    SELECT pd.transaction_id 
    FROM promoter_deposits pd 
    WHERE pd.transaction_id IS NOT NULL
  );

-- 同时修复没有 transaction_id 关联但可以通过时间和金额匹配的记录
-- 对于 description 为 NULL 且 type='DEPOSIT' 的记录，检查是否有对应的 promoter_deposits
UPDATE wallet_transactions wt
SET 
  type = 'PROMOTER_DEPOSIT',
  description = '地推代充 - 操作员: ' || (
    SELECT COALESCE(u.phone_number, pd.promoter_id::text)
    FROM promoter_deposits pd
    LEFT JOIN users u ON u.id = pd.promoter_id
    WHERE pd.target_user_id = (
      SELECT w.user_id FROM wallets w WHERE w.id = wt.wallet_id
    )
    AND pd.amount = wt.amount
    AND pd.created_at BETWEEN wt.created_at - INTERVAL '5 seconds' AND wt.created_at + INTERVAL '5 seconds'
    LIMIT 1
  )
WHERE wt.type = 'DEPOSIT'
  AND wt.description IS NULL
  AND EXISTS (
    SELECT 1 FROM promoter_deposits pd
    WHERE pd.target_user_id = (
      SELECT w.user_id FROM wallets w WHERE w.id = wt.wallet_id
    )
    AND pd.amount = wt.amount
    AND pd.created_at BETWEEN wt.created_at - INTERVAL '5 seconds' AND wt.created_at + INTERVAL '5 seconds'
  );
