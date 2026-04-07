import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../contexts/UserContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { 
  TicketIcon, 
  ArrowLeftIcon,
  GiftIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon 
} from '@heroicons/react/24/outline';

// 数据库实际字段：id, user_id, amount, status(VALID/USED/EXPIRED), source, related_lottery_id, expires_at, used_at, created_at, updated_at
interface Coupon {
  id: string;
  user_id: string;
  amount: number;
  status: 'VALID' | 'USED' | 'EXPIRED';
  source: string;
  related_lottery_id: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  updated_at: string;
}

type TabType = 'valid' | 'used' | 'expired';

const CouponListPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user } = useUser();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('valid');

  // 获取用户抵扣券列表
  const { data: coupons = [], isLoading } = useQuery({
    queryKey: ['coupons', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return (data || []) as Coupon[];
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  // 按状态分组 - 使用数据库实际状态值 VALID/USED/EXPIRED
  const groupedCoupons = useMemo(() => {
    const now = new Date();
    return {
      valid: coupons.filter(c => c.status === 'VALID' && new Date(c.expires_at) > now),
      used: coupons.filter(c => c.status === 'USED'),
      expired: coupons.filter(c => c.status === 'EXPIRED' || (c.status === 'VALID' && new Date(c.expires_at) <= now)),
    };
  }, [coupons]);

  const currentCoupons = groupedCoupons[activeTab];

  // 统计数据
  const validCount = groupedCoupons.valid.length;
  const totalSaved = coupons
    .filter(c => c.status === 'USED')
    .reduce((sum, c) => sum + c.amount, 0);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  // 来源类型翻译
  const getSourceLabel = (source: string): string => {
    switch (source) {
      case 'LOTTERY_REFUND': return t('coupon.sourceLotteryRefund');
      case 'DEPOSIT_BONUS': return t('coupon.sourceDepositBonus');
      case 'ADMIN_GRANT': return t('coupon.sourceAdminGrant');
      case 'PROMOTION': return t('coupon.sourcePromotion');
      default: return source;
    }
  };

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: 'valid', label: t('coupon.tabValid'), count: groupedCoupons.valid.length },
    { key: 'used', label: t('coupon.tabUsed'), count: groupedCoupons.used.length },
    { key: 'expired', label: t('coupon.tabExpired'), count: groupedCoupons.expired.length },
  ];

  // 判断抵扣券是否可用
  const isCouponActive = (coupon: Coupon): boolean => {
    return coupon.status === 'VALID' && new Date(coupon.expires_at) > new Date();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 pb-20">
      {/* 头部 */}
      <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 text-white shadow-lg">
        <div className="max-w-2xl mx-auto px-4 pt-12 pb-6">
          <div className="flex items-center mb-6">
            <button onClick={() => navigate(-1)} className="mr-3 p-1 rounded-full hover:bg-white/20 transition-colors">
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <h1 className="text-2xl font-bold">{t('coupon.title')}</h1>
          </div>
          
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-4">
            <motion.div 
              whileHover={{ scale: 1.02 }} 
              className="bg-white/20 backdrop-blur-md rounded-2xl p-4 border border-white/10"
            >
              <div className="flex items-center space-x-2 mb-1">
                <TicketIcon className="w-5 h-5 opacity-80" />
                <span className="text-sm opacity-80">{t('coupon.validCount', { count: validCount })}</span>
              </div>
              <p className="text-3xl font-black">{validCount}</p>
            </motion.div>
            <motion.div 
              whileHover={{ scale: 1.02 }} 
              className="bg-white/20 backdrop-blur-md rounded-2xl p-4 border border-white/10"
            >
              <div className="flex items-center space-x-2 mb-1">
                <GiftIcon className="w-5 h-5 opacity-80" />
                <span className="text-sm opacity-80">{t('coupon.totalSaved')}</span>
              </div>
              <p className="text-3xl font-black">{totalSaved} TJS</p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex space-x-6 py-3">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center space-x-1.5 whitespace-nowrap transition-all pb-1 ${
                  activeTab === tab.key
                    ? 'text-orange-600 font-semibold'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key
                    ? 'bg-orange-100 text-orange-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {tab.count}
                </span>
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="couponTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 抵扣券列表 */}
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin"></div>
          </div>
        ) : currentCoupons.length === 0 ? (
          <div className="text-center py-16">
            <picture>
              <source srcSet="/brand/empty_cart.webp" type="image/webp" />
              <img 
                src="/brand/empty_cart.png" 
                alt="No coupons"
                className="w-32 h-32 mx-auto mb-4 opacity-80"
                style={{ objectFit: 'contain' }}
              />
            </picture>
            <p className="text-gray-500 font-medium">{t('coupon.noCoupons')}</p>
            <p className="text-gray-400 text-sm mt-2">{t('coupon.noCouponsHint')}</p>
          </div>
        ) : (
          currentCoupons.map((coupon, index) => (
            <motion.div
              key={coupon.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`relative overflow-hidden rounded-2xl shadow-sm ${
                isCouponActive(coupon)
                  ? 'bg-white border border-orange-100'
                  : 'bg-gray-50 border border-gray-200 opacity-70'
              }`}
            >
              <div className="flex">
                {/* 左侧金额区域 */}
                <div className={`flex-shrink-0 w-24 flex flex-col items-center justify-center py-4 ${
                  isCouponActive(coupon)
                    ? 'bg-gradient-to-b from-orange-500 to-amber-500 text-white'
                    : 'bg-gray-300 text-white'
                }`}>
                  <span className="text-3xl font-black">{coupon.amount}</span>
                  <span className="text-xs mt-0.5 opacity-90">TJS</span>
                </div>
                
                {/* 右侧信息区域 */}
                <div className="flex-1 p-3 pl-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{t('coupon.noThreshold')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {getSourceLabel(coupon.source)}
                      </p>
                    </div>
                    {/* 状态标签 */}
                    {coupon.status === 'USED' ? (
                      <span className="flex items-center text-xs text-gray-400">
                        <CheckCircleIcon className="w-4 h-4 mr-0.5" />
                        {t('coupon.used')}
                      </span>
                    ) : (coupon.status === 'EXPIRED' || new Date(coupon.expires_at) <= new Date()) ? (
                      <span className="flex items-center text-xs text-gray-400">
                        <XCircleIcon className="w-4 h-4 mr-0.5" />
                        {t('coupon.expired')}
                      </span>
                    ) : null}
                  </div>
                  
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center text-xs text-gray-400">
                      <ClockIcon className="w-3.5 h-3.5 mr-1" />
                      {t('coupon.validUntil', { date: formatDate(coupon.expires_at) })}
                    </div>
                    {isCouponActive(coupon) && (
                      <button
                        onClick={() => navigate('/')}
                        className="text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors"
                      >
                        {t('coupon.useNow')} →
                      </button>
                    )}
                  </div>
                </div>
              </div>
              
              {/* 锯齿装饰 - 模拟真实优惠券效果 */}
              <div className="absolute left-[92px] top-0 bottom-0 flex flex-col justify-around">
                {[...Array(6)].map((_, i) => (
                  <div 
                    key={i} 
                    className={`w-2 h-2 rounded-full -ml-1 ${
                      isCouponActive(coupon)
                        ? 'bg-orange-50'
                        : 'bg-gray-50'
                    }`}
                  />
                ))}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};

export default CouponListPage;
