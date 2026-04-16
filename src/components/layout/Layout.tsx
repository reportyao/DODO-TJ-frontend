import React, { useState, useEffect, useCallback } from "react"
import { useLocation } from "react-router-dom"
import { useUser } from "../../contexts/UserContext"
import { cn } from "../../lib/utils"
import { BottomNavigation } from "../navigation/BottomNavigation"
import { useTranslation } from 'react-i18next'
import SpinFloatingButton from "../SpinFloatingButton"
import NewUserGiftModal from "../NewUserGiftModal"
import OfflineBanner from "../OfflineBanner"
import { supabase } from "../../lib/supabase"

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
  
  // 新人礼物弹窗状态
  const [showNewUserGift, setShowNewUserGift] = useState(false)
  const [giftAmount, setGiftAmount] = useState(10)
  
  // 购物次数
  const [spinCount, setSpinCount] = useState(0)

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

  /**
   * [v2 性能优化] 获取用户购物次数
   *
   * 修复问题：
   * 1. 原实现使用原始 fetch + SUPABASE_ANON_KEY 绕过 RLS，存在安全隐患
   *    且无法利用 supabase client 的连接池和 token 管理
   * 2. 改用 supabase client 的 .from() 查询，正确走 RLS
   * 3. 延迟 1.5 秒执行，避免与首屏核心请求（get-home-feed）竞争网络带宽
   * 4. 添加 AbortController 防止组件卸载后的状态更新
   */
  const fetchSpinCount = useCallback(async (signal?: AbortSignal) => {
    if (!user?.id) {return}
    
    try {
      const { data, error } = await supabase
        .from('user_spin_balance')
        .select('spin_count')
        .eq('user_id', user.id)
        .maybeSingle()

      if (signal?.aborted) {return}
      
      if (!error && data) {
        setSpinCount(data.spin_count || 0)
      }
    } catch (e) {
      // 表可能不存在，忽略错误
    }
  }, [user?.id])

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {return}

    const abortController = new AbortController()
    const bootstrap = () => {
      if (abortController.signal.aborted) {return}

      void fetchSpinCount(abortController.signal)

      return supabase
        .channel(`spin_balance_changes:${user.id}`)
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
              setSpinCount((payload.new as Record<string, number>).spin_count || 0)
            }
          }
        )
        .subscribe()
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    let idleId: number | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null

    const startBootstrap = () => {
      channel = bootstrap() || null
    }

    if (isHomeRoute && typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(startBootstrap, { timeout: 2500 })
    } else {
      const delay = isHomeRoute ? 2200 : 1500
      timer = setTimeout(startBootstrap, delay)
    }

    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      abortController.abort()
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [isAuthenticated, user?.id, fetchSpinCount, isHomeRoute])

  return (
    <div className={cn(
      "min-h-screen bg-gradient-to-br from-amber-50 via-white to-amber-50",
      className
    )}>
      {/* 弱网/离线状态提示横幅 */}
      <OfflineBanner />
      {showHeader && (
        <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50">
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
                  <p className="text-xs font-semibold text-accent">{t('home.freeShippingLine1')}</p>
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
        </header>
      )}
      
      <main className={cn(
        "max-w-md mx-auto",
        showBottomNav && "pb-24"
      )}>
        {children}
      </main>

      {showBottomNav && <BottomNavigation />}
      
      {/* 推荐浮动入口 - 仅在登录后显示 */}
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
