import React, { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import {
  DevicePhoneMobileIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentListIcon,
  ShareIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  XMarkIcon,
  BellIcon,
  UsersIcon,
  LanguageIcon,
  BuildingStorefrontIcon,
  ShieldCheckIcon,
  ClockIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { copyToClipboard } from '../lib/utils'
import toast from 'react-hot-toast'
import { triggerInstallPrompt, isInstalled } from '../utils/pwaUtils'
import { useWholesalerProfile } from '../hooks/useB2B'
import { useUnreadNotifications } from '../hooks/useUnreadNotifications'

const ProfilePage: React.FC = () => {
  const { t } = useTranslation()
  const { user, logout } = useUser()
  const navigate = useNavigate()
  const { totalUnread, orderUnread } = useUnreadNotifications()

  const [isPageLoading, setIsPageLoading] = useState(true)

  const shortUserId = useMemo(() => {
    if (!user?.id) return '------'
    return user.id.substring(0, 8).toUpperCase()
  }, [user?.id])

  // 批发商身份
  const { data: wholesalerProfile, isLoading: wholesalerLoading } = useWholesalerProfile()
  const isApprovedWholesaler = wholesalerProfile?.status === 'approved'
  const isPendingWholesaler = wholesalerProfile?.status === 'pending'
  const isRejectedWholesaler = wholesalerProfile?.status === 'rejected'

  useEffect(() => {
    if (!wholesalerLoading) setIsPageLoading(false)
  }, [wholesalerLoading])

  const handleCopyReferralLink = async () => {
    const code = user?.referral_code || user?.invite_code
    if (code) {
      const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin
      const inviteLink = `${appDomain}/register?ref=${encodeURIComponent(code)}`
      const success = await copyToClipboard(inviteLink)
      if (success) toast.success(t('profile.copyReferralCode'))
      else toast.error(t('error.unknownError'))
    }
  }

  const handleShareReferral = () => {
    const code = user?.referral_code || user?.invite_code
    if (!code) return
    const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin
    const inviteLink = `${appDomain}/register?ref=${encodeURIComponent(code)}`
    const shareText = t('invite.shareText', { inviteCode: code, inviteLink })
    if (navigator.share) {
      navigator.share({ title: t('invite.shareTitle'), text: shareText, url: inviteLink }).catch(console.error)
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText + '\n' + inviteLink)}`, '_blank')
    }
  }

  const handleAddToHomeScreen = async () => {
    if (isInstalled()) { toast.success(t('pwa.alreadyInstalled')); return }
    const installed = await triggerInstallPrompt()
    if (installed) { toast.success(t('pwa.installedSuccess')); return }
    toast(t('pwa.manualInstallHint'), { duration: 5000 })
  }

  // 我的门店按钮文案
  const myStoreTitle = useMemo(() => {
    if (isApprovedWholesaler) return t('wholesaler.editStoreInfo')
    if (isPendingWholesaler) return t('wholesaler.pendingTitle')
    if (isRejectedWholesaler) return t('wholesaler.rejectedTitle')
    return t('wholesaler.applyTitle')
  }, [isApprovedWholesaler, isPendingWholesaler, isRejectedWholesaler, t])

  const myStoreSubtitle = useMemo(() => {
    if (isApprovedWholesaler) return t('wholesaler.approvedBadge')
    if (isPendingWholesaler) return t('wholesaler.pendingDesc')
    if (isRejectedWholesaler) return t('wholesaler.rejectedReapply')
    return t('wholesaler.applySubtitle')
  }, [isApprovedWholesaler, isPendingWholesaler, isRejectedWholesaler, t])

  const MyStoreIcon = useMemo(() => {
    if (isPendingWholesaler) return ClockIcon
    if (isRejectedWholesaler) return XCircleIcon
    return BuildingStorefrontIcon
  }, [isPendingWholesaler, isRejectedWholesaler])

  // 核心功能纵向菜单
  const coreMenuItems = [
    {
      Icon: MyStoreIcon,
      title: myStoreTitle,
      subtitle: myStoreSubtitle,
      action: () => navigate('/wholesaler/apply'),
      highlight: isApprovedWholesaler,
      badge: isApprovedWholesaler
        ? t('wholesaler.approvedBadge')
        : isPendingWholesaler
        ? t('b2b.pendingApproval')
        : undefined,
      badgeColor: isApprovedWholesaler
        ? 'bg-green-100 text-green-700'
        : 'bg-yellow-100 text-yellow-700',
    },
    {
      Icon: UsersIcon,
      title: t('wholesaler.myInvite'),
      subtitle: t('wholesaler.myInviteDesc'),
      action: () => navigate('/invite'),
      highlight: false,
      badge: undefined,
      badgeColor: '',
    },
    {
      Icon: ClipboardDocumentListIcon,
      title: t('orders.title'),
      subtitle: t('profile.viewOrders'),
      action: () => navigate('/b2b/orders'),
      highlight: false,
      badge: orderUnread > 0 ? String(orderUnread) : undefined,
      badgeColor: 'bg-red-500 text-white',
      dot: orderUnread > 0,
    },
  ]

  // 其他菜单
  const menuItems = [
    {
      Icon: DevicePhoneMobileIcon,
      title: t('profile.addToHomeScreen'),
      subtitle: t('profile.addToHomeScreenDesc'),
      action: handleAddToHomeScreen,
    },
    {
      Icon: LanguageIcon,
      title: t('profile.language'),
      subtitle: t('profile.settings'),
      action: () => navigate('/settings'),
    },
    {
      Icon: BellIcon,
      title: t('nav.notifications'),
      subtitle: t('profile.viewNotifications'),
      action: () => navigate('/notifications'),
      unreadCount: totalUnread,
    },
  ]

  if (isPageLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{t('common.loading')}...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* 用户信息卡片 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-primary to-primary-dark text-white mx-4 mt-4 rounded-2xl p-6"
      >
        <div
          className="flex items-center space-x-4 cursor-pointer active:opacity-80 transition-opacity"
          onClick={() => navigate('/profile/edit')}
        >
          {/* 头像 */}
          <div className="relative flex-shrink-0">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt="Avatar"
                style={{ width: '64px', height: '64px', borderRadius: '9999px', border: '4px solid rgba(255,255,255,0.2)', objectFit: 'cover', maxWidth: 'none' }}
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                  const ph = (e.target as HTMLImageElement).parentElement?.querySelector('.avatar-placeholder')
                  if (ph) ph.classList.remove('hidden')
                }}
              />
            ) : null}
            <div className={`w-16 h-16 bg-white/20 rounded-full flex items-center justify-center avatar-placeholder ${user?.avatar_url ? 'hidden' : ''}`}>
              <span className="text-2xl font-bold">{(user?.first_name as string | null)?.[0] || 'U'}</span>
            </div>
            {user?.is_verified && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                <CheckCircleIcon className="w-4 h-4 text-white" />
              </div>
            )}
          </div>
          {/* 用户信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-1">
              <h2 className="text-xl font-bold truncate">
                {(user?.first_name as string | null) || t('profile.defaultName')}
              </h2>
              <ChevronRightIcon className="w-4 h-4 text-white/60 flex-shrink-0" />
            </div>
            <p className="text-xs text-white/70 mt-0.5">{t('profile.tapToEditProfile')}</p>
            <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/20 font-mono">
                ID: {shortUserId}
              </span>
              {/* 批发商身份标识 */}
              {isApprovedWholesaler && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-400/90 text-yellow-900 flex items-center space-x-1">
                  <ShieldCheckIcon className="w-3 h-3" />
                  <span>{t('wholesaler.approvedBadge')}</span>
                </span>
              )}
              {isPendingWholesaler && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/30 text-white">
                  {t('b2b.pendingApproval')}
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* 推荐码卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-2xl mx-4 mt-4 p-6 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{t('invite.myInviteCode')}</h3>
          <ShareIcon className="w-5 h-5 text-gray-400" />
        </div>
        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <p className="text-2xl font-bold text-center text-gray-900 font-mono">
            {user?.referral_code || user?.invite_code || '------'}
          </p>
        </div>
        <div className="flex space-x-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCopyReferralLink}
            className="flex-1 bg-amber-50 text-primary py-2 px-4 rounded-lg font-medium flex items-center justify-center space-x-1"
          >
            <ClipboardDocumentIcon className="w-4 h-4" />
            <span>{t('common.copy')}</span>
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleShareReferral}
            className="flex-1 bg-green-50 text-green-600 py-2 px-4 rounded-lg font-medium flex items-center justify-center space-x-1"
          >
            <ShareIcon className="w-4 h-4" />
            <span>{t('common.share')}</span>
          </motion.button>
        </div>
      </motion.div>

      {/* 核心功能纵向菜单 */}
      <div className="mx-4 mt-6">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          {coreMenuItems.map((item, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + index * 0.07 }}
              onClick={item.action}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center space-x-3">
                <div className={`relative w-11 h-11 rounded-xl flex items-center justify-center ${
                  item.highlight
                    ? 'bg-gradient-to-br from-primary to-primary-dark'
                    : 'bg-gradient-to-br from-amber-100 to-amber-200'
                }`}>
                  <item.Icon className={`w-5 h-5 ${item.highlight ? 'text-white' : 'text-primary-dark'}`} />
                  {(item as any).dot && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {orderUnread > 99 ? '99+' : orderUnread}
                    </span>
                  )}
                </div>
                <div className="text-left">
                  <div className="flex items-center space-x-2 flex-wrap gap-1">
                    <p className={`text-sm font-semibold ${item.highlight ? 'text-primary' : 'text-gray-900'}`}>
                      {item.title}
                    </p>
                    {item.badge && (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${item.badgeColor}`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{item.subtitle}</p>
                </div>
              </div>
              <ChevronRightIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* 其他菜单 */}
      <div className="mx-4 mt-4">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          {menuItems.map((item, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + index * 0.05 }}
              onClick={item.action}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center space-x-3">
                <div className="relative w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <item.Icon className="w-5 h-5 text-gray-600" />
                  {(item as any).unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {(item as any).unreadCount > 99 ? '99+' : (item as any).unreadCount}
                    </span>
                  )}
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">{item.title}</p>
                  <p className="text-xs text-gray-500">{item.subtitle}</p>
                </div>
              </div>
              <ChevronRightIcon className="w-5 h-5 text-gray-400" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* 退出登录 */}
      <div className="mx-4 mt-6 mb-6">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={logout}
          className="w-full bg-white border border-red-200 text-red-600 py-4 rounded-2xl font-semibold flex items-center justify-center space-x-2 hover:bg-red-50 transition-colors"
        >
          <XMarkIcon className="w-5 h-5" />
          <span>{t('profile.logout')}</span>
        </motion.button>
      </div>
    </div>
  )
}

export default ProfilePage
