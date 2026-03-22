/**
 * 临时测试函数：模拟管理后台审核充值
 * 使用 service_role key 调用 approve_deposit_atomic RPC
 * 修复 p_admin_id 的 UUID 类型转换问题
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { request_id, action, admin_id, admin_note } = await req.json()
  
  if (!request_id || !action || !admin_id) {
    return new Response(
      JSON.stringify({ success: false, error: '缺少参数: request_id, action, admin_id' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // 使用 SQL 直接调用 RPC，显式转换 UUID 类型
    const { data, error } = await supabase.rpc('approve_deposit_atomic', {
      p_request_id: request_id,
      p_action: action,
      p_admin_id: admin_id,
      p_admin_note: admin_note || '',
    })

    console.log('[test-approve-deposit] RPC result:', JSON.stringify({ data, error }))

    if (error) {
      // 如果 RPC 调用失败（类型问题），尝试直接用 SQL
      if (error.message.includes('uuid') || error.message.includes('type')) {
        console.log('[test-approve-deposit] RPC type error, trying direct SQL approach')
        
        // 先查询充值申请
        const { data: deposit, error: fetchErr } = await supabase
          .from('deposit_requests')
          .select('*')
          .eq('id', request_id)
          .single()
        
        if (fetchErr || !deposit) {
          return new Response(
            JSON.stringify({ success: false, error: '充值申请不存在' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        
        if (deposit.status !== 'PENDING') {
          return new Response(
            JSON.stringify({ success: false, error: `该充值申请已被处理，当前状态: ${deposit.status}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        
        if (action === 'APPROVED') {
          // 1. 更新充值申请状态
          const { error: updateErr } = await supabase
            .from('deposit_requests')
            .update({
              status: 'APPROVED',
              reviewed_by: admin_id,
              reviewed_at: new Date().toISOString(),
              admin_note: admin_note || null,
            })
            .eq('id', request_id)
          
          if (updateErr) {
            return new Response(
              JSON.stringify({ success: false, error: '更新充值申请失败: ' + updateErr.message }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          
          // 2. 查找用户钱包
          const { data: wallet, error: walletErr } = await supabase
            .from('wallets')
            .select('id, balance')
            .eq('user_id', deposit.user_id)
            .eq('type', 'TJS')
            .single()
          
          if (walletErr || !wallet) {
            return new Response(
              JSON.stringify({ success: false, error: '用户钱包不存在' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          
          // 3. 更新钱包余额
          const newBalance = parseFloat(wallet.balance) + parseFloat(deposit.amount)
          const { error: balanceErr } = await supabase
            .from('wallets')
            .update({ balance: newBalance, updated_at: new Date().toISOString() })
            .eq('id', wallet.id)
          
          if (balanceErr) {
            return new Response(
              JSON.stringify({ success: false, error: '更新余额失败: ' + balanceErr.message }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          
          // 4. 创建钱包交易记录
          await supabase.from('wallet_transactions').insert({
            user_id: deposit.user_id,
            wallet_id: wallet.id,
            type: 'DEPOSIT',
            amount: deposit.amount,
            balance_after: newBalance,
            description: `充值 ${deposit.amount} TJS (${deposit.payment_method})`,
            reference_type: 'deposit_request',
            reference_id: deposit.id,
          })
          
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: '充值已批准',
              amount: deposit.amount,
              new_balance: newBalance,
              bonus_amount: 0,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        } else if (action === 'REJECTED') {
          // 拒绝：只更新状态
          const { error: updateErr } = await supabase
            .from('deposit_requests')
            .update({
              status: 'REJECTED',
              reviewed_by: admin_id,
              reviewed_at: new Date().toISOString(),
              admin_note: admin_note || null,
            })
            .eq('id', request_id)
          
          if (updateErr) {
            return new Response(
              JSON.stringify({ success: false, error: '更新充值申请失败: ' + updateErr.message }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          
          return new Response(
            JSON.stringify({ success: true, message: '充值已拒绝' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
      
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e: any) {
    console.error('[test-approve-deposit] Error:', e)
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
