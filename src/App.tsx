import { Suspense, useEffect } from "react"
import { useTranslation } from 'react-i18next'
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import { Toaster } from "react-hot-toast"
import PWAInstallPrompt from "./components/PWAInstallPrompt"
import PWAUpdateNotification from "./components/PWAUpdateNotification"

import { Layout } from "./components/layout/Layout"
import { RealtimeNotificationsProvider } from "./components/RealtimeNotificationsProvider"
import { PageLoadingFallback } from "./components/PageLoadingFallback"
import { AuthGuard, GuestGuard } from "./components/AuthGuard"
import { lazyWithRetry, prefetchCorePages, clearChunkReloadFlag } from "./utils/lazyWithRetry"

// ============================================================
// 路由级代码分割：所有页面组件使用 lazyWithRetry 动态加载
// - 自动重试 3 次（指数退避：1s, 2s, 4s）
// - 版本更新导致 chunk 失效时自动刷新页面
// - 支持 .preload() 静默预加载
// ============================================================

// 首页（用户首次打开必定访问）
const HomePage = lazyWithRetry(() => import("./pages/HomePage"))

// 核心页面（底部导航直达，首屏后静默预加载）
const LotteryPage = lazyWithRetry(() => import("./pages/LotteryPage"))
const WalletPage = lazyWithRetry(() => import("./pages/WalletPage"))
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"))

// 高频访问页面（用户常用功能）
const LotteryDetailPage = lazyWithRetry(() => import("./pages/LotteryDetailPage"))
const LotteryResultPage = lazyWithRetry(() => import("./pages/LotteryResultPage"))
const OrderManagementPage = lazyWithRetry(() => import("./pages/OrderManagementPage"))
const OrderDetailPage = lazyWithRetry(() => import("./pages/OrderDetailPage"))
const NotificationPage = lazyWithRetry(() => import("./pages/NotificationPage"))

// 钱包相关页面
const DepositPage = lazyWithRetry(() => import("./pages/DepositPage"))
const ExchangePage = lazyWithRetry(() => import("./pages/ExchangePage"))
const WithdrawPage = lazyWithRetry(() => import("./pages/WithdrawPage"))

// 功能页面（按需加载）
const FullPurchaseConfirmPage = lazyWithRetry(() => import("./pages/FullPurchaseConfirmPage"))
const InvitePage = lazyWithRetry(() => import("./pages/InvitePage"))
const SpinLotteryPage = lazyWithRetry(() => import("./pages/SpinLotteryPage"))
const AIPage = lazyWithRetry(() => import("./pages/AIPage"))
const ShowoffPage = lazyWithRetry(() => import("./pages/ShowoffPage"))
const ShowoffCreatePage = lazyWithRetry(() => import("./pages/ShowoffCreatePage"))
const MarketPage = lazyWithRetry(() => import("./pages/MarketPage"))
const MarketCreatePage = lazyWithRetry(() => import("./pages/MarketCreatePage"))
const MyTicketsPage = lazyWithRetry(() => import("./pages/MyTicketsPage"))
const MyPrizesPage = lazyWithRetry(() => import("./pages/MyPrizesPage"))

// 首页场景化改造页面
const SceneHomePage = lazyWithRetry(() => import("./pages/SceneHomePage"))
const TopicDetailPage = lazyWithRetry(() => import("./pages/TopicDetailPage"))
const CategoryProductsPage = lazyWithRetry(() => import("./pages/CategoryProductsPage"))

const OrderPage = lazyWithRetry(() => import("./pages/OrderPage"))
const PendingPickupPage = lazyWithRetry(() => import("./pages/PendingPickupPage"))
const SubsidyPlanPage = lazyWithRetry(() => import("./pages/SubsidyPlanPage"))
const PromoterCenterPage = lazyWithRetry(() => import("./pages/PromoterCenterPage"))
const PromoterDepositPage = lazyWithRetry(() => import("./pages/PromoterDepositPage"))
const PickupVerifyPage = lazyWithRetry(() => import("./pages/PickupVerifyPage"))
const CouponListPage = lazyWithRetry(() => import("./pages/CouponListPage"))

// 设置与个人资料编辑
const ProfileEditPage = lazyWithRetry(() => import("./pages/ProfileEditPage"))
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"))

// 认证页面（PWA 模式）
const LoginPage = lazyWithRetry(() => import("./pages/LoginPage"))
const RegisterPage = lazyWithRetry(() => import("./pages/RegisterPage"))
const ForgotPasswordPage = lazyWithRetry(() => import("./pages/ForgotPasswordPage"))

// 404 页面
const NotFoundPage = lazyWithRetry(() => import("./pages/NotFoundPage"))

// 调试面板：生产环境中通过连续点击5次"我的"触发
const DebugFloatingButton = lazyWithRetry(() => import("./components/debug/DebugFloatingButton").then(m => ({ default: m.DebugFloatingButton })))
const DebugPage = lazyWithRetry(() => import("./pages/DebugPage"))


function App() {
  const { t, i18n } = useTranslation()

  // 应用成功挂载后：清除 chunk reload 标记 + 静默预加载核心页面
  useEffect(() => {
    clearChunkReloadFlag()

    // 首屏渲染完成后 2 秒，按优先级静默预加载核心页面
    prefetchCorePages([
      LotteryPage,         // 商城列表（底部导航第2个）
      WalletPage,          // 钱包（底部导航第3个）
      ProfilePage,         // 个人中心（底部导航第4个）
    ])
  }, [])

  // 动态更新 SEO meta 标签（随语言切换同步更新）
  useEffect(() => {
    // 更新 title
    document.title = t('seo.title')

    // 更新 description
    let descMeta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!descMeta) {
      descMeta = document.createElement('meta')
      descMeta.name = 'description'
      document.head.appendChild(descMeta)
    }
    descMeta.content = t('seo.description')

    // 更新 keywords
    let keywordsMeta = document.querySelector('meta[name="keywords"]') as HTMLMetaElement | null
    if (!keywordsMeta) {
      keywordsMeta = document.createElement('meta')
      keywordsMeta.name = 'keywords'
      document.head.appendChild(keywordsMeta)
    }
    keywordsMeta.content = t('seo.keywords')

    // 更新 og:title
    let ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null
    if (!ogTitle) {
      ogTitle = document.createElement('meta')
      ogTitle.setAttribute('property', 'og:title')
      document.head.appendChild(ogTitle)
    }
    ogTitle.content = t('seo.title')

    // 更新 og:description
    let ogDesc = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null
    if (!ogDesc) {
      ogDesc = document.createElement('meta')
      ogDesc.setAttribute('property', 'og:description')
      document.head.appendChild(ogDesc)
    }
    ogDesc.content = t('seo.description')
  }, [i18n.language, t])

  return (
    <RealtimeNotificationsProvider>
      <Router>
      <div className="App">
        <Layout>
          <Suspense fallback={<PageLoadingFallback />}>
            <Routes>
              {/* ============================================================ */}
              {/* 访客路由（已登录用户访问将重定向到首页）                      */}
              {/* ============================================================ */}
              <Route path="/login" element={<GuestGuard><LoginPage /></GuestGuard>} />
              <Route path="/register" element={<GuestGuard><RegisterPage /></GuestGuard>} />
              <Route path="/forgot-password" element={<GuestGuard><ForgotPasswordPage /></GuestGuard>} />
              {/* /reset-password 是密码重置链接的目标路由，复用 ForgotPasswordPage 并自动进入 verify 步骤 */}
              {/* 注意：这是公开路由，已登录用户也可以通过 WhatsApp 链接重置密码 */}
              <Route path="/reset-password" element={<ForgotPasswordPage />} />

              {/* ============================================================ */}
              {/* 公开路由（无需登录即可访问）                                  */}
              {/* 首页和商城列表允许未登录用户浏览，提升转化率                  */}
              {/* ============================================================ */}
              <Route path="/" element={<SceneHomePage />} />
              {/* 保留旧首页路由，方便回退 */}
              <Route path="/home-legacy" element={<HomePage />} />
              <Route path="/lottery" element={<LotteryPage />} />
              <Route path="/lottery/:id" element={<LotteryDetailPage />} />
              <Route path="/lottery/:id/result" element={<LotteryResultPage />} />
              <Route path="/showoff" element={<ShowoffPage />} />
              <Route path="/topic/:slug" element={<TopicDetailPage />} />
              <Route path="/category/:categoryId" element={<CategoryProductsPage />} />

              {/* 拼团路由 - 重定向到首页，避免死链 */}
              <Route path="/group-buy" element={<Navigate to="/" replace />} />
              <Route path="/group-buy/:productId" element={<Navigate to="/" replace />} />
              <Route path="/group-buy/result/:sessionId" element={<Navigate to="/" replace />} />
              <Route path="/my-group-buys" element={<Navigate to="/orders" replace />} />
              <Route path="/groupbuy/:productId" element={<Navigate to="/" replace />} />

              {/* ============================================================ */}
              {/* 受保护路由（需要登录才能访问）                                */}
              {/* ============================================================ */}
              <Route path="/full-purchase-confirm/:lotteryId" element={<AuthGuard><FullPurchaseConfirmPage /></AuthGuard>} />
              <Route path="/wallet" element={<AuthGuard><WalletPage /></AuthGuard>} />
              <Route path="/deposit" element={<AuthGuard><DepositPage /></AuthGuard>} />
              <Route path="/wallet/deposit" element={<AuthGuard><DepositPage /></AuthGuard>} />
              <Route path="/withdraw" element={<AuthGuard><WithdrawPage /></AuthGuard>} />
              <Route path="/wallet/withdraw" element={<AuthGuard><WithdrawPage /></AuthGuard>} />
              <Route path="/exchange" element={<AuthGuard><ExchangePage /></AuthGuard>} />
              <Route path="/profile" element={<AuthGuard><ProfilePage /></AuthGuard>} />
              <Route path="/subsidy-plan" element={<AuthGuard><SubsidyPlanPage /></AuthGuard>} />

              <Route path="/orders" element={<AuthGuard><OrderManagementPage /></AuthGuard>} />
              <Route path="/notifications" element={<AuthGuard><NotificationPage /></AuthGuard>} />
              <Route path="/invite" element={<AuthGuard><InvitePage /></AuthGuard>} />
              <Route path="/spin" element={<AuthGuard><SpinLotteryPage /></AuthGuard>} />
              <Route path="/ai" element={<AuthGuard><AIPage /></AuthGuard>} />
              <Route path="/showoff/create" element={<AuthGuard><ShowoffCreatePage /></AuthGuard>} />
              <Route path="/market" element={<AuthGuard><MarketPage /></AuthGuard>} />
              <Route path="/market/create" element={<AuthGuard><MarketCreatePage /></AuthGuard>} />
              <Route path="/my-tickets" element={<AuthGuard><MyTicketsPage /></AuthGuard>} />
              <Route path="/my-prizes" element={<AuthGuard><OrderManagementPage /></AuthGuard>} />
              <Route path="/prizes" element={<AuthGuard><OrderManagementPage /></AuthGuard>} />
              <Route path="/orders-management" element={<AuthGuard><OrderManagementPage /></AuthGuard>} />
              <Route path="/order-detail/:id" element={<AuthGuard><OrderDetailPage /></AuthGuard>} />
              <Route path="/showoff/my" element={<AuthGuard><ShowoffPage /></AuthGuard>} />
              <Route path="/promoter-center" element={<AuthGuard><PromoterCenterPage /></AuthGuard>} />
              <Route path="/promoter-deposit" element={<AuthGuard><PromoterDepositPage /></AuthGuard>} />
              <Route path="/pickup-verify" element={<AuthGuard><PickupVerifyPage /></AuthGuard>} />
              <Route path="/market/my-resales" element={<AuthGuard><MarketPage /></AuthGuard>} />
              <Route path="/coupons" element={<AuthGuard><CouponListPage /></AuthGuard>} />
              <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
              <Route path="/debug" element={<DebugPage />} />
              <Route path="/profile/edit" element={<AuthGuard><ProfileEditPage /></AuthGuard>} />
              <Route path="/pending-pickup" element={<AuthGuard><PendingPickupPage /></AuthGuard>} />
              <Route path="/orders/:id" element={<AuthGuard><OrderDetailPage /></AuthGuard>} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
        }}
      />
      
      <Suspense fallback={null}>
        <DebugFloatingButton />
      </Suspense>
      
      {/* PWA 安装提示 */}
      <PWAInstallPrompt />
      
      {/* PWA 更新通知 */}
      <PWAUpdateNotification />

    </div>
      </Router>
    </RealtimeNotificationsProvider>
  )
}

export default App
