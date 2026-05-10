import React, { useState, useEffect } from "react"
import { useLocation } from "react-router-dom"
import { useUser } from "../../contexts/UserContext"
import { cn } from "../../lib/utils"
import { BottomNavigation } from "../navigation/BottomNavigation"
import { useTranslation } from 'react-i18next'
import NewUserGiftModal from "../NewUserGiftModal"
import OfflineBanner from "../OfflineBanner"

interface LayoutProps {
  children: React.ReactNode
  className?: string
  showHeader?: boolean
  showBottomNav?: boolean
}

export const Layout: React.FC<LayoutProps> = ({ 
  children, 
  className,
  showHeader = true,
  showBottomNav = true
}) => {
  const { user, isAuthenticated } = useUser()
  const { t } = useTranslation()
  const location = useLocation()
  const isHomeRoute = location.pathname === '/'

  // 不需要底部导航的页面：身份验证/商品详情/结算等。
  // 这些页面贴底都有自己的 CTA 按钮，再叠加全局导航会干扰转化。
  // 登录/注册页面保留底部导航，方便用户切换页面
  const HIDDEN_NAV_PREFIXES = [
    '/forgot-password',
    '/reset-password',
    '/b2b/product',
    '/b2b/checkout',
  ]
  const isHiddenNavRoute = HIDDEN_NAV_PREFIXES.some((p) =>
    location.pathname === p || location.pathname.startsWith(p + '/'),
  )
  
  // 新人礼物弹窗状态
  const [showNewUserGift, setShowNewUserGift] = useState(false)
  const [giftAmount, setGiftAmount] = useState(5)

  // 检查是否需要显示新人礼物弹窗
  useEffect(() => {
    if (!isAuthenticated) {return}
    const checkNewUserGift = () => {
      const newUserGiftShown = localStorage.getItem('new_user_gift_shown')
      const newUserGiftData = localStorage.getItem('new_user_gift_data')
      
      if (newUserGiftData && !newUserGiftShown) {
        try {
          const giftData = JSON.parse(newUserGiftData)
          if (giftData.lucky_coins) {
            setGiftAmount(giftData.lucky_coins)
            setShowNewUserGift(true)
          }
        } catch (e) {
          console.error('Failed to parse new user gift data:', e)
        }
      }
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    let idleId: number | null = null
    if (isHomeRoute && typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(checkNewUserGift, { timeout: 1200 })
    } else {
      const delay = isHomeRoute ? 400 : 0
      timer = setTimeout(checkNewUserGift, delay)
    }
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [isAuthenticated, isHomeRoute])

  // 关闭新人礼物弹窗
  const handleCloseNewUserGift = () => {
    setShowNewUserGift(false)
    localStorage.setItem('new_user_gift_shown', 'true')
    localStorage.removeItem('new_user_gift_data')
  }

  return (
    <div className={cn(
      "min-h-screen bg-gradient-to-br from-amber-50 via-white to-amber-50",
      className
    )}>
      {/* 弱网/离线状态提示横幅 */}
      <OfflineBanner />
      {showHeader && false && (
        <header className="bg-white/90 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50">
          <div className="max-w-md mx-auto px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <picture>
                  <source srcSet="/dodo-logo.webp" type="image/webp" />
                  <img 
                    src="/dodo-logo.webp" 
                    alt="DODO Logo"
                    style={{ width: '36px', height: '36px', objectFit: 'contain', maxWidth: 'none' }}
                  />
                </picture>
                <div className="min-w-0">
                  <h1 className="text-base font-bold tracking-tight text-gray-900 leading-none">DODO</h1>
                </div>
              </div>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <div className="px-2.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-[11px] font-semibold text-emerald-700 leading-none whitespace-nowrap shadow-sm">
                  {t('home.freeShippingShort')}
                </div>
                {user?.avatar_url && (
                  <img 
                    src={user.avatar_url} 
                    alt="Avatar"
                    style={{ width: '34px', height: '34px', borderRadius: '9999px', objectFit: 'cover', maxWidth: 'none' }}
                  />
                )}
              </div>
            </div>
          </div>
        </header>
      )}
      
      <main className={cn(
        "max-w-md mx-auto",
        showBottomNav && !isHiddenNavRoute && "pb-24"
      )}>
        {children}
      </main>

      {showBottomNav && !isHiddenNavRoute && <BottomNavigation />}
      
      {/* 新人礼物弹窗 */}
      <NewUserGiftModal
        isOpen={showNewUserGift}
        giftAmount={giftAmount}
        onClose={handleCloseNewUserGift}
      />
    </div>
  )
}
