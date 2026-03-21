import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ClockIcon,
  TicketIcon,
  ArrowPathIcon,
  ShoppingBagIcon,
  BanknotesIcon
} from '@heroicons/react/24/outline';
import { formatCurrency, formatDateTime } from '../lib/utils';
import toast from 'react-hot-toast';

interface Order {
  id: string;
  order_number: string;
  type: 'LOTTERY_PURCHASE' | 'FULL_PURCHASE' | 'COIN_EXCHANGE' | 'DEPOSIT' | 'WITHDRAWAL';
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  amount: number;
  currency: string;
  description?: string;
  lottery_id?: string;
  lottery_title?: string;
  lottery_title_i18n?: any;
  purchased_numbers?: string;
  pickup_code?: string;
  created_at: string;
  updated_at: string;
}

const OrderPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();

  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  const getLocalizedText = (i18nObj: any, lang: string) => {
    if (!i18nObj) return '';
    return i18nObj[lang] || i18nObj['zh'] || i18nObj['en'] || '';
  };

  const fetchOrders = useCallback(async () => {
    if (!user || !sessionToken) return;
    
    setIsLoading(true);
    try {
      const allOrders: Order[] = [];

      // 1. 获取抽奖购买订单
      const { data: lotteryOrders, error: lotteryError } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          type,
          status,
          total_amount,
          currency,
          lottery_id,
          selected_numbers,
          created_at,
          updated_at,
          lotteries (
            title,
            title_i18n
          )
        `)
        .eq('user_id', user.id)
        .eq('type', 'LOTTERY_PURCHASE')
        .order('created_at', { ascending: false });

      if (!lotteryError && lotteryOrders) {
        lotteryOrders.forEach((order: any) => {
          allOrders.push({
            id: order.id,
            order_number: order.order_number,
            type: 'LOTTERY_PURCHASE',
            status: order.status,
            amount: order.total_amount,
            currency: order.currency,
            lottery_id: order.lottery_id,
            lottery_title: order.lotteries?.title || getLocalizedText(order.lotteries?.title_i18n, i18n.language),
            lottery_title_i18n: order.lotteries?.title_i18n,
            purchased_numbers: order.selected_numbers,
            created_at: order.created_at,
            updated_at: order.updated_at
          });
        });
      }

      // 2. 获取全款购买订单
      const { data: fullPurchaseOrders, error: fullPurchaseError } = await (supabase as any)
        .from('full_purchase_orders')
        .select(`
          id,
          order_number,
          status,
          total_amount,
          currency,
          lottery_id,
          pickup_code,
          metadata,
          created_at,
          updated_at,
          lotteries (
            title,
            title_i18n
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!fullPurchaseError && fullPurchaseOrders) {
        fullPurchaseOrders.forEach((order: any) => {
          const title = order.lotteries?.title || 
                       getLocalizedText(order.lotteries?.title_i18n, i18n.language) ||
                       getLocalizedText(order.metadata?.product_title_i18n, i18n.language) ||
                       order.metadata?.product_title;
          
          allOrders.push({
            id: order.id,
            order_number: order.order_number,
            type: 'FULL_PURCHASE',
            status: order.status,
            amount: order.total_amount,
            currency: order.currency,
            lottery_id: order.lottery_id,
            lottery_title: title,
            lottery_title_i18n: order.lotteries?.title_i18n || order.metadata?.product_title_i18n,
            pickup_code: order.pickup_code,
            created_at: order.created_at,
            updated_at: order.updated_at
          });
        });
      }

      // 按时间排序
      allOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setOrders(allOrders);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      toast.error(t('error.networkError'));
    } finally {
      setIsLoading(false);
    }
  }, [supabase, user, sessionToken, t, i18n.language]);

  const filterOrders = useCallback(() => {
    let filtered = [...orders];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(order =>
        order.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.lottery_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.pickup_code?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status === statusFilter);
    }

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter(order => order.type === typeFilter);
    }

    setFilteredOrders(filtered);
  }, [orders, searchQuery, statusFilter, typeFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    filterOrders();
  }, [filterOrders]);

  const getOrderTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      LOTTERY_PURCHASE: t('order.lotteryPurchase'),
      FULL_PURCHASE: t('order.fullPurchase'),
      COIN_EXCHANGE: t('order.coinExchange'),
      DEPOSIT: t('order.deposit'),
      WITHDRAWAL: t('order.withdrawal')
    };
    return labels[type] || t('wallet.transactionType.other');
  };

  const getOrderStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      PENDING: t('order.pending'),
      COMPLETED: t('order.completed'),
      CANCELLED: t('order.cancelled'),
      FAILED: t('order.failed')
    };
    return labels[status] || t('wallet.transactionStatus.completed');
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-700';
      case 'FAILED':
      case 'CANCELLED':
        return 'bg-red-100 text-red-700';
      case 'PENDING':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'LOTTERY_PURCHASE':
        return <TicketIcon className="w-5 h-5 text-blue-600" />;
      case 'FULL_PURCHASE':
        return <ShoppingBagIcon className="w-5 h-5 text-orange-600" />;
      case 'COIN_EXCHANGE':
        return <ArrowPathIcon className="w-5 h-5 text-purple-600" />;
      case 'DEPOSIT':
      case 'WITHDRAWAL':
        return <BanknotesIcon className="w-5 h-5 text-green-600" />;
      default:
        return <ClockIcon className="w-5 h-5 text-gray-600" />;
    }
  };

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-6 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-gray-900">{t('order.myOrders')}</h1>
        
        {/* Search Bar */}
        <div className="mt-4 flex space-x-2">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('order.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2.5 rounded-lg border transition-colors ${
              showFilters
                ? 'bg-blue-50 border-blue-500 text-blue-600'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <FunnelIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 space-y-3"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('order.orderStatus')}
              </label>
              <div className="flex flex-wrap gap-2">
                {['all', 'PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      statusFilter === status
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {status === 'all' ? (t('common.all')) : getOrderStatusLabel(status)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('order.orderType')}
              </label>
              <div className="flex flex-wrap gap-2">
                {['all', 'LOTTERY_PURCHASE', 'FULL_PURCHASE', 'COIN_EXCHANGE'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setTypeFilter(type)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      typeFilter === type
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {type === 'all' ? (t('common.all')) : getOrderTypeLabel(type)}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Orders List */}
      <div className="px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <TicketIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('order.noOrders')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Order Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      {getTypeIcon(order.type)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{order.order_number}</p>
                      <p className="text-sm text-gray-500">{formatDateTime(order.created_at)}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                    {getOrderStatusLabel(order.status)}
                  </span>
                </div>

                {/* Order Details */}
                <div className="space-y-2 border-t border-gray-100 pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('order.type')}:</span>
                    <span className="text-sm font-medium text-gray-900">{getOrderTypeLabel(order.type)}</span>
                  </div>
                  
                  {order.lottery_title && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">{t('order.product')}:</span>
                      <span className="text-sm font-medium text-gray-900 text-right max-w-[200px] truncate">
                        {order.lottery_title}
                      </span>
                    </div>
                  )}

                  {order.purchased_numbers && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">{t('order.numbers')}:</span>
                      <span className="text-sm font-medium text-gray-900">{order.purchased_numbers}</span>
                    </div>
                  )}

                  {order.pickup_code && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">{t('order.pickupCode')}:</span>
                      <span className="text-sm font-bold text-orange-600 text-lg">{order.pickup_code}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                    <span className="text-sm text-gray-600">{t('order.amount')}:</span>
                    <span className="text-lg font-bold text-blue-600">
                      {formatCurrency(order.currency, order.amount)}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderPage;
