import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 获取总用户数
    const { count: totalUsers } = await supabaseClient
      .from('users')
      .select('*', { count: 'exact', head: true })

    // 获取今日新增用户
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { count: todayUsers } = await supabaseClient
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString())

    // 获取活跃积分商城数
    const { count: activeLotteries } = await supabaseClient
      .from('lotteries')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')

    // 获取总收入
    const { data: deposits } = await supabaseClient
      .from('deposits')
      .select('amount')
      .eq('status', 'approved')

    const totalRevenue = deposits?.reduce((sum, d) => sum + parseFloat(d.amount), 0) || 0

    // 获取今日收入
    const { data: todayDeposits } = await supabaseClient
      .from('deposits')
      .select('amount')
      .eq('status', 'approved')
      .gte('created_at', today.toISOString())

    const todayRevenue = todayDeposits?.reduce((sum, d) => sum + parseFloat(d.amount), 0) || 0

    // 获取待处理订单
    const { count: pendingOrders } = await supabaseClient
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    // 获取待审核充值
    const { count: pendingDeposits } = await supabaseClient
      .from('deposits')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    // 获取待审核提现
    const { count: pendingWithdrawals } = await supabaseClient
      .from('withdrawals')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    // 获取7日活跃用户（有订单或交易）
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const { data: activeUserIds } = await supabaseClient
      .from('orders')
      .select('user_id')
      .gte('created_at', sevenDaysAgo.toISOString())

    const uniqueActiveUsers = new Set(activeUserIds?.map(o => o.user_id) || [])

    const stats = {
      totalUsers: totalUsers || 0,
      todayUsers: todayUsers || 0,
      activeLotteries: activeLotteries || 0,
      totalRevenue: totalRevenue.toFixed(2),
      todayRevenue: todayRevenue.toFixed(2),
      pendingOrders: pendingOrders || 0,
      pendingDeposits: pendingDeposits || 0,
      pendingWithdrawals: pendingWithdrawals || 0,
      activeUsers7d: uniqueActiveUsers.size
    }

    return new Response(
      JSON.stringify(stats),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
