import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
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
  MegaphoneIcon
} from '@heroicons/react/24/outline'
import { copyToClipboard } from '../lib/utils'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import toast from 'react-hot-toast'

const ProfilePage: React.FC = () => {
  const { t } = useTranslation()
  const { user, logout } = useUser()
  const navigate = useNavigate()

  // ========== 市场合伙人身份验证 ==========
  const [isPromoter, setIsPromoter] = useState(false)

  useEffect(() => {
    // 通过RPC函数检查当前用户是否为活跃推广者（市场合伙人）
    // 使用 SECURITY DEFINER 的RPC函数绕过RLS限制
    const checkPromoterStatus = async () => {
      if (!user?.id) return
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
        console.log('[ProfilePage] Promoter check not available')
      }
    }
    checkPromoterStatus()
  }, [user?.id])

  const handleCopyReferralLink = async () => {
    const code = user?.referral_code || user?.invite_code;
    if (code) {
      // 复制完整的邀请链接
      const sharePrefix = import.meta.env.VITE_TELEGRAM_SHARE_LINK || 't.me/tezbarakatbot/shoppp';
      const inviteLink = `https://${sharePrefix}?startapp=${code}`
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
    
    const sharePrefix = import.meta.env.VITE_TELEGRAM_SHARE_LINK || 't.me/tezbarakatbot/shoppp';
    const inviteLink = `https://${sharePrefix}?startapp=${code}`;
    const shareText = `🎁 Барои Шумо 10 сомонӣ тӯҳфа!\nБо истиноди ман ворид шавед ва бонус гиред. Дар TezBarakat арзон харед ва бурд кунед!`;
    
    // 使用 Telegram WebApp 的 openTelegramLink 打开分享页面
    if (window.Telegram?.WebApp?.openTelegramLink) {
      // 使用 Telegram 的分享链接
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else if (navigator.share) {
      navigator.share({
        title: t('invite.shareInvite'),
        text: shareText,
        url: inviteLink
      }).catch(console.error);
    } else {
      handleCopyReferralLink();
    }
  }

  // 三个功能卡片
  const featureCards = [
    {
      icon: ShoppingBagIcon,
      title: t('profile.pendingPickup'),
      subtitle: t('profile.viewPendingPickup'),
      color: 'from-blue-500 to-blue-600',
      action: () => navigate('/pending-pickup'),
    },
    {
      icon: UsersIcon,
      title: t('invite.myTeam'),
      subtitle: t('invite.viewTeamInfo'),
      color: 'from-purple-500 to-purple-600',
      action: () => navigate('/invite'),
    },
    {
      icon: ClipboardDocumentListIcon,
      title: t('orders.title'),
      subtitle: t('profile.viewOrders'),
      color: 'from-purple-500 to-pink-600',
      action: () => navigate('/orders-management'),
    },
  ]

  // 精简后的菜单项
  const menuItems = [
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
    // 市场合伙人入口 - 仅对活跃推广者显示
    ...(isPromoter ? [{
      icon: MegaphoneIcon,
      title: t('promoter.centerTitle'),
      subtitle: t('promoter.centerSubtitle'),
      action: () => navigate('/promoter-center'),
      highlight: true,
    }] : []),
  ]

  const getKycLevelText = (level: string) => {
    switch (level) {
      case 'BASIC': return t('wallet.basicVerification')
      case 'INTERMEDIATE': return t('wallet.authentication')
      case 'ADVANCED': return t('wallet.authentication')
      default: return t('wallet.notSet')
    }
  }

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* 用户信息卡片 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-blue-600 to-purple-600 text-white mx-4 mt-4 rounded-2xl p-6"
      >
        <div className="flex items-center space-x-4">
	          {/* 头像 */}
	          <div className="relative">
	            {user?.avatar_url ? (
	              <img 
	                src={user.avatar_url} 
	                alt="Avatar"
	                style={{ width: '64px', height: '64px', borderRadius: '9999px', border: '4px solid rgba(255,255,255,0.2)', objectFit: 'cover', maxWidth: 'none' }}
                  onError={(e) => {
                    console.error('Avatar load failed:', user.avatar_url);
                    // 如果加载失败，隐藏图片显示占位符
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.querySelector('.avatar-placeholder')!.classList.remove('hidden');
                  }}
	              />
	            ) : null}
              <div className={`w-16 h-16 bg-white/20 rounded-full flex items-center justify-center avatar-placeholder ${user?.avatar_url ? 'hidden' : ''}`}>
                <span className="text-2xl font-bold">
                  {user?.telegram_username?.[0] || user?.first_name?.[0] || 'U'}
                </span>
              </div>
            
            {user?.is_verified && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                <CheckCircleIcon className="w-4 h-4 text-white" />
              </div>
            )}
          </div>

          {/* 用户信息 */}
          <div className="flex-1">
            <h2 className="text-xl font-bold">
              {user?.first_name || user?.telegram_username || 'User'}
            </h2>
            <div className="flex items-center space-x-2 mt-2">
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-white/20">
                {user ? getKycLevelText('BASIC') : t('wallet.notSet')}
              </span>
              {user?.id && (
                <button
                  onClick={async () => {
                    const idShort = user.id.substring(0, 8)
                    const success = await copyToClipboard(idShort)
                    if (success) {
                      toast.success(t('profile.idCopied'))
                    }
                  }}
                  className="px-2 py-1 rounded-full text-xs font-medium bg-white/20 flex items-center space-x-1 active:bg-white/30 transition-colors"
                >
                  <span>{t('profile.myIdCode')}: {user.id.substring(0, 8)}</span>
                  <ClipboardDocumentIcon className="w-3 h-3" />
                </button>
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
            className="flex-1 bg-blue-50 text-blue-600 py-2 px-4 rounded-lg font-medium flex items-center justify-center space-x-1"
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
    </div>
  )
}

export default ProfilePage
