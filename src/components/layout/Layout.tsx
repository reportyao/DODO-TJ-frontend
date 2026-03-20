import React, { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { useUser } from "../../contexts/UserContext"
import { cn } from "../../lib/utils"
import { BottomNavigation } from "../navigation/BottomNavigation"
import { useTranslation } from 'react-i18next'
import SpinFloatingButton from "../SpinFloatingButton"
import NewUserGiftModal from "../NewUserGiftModal"
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../../lib/supabase"

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
  
  // 新人礼物弹窗状态
  const [showNewUserGift, setShowNewUserGift] = useState(false)
  const [giftAmount, setGiftAmount] = useState(10)
  
  // 抽奖次数
  const [spinCount, setSpinCount] = useState(0)

  // 检查是否需要显示新人礼物弹窗
  useEffect(() => {
    const checkNewUserGift = () => {
      // 检查 localStorage 中是否有新人礼物标记
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

    if (isAuthenticated) {
      checkNewUserGift()
    }
  }, [isAuthenticated])

  // 关闭新人礼物弹窗
  const handleCloseNewUserGift = () => {
    setShowNewUserGift(false)
    localStorage.setItem('new_user_gift_shown', 'true')
    localStorage.removeItem('new_user_gift_data')
  }

  // 获取用户抽奖次数
  const fetchSpinCount = useCallback(async () => {
    if (!user?.id) return
    
    try {
      // 使用直接API调用以避免类型错误（新表未在类型定义中）
      const supabaseUrl = SUPABASE_URL
      const supabaseKey = SUPABASE_ANON_KEY
      
      const response = await fetch(
        `${supabaseUrl}/rest/v1/user_spin_balance?user_id=eq.${user.id}&select=spin_count`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          }
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data && data.length > 0) {
          setSpinCount(data[0].spin_count || 0)
        }
      }
    } catch (e) {
      // 表可能不存在，忽略错误
      console.log('Spin balance not available yet')
    }
  }, [user?.id])

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      fetchSpinCount()
      
      // 订阅实时更新
      const channel = supabase
        .channel('spin_balance_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_spin_balance',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            if (payload.new && typeof payload.new === 'object' && 'spin_count' in payload.new) {
              setSpinCount((payload.new as any).spin_count || 0)
            }
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }
  }, [isAuthenticated, user?.id, fetchSpinCount])

  return (
    <div className={cn(
      "min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50",
      className
    )}>
      {showHeader && (
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50"
        >
          <div className="max-w-md mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <picture>
                  <source srcSet="/dodo-logo.webp" type="image/webp" />
                  <img 
                    src="/dodo-logo.png" 
                    alt="DODO Logo"
                    style={{ width: '40px', height: '40px', objectFit: 'contain', maxWidth: 'none' }}
                  />
                </picture>
                <div>
                  <h1 className="text-lg font-bold text-gray-900">DODO</h1>
                  <p className="text-xs text-gray-500">{t('home.tagline')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-semibold text-emerald-600">{t('home.freeShippingLine1')}</p>
                  <p className="text-xs font-bold text-red-500">{t('home.freeShippingLine2')}</p>
                </div>
                {user?.avatar_url && (
                  <img 
                    src={user.avatar_url} 
                    alt="Avatar"
                    style={{ width: '40px', height: '40px', borderRadius: '9999px', objectFit: 'cover', maxWidth: 'none' }}
                  />
                )}
              </div>
            </div>
          </div>
        </motion.header>
      )}
      
      <main className={cn(
        "max-w-md mx-auto",
        showBottomNav && "pb-20"
      )}>
        {children}
      </main>

      {showBottomNav && <BottomNavigation />}
      
      {/* 转盘抽奖浮动入口 - 仅在登录后显示 */}
      {isAuthenticated && <SpinFloatingButton spinCount={spinCount} />}
      
      {/* 新人礼物弹窗 */}
      <NewUserGiftModal
        isOpen={showNewUserGift}
        giftAmount={giftAmount}
        onClose={handleCloseNewUserGift}
      />
    </div>
  )
}
