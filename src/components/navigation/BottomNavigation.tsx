import React, { useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
// 调试面板通过事件触发，不需要直接导入
import { 
  HomeIcon, 
  CreditCardIcon, 
  UserIcon,
  PhotoIcon
} from '@heroicons/react/24/outline'
import {
  HomeIcon as HomeIconSolid,
  CreditCardIcon as CreditCardIconSolid,
  UserIcon as UserIconSolid,
  PhotoIcon as PhotoIconSolid
} from '@heroicons/react/24/solid'
import { cn } from '../../lib/utils'

export const BottomNavigation: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null)

  const navigation = [
    {
      name: t('nav.home'),
      path: '/',
      icon: HomeIcon,
      activeIcon: HomeIconSolid,
    },
    {
      name: t('showoff.showoff'),
      path: '/showoff',
      icon: PhotoIcon,
      activeIcon: PhotoIconSolid,
    },
    {
      name: t('nav.wallet'),
      path: '/wallet',
      icon: CreditCardIcon,
      activeIcon: CreditCardIconSolid,
    },
    {
      name: t('nav.profile'),
      path: '/profile',
      icon: UserIcon,
      activeIcon: UserIconSolid,
    },
  ]

  return (
    <>
      <motion.nav
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="max-w-md mx-auto px-4 py-2">
          <div className="flex items-center justify-around">
            {navigation.map((item) => {
              const isActive = location.pathname === item.path
              const Icon = isActive ? item.activeIcon : item.icon

              const handleClick = () => {
                // 如果是"我的"标签，检测连续点击
                if (item.path === '/profile') {
                  clickCountRef.current += 1

                  // 清除之前的计时器
                  if (clickTimerRef.current) {
                    clearTimeout(clickTimerRef.current)
                  }

                  // 如果达到5次，触发调试面板事件
                  if (clickCountRef.current >= 5) {
                    window.dispatchEvent(new CustomEvent('showDebugPanel'))
                    clickCountRef.current = 0
                    return
                  }

                  // 1秒后重置计数
                  clickTimerRef.current = setTimeout(() => {
                    clickCountRef.current = 0
                  }, 1000)
                }

                navigate(item.path)
              }

              return (
                <motion.button
                  key={item.name}
                  onClick={handleClick}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "flex flex-col items-center py-2 px-3 rounded-xl transition-all duration-200",
                    isActive 
                      ? "text-primary bg-amber-50" 
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  <div className="relative">
                    <Icon className="w-6 h-6" />
                    
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute -inset-1 bg-amber-100 rounded-lg -z-10"
                        initial={false}
                        transition={{
                          type: "spring",
                          stiffness: 500,
                          damping: 30
                        }}
                      />
                    )}
                  </div>
                  
                  <span className={cn(
                    "text-xs font-medium mt-1",
                    isActive ? "text-primary" : "text-gray-600"
                  )}>
                    {item.name}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </div>
      </motion.nav>

      {/* 调试面板由 App.tsx 中的 DebugFloatingButton 组件处理 */}
    </>
  )
}
