/**
 * promoter-deposit Edge Function
 * 
 * Promoter deposit interface
 * 
 * Features:
 *   1. Validate promoter identity (via session_token)
 *   2. Search target user (compatible with UUID / phone / username)
 *   3. Execute deposit (call perform_promoter_deposit RPC transaction)
 *   4. Get deposit statistics
 * 
 * Request format:
 *   POST /promoter-deposit
 *   body: {
 *     action: 'deposit' | 'search_user' | 'get_stats' | 'get_history',
 *     session_token: string,
 *     // Required for action=deposit:
 *     target_user_id?: string,
 *     amount?: number,
 *     note?: string,
 *     idempotency_key?: string,
 *     // Required for action=search_user:
 *     query?: string,
 *   }
 * 
 * Authentication:
 *   Validate identity by querying user_sessions table with session_token
 * 
 * Error handling:
 *   All errors identified by error_code, frontend uses i18n for display
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// ============================================================
// Error class with error_code
// ============================================================
class CodedError extends Error {
  error_code: string
  constructor(error_code: string, message: string) {
    super(message)
    this.error_code = error_code
  }
}

function throwCoded(code: string, message: string): never {
  throw new CodedError(code, message)
}

// ============================================================
// Session validation
// ============================================================
async function validateSession(supabase: any, sessionToken: string) {
  if (!sessionToken) {
    throwCoded('ERR_MISSING_TOKEN', 'Unauthorized: Missing session token')
  }

  const { data: sessions, error: sessionError } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('session_token', sessionToken)
    .eq('is_active', true)

  if (sessionError) {
    throwCoded('ERR_SERVER_ERROR', 'Session validation failed')
  }

  if (!sessions || sessions.length === 0) {
    throwCoded('ERR_INVALID_SESSION', 'Unauthorized: Invalid session')
  }

  const session = sessions[0]
  const expiresAt = new Date(session.expires_at)
  const now = new Date()

  if (expiresAt < now) {
    throwCoded('ERR_SESSION_EXPIRED', 'Unauthorized: Session expired')
  }

  return { userId: session.user_id, session }
}

// ============================================================
// Main handler
// ============================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json()
    const { action, session_token } = body

    if (!session_token) {
      throwCoded('ERR_MISSING_TOKEN', 'Unauthorized: Missing session_token')
    }

    const { userId } = await validateSession(supabase, session_token)

    // 1. Verify if user is a promoter
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, role, is_active')
      .eq('id', userId)
      .single()

    if (profileError || !userProfile) {
      throwCoded('ERR_USER_NOT_FOUND', 'User not found')
    }

    if (userProfile.role !== 'promoter' && userProfile.role !== 'admin') {
      throwCoded('ERR_NOT_PROMOTER', 'User is not a promoter')
    }

    if (userProfile.is_active === false) {
      throwCoded('ERR_PROMOTER_INACTIVE', 'Promoter account is inactive')
    }

    // ============================================================
    // Route actions
    // ============================================================
    switch (action) {
      // ------------------------------------------------------------
      // Search user
      // ------------------------------------------------------------
      case 'search_user': {
        const { query } = body
        if (!query || !query.trim()) {
          throwCoded('ERR_SEARCH_KEYWORD_EMPTY', 'Search query cannot be empty')
        }

        const searchQuery = query.trim()
        
        // Call RPC for flexible search
        const { data: users, error: rpcError } = await supabase.rpc('search_users_for_deposit', {
          p_query: searchQuery
        })

        if (rpcError) {
          console.error('[promoter-deposit] search_users_for_deposit failed:', rpcError)
          throwCoded('ERR_SERVER_ERROR', 'Search failed: ' + rpcError.message)
        }

        if (!users || users.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'User not found', error_code: 'ERR_USER_NOT_FOUND' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (users.length === 1) {
          return new Response(
            JSON.stringify({ success: true, multiple: false, user: users[0] }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        return new Response(
          JSON.stringify({ success: true, multiple: true, users: users }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // ------------------------------------------------------------
      // Execute deposit
      // ------------------------------------------------------------
      case 'deposit': {
        const { target_user_id, amount, note, idempotency_key } = body
        if (!target_user_id) {
          throwCoded('ERR_PARAMS_MISSING', 'Target user ID is required')
        }

        if (!amount || isNaN(amount) || amount < 10) {
          throwCoded('ERR_DEPOSIT_AMOUNT_INVALID', 'Deposit amount must be at least 10 TJS')
        }

        // Call transaction RPC
        const { data: result, error: rpcError } = await supabase.rpc('perform_promoter_deposit', {
          p_promoter_id: userId,
          p_target_user_id: target_user_id,
          p_amount: amount,
          p_note: note || null,
          p_idempotency_key: idempotency_key || null
        })

        if (rpcError) {
          console.error('[promoter-deposit] perform_promoter_deposit failed:', rpcError)
          
          // Map common RPC errors to standard error codes
          const rpcErrorCode = rpcError.code
          let standardCode = 'ERR_SERVER_ERROR'
          
          if (rpcError.message.includes('SELF_DEPOSIT_FORBIDDEN')) standardCode = 'ERR_SELF_DEPOSIT_FORBIDDEN'
          else if (rpcError.message.includes('DAILY_COUNT_EXCEEDED')) standardCode = 'ERR_DAILY_COUNT_EXCEEDED'
          else if (rpcError.message.includes('DAILY_LIMIT_EXCEEDED')) standardCode = 'ERR_DAILY_LIMIT_EXCEEDED'
          else if (rpcError.message.includes('AMOUNT_MUST_BE_INTEGER')) standardCode = 'ERR_AMOUNT_MUST_BE_INTEGER'
          
          throwCoded(standardCode, `Deposit failed: ${rpcError.message}`)
        }

        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // ------------------------------------------------------------
      // Get stats
      // ------------------------------------------------------------
      case 'get_stats': {
        const { data: stats, error: rpcError } = await supabase.rpc('get_promoter_deposit_stats', {
          p_promoter_id: userId
        })

        if (rpcError) {
          console.error('[promoter-deposit] get_promoter_deposit_stats failed:', rpcError)
          throwCoded('ERR_SERVER_ERROR', 'Failed to get stats: ' + rpcError.message)
        }

        return new Response(
          JSON.stringify(stats),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // ------------------------------------------------------------
      // Get history
      // ------------------------------------------------------------
      case 'get_history': {
        const { page = 1, page_size = 20 } = body
        const offset = (page - 1) * page_size

        const { data: deposits, error: queryError } = await supabase
          .from('promoter_deposits')
          .select(`
            id, amount, currency, status, note, bonus_amount, created_at,
            target_user:users!promoter_deposits_target_user_id_fkey(
              id, phone_number, first_name, last_name, avatar_url
            )
          `)
          .eq('promoter_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + page_size - 1)

        if (queryError) {
          console.error('[promoter-deposit] get_history error:', queryError)
          throwCoded('ERR_SERVER_ERROR', 'Failed to get history: ' + queryError.message)
        }

        return new Response(
          JSON.stringify({ success: true, data: deposits }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      default:
        throwCoded('ERR_INVALID_ACTION', 'Unknown action: ' + action)
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    const errorCode = (error instanceof CodedError) ? error.error_code : 'ERR_SERVER_ERROR'
    console.error("[promoter-deposit] Error:", errMsg, "code:", errorCode)

    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg || 'Internal server error',
        error_code: errorCode,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
