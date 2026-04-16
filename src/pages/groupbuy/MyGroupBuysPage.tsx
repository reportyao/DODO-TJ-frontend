import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useUser } from '../../contexts/UserContext';
import { extractEdgeFunctionError } from '../../utils/edgeFunctionHelper'
// getOptimizedImageUrl removed to fix thumbnail enlargement issue
import {
  ShoppingBag,
  Users,
  Clock,
  Trophy,
  RefreshCw,
  ChevronLeft,
} from 'lucide-react';

interface GroupBuyOrder {
  id: string;
  order_number: string;
  amount: number;
  status: string;
  created_at: string;
  refund_lucky_coins: number | null;
  session: {
    id: string;
    session_code: string;
    status: string;
    current_participants: number;
    group_size: number; // 数据库字段名
    expires_at: string;
    winner_id: string | null;
  };
  product: {
    id: string;
    title: { zh: string; ru: string; tg: string };
    image_url: string;
    price_per_person: number;
  };
}

export default function MyGroupBuysPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useUser();
  const [orders, setOrders] = useState<GroupBuyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  useEffect(() => {
    if (user) {
      fetchOrders();
    }
  }, [user]);

  const fetchOrders = async () => {
    if (!user) {return;}

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('group-buy-list', {
        body: { type: 'my-orders', user_id: user.id },
      });

      if (error) {throw new Error(await extractEdgeFunctionError(error));}
      if (data?.success) {
        setOrders(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const getLocalizedText = (text: any) => {
    if (!text) {return '';}
    if (typeof text === 'string') {return text;}
    if (typeof text !== 'object') {return String(text);}
    
    const currentLang = text[i18n.language];
    if (currentLang && typeof currentLang === 'string' && currentLang.trim()) {
      return currentLang;
    }
    
    const fallbackLangs = ['zh', 'ru', 'tg', 'en'];
    for (const lang of fallbackLangs) {
      if (text[lang] && typeof text[lang] === 'string' && text[lang].trim()) {
        return text[lang];
      }
    }
    
    return '';
  };

  const getStatusBadge = (order: GroupBuyOrder) => {
    if (order.status === 'WON') {
      return (
        <div className="flex items-center gap-1 bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-sm font-bold">
          <Trophy className="w-4 h-4" />
          {t('groupBuy.status.won')}
        </div>
      );
    } else if (order.status === 'REFUNDED') {
      return (
        <div className="flex items-center gap-1 bg-amber-100 text-primary-dark px-3 py-1 rounded-full text-sm font-bold">
          <RefreshCw className="w-4 h-4" />
          {t('groupBuy.status.refunded')}
        </div>
      );
    } else if (order.session.status === 'ACTIVE') {
      return (
        <div className="flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">
          <Clock className="w-4 h-4" />
          {t('groupBuy.status.active')}
        </div>
      );
        } else if (order.status === 'LOST' || order.session.status === 'TIMEOUT') {
      // 新增逻辑：未成团或未获奖，显示已退款到余额
      return (
        <div className="flex items-center gap-1 bg-amber-100 text-primary-dark px-3 py-1 rounded-full text-sm font-bold">
          <RefreshCw className="w-4 h-4" />
          {t('groupBuy.status.refundedToBalance')}
        </div>
      );
    } else {
      // 默认状态，理论上不应该出现
      return (
        <div className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm font-bold">
          {t('groupBuy.status.unknown')}
        </div>
      );
    }
  };

  const filteredOrders = orders.filter((order) => {
    if (filter === 'all') {return true;}
    if (filter === 'active') {return order.session.status === 'ACTIVE';}
    if (filter === 'completed')
      {return order.session.status === 'SUCCESS' || order.session.status === 'TIMEOUT';}
    return true;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary via-primary to-red-500 text-white p-6 rounded-b-3xl shadow-lg">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-white hover:text-amber-100 mb-4"
        >
          <ChevronLeft className="w-6 h-6" />
          {t('common.back')}
        </button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="w-7 h-7" />
          {t('groupBuy.myGroups')}
        </h1>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 p-4">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            filter === 'all'
              ? 'bg-primary text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('groupBuy.filter.all')}
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            filter === 'active'
              ? 'bg-primary text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('groupBuy.filter.active')}
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            filter === 'completed'
              ? 'bg-primary text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('groupBuy.filter.completed')}
        </button>
      </div>

      {/* Orders List */}
      <div className="p-4 space-y-4">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingBag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('groupBuy.noOrders')}</p>
            <button
              onClick={() => navigate('/group-buy')}
              className="mt-4 text-primary hover:text-primary font-medium"
            >
              {t('groupBuy.browseProducts')}
            </button>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-2xl shadow-md overflow-hidden"
            >
              <div className="flex gap-4 p-4">
                {/* Product Image */}
                <img
                  src={order.product.image_url}
                  alt={getLocalizedText(order.product.title)}
                  loading="lazy"
                  style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '0.75rem', flexShrink: 0, maxWidth: 'none' }}
                />

                {/* Order Info */}
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-bold text-gray-800">
                      {getLocalizedText(order.product.title)}
                    </h3>
                    {getStatusBadge(order)}
                  </div>

                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>
                        {order.session.current_participants}/{order.session.group_size}
                      </span>
                    </div>
                    <div className="text-primary font-bold">TJS {order.amount}</div>
                  </div>

                  {/* Refund Info */}
                  {order.refund_lucky_coins && (
                    <div className="mt-2 bg-amber-50 rounded-lg p-2 text-sm">
                      <span className="text-primary-dark">
                        {t('groupBuy.refundedLuckyCoins')}: {order.refund_lucky_coins}
                      </span>
                    </div>
                  )}

                  {/* Won Info */}
                  {order.status === 'WON' && (
                    <button
                      onClick={() => navigate(`/group-buy/result/${order.session.id}`)}
                      className="mt-2 text-sm text-primary hover:text-primary font-medium"
                    >
                      {t('groupBuy.viewResult')} →
                    </button>
                  )}
                </div>
              </div>

              {/* Order Number */}
              <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500">
                {t('groupBuy.orderNumber')}: {order.order_number}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
