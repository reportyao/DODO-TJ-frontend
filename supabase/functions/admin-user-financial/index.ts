import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-admin-id',
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

    const url = new URL(req.url)
    const userId = url.searchParams.get('user_id')
    const action = url.searchParams.get('action') || 'summary'
    const period = url.searchParams.get('period') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20')
    const transactionType = url.searchParams.get('type')
    const status = url.searchParams.get('status')
    const startDate = url.searchParams.get('startDate')
    const endDate = url.searchParams.get('endDate')
    // 【新增】钱包类型筛选：TJS / LUCKY_COIN / 空(全部)
    const walletType = url.searchParams.get('walletType')

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // 记录管理员操作日志
    const adminId = req.headers.get('X-Admin-Id')
    if (adminId) {
      try {
        await supabaseClient.from('admin_logs').insert({
          admin_id: adminId,
          action: `VIEW_USER_FINANCIAL_${action.toUpperCase()}`,
          target_type: 'user',
          target_id: userId,
          details: { period, page, pageSize, transactionType, status, startDate, endDate, walletType }
        })
      } catch (logError: unknown) {
        console.error('Failed to log admin action:', logError)
      }
    }

    if (action === 'summary') {
      return await getFinancialSummary(supabaseClient, userId, period)
    } else if (action === 'transactions') {
      return await getTransactions(supabaseClient, userId, {
        page,
        pageSize,
        transactionType,
        status,
        startDate,
        endDate,
        walletType
      })
    } else if (action === 'export') {
      return await exportTransactions(supabaseClient, userId, {
        transactionType,
        status,
        startDate,
        endDate,
        walletType
      })
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Error in admin-user-financial:', error)
    return new Response(
      JSON.stringify({ error: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function getFinancialSummary(supabaseClient: any, userId: string, period: string) {
  // 1. 获取钱包信息
  const { data: wallets, error: walletsError } = await supabaseClient
    .from('wallets')
    .select('*')
    .eq('user_id', userId)

  if (walletsError) throw walletsError

  const luckyCoinsWallet = wallets.find((w: any) => w.type === 'LUCKY_COIN')
  const cashWallet = wallets.find((w: any) => w.type === 'TJS')

  // 2. 获取佣金统计
  const { data: commissions, error: commissionsError } = await supabaseClient
    .from('commissions')
    .select('level, amount')
    .eq('user_id', userId)
    .eq('status', 'settled')

  if (commissionsError) throw commissionsError

  const level1Commission = commissions.filter((c: any) => c.level === 1).reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0)
  const level2Commission = commissions.filter((c: any) => c.level === 2).reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0)
  const level3Commission = commissions.filter((c: any) => c.level === 3).reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0)

  // 3. 计算时间范围
  let dateFilter = ''
  const now = new Date()
  
  if (period === 'today') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    dateFilter = `created_at >= '${today.toISOString()}'`
  } else if (period === 'week') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    dateFilter = `created_at >= '${weekAgo.toISOString()}'`
  } else if (period === 'month') {
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    dateFilter = `created_at >= '${monthAgo.toISOString()}'`
  }

  // 4. 按钱包类型分别获取交易统计
  const cashWalletId = cashWallet?.id
  const luckyCoinsWalletId = luckyCoinsWallet?.id
  const walletIds = wallets.map((w: any) => w.id)

  // 获取全部交易（用于分类统计）
  let allQuery = supabaseClient
    .from('wallet_transactions')
    .select('type, amount, wallet_id')
    .in('wallet_id', walletIds)
    .eq('status', 'COMPLETED')

  const { data: allTransactions, error: allTransactionsError } = await allQuery
  if (allTransactionsError) throw allTransactionsError

  // 获取时间段内的交易
  let periodQuery = supabaseClient
    .from('wallet_transactions')
    .select('type, amount, status, wallet_id')
    .in('wallet_id', walletIds)
    .eq('status', 'COMPLETED')

  if (dateFilter) {
    const dateValue = dateFilter.split("'")[1]
    periodQuery = periodQuery.gte('created_at', dateValue)
  }

  const { data: periodTransactions, error: periodTransactionsError } = await periodQuery
  if (periodTransactionsError) throw periodTransactionsError

  // 【改进】分别按钱包类型计算统计数据
  const tjsTransactions = allTransactions.filter((t: any) => t.wallet_id === cashWalletId)
  const pointsTransactions = allTransactions.filter((t: any) => t.wallet_id === luckyCoinsWalletId)

  // TJS 钱包统计
  const tjsSpending = tjsTransactions
    .filter((t: any) => ['GROUP_BUY_PURCHASE', 'WITHDRAWAL', 'WITHDRAWAL_FREEZE'].includes(t.type))
    .reduce((sum: number, t: any) => sum + Math.abs(parseFloat(t.amount)), 0)
  const tjsIncome = tjsTransactions
    .filter((t: any) => [
      'DEPOSIT', 'deposit', 'PROMOTER_DEPOSIT',
      'GROUP_BUY_WIN', 'GROUP_BUY_REFUND', 'GROUP_BUY_REFUND_TO_BALANCE',
      'REFERRAL_BONUS', 'MARKET_SALE', 'COMMISSION', 'BONUS',
      'FIRST_DEPOSIT_BONUS', 'FIRST_DEPOSIT_BONUS_ACTIVATION',
      'FIRST_GROUP_BUY_REWARD', 'REFERRAL_FIRST_DEPOSIT_COMMISSION',
      'REFERRAL_GROUP_BUY_COMMISSION', 'COIN_EXCHANGE', 'WITHDRAWAL_UNFREEZE'
    ].includes(t.type))
    .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0)

  // LUCKY_COIN 钱包统计
  const pointsSpending = pointsTransactions
    .filter((t: any) => ['LOTTERY_PURCHASE', 'FULL_PURCHASE', 'SPIN_COST', 'MARKET_PURCHASE', 'RESALE_PURCHASE'].includes(t.type))
    .reduce((sum: number, t: any) => sum + Math.abs(parseFloat(t.amount)), 0)
  const pointsIncome = pointsTransactions
    .filter((t: any) => [
      'SPIN_REWARD', 'NEW_USER_GIFT', 'SHOWOFF_REWARD',
      'GROUP_BUY_REFUND', 'GROUP_BUY_REFUND_TO_POINTS',
      'LOTTERY_PRIZE', 'LOTTERY_REFUND',
      'COIN_EXCHANGE', 'COMMISSION', 'COMMISSION_PAYOUT',
      'REFERRAL_REWARD', 'FIRST_GROUP_BUY_REWARD',
      'MARKET_SALE', 'RESALE_INCOME'
    ].includes(t.type))
    .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0)

  // 时间段统计（也按钱包类型分开）
  const periodTjsTx = periodTransactions.filter((t: any) => t.wallet_id === cashWalletId)
  const periodPointsTx = periodTransactions.filter((t: any) => t.wallet_id === luckyCoinsWalletId)

  const periodDeposits = periodTjsTx.filter((t: any) => ['DEPOSIT', 'deposit', 'PROMOTER_DEPOSIT'].includes(t.type)).reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0)
  const periodWithdrawals = periodTjsTx.filter((t: any) => ['WITHDRAWAL', 'WITHDRAWAL_FREEZE'].includes(t.type)).reduce((sum: number, t: any) => sum + Math.abs(parseFloat(t.amount)), 0)
  const periodTjsSpending = periodTjsTx.filter((t: any) => ['GROUP_BUY_PURCHASE', 'WITHDRAWAL', 'WITHDRAWAL_FREEZE'].includes(t.type)).reduce((sum: number, t: any) => sum + Math.abs(parseFloat(t.amount)), 0)
  const periodTjsIncome = periodTjsTx.filter((t: any) => [
    'DEPOSIT', 'deposit', 'PROMOTER_DEPOSIT',
    'GROUP_BUY_WIN', 'GROUP_BUY_REFUND', 'GROUP_BUY_REFUND_TO_BALANCE',
    'REFERRAL_BONUS', 'MARKET_SALE', 'COMMISSION', 'BONUS',
    'FIRST_DEPOSIT_BONUS', 'FIRST_DEPOSIT_BONUS_ACTIVATION',
    'FIRST_GROUP_BUY_REWARD', 'REFERRAL_FIRST_DEPOSIT_COMMISSION',
    'REFERRAL_GROUP_BUY_COMMISSION', 'COIN_EXCHANGE', 'WITHDRAWAL_UNFREEZE'
  ].includes(t.type)).reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0)
  const periodPointsSpending = periodPointsTx.filter((t: any) => ['LOTTERY_PURCHASE', 'FULL_PURCHASE', 'SPIN_COST', 'MARKET_PURCHASE', 'RESALE_PURCHASE'].includes(t.type)).reduce((sum: number, t: any) => sum + Math.abs(parseFloat(t.amount)), 0)
  const periodPointsIncome = periodPointsTx.filter((t: any) => [
    'SPIN_REWARD', 'NEW_USER_GIFT', 'SHOWOFF_REWARD',
    'GROUP_BUY_REFUND', 'GROUP_BUY_REFUND_TO_POINTS',
    'LOTTERY_PRIZE', 'LOTTERY_REFUND',
    'COIN_EXCHANGE', 'COMMISSION', 'COMMISSION_PAYOUT',
    'REFERRAL_REWARD', 'FIRST_GROUP_BUY_REWARD',
    'MARKET_SALE', 'RESALE_INCOME'
  ].includes(t.type)).reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0)

  // 6. 构建响应 - 分离两种钱包的数据
  const summary = {
    // TJS 余额信息
    cashBalance: cashWallet ? parseFloat(cashWallet.balance) : 0,
    cashFrozenBalance: cashWallet ? parseFloat(cashWallet.frozen_balance) : 0,
    totalDeposits: cashWallet ? parseFloat(cashWallet.total_deposits) : 0,
    totalWithdrawals: cashWallet ? parseFloat(cashWallet.total_withdrawals) : 0,
    tjsSpending,
    tjsIncome,

    // LUCKY_COIN 积分信息
    luckyCoinsBalance: luckyCoinsWallet ? parseFloat(luckyCoinsWallet.balance) : 0,
    luckyFrozenBalance: luckyCoinsWallet ? parseFloat(luckyCoinsWallet.frozen_balance) : 0,
    pointsSpending,
    pointsIncome,

    // 合计（向后兼容）
    frozenBalance: (luckyCoinsWallet ? parseFloat(luckyCoinsWallet.frozen_balance) : 0) + (cashWallet ? parseFloat(cashWallet.frozen_balance) : 0),
    totalSpending: tjsSpending + pointsSpending,
    totalIncome: tjsIncome + pointsIncome,
    
    // 佣金数据
    level1Commission,
    level2Commission,
    level3Commission,
    totalCommission: level1Commission + level2Commission + level3Commission,
    
    // 时间段统计 - 分开两种钱包
    periodStats: {
      period,
      deposits: periodDeposits,
      withdrawals: periodWithdrawals,
      // TJS 时间段
      tjsSpending: periodTjsSpending,
      tjsIncome: periodTjsIncome,
      tjsNetChange: periodDeposits + periodTjsIncome - periodWithdrawals - periodTjsSpending,
      // LUCKY_COIN 时间段
      pointsSpending: periodPointsSpending,
      pointsIncome: periodPointsIncome,
      pointsNetChange: periodPointsIncome - periodPointsSpending,
      // 合计
      spending: periodTjsSpending + periodPointsSpending,
      income: periodTjsIncome + periodPointsIncome,
      netChange: periodDeposits + periodTjsIncome + periodPointsIncome - periodWithdrawals - periodTjsSpending - periodPointsSpending
    }
  }

  return new Response(
    JSON.stringify({ success: true, data: summary }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getTransactions(supabaseClient: any, userId: string, options: any) {
  const { page, pageSize, transactionType, status, startDate, endDate, walletType } = options

  // 1. 获取用户钱包
  const { data: wallets, error: walletsError } = await supabaseClient
    .from('wallets')
    .select('id, type, currency')
    .eq('user_id', userId)

  if (walletsError) throw walletsError

  // 【新增】按钱包类型筛选
  let filteredWallets = wallets
  if (walletType) {
    filteredWallets = wallets.filter((w: any) => w.type === walletType)
  }

  const walletIds = filteredWallets.map((w: any) => w.id)
  const walletsMap = wallets.reduce((map: any, w: any) => {
    map[w.id] = w
    return map
  }, {})

  if (walletIds.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          transactions: [],
          pagination: { page, pageSize, total: 0, totalPages: 0 }
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // 2. 构建查询
  let query = supabaseClient
    .from('wallet_transactions')
    .select('*', { count: 'exact' })
    .in('wallet_id', walletIds)
    .order('created_at', { ascending: false })

  if (transactionType) {
    query = query.eq('type', transactionType)
  }

  if (status) {
    query = query.eq('status', status)
  }

  if (startDate) {
    query = query.gte('created_at', startDate)
  }

  if (endDate) {
    query = query.lte('created_at', endDate)
  }

  // 分页
  const offset = (page - 1) * pageSize
  query = query.range(offset, offset + pageSize - 1)

  const { data: transactions, error: transactionsError, count } = await query

  if (transactionsError) throw transactionsError

  // 3. 增强交易数据
  const enhancedTransactions = transactions.map((t: any) => {
    const wallet = walletsMap[t.wallet_id]
    return {
      ...t,
      walletType: wallet.type,
      currency: wallet.currency,
      typeName: getTransactionTypeName(t.type),
      isIncome: isIncomeType(t.type),
      // 【新增】单位标识
      unit: wallet.type === 'TJS' ? 'TJS' : '积分'
    }
  })

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        transactions: enhancedTransactions,
        pagination: {
          page,
          pageSize,
          total: count,
          totalPages: Math.ceil(count / pageSize)
        }
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function exportTransactions(supabaseClient: any, userId: string, options: any) {
  const { transactionType, status, startDate, endDate, walletType } = options

  // 获取所有交易记录(不分页)
  const { data: wallets } = await supabaseClient
    .from('wallets')
    .select('id, type, currency')
    .eq('user_id', userId)

  let filteredWallets = wallets
  if (walletType) {
    filteredWallets = wallets.filter((w: any) => w.type === walletType)
  }

  const walletIds = filteredWallets.map((w: any) => w.id)
  const walletsMap = wallets.reduce((map: any, w: any) => {
    map[w.id] = w
    return map
  }, {})

  let query = supabaseClient
    .from('wallet_transactions')
    .select('*')
    .in('wallet_id', walletIds)
    .order('created_at', { ascending: false })

  if (transactionType) query = query.eq('type', transactionType)
  if (status) query = query.eq('status', status)
  if (startDate) query = query.gte('created_at', startDate)
  if (endDate) query = query.lte('created_at', endDate)

  const { data: transactions } = await query

  // 生成CSV
  const headers = ['时间', '类型', '金额', '单位', '变化前余额', '变化后余额', '状态', '钱包类型', '描述', '关联订单ID']
  const rows = (transactions || []).map((t: any) => {
    const wallet = walletsMap[t.wallet_id]
    const unit = wallet.type === 'TJS' ? 'TJS' : '积分'
    return [
      t.created_at,
      getTransactionTypeName(t.type),
      t.amount,
      unit,
      t.balance_before ?? '',
      t.balance_after ?? '',
      t.status,
      getWalletTypeName(wallet.type),
      (t.description || '').replace(/,/g, '，'),
      t.related_order_id || ''
    ]
  })

  const csv = [headers, ...rows].map(row => row.join(',')).join('\n')

  return new Response(csv, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="user_${userId}_transactions_${new Date().toISOString()}.csv"`
    }
  })
}

function getTransactionTypeName(type: string): string {
  const typeNames: Record<string, string> = {
    'DEPOSIT': '充值',
    'deposit': '充值',
    'WITHDRAWAL': '提现',
    'WITHDRAWAL_FREEZE': '提现冻结',
    'WITHDRAWAL_UNFREEZE': '提现解冻',
    'LOTTERY_PURCHASE': '积分商城消费',
    'LOTTERY_REFUND': '积分商城退款',
    'LOTTERY_PRIZE': '积分商城中奖',
    'REFERRAL_BONUS': '邀请奖励',
    'COIN_EXCHANGE': '币种兑换',
    'MARKET_PURCHASE': '市场购买',
    'MARKET_SALE': '市场出售',
    'ADMIN_ADJUSTMENT': '系统调整',
    'GROUP_BUY_PURCHASE': '拼团消费',
    'GROUP_BUY_REFUND': '拼团退款',
    'GROUP_BUY_REFUND_TO_POINTS': '拼团退款转积分',
    'GROUP_BUY_REFUND_TO_BALANCE': '拼团退款转余额',
    'GROUP_BUY_WIN': '拼团中奖',
    'FULL_PURCHASE': '全款购买',
    'NEW_USER_GIFT': '新用户礼物',
    'SHOWOFF_REWARD': '晒单奖励',
    'SPIN_REWARD': '转盘奖励',
    'SPIN_COST': '转盘消耗',
    'COMMISSION': '佣金收入',
    'FIRST_DEPOSIT_BONUS': '首充奖励',
    'FIRST_DEPOSIT_BONUS_ACTIVATION': '首充奖励激活',
    'FIRST_GROUP_BUY_REWARD': '首次拼团奖励',
    'REFERRAL_FIRST_DEPOSIT_COMMISSION': '邀请首充佣金',
    'REFERRAL_GROUP_BUY_COMMISSION': '邀请拼团佣金',
    'BONUS': '奖励',
    'POINTS_EXCHANGE': '积分兑换',
    'PROMOTER_DEPOSIT': '地推代充',
    'COMMISSION_PAYOUT': '批量佣金发放',
    'RESALE_PURCHASE': '转售购买',
    'RESALE_INCOME': '转售收入',
    'REFERRAL_REWARD': '邀请奖励'
  }
  return typeNames[type] || type
}

function getWalletTypeName(type: string): string {
  const names: Record<string, string> = {
    'TJS': '余额 (TJS)',
    'LUCKY_COIN': '积分'
  }
  return names[type] || type
}

function isIncomeType(type: string): boolean {
  return [
    'DEPOSIT',
    'deposit',
    'LOTTERY_PRIZE',
    'LOTTERY_REFUND',
    'GROUP_BUY_WIN',
    'GROUP_BUY_REFUND',
    'GROUP_BUY_REFUND_TO_POINTS',
    'GROUP_BUY_REFUND_TO_BALANCE',
    'REFERRAL_BONUS',
    'MARKET_SALE',
    'NEW_USER_GIFT',
    'SHOWOFF_REWARD',
    'SPIN_REWARD',
    'WITHDRAWAL_UNFREEZE',
    'COMMISSION',
    'COMMISSION_PAYOUT',
    'FIRST_DEPOSIT_BONUS',
    'FIRST_DEPOSIT_BONUS_ACTIVATION',
    'FIRST_GROUP_BUY_REWARD',
    'REFERRAL_FIRST_DEPOSIT_COMMISSION',
    'REFERRAL_GROUP_BUY_COMMISSION',
    'BONUS',
    'PROMOTER_DEPOSIT',
    'COIN_EXCHANGE',
    'POINTS_EXCHANGE',
    'RESALE_INCOME',
    'REFERRAL_REWARD',
    'MARKET_SALE'
  ].includes(type)
}
