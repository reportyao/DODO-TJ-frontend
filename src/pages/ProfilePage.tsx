import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import {
  UserCircleIcon,
  CogIcon,
  ShoppingBagIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentListIcon,
  ShareIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  XMarkIcon,
  PhotoIcon,
  BellIcon,
  UsersIcon,
  TrophyIcon,
  LanguageIcon,
  SparklesIcon,
  MegaphoneIcon,
  QrCodeIcon,
  TicketIcon
} from '@heroicons/react/24/outline'
import { copyToClipboard } from '../lib/utils'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import toast from 'react-hot-toast'
import QRCode from 'qrcode'

const ProfilePage: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { user, logout } = useUser()
  const navigate = useNavigate()

  // ========== 加载状态 ==========
  const [isPageLoading, setIsPageLoading] = useState(true)

  // ========== 用户二维码（供地推人员扫码充值） ==========
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('')
  const [showQrModal, setShowQrModal] = useState(false)

  // 生成用户个人二维码
  useEffect(() => {
    if (!user?.id) return
    const qrContent = `dodo://user/${user.id}`
    QRCode.toDataURL(qrContent, {
      width: 200,
      margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((url: string) => setQrCodeUrl(url))
      .catch((err: Error) => console.error('[ProfilePage] QR code generation failed:', err))
  }, [user?.id])

  // 获取用户 ID 的短格式显示（前8位）
  const shortUserId = useMemo(() => {
    if (!user?.id) return '------'
    return user.id.substring(0, 8).toUpperCase()
  }, [user?.id])

  // ========== 核销员身份验证 ==========
  const [isPickupStaff, setIsPickupStaff] = useState(false)
  const [staffPointName, setStaffPointName] = useState('')

  useEffect(() => {
    const checkStaffStatus = async () => {
      if (!user?.id) return
      try {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/check_pickup_staff_status`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_user_id: user.id })
          }
        )
        if (response.ok) {
          const data = await response.json()
          setIsPickupStaff(data?.is_staff === true)
          if (data?.point_name_i18n) {
            const lang = i18n.language as 'zh' | 'ru' | 'tg'
            setStaffPointName(
              data.point_name_i18n[lang] || data.point_name || ''
            )
          } else if (data?.point_name) {
            setStaffPointName(data.point_name)
          }
        }
      } catch (e) {
      }
    }
    checkStaffStatus()
  }, [user?.id])

  // ========== 市场合伙人身份验证 ==========
  const [isPromoter, setIsPromoter] = useState(false)

  useEffect(() => {
    // 通过RPC函数检查当前用户是否为活跃推广者（市场合伙人）
    // 使用 SECURITY DEFINER 的RPC函数绕过RLS限制
    const checkPromoterStatus = async () => {
      if (!user?.id) {
        setIsPageLoading(false)
        return
      }
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
            body: JSON.stringify({ p_user_id: user.id, p_time_range: 'today' })
          }
        )
        if (response.ok) {
          const data = await response.json()
          setIsPromoter(data?.success === true)
        }
      } catch (e) {
      } finally {
        setIsPageLoading(false)
      }
    }
    checkPromoterStatus()
  }, [user?.id])

  const handleCopyReferralLink = async () => {
    const code = user?.referral_code || user?.invite_code;
    if (code) {
      // 【迁移修复】使用 PWA 域名生成分享链接
      const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin;
      const inviteLink = `${appDomain}?ref=${code}`;
      const success = await copyToClipboard(inviteLink)
      if (success) {
        toast.success(t('profile.copyReferralCode'))
      } else {
        toast.error(t('error.unknownError'))
      }
    }
  }

  const handleShareReferral = () => {
    const code = user?.referral_code || user?.invite_code;
    if (!code) return;
    
    // 使用 PWA 域名生成分享链接
    const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin;
    const inviteLink = `${appDomain}?ref=${code}`;
    // 使用 i18n 多语言分享文案
    const shareText = t('invite.shareText', { inviteCode: code, inviteLink });
    
    // 优先使用 Web Share API，其次使用 WhatsApp 分享
    if (navigator.share) {
      navigator.share({
        title: t('invite.shareTitle'),
        text: shareText,
        url: inviteLink
      }).catch(console.error);
    } else {
      // 回退到 WhatsApp 分享
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText + '\n' + inviteLink)}`;
      window.open(whatsappUrl, '_blank');
    }
  }

  // 三个功能卡片
  const featureCards = [
    {
      icon: ShoppingBagIcon,
      title: t('profile.pendingPickup'),
      subtitle: t('profile.viewPendingPickup'),
      color: 'from-primary to-primary-dark',
      action: () => navigate('/pending-pickup'),
    },
    {
      icon: UsersIcon,
      title: t('invite.myTeam'),
      subtitle: t('invite.viewTeamInfo'),
      color: 'from-primary to-primary-dark',
      action: () => navigate('/invite'),
    },
    {
      icon: ClipboardDocumentListIcon,
      title: t('orders.title'),
      subtitle: t('profile.viewOrders'),
      color: 'from-primary to-primary-dark',
      action: () => navigate('/orders-management'),
    },
  ]

  // 精简后的菜单项
  const menuItems = [
    {
      icon: TicketIcon,
      title: t('coupon.title'),
      subtitle: t('coupon.noCouponsHint'),
      action: () => navigate('/coupons'),
      highlight: true,
    },
    {
      icon: SparklesIcon,
      title: t('subsidy.menuTitle'),
      subtitle: t('subsidy.banner'),
      action: () => navigate('/subsidy-plan'),
      highlight: true,
    },
    {
      icon: LanguageIcon,
      title: t('profile.language'),
      subtitle: t('profile.settings'),
      action: () => navigate('/settings'),
    },
    {
      icon: BellIcon,
      title: t('nav.notifications'),
      subtitle: t('profile.viewNotifications'),
      action: () => navigate('/notifications'),
    },
    // 转售历史已隐藏
    // {
    //   icon: ShoppingBagIcon,
    //   title: t('market.resaleRecords'),
    //   subtitle: t('market.viewResaleHistory'),
    //   action: () => navigate('/market/my-resales'),
    // },
    {
      icon: PhotoIcon,
      title: t('showoff.myShowoffs'),
      subtitle: t('showoff.viewMyShowoffs'),
      action: () => navigate('/showoff/my'),
    },
    // 核销员入口 - 仅对核销员显示（放在推广者之前，更突出）
    ...(isPickupStaff ? [{
      icon: CheckCircleIcon,
      title: t('pickupVerify.menuTitle'),
      subtitle: staffPointName
        ? t('pickupVerify.menuSubtitleWithPoint', { point: staffPointName })
        : t('pickupVerify.menuSubtitle'),
      action: () => navigate('/pickup-verify'),
      highlight: true,
    }] : []),
    // 市场合伙人入口 - 仅对活跃推广者显示
    ...(isPromoter ? [{
      icon: MegaphoneIcon,
      title: t('promoter.centerTitle'),
      subtitle: t('promoter.centerSubtitle'),
      action: () => navigate('/promoter-center'),
      highlight: true,
    }] : []),
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
        <div className="flex items-center space-x-4">
          {/* 头像 + 用户信息（点击跳转到编辑页） */}
          <div 
            className="flex items-center space-x-4 flex-1 cursor-pointer active:opacity-80 transition-opacity"
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
                    console.error('Avatar load failed:', user.avatar_url);
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.querySelector('.avatar-placeholder')!.classList.remove('hidden');
                  }}
                />
              ) : null}
              <div className={`w-16 h-16 bg-white/20 rounded-full flex items-center justify-center avatar-placeholder ${user?.avatar_url ? 'hidden' : ''}`}>
                <span className="text-2xl font-bold">
                  {user?.first_name?.[0] || 'U'}
                </span>
              </div>
            
              {user?.is_verified && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                  <CheckCircleIcon className="w-4 h-4 text-white" />
                </div>
              )}
            </div>

            {/* 用户信息 - 显示用户ID */}
            <div className="flex-1">
              <div className="flex items-center space-x-1">
                <h2 className="text-xl font-bold">
                  {user?.first_name || t('profile.defaultName')}
                </h2>
                <ChevronRightIcon className="w-4 h-4 text-white/60" />
              </div>
              <p className="text-xs text-white/70 mt-0.5">{t('profile.tapToEditProfile')}</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-white/20 font-mono">
                  ID: {shortUserId}
                </span>
              </div>
            </div>
          </div>

          {/* 用户个人二维码（供地推人员扫码充值） */}
          {qrCodeUrl && (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowQrModal(true)}
              className="w-14 h-14 bg-white rounded-lg p-1 shadow-sm flex-shrink-0"
              title={t('profile.myQrCode')}
            >
              <img src={qrCodeUrl} alt="QR Code" className="w-full h-full rounded" />
            </motion.button>
          )}
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
            <span>{t('common.copy') || t('invite.copyCode')}</span>
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleShareReferral}
            className="flex-1 bg-green-50 text-green-600 py-2 px-4 rounded-lg font-medium flex items-center justify-center space-x-1"
          >
            <ShareIcon className="w-4 h-4" />
            <span>{t('common.share') || t('invite.shareInvite')}</span>
          </motion.button>
        </div>
      </motion.div>

      {/* 三个功能卡片 */}
      <div className="mx-4 mt-6">
        <div className="grid grid-cols-3 gap-3">
          {featureCards.map((card, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + index * 0.1 }}
              onClick={card.action}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all"
            >
              <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center mx-auto mb-2`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <p className="text-xs font-semibold text-gray-900 text-center">{card.title}</p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 菜单列表 */}
      <div className="mx-4 mt-6">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          {menuItems.map((item, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + index * 0.05 }}
              onClick={item.action}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  item.highlight 
                    ? 'bg-gradient-to-br from-orange-500 to-yellow-500' 
                    : 'bg-gray-100'
                }`}>
                  <item.icon className={`w-5 h-5 ${
                    item.highlight ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
                <div className="text-left">
                  <p className={`text-sm font-medium ${
                    item.highlight ? 'text-orange-600' : 'text-gray-900'
                  }`}>{item.title}</p>
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

      {/* 二维码放大弹窗 */}
      <AnimatePresence>
        {showQrModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowQrModal(false)}
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white rounded-2xl p-6 mx-8 max-w-sm w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-900 mb-1">
                  {t('profile.myQrCode')}
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  {t('profile.qrCodeHint')}
                </p>
                {qrCodeUrl && (
                  <img
                    src={qrCodeUrl}
                    alt="QR Code"
                    className="w-56 h-56 mx-auto mb-4 rounded-lg"
                  />
                )}
                <p className="text-sm font-mono text-gray-600 mb-4">
                  ID: {user?.id || '------'}
                </p>
                <button
                  onClick={() => setShowQrModal(false)}
                  className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                >
                  {t('common.close')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default ProfilePage
