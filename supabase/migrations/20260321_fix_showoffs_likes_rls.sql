-- ============================================================
-- 修复 showoffs 和 likes 表的 RLS 策略
-- 问题：两张表未启用 RLS，任何人都可以读写
-- ============================================================

-- ============================================================
-- 1. showoffs 表 RLS
-- ============================================================
ALTER TABLE public.showoffs ENABLE ROW LEVEL SECURITY;

-- 公开读取：已审核通过且未隐藏的晒单，任何人可读
CREATE POLICY "Public can view approved non-hidden showoffs"
  ON public.showoffs
  FOR SELECT
  USING (status = 'APPROVED' AND is_hidden = false);

-- 用户读取自己的晒单（包括 PENDING 状态）
-- 使用 session_token 验证用户身份
CREATE POLICY "Users can view their own showoffs"
  ON public.showoffs
  FOR SELECT
  USING (
    user_id IS NOT NULL AND
    user_id IN (
      SELECT user_id::text FROM public.user_sessions
      WHERE session_token = current_setting('request.headers', true)::json->>'custom-session-token'
      AND expires_at > now()
    )
  );

-- 用户创建晒单（需要登录）
CREATE POLICY "Authenticated users can create showoffs"
  ON public.showoffs
  FOR INSERT
  WITH CHECK (
    user_id IS NOT NULL AND
    user_id IN (
      SELECT user_id::text FROM public.user_sessions
      WHERE session_token = current_setting('request.headers', true)::json->>'custom-session-token'
      AND expires_at > now()
    )
  );

-- service_role 绕过 RLS（管理后台使用）
CREATE POLICY "Service role bypass showoffs"
  ON public.showoffs
  USING (current_setting('role', true) = 'service_role');

-- ============================================================
-- 2. likes 表 RLS
-- ============================================================
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

-- 用户读取自己的点赞记录
CREATE POLICY "Users can view their own likes"
  ON public.likes
  FOR SELECT
  USING (
    user_id IS NOT NULL AND
    user_id IN (
      SELECT user_id::text FROM public.user_sessions
      WHERE session_token = current_setting('request.headers', true)::json->>'custom-session-token'
      AND expires_at > now()
    )
  );

-- 用户创建点赞
CREATE POLICY "Authenticated users can create likes"
  ON public.likes
  FOR INSERT
  WITH CHECK (
    user_id IS NOT NULL AND
    user_id IN (
      SELECT user_id::text FROM public.user_sessions
      WHERE session_token = current_setting('request.headers', true)::json->>'custom-session-token'
      AND expires_at > now()
    )
  );

-- 用户删除自己的点赞
CREATE POLICY "Users can delete their own likes"
  ON public.likes
  FOR DELETE
  USING (
    user_id IS NOT NULL AND
    user_id IN (
      SELECT user_id::text FROM public.user_sessions
      WHERE session_token = current_setting('request.headers', true)::json->>'custom-session-token'
      AND expires_at > now()
    )
  );

-- service_role 绕过 RLS
CREATE POLICY "Service role bypass likes"
  ON public.likes
  USING (current_setting('role', true) = 'service_role');
