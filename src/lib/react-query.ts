import { QueryClient } from '@tanstack/react-query';

/**
 * React Query 全局配置
 * 
 * 【缓存策略说明】
 * - staleTime: 数据被视为"新鲜"的时间，新鲜期内不会重新请求
 * - gcTime: 数据在缓存中保留的时间（即使已过期），用于即时显示旧数据
 * - retry: 失败重试次数，使用指数退避策略
 * - refetchOnWindowFocus: 关闭（避免频繁请求，移动端切换应用时触发）
 * - refetchOnReconnect: 开启（断网恢复后自动刷新）
 * - networkMode: 'offlineFirst' 允许在离线时返回缓存数据
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 默认 staleTime: 5分钟（各 hook 可覆盖）
      staleTime: 1000 * 60 * 5,
      
      // 缓存保留30分钟（即使数据过期，切换页面时仍可即时显示旧数据）
      gcTime: 1000 * 60 * 30,
      
      // 重试配置：2次重试，指数退避（1s, 2s, 最大30s）
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      
      // 页面切换和网络恢复行为
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true, // 页面挂载时如果数据stale则刷新

      // 【弱网优化】offlineFirst模式：
      // 优先返回缓存数据，同时在后台尝试网络请求
      // 离线时不会报错，而是返回缓存中的旧数据
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
});

// ============================================================
// Query Keys：统一管理缓存键，确保缓存一致性
// ============================================================
export const queryKeys = {
  // 用户相关
  user: ['user'] as const,
  userProfile: (userId: string) => ['user', 'profile', userId] as const,
  userWallets: (userId: string) => ['user', 'wallets', userId] as const,
  
  // 商城（抽奖）相关
  lotteries: {
    all: ['lotteries'] as const,
    lists: () => ['lotteries', 'list'] as const,
    list: (status?: string) => ['lotteries', 'list', { status }] as const,
    detail: (id: string) => ['lotteries', 'detail', id] as const,
    result: (id: string) => ['lotteries', 'result', id] as const,
  },
  
  // 奖品相关
  prizes: {
    all: ['prizes'] as const,
    user: (userId: string) => ['prizes', 'user', userId] as const,
  },
  
  // 转售相关
  resales: {
    all: ['resales'] as const,
    lists: () => ['resales', 'list'] as const,
    user: (userId: string) => ['resales', 'user', userId] as const,
  },
  
  // 邀请相关
  referrals: {
    stats: (userId: string) => ['referrals', 'stats', userId] as const,
    invited: (userId: string) => ['referrals', 'invited', userId] as const,
  },
  
  // 晒单相关
  showoffs: {
    all: ['showoffs'] as const,
    lists: () => ['showoffs', 'list'] as const,
    user: (userId: string) => ['showoffs', 'user', userId] as const,
  },
  
  // 支付配置
  paymentConfigs: ['payment', 'configs'] as const,

  /**
   * [v2] 轮播图缓存键已废弃
   * Banner 数据现在由 get-home-feed 统一返回，
   * 不再有独立的 banners 查询。保留键定义以兼容旧代码引用。
   * @deprecated 使用 homepageQueryKeys.homeFeed() 代替
   */
  banners: ['banners'] as const,
};

// ============================================================
// 不同数据类型的推荐 staleTime（供各 hook 引用）
// ============================================================
export const staleTimes = {
  /** 静态配置类数据（轮播图、取货点、优惠券规则、补贴池）：30分钟 */
  static: 1000 * 60 * 30,
  /** 商品列表类数据（商城列表、首页 feed）：3分钟
   * [v2] 从 5 分钟调整为 3 分钟，配合 Edge Function 的 s-maxage=30 CDN 缓存，
   * 确保商品上下架变更在合理时间内反映到首页 */
  list: 1000 * 60 * 3,
  /** 用户资产类数据（钱包余额）：1分钟 */
  realtime: 1000 * 60 * 1,
  /** 详情页数据：3分钟 */
  detail: 1000 * 60 * 3,
};
