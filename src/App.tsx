import { Suspense, useEffect } from "react"
import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { Toaster } from "react-hot-toast"
import { BotFollowModal, useBotFollowModal } from "./components/BotFollowModal"
import { Layout } from "./components/layout/Layout"
import { RealtimeNotificationsProvider } from "./components/RealtimeNotificationsProvider"
import { PageLoadingFallback } from "./components/PageLoadingFallback"
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
const GroupBuyListPage = lazyWithRetry(() => import("./pages/groupbuy/GroupBuyListPage"))

// 高频访问页面（用户常用功能）
const LotteryDetailPage = lazyWithRetry(() => import("./pages/LotteryDetailPage"))
const LotteryResultPage = lazyWithRetry(() => import("./pages/LotteryResultPage"))
const GroupBuyDetailPage = lazyWithRetry(() => import("./pages/groupbuy/GroupBuyDetailPage"))
const GroupBuyResultPage = lazyWithRetry(() => import("./pages/groupbuy/GroupBuyResultPage"))
const MyGroupBuysPage = lazyWithRetry(() => import("./pages/groupbuy/MyGroupBuysPage"))
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
const BotPage = lazyWithRetry(() => import("./pages/BotPage"))
const OrderPage = lazyWithRetry(() => import("./pages/OrderPage"))
const PendingPickupPage = lazyWithRetry(() => import("./pages/PendingPickupPage"))
const SubsidyPlanPage = lazyWithRetry(() => import("./pages/SubsidyPlanPage"))
const PromoterCenterPage = lazyWithRetry(() => import("./pages/PromoterCenterPage"))
const PromoterDepositPage = lazyWithRetry(() => import("./pages/PromoterDepositPage"))

// 设置与个人资料编辑
const ProfileEditPage = lazyWithRetry(() => import("./pages/ProfileEditPage"))
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"))

// 404 页面
const NotFoundPage = lazyWithRetry(() => import("./pages/NotFoundPage"))

// 调试面板：生产环境中通过连续点击5次"我的"触发
const DebugFloatingButton = lazyWithRetry(() => import("./components/debug/DebugFloatingButton").then(m => ({ default: m.DebugFloatingButton })))
const DebugPage = lazyWithRetry(() => import("./pages/DebugPage"))


function App() {
  const { showModal, closeModal, handleSuccess } = useBotFollowModal()

  // 应用成功挂载后：清除 chunk reload 标记 + 静默预加载核心页面
  useEffect(() => {
    // 清除之前可能残留的 chunk reload 标记
    clearChunkReloadFlag()

    // 首屏渲染完成后 2 秒，按优先级静默预加载核心页面
    // 这些是底部导航栏直达的页面，用户大概率会访问
    prefetchCorePages([
      LotteryPage,        // 抽奖列表（底部导航第2个）
      GroupBuyListPage,    // 拼团列表（底部导航第3个）
      WalletPage,          // 钱包（底部导航第4个）
      ProfilePage,         // 个人中心（底部导航第5个）
    ])
  }, [])

  return (
    <RealtimeNotificationsProvider>
      <Router>
      <div className="App">
        <Layout>
          <Suspense fallback={<PageLoadingFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/lottery" element={<LotteryPage />} />
              <Route path="/lottery/:id" element={<LotteryDetailPage />} />
              <Route path="/lottery/:id/result" element={<LotteryResultPage />} />
              <Route path="/full-purchase-confirm/:lotteryId" element={<FullPurchaseConfirmPage />} />
              <Route path="/group-buy" element={<GroupBuyListPage />} />
              <Route path="/group-buy/:productId" element={<GroupBuyDetailPage />} />
              <Route path="/group-buy/result/:sessionId" element={<GroupBuyResultPage />} />
              <Route path="/my-group-buys" element={<MyGroupBuysPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/deposit" element={<DepositPage />} />
              <Route path="/wallet/deposit" element={<DepositPage />} />
              <Route path="/withdraw" element={<WithdrawPage />} />
              <Route path="/wallet/withdraw" element={<WithdrawPage />} />
              <Route path="/exchange" element={<ExchangePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/subsidy-plan" element={<SubsidyPlanPage />} />
              <Route path="/bot" element={<BotPage />} />
              <Route path="/orders" element={<OrderManagementPage />} />
              <Route path="/notifications" element={<NotificationPage />} />
              <Route path="/invite" element={<InvitePage />} />
              <Route path="/spin" element={<SpinLotteryPage />} />
              <Route path="/ai" element={<AIPage />} />
              <Route path="/showoff" element={<ShowoffPage />} />
              <Route path="/showoff/create" element={<ShowoffCreatePage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/market/create" element={<MarketCreatePage />} />
              <Route path="/my-tickets" element={<MyTicketsPage />} />
              <Route path="/my-prizes" element={<OrderManagementPage />} />
              <Route path="/prizes" element={<OrderManagementPage />} />
              <Route path="/orders-management" element={<OrderManagementPage />} />
              <Route path="/order-detail/:id" element={<OrderDetailPage />} />
              <Route path="/showoff/my" element={<ShowoffPage />} />
              <Route path="/promoter-center" element={<PromoterCenterPage />} />
              <Route path="/promoter-deposit" element={<PromoterDepositPage />} />
              <Route path="/market/my-resales" element={<MarketPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/debug" element={<DebugPage />} />
              <Route path="/profile/edit" element={<ProfileEditPage />} />
              <Route path="/pending-pickup" element={<PendingPickupPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/groupbuy/:productId" element={<GroupBuyDetailPage />} />
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
      
      {/* Bot关注引导弹窗 */}
      {showModal && (
        <BotFollowModal
          onClose={closeModal}
          onSuccess={handleSuccess}
        />
      )}
    </div>
      </Router>
    </RealtimeNotificationsProvider>
  )
}

export default App
