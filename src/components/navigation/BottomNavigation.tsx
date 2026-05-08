/**
 * 统一底部导航
 *
 * 全站底部导航统一为三项：首页 / 购物车 / 我的。
 * - 首页 -> /            (B2BHomePage)
 * - 购物车 -> /b2b/cart   (B2BCartPage)
 * - 我的 -> /profile      (ProfilePage)
 *
 * 注：原"晒单 / 种树 / 钱包 / 进货"等入口已下沉到对应页面内部入口，
 * 不再占用底部主导航位置，以保持移动端的视觉清爽与转化率。
 */
import React, { useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  HomeIcon,
  ShoppingCartIcon,
  UserIcon,
} from '@heroicons/react/24/outline'
import {
  HomeIcon as HomeIconSolid,
  ShoppingCartIcon as ShoppingCartIconSolid,
  UserIcon as UserIconSolid,
} from '@heroicons/react/24/solid'
import { useB2BCart } from '../../hooks/useB2B'
import { useUser } from '../../contexts/UserContext'
import { cn } from '../../lib/utils'

export const BottomNavigation: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null)
  const { isAuthenticated } = useUser()
  // 仅在已登录场景下读取购物车数量，避免未登录时无谓的网络请求
  const { data: cartItems } = useB2BCart()
  const cartCount = isAuthenticated ? (cartItems?.length || 0) : 0

  const navigation = [
    {
      name: t('nav.home'),
      path: '/',
      icon: HomeIcon,
      activeIcon: HomeIconSolid,
      badge: 0,
    },
    {
      name: t('nav.cart'),
      path: '/b2b/cart',
      icon: ShoppingCartIcon,
      activeIcon: ShoppingCartIconSolid,
      badge: cartCount,
    },
    {
      name: t('nav.profile'),
      path: '/profile',
      icon: UserIcon,
      activeIcon: UserIconSolid,
      badge: 0,
    },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-md mx-auto px-3 py-1.5">
        <div className="grid grid-cols-3 gap-1">
          {navigation.map((item) => {
            const isActive =
              location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(`${item.path}/`)) ||
              (item.path === '/' && location.pathname === '/b2b')
            const Icon = isActive ? item.activeIcon : item.icon
            const handleClick = () => {
              // "我的"标签连续点击 5 次唤起调试面板（保留旧能力）
              if (item.path === '/profile') {
                clickCountRef.current += 1
                if (clickTimerRef.current) {
                  clearTimeout(clickTimerRef.current)
                }
                if (clickCountRef.current >= 5) {
                  window.dispatchEvent(new CustomEvent('showDebugPanel'))
                  clickCountRef.current = 0
                  return
                }
                clickTimerRef.current = setTimeout(() => {
                  clickCountRef.current = 0
                }, 1000)
              }
              navigate(item.path)
            }
            return (
              <button
                key={item.name}
                onClick={handleClick}
                className={cn(
                  'flex min-w-0 flex-col items-center py-1.5 px-1 rounded-xl transition-all duration-200 active:scale-95',
                  isActive
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900',
                )}
              >
                <div className="relative">
                  <Icon className="w-6 h-6" />
                  {item.badge > 0 && (
                    <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                  {isActive && (
                    <div className="absolute -inset-1 bg-blue-100 rounded-lg -z-10" />
                  )}
                </div>
                <span
                  className={cn(
                    'mt-1 text-[11px] leading-none font-medium truncate max-w-full',
                    isActive ? 'text-blue-600' : 'text-gray-600',
                  )}
                >
                  {item.name}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
