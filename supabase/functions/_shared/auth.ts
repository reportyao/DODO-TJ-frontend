import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

const SESSION_CACHE_TTL_MS = 15 * 1000
const MAX_CACHE_SIZE = 500

type SessionRow = {
  user_id: string
  expires_at: string
  is_active?: boolean
}

type UserRow = Record<string, unknown> & {
  id: string
  phone_number?: string | null
}

export interface ValidatedSession {
  userId: string
  phoneNumber: string | null
  user: UserRow
  session: SessionRow
}

const sessionCache = new Map<string, { value: ValidatedSession; timestamp: number }>()

function getCachedSession(sessionToken: string): ValidatedSession | null {
  const cached = sessionCache.get(sessionToken)
  if (!cached) return null

  if (Date.now() - cached.timestamp > SESSION_CACHE_TTL_MS) {
    sessionCache.delete(sessionToken)
    return null
  }

  return cached.value
}

function setCachedSession(sessionToken: string, value: ValidatedSession) {
  if (sessionCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = sessionCache.keys().next().value
    if (oldestKey) {
      sessionCache.delete(oldestKey)
    }
  }

  sessionCache.set(sessionToken, {
    value,
    timestamp: Date.now(),
  })
}

export async function validateSessionWithUser(
  supabase: SupabaseClient,
  sessionToken: string,
): Promise<ValidatedSession> {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌')
  }

  const cached = getCachedSession(sessionToken)
  if (cached) {
    return cached
  }

  const { data: session, error: sessionError } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at, is_active')
    .eq('session_token', sessionToken)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle<SessionRow>()

  if (sessionError) {
    throw new Error('验证会话失败')
  }

  if (!session) {
    throw new Error('未授权：会话不存在或已失效')
  }

  if (new Date(session.expires_at) < new Date()) {
    throw new Error('未授权：会话已过期')
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', session.user_id)
    .limit(1)
    .maybeSingle<UserRow>()

  if (userError) {
    throw new Error('查询用户信息失败')
  }

  if (!user) {
    throw new Error('未授权：用户不存在')
  }

  const validated = {
    userId: session.user_id,
    phoneNumber: user.phone_number ?? null,
    user,
    session,
  }

  setCachedSession(sessionToken, validated)
  return validated
}
