/**
 * PromoterDepositPage - 地推人员代客充值页面
 * 
 * 功能：
 *   1. 扫描用户二维码或手动输入用户 ID / 手机号查找目标用户
 *   2. 选择快捷金额或手动输入充值金额（10-500 TJS）
 *   3. 执行充值操作（调用 promoter-deposit Edge Function）
 *   4. 显示今日充值统计和充值历史
 * 
 * 认证方式：
 *   通过 localStorage 中的 custom_session_token 验证身份
 *   （与 exchange-balance 等页面保持一致）
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import {
  ArrowLeftIcon,
  QrCodeIcon,
  MagnifyingGlassIcon,
  UserCircleIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import toast from 'react-hot-toast'

// ============================================================
// 类型定义
// ============================================================
interface TargetUser {
  id: string
  phone_number: string | null
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
}

interface DepositStats {
  total_amount: number
  total_count: number
  total_bonus: number
  daily_limit: number
  remaining_limit: number
  remaining_count: number
}

interface DepositRecord {
  id: string
  amount: number
  currency: string
  status: string
  note: string | null
  bonus_amount: number
  created_at: string
  target_user: TargetUser | null
}

// ============================================================
// 组件
// ============================================================
const PromoterDepositPage: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useUser()
  const navigate = useNavigate()

  // ========== 状态 ==========
  const [step, setStep] = useState<'search' | 'amount' | 'confirm' | 'success'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [targetUser, setTargetUser] = useState<TargetUser | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [stats, setStats] = useState<DepositStats | null>(null)
  const [quickAmounts, setQuickAmounts] = useState<number[]>([10, 20, 50, 100, 200, 500])
  const [history, setHistory] = useState<DepositRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [depositResult, setDepositResult] = useState<any>(null)

  // ========== 获取 session_token ==========
  const getSessionToken = useCallback(() => {
    return localStorage.getItem('custom_session_token')
  }, [])

  // ========== 调用 promoter-deposit Edge Function ==========
  const callPromoterDeposit = useCallback(async (body: Record<string, any>) => {
    const sessionToken = getSessionToken()
    if (!sessionToken) {
      throw new Error(t('promoterDeposit.notLoggedIn'))
    }

    const { data, error } = await supabase.functions.invoke('promoter-deposit', {
      body: {
        ...body,
        session_token: sessionToken,
      },
    })

    if (error) {
      // 尝试从 error 中提取具体错误信息
      const errorMsg = typeof error === 'object' && error.message
        ? error.message
        : String(error)
      throw new Error(errorMsg)
    }

    return data
  }, [getSessionToken, t])

  // ========== 加载今日统计 ==========
  const loadStats = useCallback(async () => {
    try {
      const result = await callPromoterDeposit({ action: 'get_stats' })
      if (result?.success !== false) {
        setStats(result)
      }
    } catch (err: any) {
      console.error('[PromoterDepositPage] loadStats error:', err)
    }
  }, [callPromoterDeposit])

  // ========== 加载快捷金额配置 ==========
  const loadQuickAmounts = useCallback(async () => {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/system_config?key=eq.promoter_deposit_quick_amounts&select=value`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      )
      if (response.ok) {
        const data = await response.json()
        if (data?.[0]?.value) {
          const parsed = typeof data[0].value === 'string'
            ? JSON.parse(data[0].value)
            : data[0].value
          if (parsed?.amounts && Array.isArray(parsed.amounts)) {
            setQuickAmounts(parsed.amounts)
          }
        }
      }
    } catch (err) {
      console.log('[PromoterDepositPage] loadQuickAmounts fallback to default')
    }
  }, [])

  // ========== 加载充值历史 ==========
  const loadHistory = useCallback(async () => {
    try {
      const result = await callPromoterDeposit({
        action: 'get_history',
        page: 1,
        page_size: 20,
      })
      if (result?.success !== false && result?.data) {
        setHistory(result.data)
      }
    } catch (err: any) {
      console.error('[PromoterDepositPage] loadHistory error:', err)
    }
  }, [callPromoterDeposit])

  // ========== 初始化 ==========
  useEffect(() => {
    loadStats()
    loadQuickAmounts()
  }, [loadStats, loadQuickAmounts])

  // ========== 搜索用户 ==========
  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    try {
      const result = await callPromoterDeposit({
        action: 'search_user',
        query: searchQuery.trim(),
      })

      if (result?.success) {
        // 检查是否是自己
        if (result.user.id === user?.id) {
          toast.error(t('promoterDeposit.cannotDepositSelf'))
          return
        }
        setTargetUser(result.user)
        setStep('amount')
      } else {
        toast.error(t('promoterDeposit.userNotFound'))
      }
    } catch (err: any) {
      toast.error(mapErrorMessage(err.message) || t('promoterDeposit.searchFailed'))
    } finally {
      setIsSearching(false)
    }
  }

  // ========== 错误消息映射（将后端中文错误消息映射为翻译key） ==========
  const mapErrorMessage = (msg: string): string => {
    const errorMap: Record<string, string> = {
      'NOT_PROMOTER': t('promoterDeposit.errors.notPromoter', '您不是地推人员'),
      'PROMOTER_INACTIVE': t('promoterDeposit.errors.promoterInactive', '地推账号未激活'),
      'SELF_DEPOSIT_FORBIDDEN': t('promoterDeposit.cannotDepositSelf'),
      'INVALID_AMOUNT': t('promoterDeposit.errors.invalidAmount', '充值金额不合法'),
      'AMOUNT_MUST_BE_INTEGER': t('promoterDeposit.errors.amountMustBeInteger', '金额必须为整数'),
      'DAILY_COUNT_EXCEEDED': t('promoterDeposit.errors.dailyCountExceeded', '今日充值次数已达上限'),
      'DAILY_LIMIT_EXCEEDED': t('promoterDeposit.errors.dailyLimitExceeded', '今日充值额度不足'),
    }
    // 检查是否是已知的错误码
    if (errorMap[msg]) return errorMap[msg]
    // 检查是否包含已知的中文错误消息
    if (msg.includes('不是地推人员')) return errorMap['NOT_PROMOTER']
    if (msg.includes('未激活') || msg.includes('已被停用')) return errorMap['PROMOTER_INACTIVE']
    if (msg.includes('不能小于')) return errorMap['INVALID_AMOUNT']
    if (msg.includes('次数已达上限')) return errorMap['DAILY_COUNT_EXCEEDED']
    if (msg.includes('额度不足')) return errorMap['DAILY_LIMIT_EXCEEDED']
    return msg
  }

  // ========== 扫码功能（PWA 模式不支持，提示用户使用手动搜索） ==========
  const handleScanQr = () => {
    toast(t('promoterDeposit.scanNotSupported'), { icon: 'ℹ️' })
  }

  // ========== 选择金额 ==========
  const handleSelectAmount = (value: number) => {
    setAmount(value)
    setCustomAmount('')
  }

  const handleCustomAmountChange = (value: string) => {
    // 只允许整数金额
    const filtered = value.replace(/[^\d]/g, '')
    setCustomAmount(filtered)
    const num = parseInt(filtered, 10)
    const maxAmount = stats?.daily_limit || 500
    if (!isNaN(num) && num >= 10 && num <= maxAmount) {
      setAmount(num)
    } else {
      setAmount(null)
    }
  }

  // ========== 确认充值 ==========
  const handleConfirm = () => {
    if (!targetUser || !amount) return
    setStep('confirm')
  }

  // ========== 执行充值 ==========
  const handleDeposit = async () => {
    if (!targetUser || !amount) return

    setIsSubmitting(true)
    try {
      // 生成幂等性 key 防止重复提交
      const idempotencyKey = `promoter_deposit_${targetUser.id}_${amount}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const result = await callPromoterDeposit({
        action: 'deposit',
        target_user_id: targetUser.id,
        amount: amount,
        note: note || undefined,
        idempotency_key: idempotencyKey,
      })

      if (result?.success) {
        setDepositResult(result)
        setStep('success')
        // 刷新统计
        loadStats()
        toast.success(t('promoterDeposit.depositSuccess'))
      } else {
        toast.error(mapErrorMessage(result?.error) || t('promoterDeposit.depositFailed'))
      }
    } catch (err: any) {
      toast.error(mapErrorMessage(err.message) || t('promoterDeposit.depositFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // ========== 重置，开始新的充值 ==========
  const handleReset = () => {
    setStep('search')
    setSearchQuery('')
    setTargetUser(null)
    setAmount(null)
    setCustomAmount('')
    setNote('')
    setDepositResult(null)
  }

  // ========== 获取用户显示名称 ==========
  const getUserDisplayName = (u: TargetUser | null) => {
    if (!u) return '---'
    if (u.first_name) return u.first_name + (u.last_name ? ' ' + u.last_name : '')
    if (u.phone_number) return u.phone_number.slice(0, 3) + '****'
    return u.id.substring(0, 8)
  }

  // ========== 渲染 ==========
  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* 顶部导航栏 */}
      <div className="bg-white sticky top-0 z-10 px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <button onClick={() => navigate('/promoter-center')} className="p-1">
          <ArrowLeftIcon className="w-6 h-6 text-gray-700" />
        </button>
        <h1 className="text-lg font-bold text-gray-900">
          {t('promoterDeposit.title')}
        </h1>
        <button
          onClick={() => {
            setShowHistory(!showHistory)
            if (!showHistory) loadHistory()
          }}
          className="p-1"
        >
          <ClockIcon className="w-6 h-6 text-gray-700" />
        </button>
      </div>

      {/* 今日统计卡片 */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mt-4 bg-gradient-to-r from-primary to-primary rounded-2xl p-4 text-white"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium opacity-80">
              {t('promoterDeposit.todayStats')}
            </span>
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
              {stats.remaining_count} {t('promoterDeposit.timesRemaining')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-2xl font-bold">{stats.total_count}</p>
              <p className="text-xs opacity-70">{t('promoterDeposit.depositCount')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total_amount}</p>
              <p className="text-xs opacity-70">{t('promoterDeposit.depositAmount')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.remaining_limit}</p>
              <p className="text-xs opacity-70">{t('promoterDeposit.remainingLimit')}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* ========== 充值历史弹窗 ========== */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setShowHistory(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">
                  {t('promoterDeposit.depositHistory')}
                </h3>
                <button onClick={() => setShowHistory(false)}>
                  <XMarkIcon className="w-6 h-6 text-gray-400" />
                </button>
              </div>
              <div className="overflow-y-auto max-h-[60vh] p-4 space-y-3">
                {history.length === 0 ? (
                  <p className="text-center text-gray-400 py-8">
                    {t('promoterDeposit.noHistory')}
                  </p>
                ) : (
                  history.map((record) => (
                    <div
                      key={record.id}
                      className="bg-gray-50 rounded-xl p-3 flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                          <BanknotesIcon className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {getUserDisplayName(record.target_user)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(record.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-600">
                          +{record.amount} TJS
                        </p>
                        {record.bonus_amount > 0 && (
                          <p className="text-xs text-orange-500">
                            +{record.bonus_amount} {t('promoterDeposit.bonus')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== Step 1: 搜索用户 ========== */}
      <AnimatePresence mode="wait">
        {step === 'search' && (
          <motion.div
            key="search"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mx-4 mt-4"
          >
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                {t('promoterDeposit.findUser')}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                {t('promoterDeposit.findUserHint')}
              </p>

              {/* 搜索输入框 */}
              <div className="flex space-x-2 mb-4">
                <div className="flex-1 relative">
                  <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder={t('promoterDeposit.searchPlaceholder')}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
                <button
                  onClick={handleScanQr}
                  className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0"
                >
                  <QrCodeIcon className="w-6 h-6 text-primary" />
                </button>
              </div>

              {/* 搜索按钮 */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="w-full py-3 bg-primary text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSearching ? (
                  <span className="flex items-center justify-center space-x-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>{t('promoterDeposit.searching')}</span>
                  </span>
                ) : (
                  t('promoterDeposit.searchUser')
                )}
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ========== Step 2: 选择金额 ========== */}
        {step === 'amount' && targetUser && (
          <motion.div
            key="amount"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mx-4 mt-4 space-y-4"
          >
            {/* 目标用户信息 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center space-x-3">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                {targetUser.avatar_url ? (
                  <img
                    src={targetUser.avatar_url}
                    alt="avatar"
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <UserCircleIcon className="w-8 h-8 text-primary" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900">
                  {getUserDisplayName(targetUser)}
                </p>
                <p className="text-xs text-gray-500 font-mono">
                  ID: {targetUser.id.substring(0, 8)}
                  {targetUser.phone_number && ` · ${targetUser.phone_number.slice(0, 3)}****`}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="text-sm text-primary font-medium"
              >
                {t('promoterDeposit.changeUser')}
              </button>
            </div>

            {/* 金额选择 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                {t('promoterDeposit.selectAmount')}
              </h3>

              {/* 快捷金额按钮 */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {quickAmounts.map((value) => (
                  <motion.button
                    key={value}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleSelectAmount(value)}
                    className={`py-3 rounded-xl font-bold text-lg transition-all ${
                      amount === value && !customAmount
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-gray-50 text-gray-700 border border-gray-200'
                    }`}
                  >
                    {value} <span className="text-xs font-normal opacity-70">TJS</span>
                  </motion.button>
                ))}
              </div>

              {/* 自定义金额输入 */}
              <div className="relative mb-4">
                <input
                  type="text"
                  inputMode="numeric"
                  value={customAmount}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                  placeholder={t('promoterDeposit.customAmountPlaceholder')}
                  className="w-full py-3 px-4 bg-gray-50 rounded-xl border border-gray-200 text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
                  TJS
                </span>
              </div>

              {/* 金额范围提示 */}
              <p className="text-xs text-gray-400 text-center mb-4">
                {t('promoterDeposit.amountRangeDynamic', { min: 10, max: stats?.daily_limit || 500 })}
              </p>

              {/* 备注输入 */}
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('promoterDeposit.notePlaceholder')}
                className="w-full py-2 px-4 bg-gray-50 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-4"
              />

              {/* 确认按钮 */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleConfirm}
                disabled={!amount || amount < 10}
                className="w-full py-3 bg-primary text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('promoterDeposit.nextStep')}
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ========== Step 3: 确认充值 ========== */}
        {step === 'confirm' && targetUser && amount && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mx-4 mt-4"
          >
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="text-center mb-6">
                <ExclamationTriangleIcon className="w-12 h-12 text-orange-500 mx-auto mb-2" />
                <h3 className="text-lg font-bold text-gray-900">
                  {t('promoterDeposit.confirmTitle')}
                </h3>
              </div>

              {/* 充值详情 */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">
                    {t('promoterDeposit.targetUser')}
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {getUserDisplayName(targetUser)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">
                    {t('promoterDeposit.userId')}
                  </span>
                  <span className="text-sm font-mono text-gray-900">
                    {targetUser.id.substring(0, 8)}
                  </span>
                </div>
                {targetUser.phone_number && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">
                      {t('promoterDeposit.phoneNumber', '电话')}
                    </span>
                    <span className="text-sm font-mono text-gray-900">
                      {targetUser.phone_number}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">
                    {t('promoterDeposit.depositAmountLabel')}
                  </span>
                  <span className="text-lg font-bold text-primary">
                    {amount} TJS
                  </span>
                </div>
                {note && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">
                      {t('promoterDeposit.noteLabel')}
                    </span>
                    <span className="text-sm text-gray-900">{note}</span>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex space-x-3">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('amount')}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium"
                >
                  {t('common.back')}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDeposit}
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center space-x-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>{t('promoterDeposit.processing')}</span>
                    </span>
                  ) : (
                    t('promoterDeposit.confirmDeposit')
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ========== Step 4: 充值成功 ========== */}
        {step === 'success' && depositResult && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-4 mt-4"
          >
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 15, delay: 0.2 }}
              >
                <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
              </motion.div>

              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {t('promoterDeposit.depositSuccess')}
              </h3>

              <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-6 text-left">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">
                    {t('promoterDeposit.depositAmountLabel')}
                  </span>
                  <span className="text-sm font-bold text-green-600">
                    +{depositResult.amount} TJS
                  </span>
                </div>
                {depositResult.bonus_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">
                      {t('promoterDeposit.firstDepositBonus')}
                    </span>
                    <span className="text-sm font-bold text-orange-500">
                      +{depositResult.bonus_amount} TJS
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">
                    {t('promoterDeposit.todayRemaining')}
                  </span>
                  <span className="text-sm text-gray-700">
                    {depositResult.today_count ?? '--'}/10 {t('promoterDeposit.times')} · {depositResult.today_total ?? '--'}/{depositResult.daily_limit ?? '--'} TJS
                  </span>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleReset}
                className="w-full py-3 bg-primary text-white rounded-xl font-medium"
              >
                {t('promoterDeposit.continueDeposit')}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default PromoterDepositPage
