import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon,
  MapPinIcon,
  TruckIcon,
  BanknotesIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useB2BCart, useWholesalerProfile, useB2BCartMutations, GiftProductOption } from '../hooks/useB2B';
import { useUser } from '../contexts/UserContext';
import { useSupabase } from '../contexts/SupabaseContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { LazyImage } from '../components/LazyImage';
import toast from 'react-hot-toast';

function getGiftProductNameFn(item: GiftProductOption, lang = 'ru'): string {
  const name = item.name_i18n?.[lang] || item.name_i18n?.ru || item.name_i18n?.zh || item.name_i18n?.tg;
  return name || item.product_name || '';
}

export default function B2BCheckoutPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'ru';
  const navigate = useNavigate();
  const { user, sessionToken } = useUser();
  const { supabase } = useSupabase();
  const { data: cartData, isLoading: cartLoading } = useB2BCart();
  const { data: wholesalerProfile, isLoading: profileLoading } = useWholesalerProfile();
  const { clearCart } = useB2BCartMutations();

  const cartItems = cartData?.items || [];
  const giftState = cartData?.gift_with_purchase;

  // 获取多档位已选赠品
  const selectedGifts = useMemo<GiftProductOption[]>(() => {
    if (!giftState || !giftState.rules) return [];
    try {
      const saved = localStorage.getItem('b2b_selected_gift_ids');
      if (!saved) return [];
      const selectedMap = JSON.parse(saved) as Record<string, string>;
      
      return giftState.rules.map(rule => {
        const selectedId = selectedMap[rule.rule_id];
        return rule.gift_products.find(p => p.product_id === selectedId);
      }).filter((p): p is GiftProductOption => !!p);
    } catch (e) {
      return [];
    }
  }, [giftState]);

  // 表单状态
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addressEditing, setAddressEditing] = useState(false);
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);

  // 初始化地址
  useEffect(() => {
    if (profileLoading) return;
    if (wholesalerProfile?.delivery_address && !deliveryAddress) {
      setDeliveryAddress(wholesalerProfile.delivery_address);
      return;
    }
    if (!deliveryAddress) {
      setAddressEditing(true);
    }
  }, [wholesalerProfile, profileLoading, deliveryAddress]);

  // 计算汇总数据
  const summary = useMemo(() => {
    if (!cartItems || cartItems.length === 0) {
      return { totalAmount: 0, totalItems: 0, totalQuantity: 0 };
    }
    return {
      totalAmount: cartItems.reduce((sum, item) => sum + item.wholesale_price * item.quantity, 0),
      totalItems: cartItems.length,
      totalQuantity: cartItems.reduce((sum, item) => sum + item.quantity, 0),
    };
  }, [cartItems]);

  // 提交订单
  const handleSubmitOrder = async () => {
    if (!user || !sessionToken) {
      toast.error(t('b2b.pleaseLogin', '请先登录'));
      navigate('/login');
      return;
    }

    if (!deliveryAddress.trim()) {
      toast.error(t('b2b.pleaseEnterAddress', '请填写收货地址'));
      return;
    }

    if (!cartItems || cartItems.length === 0) {
      toast.error(t('b2b.cartEmpty', '购物车为空'));
      return;
    }

    setSubmitting(true);
    try {
      if (!checkoutIdempotencyKeyRef.current) {
        checkoutIdempotencyKeyRef.current = `b2b-checkout-${user.id}-${Date.now()}-${crypto.randomUUID()}`;
      }

      const idempotencyKey = checkoutIdempotencyKeyRef.current;
      const { data, error } = await supabase.functions.invoke('b2b-checkout', {
        method: 'POST',
        body: {
          delivery_address: deliveryAddress.trim(),
          delivery_note: deliveryNote.trim() || null,
          selected_gift_product_ids: selectedGifts.map(g => g.product_id),
          idempotency_key: idempotencyKey,
        },
        headers: {
          'x-session-token': sessionToken,
          'Idempotency-Key': idempotencyKey,
        },
      });

      if (error) {
        throw new Error(await extractEdgeFunctionError(error));
      }

      if (data?.success) {
        const createdOrder = data.order || {};
        clearCart.mutate();
        localStorage.removeItem('b2b_selected_gift_ids');
        checkoutIdempotencyKeyRef.current = null;

        navigate(`/b2b/orders?created=${encodeURIComponent(createdOrder.id || '')}`, {
          replace: true,
          state: {
            checkoutSuccess: true,
            order: createdOrder
          },
        });
      } else {
        throw new Error(data?.error || t('b2b.orderFailed', '下单失败'));
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('b2b.orderFailed', '下单失败，请重试');
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  if (cartLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!cartItems || cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <h2 className="text-lg font-bold text-gray-900 mb-2">{t('b2b.cartEmpty', '购物车为空')}</h2>
        <button onClick={() => navigate('/b2b')} className="bg-orange-500 text-white px-6 py-2 rounded-full font-bold">
          {t('b2b.home', '回首页')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <div className="sticky top-0 z-40 bg-white border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeftIcon className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-bold text-gray-900">{t('b2b.confirmOrder', '确认订单')}</h1>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* 收货地址 */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-gray-900">
              <MapPinIcon className="w-5 h-5 text-orange-500" />
              {t('b2b.deliveryAddress', '收货地址')}
            </div>
            <button onClick={() => setAddressEditing(!addressEditing)} className="text-sm text-orange-500 font-bold">
              {addressEditing ? t('b2b.done', '完成') : t('b2b.edit', '修改')}
            </button>
          </div>
          {addressEditing ? (
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              rows={3}
              className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none"
              placeholder={t('b2b.addressPlaceholder', '请输入详细收货地址...')}
            />
          ) : (
            <div className="text-sm text-gray-700 leading-relaxed">
              {deliveryAddress || <span className="text-red-500">{t('b2b.pleaseEnterAddress', '请填写收货地址')}</span>}
            </div>
          )}
        </div>

        {/* 商品清单 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-gray-900">
              <DocumentTextIcon className="w-5 h-5 text-orange-500" />
              {t('b2b.productList', '商品清单')}
            </div>
            <span className="text-xs text-gray-400 font-medium">
              {summary.totalItems} {t('b2b.types', '种')} · {summary.totalQuantity} {t('b2b.pieces', '件')}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {cartItems.map((item) => (
              <div key={item.id} className="p-4 flex gap-3">
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-50 flex-shrink-0 border border-gray-50">
                  <LazyImage src={item.product_image} alt={item.product_name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 line-clamp-1">{item.product_name}</h4>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-500 font-medium">
                      TJS {item.wholesale_price.toFixed(2)} × {item.quantity}{item.unit_measure}
                    </span>
                    <span className="text-sm font-black text-gray-900">
                      TJS {(item.wholesale_price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {/* 叠加赠品展示 */}
            {selectedGifts.map((gift) => (
              <div key={gift.product_id} className="p-4 flex gap-3 bg-orange-50/30">
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-white flex-shrink-0 border border-orange-100">
                  <LazyImage src={gift.image_url} alt={getGiftProductNameFn(gift, lang)} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500 text-white uppercase tracking-wider">{t('b2b.giftBadge', '赠品')}</span>
                    <h4 className="text-sm font-bold text-gray-900 line-clamp-1">{getGiftProductNameFn(gift, lang)}</h4>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-500 font-medium">
                      {t('b2b.giftFreeLabel', '免费赠送')} × {gift.gift_quantity}{gift.unit_measure || t('b2b.pieces', '件')}
                    </span>
                    <span className="text-sm font-black text-green-600 uppercase tracking-widest">{t('b2b.freeGiftPrice', '免费')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 配送与支付 */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-gray-900">
              <TruckIcon className="w-5 h-5 text-orange-500" />
              {t('b2b.deliveryMethod', '配送方式')}
            </div>
            <span className="text-sm text-gray-700 font-medium">{t('b2b.deliveryCOD', '送货上门')}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-gray-900">
              <BanknotesIcon className="w-5 h-5 text-orange-500" />
              {t('b2b.paymentMethod', '支付方式')}
            </div>
            <span className="text-sm text-gray-700 font-medium">{t('b2b.paymentCOD', '货到付款')}</span>
          </div>
        </div>

        {/* 备注 */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h3 className="text-sm font-bold text-gray-900 mb-3">{t('b2b.deliveryNote', '配送备注')}</h3>
          <textarea
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
            rows={2}
            className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none"
            placeholder={t('b2b.notePlaceholder', '有什么想告诉配送员的吗？')}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-lg border-t pb-safe">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium">{t('b2b.totalAmount', '实付总计')}</span>
            <span className="text-xl font-black text-orange-600">TJS {summary.totalAmount.toFixed(2)}</span>
          </div>
          <button
            onClick={handleSubmitOrder}
            disabled={submitting}
            className="flex-1 bg-gradient-to-r from-orange-500 to-orange-600 text-white h-14 rounded-2xl font-bold text-lg shadow-xl shadow-orange-100 flex items-center justify-center disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {submitting ? <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div> : t('b2b.submitOrder', '提交订单')}
          </button>
        </div>
      </div>
    </div>
  );
}
