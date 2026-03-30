import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { EyeIcon, EyeSlashIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { Wallet } from '../../lib/supabase'
import { formatCurrency, cn } from '../../lib/utils'
import { useSupabase } from '../../contexts/SupabaseContext'
import { useUser } from '../../contexts/UserContext'

interface WalletCardProps {
  wallets: Wallet[]
  isLoading?: boolean
  onRefresh?: () => void
  className?: string
}

export const WalletCard: React.FC<WalletCardProps> = ({
  wallets,
  isLoading = false,
  onRefresh,
  className
}) => {
  const { t } = useTranslation()
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [showBalance, setShowBalance] = useState(true)
  const [todayCommission, setTodayCommission] = useState<number>(0)
  const [isLoadingCommission, setIsLoadingCommission] = useState(false)
  
  // 查找 TJS 货币的余额钱包 (type='TJS')
  const balanceWallet = wallets.find(w => (w.type as string) === 'TJS' && w.currency === 'TJS')
  // 查找积分钱包 (type='LUCKY_COIN', currency='POINTS')
  const luckyCoinWallet = wallets.find(w => w.type === 'LUCKY_COIN' && (w.currency as string) === 'POINTS')
  
  // 获取今日佣金
  const fetchTodayCommission = useCallback(async () => {
    if (!user) return
    setIsLoadingCommission(true)
    try {
      // 获取今天的开始时间（UTC）
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayISO = today.toISOString()

      const { data, error } = await supabase
        .from('commissions')
        .select('amount')
        .eq('user_id', user.id)
        .gte('created_at', todayISO)
        .in('status', ['PENDING', 'PAID'])

      if (!error && data) {
        const total = data.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
        setTodayCommission(total)
      }
    } catch (e) {
      console.error('Failed to fetch today commission:', e)
    } finally {
      setIsLoadingCommission(false)
    }
  }, [user, supabase])

  useEffect(() => {
    fetchTodayCommission()
  }, [fetchTodayCommission])

  const toggleShowBalance = () => {
    setShowBalance(!showBalance)
  }

  const formatDisplayAmount = (currency: string, amount: number) => {
    return showBalance ? formatCurrency(currency, amount) : '****'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-gradient-to-br from-primary via-primary to-primary-dark rounded-2xl p-5 text-white shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t('wallet.myWallet')}</h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={toggleShowBalance}
            className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
          >
            {showBalance ? (
              <EyeIcon className="w-4 h-4" />
            ) : (
              <EyeSlashIcon className="w-4 h-4" />
            )}
          </button>
          
          {onRefresh && (
            <button
              onClick={() => {
                onRefresh()
                fetchTodayCommission()
              }}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors disabled:opacity-50"
            >
              <ArrowPathIcon className={cn(
                "w-4 h-4",
                isLoading && "animate-spin"
              )} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {/* 余额钱包 */}
        <div className="bg-white/15 backdrop-blur-sm rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/70">
                {t('wallet.balance')}
              </p>
              <p className="text-2xl font-bold mt-0.5">
                {balanceWallet ? formatDisplayAmount(balanceWallet.currency, balanceWallet.balance) : 'TJS 0.00'}
              </p>
            </div>
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <span className="text-lg">💰</span>
            </div>
          </div>
        </div>

        {/* 积分钱包 + 今日佣金 */}
        <div className="bg-white/15 backdrop-blur-sm rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm text-white/70">
                {t('wallet.luckyCoin')}
              </p>
              <p className="text-2xl font-bold mt-0.5">
                {luckyCoinWallet ? (showBalance ? luckyCoinWallet.balance.toFixed(2) : '****') : '0'}
              </p>
              {luckyCoinWallet && showBalance && (
                <p className="text-xs text-white/50 mt-1">
                  ≈ {formatCurrency('TJS', luckyCoinWallet.balance)} · {t('payment.pointsAsValue')}
                </p>
              )}
            </div>
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <span className="text-lg">🍀</span>
            </div>
          </div>
        </div>

        {/* 今日佣金 - 独立醒目展示 */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-yellow-400/20 rounded-lg flex items-center justify-center">
                <span className="text-sm">💎</span>
              </div>
              <div>
                <p className="text-xs text-white/60">{t('wallet.todayCommission') || '今日佣金'}</p>
                <p className="text-lg font-bold text-yellow-300 mt-0.5">
                  {isLoadingCommission ? (
                    <span className="inline-block w-16 h-5 bg-white/10 rounded animate-pulse" />
                  ) : (
                    showBalance ? `+${todayCommission.toFixed(2)}` : '****'
                  )}
                </p>
              </div>
            </div>
            {todayCommission > 0 && showBalance && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-yellow-400/20 text-yellow-300 text-[10px] font-medium px-2 py-1 rounded-full"
              >
                {t('wallet.commissionUnit') || '积分'}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
