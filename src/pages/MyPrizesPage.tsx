import React, { useState, useEffect, useCallback } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  TrophyIcon,
  TruckIcon,
  ShoppingBagIcon,
  TicketIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import PhoneInput from '../components/ui/PhoneInput';
import { LazyImage } from '../components/LazyImage';
import { formatDateTime } from '../lib/utils';
import toast from 'react-hot-toast';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

interface Prize {
  id: string;
  lottery_id: string;
  lottery_period: string;
  lottery_title: string;
  lottery_image: string;
  winning_code: string;
  prize_value: number;
  status: 'PENDING' | 'SHIPPING' | 'SHIPPED' | 'RESOLD';
  won_at: string;
}

const MyPrizesPage: React.FC = () => {
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPrize, setSelectedPrize] = useState<Prize | null>(null);
  const [showShippingModal, setShowShippingModal] = useState(false);

  const loadPrizes = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!user) return;

      if (!sessionToken) {
        throw new Error('User not authenticated');
      }

	      const { data, error } = await supabase.functions.invoke('get-my-prizes', {
	        body: {
	          session_token: sessionToken,
	        },
	      });
	
	      if (error) throw new Error(await extractEdgeFunctionError(error));
	
	      const result = data as { success: boolean; data: any[]; error?: string };
	
	      if (result.success && result.data) {
        // 转换数据格式 (安全访问嵌套对象)
        const formattedPrizes: Prize[] = result.data.map((prize: any) => ({
          id: prize.id,
          lottery_id: prize.lottery_id,
          lottery_period: prize.lottery?.period || prize.period || '',
          lottery_title: prize.lottery?.title || prize.lottery?.title_i18n?.[i18n.language] || prize.lottery?.title_i18n?.tg || prize.prize_name || t('myPrizes.prize'),
          lottery_image: prize.lottery?.image_url || prize.prize_image || '',
          winning_code: prize.winning_code || '',
          prize_value: prize.prize_value || 0,
          status: prize.resale_listing ? 'RESOLD' : prize.shipping ? 'SHIPPING' : (prize.status || 'PENDING'),
          won_at: prize.won_at || prize.created_at
        }));
        setPrizes(formattedPrizes);
      } else {
        throw new Error(result.error || 'Failed to load prizes');
      }
    } catch (error) {
      console.error('Load prizes error:', error);
      toast.error(t('myPrizes.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [supabase, user, sessionToken, t, i18n.language]);

  useEffect(() => {
    loadPrizes();
  }, [loadPrizes]);

  const handleApplyShipping = (prize: Prize) => {
    setSelectedPrize(prize);
    setShowShippingModal(true);
  };

  const handleResell = (prize: Prize) => {
    navigate(`/market/create?prize_id=${prize.id}`);
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      PENDING: { text: t('myPrizes.statusPending'), color: 'bg-yellow-100 text-yellow-700' },
      SHIPPING: { text: t('myPrizes.statusShipping'), color: 'bg-amber-100 text-primary-dark' },
      SHIPPED: { text: t('myPrizes.statusDelivered'), color: 'bg-green-100 text-green-700' },
      RESOLD: { text: t('myPrizes.statusResold'), color: 'bg-gray-100 text-gray-700' }
    };
    const badge = badges[status as keyof typeof badges] || badges.PENDING;
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 头部 */}
      <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="flex items-center space-x-3 mb-4">
            <TrophyIcon className="w-8 h-8" />
            <h1 className="text-2xl font-bold">{t('profile.myPrizes')}</h1>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{prizes.length}</p>
              <p className="text-xs mt-1 opacity-90">{t('profile.totalPrizes')}</p>
            </div>
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{prizes.filter(p => p.status === 'PENDING').length}</p>
              <p className="text-xs mt-1 opacity-90">{t('profile.pendingPrizes')}</p>
            </div>
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">
                TJS{prizes.reduce((sum, p) => sum + p.prize_value, 0).toFixed(0)}
              </p>
              <p className="text-xs mt-1 opacity-90">{t('profile.totalValue')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {prizes.map((prize, index) => (
          <motion.div
            key={prize.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-sm"
          >
            <div className="flex space-x-4 mb-4">
              <div style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0, borderRadius: '0.75rem', overflow: 'hidden' }}>
                <LazyImage
                  src={prize.lottery_image}
                  alt={prize.lottery_title}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">{t('myPrizes.periodLabel')}: {prize.lottery_period}</span>
                  {getStatusBadge(prize.status)}
                </div>
                <h3 className="text-lg font-bold mb-2">{prize.lottery_title}</h3>
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <TicketIcon className="w-4 h-4" />
                  <span className="font-mono font-medium">{prize.winning_code}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <ClockIcon className="w-4 h-4" />
                <span>{formatDateTime(prize.won_at)}</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">{t('myPrizes.prizeValue')}</p>
                <p className="text-xl font-bold text-yellow-600">TJS{prize.prize_value.toFixed(2)}</p>
              </div>
            </div>

            {prize.status === 'PENDING' && (
              <div className="mt-4 pt-4 border-t flex space-x-3">
                <button
                  onClick={() => handleApplyShipping(prize)}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark transition-colors"
                >
                  <TruckIcon className="w-5 h-5" />
                  <span>{t('myPrizes.applyShipping')}</span>
                </button>
                <button
                  onClick={() => handleResell(prize)}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                >
                  <ShoppingBagIcon className="w-5 h-5" />
                  <span>{t('myPrizes.resell')}</span>
                </button>
              </div>
            )}
          </motion.div>
        ))}

        {prizes.length === 0 && (
          <div className="text-center py-12">
            <TrophyIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-2">{t('myPrizes.noPrizes')}</p>
            <button
              onClick={() => navigate('/lottery')}
              className="text-primary font-medium hover:underline"
            >
              {t('myPrizes.goToLottery')} →
            </button>
          </div>
        )}
      </div>

      {/* 发货地址模态框 */}
      {showShippingModal && selectedPrize && (
        <ShippingModal
          prize={selectedPrize}
          onClose={() => {
            setShowShippingModal(false);
            setSelectedPrize(null);
          }}
          onSuccess={() => {
            setShowShippingModal(false);
            setSelectedPrize(null);
            loadPrizes();
          }}
        />
      )}
    </div>
  );
};

// 发货地址模态框组件
const ShippingModal: React.FC<{
  prize: Prize;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ prize, onClose, onSuccess }) => {
  const { supabase } = useSupabase();
  const { sessionToken } = useUser();
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    recipient_name: '',
    phone: '',
    address: '',
    city: '',
    postal_code: '',
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // 调用 request-shipping Edge Function（使用自定义 session_token 认证）
      if (!sessionToken) {
        throw new Error(t('auth.loginRequired'));
      }

      const { data, error } = await supabase.functions.invoke('request-shipping', {
        body: {
          session_token: sessionToken,
          prize_id: prize.id,
          shipping_info: formData
        }
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));

      const result = data as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Failed to submit shipping request');
      }

      toast.success(t('myPrizes.shippingRequestSuccess'));
      onSuccess();
    } catch (error: any) {
      console.error('Shipping request error:', error);
      toast.error(error.message || t('myPrizes.shippingRequestError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-4">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{t('myPrizes.shippingTitle')}</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('myPrizes.recipientName')} *
            </label>
            <input
              type="text"
              required
              value={formData.recipient_name}
              onChange={(e) => setFormData({ ...formData, recipient_name: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder={t('myPrizes.recipientNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('myPrizes.phone')} *
            </label>
            <PhoneInput
              value={formData.phone}
              onChange={(val) => setFormData({ ...formData, phone: val })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('myPrizes.address')} *
            </label>
            <textarea
              required
              rows={3}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
              placeholder={t('myPrizes.addressPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('myPrizes.city')} *
              </label>
              <input
                type="text"
                required
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder={t('myPrizes.cityPlaceholder')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('myPrizes.postalCode')}
              </label>
              <input
                type="text"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="734000"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('myPrizes.notes')}
            </label>
            <textarea
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
              placeholder={t('myPrizes.notesPlaceholder')}
            />
          </div>

          <div className="pt-4 flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t('common.submitting') : t('common.confirmSubmit')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default MyPrizesPage;
