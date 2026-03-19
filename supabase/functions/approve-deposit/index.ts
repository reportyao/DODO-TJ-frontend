/**
 * ⚠️ DEPRECATED - 此 Edge Function 已废弃
 * 
 * 充值审批已统一使用 approve_deposit_atomic RPC 函数（数据库事务路径）。
 * 该 RPC 在单一数据库事务中完成所有操作，使用 FOR UPDATE 行级锁防止 TOCTOU 竞态条件，
 * 比本 Edge Function 的非原子操作更安全可靠。
 * 
 * 调用方式: supabase.rpc('approve_deposit_atomic', { p_request_id, p_action, p_admin_id, p_admin_note })
 * 
 * 本文件保留仅为兼容性目的，所有请求将返回 410 Gone。
 * 
 * @deprecated 请使用 approve_deposit_atomic RPC 替代
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-admin-id',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: 'DEPRECATED: This Edge Function has been deprecated. Please use the approve_deposit_atomic RPC function instead.',
      migration_guide: 'Call supabase.rpc("approve_deposit_atomic", { p_request_id, p_action, p_admin_id, p_admin_note }) directly.',
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 410, // Gone
    }
  )
})
