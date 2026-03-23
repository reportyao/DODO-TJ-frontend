/**
 * PromoterCenterPage.tsx
 * 推广者中心（市场合伙人）- 用户端
 * 
 * 功能模块：
 * 1. 业绩概览 - 注册数、充值数、佣金收入（含环比趋势）
 * 2. 今日打卡 - 接触人数+1按钮
 * 3. 推广物料 - 邀请码、邀请链接、二维码海报
 * 4. 我的团队 - 一二三级下线人数和列表
 * 5. 排行榜 - 注册数前20名
 * 
 * 设计原则：
 * - 简单直观、小白化操作
 * - 大按钮、图标化、少文字多视觉
 * - 适配塔吉克斯坦用户文化水平
 * - 复用现有组件和样式模式
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { formatCurrency, copyToClipboard } from '../lib/utils'
import {
  ArrowLeftIcon,
  ChartBarIcon,
  UserGroupIcon,
  TrophyIcon,
  ClipboardDocumentIcon,
  ShareIcon,
  HandRaisedIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  QrCodeIcon,
  MegaphoneIcon,
  StarIcon,
  BoltIcon,
  BanknotesIcon,
} from '@heroicons/react/24/outline'
import {
  StarIcon as StarIconSolid,
  TrophyIcon as TrophyIconSolid,
} from '@heroicons/react/24/solid'
import toast from 'react-hot-toast'

// ============================================================
// 类型定义
// ============================================================

/** 推广者中心数据结构 */
interface PromoterCenterData {
  success: boolean
  error?: string
  promoter: {
    user_id: string
    team_name: string | null
    point_name: string | null
    hire_date: string | null
    daily_base_salary: number | null
  }
  my_stats: {
    registrations: number
    prev_registrations: number
    charges: number
    charge_amount: number
    prev_charges: number
    prev_charge_amount: number
    commission: number
    conversion_rate: number
  }
  team: {
    level1_count: number
    level2_count: number
    level3_count: number
    total_count: number
    recent_members: Array<{
      id: string
      name: string
      avatar_url: string | null
      joined_at: string
      level: number
    }>
  }
  leaderboard: Array<{
    user_id: string
    name: string
    avatar_url: string | null
    team_name: string | null
    registrations: number
    is_me: boolean
  }>
  today_log: {
    contact_count: number
    log_date: string
    has_logged: boolean
  }
  time_range: string
}

/** 当前活跃的Tab */
type ActiveTab = 'overview' | 'team' | 'leaderboard' | 'materials'

// ============================================================
// 主组件
// ============================================================

const PromoterCenterPage: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useUser()
  const navigate = useNavigate()

  // ========== 状态管理 ==========
  const [data, setData] = useState<PromoterCenterData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today')
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')
  const [isChecking, setIsChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notPromoter, setNotPromoter] = useState(false)

  // 【迁移修复】邀请链接 - 使用 PWA 域名
  const inviteCode = user?.referral_code || user?.invite_code || ''
  const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin
  const inviteLink = `${appDomain}?ref=${inviteCode}`

  // ========== 数据获取 ==========
  const fetchData = useCallback(async (showRefresh = false) => {
    if (!user?.id) {
      // 无用户ID时直接显示非推广者提示
      setNotPromoter(true)
      setIsLoading(false)
      return
    }

    if (showRefresh) setIsRefreshing(true)
    else setIsLoading(true)

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_promoter_center_data`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_user_id: user.id,
            p_time_range: timeRange,
          }),
        }
      )

      if (response.ok) {
        const result = await response.json()
        if (result.success === false && result.error === 'NOT_PROMOTER') {
          setNotPromoter(true)
        } else {
          setData(result)
          setNotPromoter(false)
        }
      }
    } catch (error) {
      console.error('[PromoterCenter] Failed to fetch data:', error)
      toast.error(t('common.error'))
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [user?.id, timeRange, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ========== 今日打卡 ==========
  const handleCheckIn = async () => {
    if (!user?.id || isChecking) return
    setIsChecking(true)

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/increment_contact_count`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_promoter_id: user.id,
            p_log_date: new Date().toISOString().split('T')[0],
          }),
        }
      )

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          // 更新本地数据
          setData(prev => prev ? {
            ...prev,
            today_log: {
              ...prev.today_log,
              contact_count: result.contact_count,
              has_logged: true,
            }
          } : prev)
          toast.success(`+1 ✅ ${t('promoter.contactCount')}: ${result.contact_count}`)
        } else {
          toast.error(result.message || t('common.error'))
        }
      }
    } catch (error) {
      console.error('[PromoterCenter] Check-in failed:', error)
      toast.error(t('common.error'))
    } finally {
      setIsChecking(false)
    }
  }

  // ========== 复制邀请链接 ==========
  const handleCopyLink = async () => {
    const success = await copyToClipboard(inviteLink)
    if (success) {
      setCopied(true)
      toast.success(t('invite.linkCopied'))
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // 【迁移修复】分享功能 - 优先使用 Web Share API，回退到 WhatsApp
  const handleShare = () => {
    const shareText = t('promoter.shareText', { code: inviteCode })
    if (navigator.share) {
      navigator.share({
        title: 'DODO',
        text: shareText,
        url: inviteLink,
      }).catch(console.error)
    } else {
      // 回退到 WhatsApp 分享
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText + '\n' + inviteLink)}`
      window.open(whatsappUrl, '_blank')
    }
  }

  // ========== 环比趋势计算 ==========
  const getTrend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0
    return Math.round(((current - previous) / previous) * 100)
  }

  // ========== 非推广者提示 ==========
  if (notPromoter) {
    return (
      <div className="pb-20 bg-gray-50 min-h-screen">
        {/* 顶部导航栏 */}
        <div className="bg-gradient-to-r from-green-600 to-accent text-white px-4 py-4">
          <div className="flex items-center space-x-3">
            <button onClick={() => navigate(-1)} className="p-1">
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <h1 className="text-lg font-bold">{t('promoter.centerTitle')}</h1>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center px-6 py-20">
          <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center mb-6">
            <MegaphoneIcon className="w-10 h-10 text-gray-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-3">{t('promoter.notPromoter')}</h2>
          <p className="text-gray-500 text-center text-sm leading-relaxed">
            {t('promoter.notPromoterDesc')}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="mt-8 px-8 py-3 bg-green-600 text-white rounded-xl font-medium"
          >
            {t('common.back')}
          </button>
        </div>
      </div>
    )
  }

  // ========== 加载状态 ==========
  if (isLoading) {
    return (
      <div className="pb-20 bg-gray-50 min-h-screen">
        <div className="bg-gradient-to-r from-green-600 to-accent text-white px-4 py-4">
          <div className="flex items-center space-x-3">
            <button onClick={() => navigate(-1)} className="p-1">
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <h1 className="text-lg font-bold">{t('promoter.centerTitle')}</h1>
          </div>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
        </div>
      </div>
    )
  }

  const stats = data?.my_stats
  const team = data?.team
  const todayLog = data?.today_log
  const leaderboard = data?.leaderboard || []
  const promoter = data?.promoter

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* ============================================================ */}
      {/* 顶部导航栏 + 推广者信息 */}
      {/* ============================================================ */}
      <div className="bg-gradient-to-r from-green-600 to-accent text-white px-4 pt-4 pb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <button onClick={() => navigate(-1)} className="p-1">
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <h1 className="text-lg font-bold">{t('promoter.centerTitle')}</h1>
          </div>
          <button
            onClick={() => fetchData(true)}
            className={`p-2 rounded-lg bg-white/20 ${isRefreshing ? 'animate-spin' : ''}`}
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>

        {/* 推广者身份卡片 */}
        <div className="bg-white/15 backdrop-blur-sm rounded-xl p-4 border border-white/20">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" style={{ width: '48px', height: '48px', borderRadius: '9999px', objectFit: 'cover', maxWidth: 'none' }} 
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <span className="text-xl font-bold">{user?.first_name?.[0] || 'P'}</span>
              )}
            </div>
            <div className="flex-1">
              <p className="font-bold text-lg">{user?.first_name || t('common.user')}</p>
              <div className="flex items-center space-x-2 text-sm text-white/80">
                {promoter?.team_name && <span>🏢 {promoter.team_name}</span>}
                {promoter?.point_name && <span>📍 {promoter.point_name}</span>}
              </div>
            </div>
            <div className="bg-green-400/30 px-3 py-1 rounded-full">
              <span className="text-xs font-medium">{t('promoter.active')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 代客充值入口按钮 */}
      {/* ============================================================ */}
      <div className="px-4 -mt-1 mb-2">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/promoter-deposit')}
          className="w-full bg-gradient-to-r from-primary to-primary-dark text-white rounded-2xl p-4 shadow-lg shadow-blue-200 flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <BanknotesIcon className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="font-bold text-base">{t('promoter.depositForCustomer')}</p>
              <p className="text-xs text-white/70">{t('promoter.depositForCustomerHint')}</p>
            </div>
          </div>
          <div className="text-white/60">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
        </motion.button>
      </div>

      {/* ============================================================ */}
      {/* 时间范围选择器 */}
      {/* ============================================================ */}
      <div className="px-4 -mt-1">
        <div className="bg-white rounded-xl p-1 shadow-sm flex">
          {(['today', 'week', 'month'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                timeRange === range
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'text-gray-500'
              }`}
            >
              {t(`promoter.${range}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ============================================================ */}
      {/* Tab 导航 */}
      {/* ============================================================ */}
      <div className="px-4 mt-4">
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}>
          {([
            { key: 'overview' as ActiveTab, icon: '📊', label: t('promoter.tabOverview') },
            { key: 'materials' as ActiveTab, icon: '📱', label: t('promoter.tabMaterials') },
            { key: 'team' as ActiveTab, icon: '👥', label: t('promoter.tabTeam') },
            { key: 'leaderboard' as ActiveTab, icon: '🏆', label: t('promoter.tabLeaderboard') },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 flex items-center space-x-1.5 px-3.5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 shadow-sm'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ============================================================ */}
      {/* Tab 内容区域 */}
      {/* ============================================================ */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="px-4 mt-4"
        >
          {activeTab === 'overview' && (
            <OverviewTab
              stats={stats}
              todayLog={todayLog}
              timeRange={timeRange}
              isChecking={isChecking}
              onCheckIn={handleCheckIn}
              getTrend={getTrend}
              t={t}
            />
          )}
          {activeTab === 'materials' && (
            <MaterialsTab
              inviteCode={inviteCode}
              inviteLink={inviteLink}
              copied={copied}
              onCopyLink={handleCopyLink}
              onShare={handleShare}
              t={t}
            />
          )}
          {activeTab === 'team' && (
            <TeamTab team={team} t={t} />
          )}
          {activeTab === 'leaderboard' && (
            <LeaderboardTab leaderboard={leaderboard} t={t} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ============================================================
// 子组件：业绩概览 Tab
// ============================================================

interface OverviewTabProps {
  stats: PromoterCenterData['my_stats'] | undefined
  todayLog: PromoterCenterData['today_log'] | undefined
  timeRange: string
  isChecking: boolean
  onCheckIn: () => void
  getTrend: (current: number, previous: number) => number
  t: (key: string, options?: any) => string
}

const OverviewTab: React.FC<OverviewTabProps> = ({
  stats, todayLog, timeRange, isChecking, onCheckIn, getTrend, t
}) => {
  if (!stats) return null

  const regTrend = getTrend(stats.registrations, stats.prev_registrations)
  const chargeTrend = getTrend(stats.charges, stats.prev_charges)

  return (
    <div className="space-y-4">
      {/* 核心业绩卡片 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 注册数 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl p-4 shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xl">📱</span>
            <TrendBadge value={regTrend} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.registrations}</p>
          <p className="text-xs text-gray-500 mt-1">{t('promoter.registrations')}</p>
        </motion.div>

        {/* 充值数 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05 }}
          className="bg-white rounded-2xl p-4 shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xl">💰</span>
            <TrendBadge value={chargeTrend} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.charges}</p>
          <p className="text-xs text-gray-500 mt-1">{t('promoter.charges')}</p>
        </motion.div>

        {/* 充值金额 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-4 shadow-sm"
        >
          <div className="flex items-center mb-2">
            <span className="text-2xl">🎯</span>
          </div>
          <p className="text-2xl font-bold text-green-600">
            {formatCurrency('TJS', stats.charge_amount)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{t('promoter.chargeAmount')}</p>
        </motion.div>

        {/* 佣金收入 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-2xl p-4 shadow-sm"
        >
          <div className="flex items-center mb-2">
            <span className="text-2xl">💎</span>
          </div>
          <p className="text-2xl font-bold text-primary">
            {formatCurrency('TJS', stats.commission)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{t('promoter.commission')}</p>
        </motion.div>
      </div>

      {/* 转化率卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-gradient-to-r from-primary to-primary rounded-2xl p-4 text-white"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/80">{t('promoter.conversionRate')}</p>
            <p className="text-3xl font-bold mt-1">{stats.conversion_rate}%</p>
          </div>
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
            <ChartBarIcon className="w-7 h-7" />
          </div>
        </div>
        <p className="text-xs text-white/70 mt-2">
          {t('promoter.conversionHint')}
        </p>
      </motion.div>

      {/* ========== 今日打卡模块 ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="bg-white rounded-2xl p-5 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <span className="text-xl">✋</span>
            <h3 className="font-bold text-gray-900">{t('promoter.todayCheckIn')}</h3>
          </div>
          <div className="bg-green-100 px-3 py-1 rounded-full">
            <span className="text-sm font-bold text-green-700">
              {todayLog?.contact_count || 0} {t('promoter.people')}
            </span>
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-4 leading-relaxed">{t('promoter.checkInHint')}</p>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onCheckIn}
          disabled={isChecking}
          className={`w-full py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center space-x-2 ${
            isChecking
              ? 'bg-gray-200 text-gray-400'
              : 'bg-gradient-to-r from-green-500 to-accent text-white shadow-lg shadow-green-200 active:shadow-sm'
          }`}
        >
          {isChecking ? (
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400" />
          ) : (
            <>
              <HandRaisedIcon className="w-6 h-6" />
              <span>{t('promoter.contactPlus1')}</span>
            </>
          )}
        </motion.button>
      </motion.div>
    </div>
  )
}

// ============================================================
// 子组件：推广物料 Tab
// ============================================================

interface MaterialsTabProps {
  inviteCode: string
  inviteLink: string
  copied: boolean
  onCopyLink: () => void
  onShare: () => void
  t: (key: string, options?: any) => string
}

const MaterialsTab: React.FC<MaterialsTabProps> = ({
  inviteCode, inviteLink, copied, onCopyLink, onShare, t
}) => {
  const handleCopyCode = async () => {
    const success = await copyToClipboard(inviteCode)
    if (success) {
      toast.success(t('invite.codeCopied'))
    }
  }

  return (
    <div className="space-y-4">
      {/* 邀请码大卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-green-600 to-accent rounded-2xl p-6 text-white"
      >
        <div className="text-center mb-4">
          <p className="text-sm text-white/80 mb-2">{t('promoter.myInviteCode')}</p>
          <div className="bg-white/25 backdrop-blur-sm rounded-xl px-6 py-4 inline-block min-w-[160px]">
            <p className="text-3xl font-bold tracking-widest font-mono text-white drop-shadow-sm">
              {inviteCode || '------'}
            </p>
          </div>
        </div>

        <div className="flex space-x-3">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleCopyCode}
            className="flex-1 flex items-center justify-center space-x-2 py-3 bg-white/20 rounded-xl font-medium"
          >
            <ClipboardDocumentIcon className="w-5 h-5" />
            <span>{t('promoter.copyCode')}</span>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onShare}
            className="flex-1 flex items-center justify-center space-x-2 py-3 bg-white text-green-700 rounded-xl font-medium"
          >
            <ShareIcon className="w-5 h-5" />
            <span>{t('promoter.share')}</span>
          </motion.button>
        </div>
      </motion.div>

      {/* 邀请链接 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-2xl p-5 shadow-sm"
      >
        <h3 className="font-bold text-gray-900 mb-3">{t('promoter.inviteLink')}</h3>
        <div className="bg-gray-50 rounded-xl p-3 mb-3">
          <p className="text-sm text-gray-600 break-all font-mono">{inviteLink}</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onCopyLink}
          className="w-full py-3 bg-amber-50 text-primary rounded-xl font-medium flex items-center justify-center space-x-2"
        >
          {copied ? (
            <>
              <CheckCircleIcon className="w-5 h-5" />
              <span>{t('promoter.copied')}</span>
            </>
          ) : (
            <>
              <ClipboardDocumentIcon className="w-5 h-5" />
              <span>{t('promoter.copyLink')}</span>
            </>
          )}
        </motion.button>
      </motion.div>

      {/* 推广技巧提示 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5"
      >
        <div className="flex items-center space-x-2 mb-3">
          <BoltIcon className="w-5 h-5 text-yellow-600" />
          <h3 className="font-bold text-yellow-800">{t('promoter.tips')}</h3>
        </div>
        <ul className="space-y-2 text-sm text-yellow-700">
          <li className="flex items-start space-x-2">
            <span className="mt-0.5">1️⃣</span>
            <span>{t('promoter.tip1')}</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="mt-0.5">2️⃣</span>
            <span>{t('promoter.tip2')}</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="mt-0.5">3️⃣</span>
            <span>{t('promoter.tip3')}</span>
          </li>
        </ul>
      </motion.div>
    </div>
  )
}

// ============================================================
// 子组件：我的团队 Tab
// ============================================================

interface TeamTabProps {
  team: PromoterCenterData['team'] | undefined
  t: (key: string, options?: any) => string
}

const TeamTab: React.FC<TeamTabProps> = ({ team, t }) => {
  if (!team) return null

  return (
    <div className="space-y-4">
      {/* 团队概览 */}
      <div className="grid grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-amber-50 rounded-2xl p-4 text-center"
        >
          <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center mx-auto mb-2">
            <span className="text-white font-bold">1</span>
          </div>
          <p className="text-2xl font-bold text-primary-dark">{team.level1_count}</p>
          <p className="text-xs text-primary mt-1">{t('promoter.level1')}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05 }}
          className="bg-amber-50 rounded-2xl p-4 text-center"
        >
          <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center mx-auto mb-2">
            <span className="text-white font-bold">2</span>
          </div>
          <p className="text-2xl font-bold text-primary-dark">{team.level2_count}</p>
          <p className="text-xs text-primary mt-1">{t('promoter.level2')}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-orange-50 rounded-2xl p-4 text-center"
        >
          <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-2">
            <span className="text-white font-bold">3</span>
          </div>
          <p className="text-2xl font-bold text-orange-700">{team.level3_count}</p>
          <p className="text-xs text-orange-500 mt-1">{t('promoter.level3')}</p>
        </motion.div>
      </div>

      {/* 团队总人数 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-gradient-to-r from-green-500 to-accent rounded-2xl p-4 text-white text-center"
      >
        <p className="text-sm text-white/80">{t('promoter.totalTeam')}</p>
        <p className="text-4xl font-bold mt-1">{team.total_count}</p>
      </motion.div>

      {/* 最近加入成员 */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{t('promoter.recentMembers')}</h3>
        </div>
        {team.recent_members.length === 0 ? (
          <div className="p-8 text-center">
            <UserGroupIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">{t('promoter.noMembers')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {team.recent_members.map((member, index) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 flex items-center space-x-3"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt="" style={{ width: '40px', height: '40px', borderRadius: '9999px', objectFit: 'cover', maxWidth: 'none' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    member.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {member.name.trim() || t('common.aUser')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(member.joined_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="px-2 py-1 bg-amber-100 text-primary-dark rounded-full text-xs font-medium">
                  L{member.level}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 子组件：排行榜 Tab
// ============================================================

interface LeaderboardTabProps {
  leaderboard: PromoterCenterData['leaderboard']
  t: (key: string, options?: any) => string
}

const LeaderboardTab: React.FC<LeaderboardTabProps> = ({ leaderboard, t }) => {
  const getRankIcon = (index: number) => {
    if (index === 0) return '🥇'
    if (index === 1) return '🥈'
    if (index === 2) return '🥉'
    return `${index + 1}`
  }

  const getRankBg = (index: number, isMe: boolean) => {
    if (isMe) return 'bg-green-50 border-2 border-green-300'
    if (index === 0) return 'bg-yellow-50'
    if (index === 1) return 'bg-gray-50'
    if (index === 2) return 'bg-orange-50'
    return 'bg-white'
  }

  return (
    <div className="space-y-3">
      {/* 排行榜标题 */}
      <div className="flex items-center space-x-2 mb-2">
        <TrophyIconSolid className="w-6 h-6 text-yellow-500" />
        <h3 className="font-bold text-gray-900">{t('promoter.leaderboardTitle')}</h3>
      </div>

      {leaderboard.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
          <TrophyIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-400">{t('promoter.noLeaderboard')}</p>
        </div>
      ) : (
        leaderboard.map((person, index) => (
          <motion.div
            key={person.user_id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.03 }}
            className={`rounded-2xl p-4 shadow-sm ${getRankBg(index, person.is_me)}`}
          >
            <div className="flex items-center space-x-3">
              {/* 排名 */}
              <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                {index < 3 ? (
                  <span className="text-2xl">{getRankIcon(index)}</span>
                ) : (
                  <span className="text-lg font-bold text-gray-400">{index + 1}</span>
                )}
              </div>

              {/* 头像 */}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                {person.avatar_url ? (
                  <img src={person.avatar_url} alt="" style={{ width: '40px', height: '40px', borderRadius: '9999px', objectFit: 'cover', maxWidth: 'none' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  person.name.charAt(0).toUpperCase()
                )}
              </div>

              {/* 信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {person.name.trim() || t('common.aUser')}
                  </p>
                  {person.is_me && (
                    <span className="px-2 py-0.5 bg-green-500 text-white rounded-full text-xs font-medium">
                      {t('promoter.me')}
                    </span>
                  )}
                </div>
                {person.team_name && (
                  <p className="text-xs text-gray-400">{person.team_name}</p>
                )}
              </div>

              {/* 注册数 */}
              <div className="text-right">
                <p className="text-lg font-bold text-gray-900">{person.registrations}</p>
                <p className="text-xs text-gray-400">{t('promoter.registrations')}</p>
              </div>
            </div>
          </motion.div>
        ))
      )}
    </div>
  )
}

// ============================================================
// 辅助组件：趋势标签
// ============================================================

const TrendBadge: React.FC<{ value: number }> = ({ value }) => {
  if (value === 0) return null
  const isUp = value > 0

  return (
    <span className={`flex items-center space-x-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
      isUp ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {isUp ? (
        <ArrowTrendingUpIcon className="w-3 h-3" />
      ) : (
        <ArrowTrendingDownIcon className="w-3 h-3" />
      )}
      <span>{Math.abs(value)}%</span>
    </span>
  )
}

export default PromoterCenterPage
