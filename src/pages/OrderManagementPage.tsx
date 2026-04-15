import React, { useState, useMemo } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardDocumentListIcon,
  ShoppingBagIcon,
  TicketIcon,
  ClockIcon,
  UsersIcon,
  ArrowsRightLeftIcon,
  TrophyIcon,
  ChevronRightIcon,
  GiftIcon,
  MapPinIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { LazyImage } from '../components/LazyImage';
import { formatDateTime } from '../lib/utils';
import toast from 'react-hot-toast';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

// 订单类型
type OrderType = 'all' | 'group_buy' | 'lottery' | 'full_purchase';

// 统一订单接口
interface UnifiedOrder {
  id: string;
  order_type: 'group_buy' | 'lottery' | 'exchange' | 'full_purchase';
  order_number: string;
  amount: number;
  status: string;
  created_at: string;
  // 商品信息
  product_title: { zh?: string; ru?: string; tg?: string };
  product_image: string;
  original_price?: number;
  price_per_person?: number;
  // 拼团特有
  session_status?: string;
  session_code?: string;
  current_participants?: number;
  group_size?: number;
  expires_at?: string;
  session_id?: string;
  refund_lucky_coins?: number;
  // 购物特有
  lottery_period?: string;
  lottery_id?: string;
  shipping?: any;
  resale_listing?: any;
  // 自提信息
  pickup_code?: string;
  pickup_status?: string;
  pickup_point?: any;
  claimed_at?: string;
  picked_up_at?: string;
  result_id?: string;
}

interface OrderSummary {
  group_buy_count: number;
  lottery_count: number;
  exchange_count: number;
  full_purchase_count: number;
}

interface OrdersResponse {
  success: boolean;
  data: UnifiedOrder[];
  summary: OrderSummary;
  error?: string;
}

// 骨架屏组件
const OrderSkeleton = () => (
  <div className="bg-white rounded-2xl p-4 shadow-sm animate-pulse mb-4">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center space-x-2">
        <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
        <div className="w-24 h-4 bg-gray-200 rounded"></div>
      </div>
      <div className="w-16 h-5 bg-gray-200 rounded-full"></div>
    </div>
    <div className="flex space-x-4">
      <div className="w-20 h-20 bg-gray-200 rounded-xl"></div>
      <div className="flex-1 space-y-2">
        <div className="w-full h-5 bg-gray-200 rounded"></div>
        <div className="w-2/3 h-4 bg-gray-200 rounded"></div>
        <div className="w-1/2 h-4 bg-gray-200 rounded"></div>
      </div>
    </div>
  </div>
);

const OrderManagementPage: React.FC = () => {
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<OrderType>('all');
  const [selectedOrder, setSelectedOrder] = useState<UnifiedOrder | null>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);

  // 使用 React Query 获取订单数据
  const { data, isLoading, isError, refetch, isRefetching } = useQuery<OrdersResponse>({
    queryKey: ['orders', user?.id],
    queryFn: async () => {
      if (!user || !sessionToken) throw new Error('User not authenticated');
      
      const { data, error } = await supabase.functions.invoke('get-my-orders', {
        body: {
          session_token: sessionToken,
          order_type: 'all',
        },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data;
    },
    enabled: !!user && !!sessionToken,
    refetchOnMount: 'always', // 修复: 每次挂载都重新获取，确保显示最新数据
    staleTime: 0, // 修复: 数据立即过期，避免缓存问题
  });

  const allOrders = data?.data || [];
  const summary = data?.summary || { group_buy_count: 0, lottery_count: 0, exchange_count: 0, full_purchase_count: 0 };

  // 根据当前 Tab 筛选订单
  const filteredOrders = useMemo(() => {
    // 过滤掉拼团订单（拼团功能已隐藏）
    const nonGroupBuyOrders = allOrders.filter(order => order.order_type !== 'group_buy');
    if (activeTab === 'all') return nonGroupBuyOrders;
    if (activeTab === 'lottery') {
      // 商城 Tab 包含 lottery、exchange、full_purchase 类型
      return nonGroupBuyOrders.filter(order => 
        order.order_type === 'lottery' || 
        order.order_type === 'exchange' || 
        order.order_type === 'full_purchase'
      );
    }
    return nonGroupBuyOrders.filter(order => order.order_type === activeTab);
  }, [allOrders, activeTab]);

  // 获取本地化文本
  const getLocalizedText = (text: any): string => {
    if (!text) return '';
    if (typeof text === 'string') return text;
    return text[i18n.language] || text.zh || text.ru || text.tg || '';
  };

  // 获取订单类型图标
  const getOrderTypeIcon = (orderType: string) => {
    switch (orderType) {
      case 'group_buy': return <UsersIcon className="w-5 h-5" />;
      case 'lottery': return <TrophyIcon className="w-5 h-5" />;
      case 'exchange': return <ArrowsRightLeftIcon className="w-5 h-5" />;
      case 'full_purchase': return <ShoppingBagIcon className="w-5 h-5" />;
      default: return <ShoppingBagIcon className="w-5 h-5" />;
    }
  };

  // 获取状态徽章
  const getStatusBadge = (order: UnifiedOrder) => {
    if (order.pickup_status) {
      const pickupStatusMap: Record<string, { text: string; color: string }> = {
        'PENDING_CLAIM': { text: t('orders.statusCongratulations'), color: 'bg-gradient-to-r from-amber-100 to-amber-100 text-primary-dark' },
        'PENDING_PICKUP': { text: t('orders.statusPendingPickup'), color: 'bg-amber-100 text-primary-dark' },
        'PICKED_UP': { text: t('orders.statusPickedUp'), color: 'bg-green-100 text-green-700' },
        'EXPIRED': { text: t('orders.statusExpired'), color: 'bg-red-100 text-red-700' },
      };
      
      const badge = pickupStatusMap[order.pickup_status];
      if (badge) {
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.color}`}>
            {badge.text}
          </span>
        );
      }
    }

    // 对于拼团订单，优先根据 session_status 判断状态
    if (order.order_type === 'group_buy' && order.session_status) {
      // 检查是否实际上已经超时（即使 session_status 还是 ACTIVE）
      const isActuallyExpired = order.session_status === 'ACTIVE' && 
                               order.expires_at && 
                               new Date(order.expires_at).getTime() < Date.now();

      // 如果拼团未成团（超时、取消、过期），显示"已退款"
      if (['TIMEOUT', 'CANCELLED', 'EXPIRED'].includes(order.session_status) || isActuallyExpired) {
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
            {t('orders.statusRefunded')}
          </span>
        );
      }
      // 如果拼团进行中
      if (order.session_status === 'ACTIVE') {
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-primary-dark">
            {t('orders.statusGrouping')}
          </span>
        );
      }
      // 如果拼团成功，继续使用 order.status 判断
    }

    const statusMap: Record<string, { text: string; color: string }> = {
      'PENDING': { text: order.order_type === 'group_buy' ? t('orders.statusGrouping') : t('orders.statusWaiting'), color: 'bg-amber-100 text-primary-dark' },
      'ACTIVE': { text: t('orders.statusGrouping'), color: 'bg-amber-100 text-primary-dark' },
      'PAID': { text: t('orders.statusPaid'), color: 'bg-amber-100 text-primary-dark' },
      'WON': { text: t('orders.statusCongratulations'), color: 'bg-gradient-to-r from-amber-100 to-amber-100 text-primary-dark' },
      'LOST': { text: t('orders.statusFinished'), color: 'bg-gray-100 text-gray-700' },
      'REFUNDED': { text: t('orders.statusRefunded'), color: 'bg-orange-100 text-orange-700' },
      'EXPIRED': { text: t('orders.statusFinished'), color: 'bg-gray-100 text-gray-700' },
      'SHIPPING': { text: t('orders.statusShipping'), color: 'bg-amber-100 text-primary-dark' },
      'SHIPPED': { text: t('orders.statusShipped'), color: 'bg-green-100 text-green-700' },
      'RESOLD': { text: t('orders.statusResold'), color: 'bg-amber-100 text-primary-dark' },
      'COMPLETED': { text: t('orders.statusCompleted'), color: 'bg-green-100 text-green-700' },
    };

    const badge = statusMap[order.status] || { text: order.status, color: 'bg-gray-100 text-gray-700' };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  const handleOrderClick = (order: UnifiedOrder) => {
    if (order.order_type === 'group_buy' && order.session_id) {
      // 已提货的拼团订单跳转到物流结果页（订单详情页）
      // 使用 result_id（group_buy_results 表的 ID）而非 order.id（group_buy_orders 表的 ID）
      if (order.pickup_status === 'PICKED_UP' && order.result_id) {
        navigate(`/order-detail/${order.result_id}`);
      } else {
        // 其他状态的拼团订单跳转到处理订单结果页
        navigate(`/group-buy/result/${order.session_id}`);
      }
    } else if (order.order_type === 'lottery' && order.lottery_id) {
      // 已获奖的一元购物订单（来自prizes表，有pickup_status）跳转到物流详情页
      if (order.pickup_status) {
        navigate(`/order-detail/${order.id}`);
      } else if (order.status === 'WON') {
        // 获奖的订单（来自orders表，无pickup_status）也应跳转到物流详情页
        // 需要通过 prize_id 跳转，如果没有则跳转到商品页
        if ((order as any).prize_id) {
          navigate(`/order-detail/${(order as any).prize_id}`);
        } else {
          navigate(`/lottery/${order.lottery_id}`);
        }
      } else {
        // 未处理订单或未获奖的订单跳转到商品详情页
        navigate(`/lottery/${order.lottery_id}`);
      }
    } else if (order.order_type === 'full_purchase') {
      navigate(`/order-detail/${order.id}`);
    }
  };

  const tabs = [
    { key: 'all', label: t('orders.tabAll'), count: summary.lottery_count + summary.full_purchase_count },
    { key: 'lottery', label: t('orders.tabLottery'), count: summary.lottery_count + summary.full_purchase_count },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 pb-20">
      {/* 头部 */}
      <div className="bg-gradient-to-r from-primary via-primary to-red-500 text-white shadow-lg">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <ClipboardDocumentListIcon className="w-8 h-8" />
              <h1 className="text-2xl font-bold">{t('orders.title')}</h1>
            </div>
            {isRefetching && <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/30 border-t-white"></div>}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <motion.div whileHover={{ scale: 1.02 }} className="bg-white/20 backdrop-blur-md rounded-2xl p-4 border border-white/10">
              <p className="text-3xl font-black">{summary.lottery_count + summary.full_purchase_count}</p>
              <p className="text-xs mt-1 font-medium opacity-80 uppercase tracking-wider">{t('orders.tabAll')}</p>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} className="bg-white/20 backdrop-blur-md rounded-2xl p-4 border border-white/10">
              <p className="text-3xl font-black">{summary.lottery_count + summary.full_purchase_count}</p>
              <p className="text-xs mt-1 font-medium opacity-80 uppercase tracking-wider">{t('orders.lotteryCount')}</p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex space-x-8 overflow-x-auto scrollbar-hide py-4">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as OrderType)}
                className={`relative flex items-center space-x-2 whitespace-nowrap transition-all ${
                  activeTab === tab.key ? 'text-primary font-bold' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    activeTab === tab.key ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {tab.count}
                  </span>
                )}
                {activeTab === tab.key && (
                  <motion.div layoutId="activeTab" className="absolute -bottom-4 left-0 right-0 h-1 bg-primary rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 订单列表 */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => <OrderSkeleton key={i} />)}
          </div>
        ) : isError ? (
          <div className="bg-white rounded-3xl p-12 text-center shadow-sm border border-red-50">
            <ExclamationCircleIcon className="w-16 h-16 text-red-200 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t('orders.loadError')}</h3>
            <button onClick={() => refetch()} className="px-6 py-2 bg-primary text-white rounded-xl font-medium">
              {t('common.retry')}
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center shadow-sm">
            <ShoppingBagIcon className="w-16 h-16 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500">{t('orders.noOrders')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => handleOrderClick(order)}
                  className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-all border border-gray-50 group cursor-pointer"
                >
                  {/* 订单头部 */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2 text-gray-500">
                      <div className="p-1.5 bg-gray-50 rounded-lg group-hover:bg-amber-50 group-hover:text-primary transition-colors">
                        {getOrderTypeIcon(order.order_type)}
                      </div>
                      <span className="text-xs font-medium tracking-tight">#{order.order_number}</span>
                    </div>
                    {getStatusBadge(order)}
                  </div>

                  {/* 订单内容 */}
                  <div className="flex space-x-4">
                    <div style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0, borderRadius: '0.75rem', overflow: 'hidden' }}>
                      <LazyImage
                        src={order.product_image}
                        alt={getLocalizedText(order.product_title)}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                      />
                      {order.order_type === 'group_buy' && (
                        <div className="absolute -top-2 -left-2 bg-primary text-white p-1 rounded-lg shadow-lg">
                          <UsersIcon className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-900 line-clamp-2 mb-1 group-hover:text-primary transition-colors">
                        {getLocalizedText(order.product_title)}
                      </h3>
                      <div className="flex items-center space-x-3 text-[11px] text-gray-500">
                        <div className="flex items-center">
                          <ClockIcon className="w-3 h-3 mr-1" />
                          {formatDateTime(order.created_at)}
                        </div>
                        {order.order_type === 'lottery' && order.lottery_period && (
                          <div className="flex items-center text-primary font-medium">
                            <TicketIcon className="w-3 h-3 mr-1" />
                            {t('lottery.period')} {order.lottery_period}
                          </div>
                        )}
                      </div>
                      
                      {/* 价格信息 */}
                      <div className="mt-2 flex items-baseline space-x-2">
                        <span className="text-sm font-black text-gray-900">{order.amount} {t('wallet.luckyCoins')}</span>
                        {order.original_price && (
                          <span className="text-[10px] text-gray-400 line-through">{order.original_price}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <ChevronRightIcon className="w-5 h-5 text-gray-300 group-hover:text-primary transition-colors" />
                    </div>
                  </div>

                  {/* 底部操作区（仅获奖且待领取） */}
                  {order.pickup_status === 'PENDING_CLAIM' && (
                    <div className="mt-4 pt-4 border-t border-dashed border-gray-100 flex justify-end space-x-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/group-buy/result/${order.session_id}`); }}
                        className="px-4 py-2 bg-gradient-to-r from-primary to-primary-dark text-white text-xs font-bold rounded-xl shadow-md shadow-amber-200 active:scale-95 transition-all"
                      >
                        {t('orders.actionClaim')}
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderManagementPage;
