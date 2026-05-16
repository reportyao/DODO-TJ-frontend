/**
 * B2B 结算确认页
 * Phase 5: 前端交易链路
 *
 * 功能：
 * - 展示订单商品明细（从购物车传入或重新获取）
 * - 填写/确认收货地址（默认使用批发商注册地址）
 * - 填写配送备注
 * - 展示支付方式（货到付款 COD）
 * - 确认下单（调用 b2b-checkout Edge Function）
 * - 下单成功后跳转到订单详情页
 *
 * 路由: /b2b/checkout
 * 依赖: useB2BCart, useWholesalerProfile, b2b-checkout Edge Function
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon,
  MapPinIcon,
  TruckIcon,
  BanknotesIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useB2BCart, useWholesalerProfile, useB2BCartMutations, getLatestGiftWithPurchaseState, GiftProductOption } from '../hooks/useB2B';
import { useUser } from '../contexts/UserContext';
import { useSupabase } from '../contexts/SupabaseContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { LazyImage } from '../components/LazyImage';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';

function getGiftProductName(item: GiftProductOption, lang = 'ru'): string {
  const name = item.name_i18n?.[lang] || item.name_i18n?.ru || item.name_i18n?.zh || item.name_i18n?.tg;
  return name || item.product_name || '赠品';
}

// ============================================================
// 订单成功弹窗组件
// ============================================================
// ============================================================
// 主页面组件
// ============================================================
export default function B2BCheckoutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, sessionToken } = useUser();
  const { supabase } = useSupabase();
  const { data: cartItems, isLoading: cartLoading } = useB2BCart();
  const { data: wholesalerProfile, isLoading: profileLoading } = useWholesalerProfile();
  const { clearCart } = useB2BCartMutations();
  const giftWithPurchase = getLatestGiftWithPurchaseState();
  const selectedGift = useMemo<GiftProductOption | null>(() => {
    if (!giftWithPurchase?.eligible) return null;
    const selectedGiftProductId = localStorage.getItem('b2b_selected_gift_product_id');
    return giftWithPurchase.gift_products.find((gift) => gift.product_id === selectedGiftProductId) || null;
  }, [giftWithPurchase]);

  // 表单状态
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addressEditing, setAddressEditing] = useState(false);
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);

  // 初始化地址：优先使用批发商注册的配送地址；没有批发商资料时也允许用户手动填写。
  useEffect(() => {
    if (profileLoading) {
      return;
    }

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
          selected_gift_product_id: selectedGift?.product_id || null,
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

        // b2b-checkout 服务端已经完成购物车清空；这里仅触发缓存刷新，避免用户返回时看到旧购物车。
        clearCart.mutate();

        // 下单成功后进入订单列表页，而不是留在已清空的结算页。
        // 订单列表保留全局底部导航，并展示成功提示与新订单高亮，用户可以继续进货或查看订单状态。
        checkoutIdempotencyKeyRef.current = null;

        navigate(`/b2b/orders?created=${encodeURIComponent(createdOrder.id || '')}`, {
          replace: true,
          state: {
            checkoutSuccess: true,
            order: {
              id: createdOrder.id,
              order_number: createdOrder.order_number,
              total_amount: createdOrder.total_amount ?? summary.totalAmount,
              item_count: createdOrder.item_count ?? (summary.totalItems + (selectedGift ? 1 : 0)),
              total_quantity: createdOrder.total_quantity ?? (summary.totalQuantity + (selectedGift ? selectedGift.gift_quantity : 0)),
              gift: createdOrder.gift || (selectedGift ? { product_id: selectedGift.product_id, quantity: selectedGift.gift_quantity } : null),
            },
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

  // Loading 状态
  if (cartLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">{t('b2b.loadingOrder', '加载订单信息...')}</p>
        </div>
      </div>
    );
  }

  // 购物车为空时重定向
  if (!cartItems || cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <div className="text-5xl mb-4">🛒</div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('b2b.cartEmpty', '购物车为空')}</h2>
        <p className="text-sm text-gray-500 mb-6 text-center">{t('b2b.addProductsFirst', '请先添加商品到购物车')}</p>
        <button
          onClick={() => navigate('/b2b')}
          className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-medium"
        >
          {t('b2b.home')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-100">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1">
            <ArrowLeftIcon className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-base font-semibold text-gray-900">{t('b2b.confirmOrder', '确认订单')}</h1>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* ============================================================ */}
        {/* 收货地址 */}
        {/* ============================================================ */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-50">
            <MapPinIcon className="w-4 h-4 text-primary flex-shrink-0" />
            <h3 className="text-sm font-semibold text-gray-900">{t('b2b.deliveryAddress', '收货地址')}</h3>
            <button
              onClick={() => setAddressEditing(!addressEditing)}
              className="ml-auto text-xs text-primary font-medium"
            >
              {addressEditing ? t('b2b.done', '完成') : t('b2b.edit', '修改')}
            </button>
          </div>
          <div className="px-4 py-3">
            {addressEditing ? (
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none resize-none"
                placeholder={t('b2b.addressPlaceholder', '请输入详细收货地址...')}
              />
            ) : (
              <div className="text-sm text-gray-700">
                {deliveryAddress || (
                  <span className="text-red-500 flex items-center gap-1">
                    <ExclamationTriangleIcon className="w-4 h-4" />
                    {t('b2b.pleaseEnterAddress', '请填写收货地址')}
                  </span>
                )}
              </div>
            )}
            {wholesalerProfile?.company_name && (
              <div className="text-xs text-gray-400 mt-1.5">
                {wholesalerProfile.company_name}
                {wholesalerProfile.contact_phone && ` · ${wholesalerProfile.contact_phone}`}
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* 商品清单 */}
        {/* ============================================================ */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-50">
            <DocumentTextIcon className="w-4 h-4 text-primary flex-shrink-0" />
            <h3 className="text-sm font-semibold text-gray-900">
              {t('b2b.productList', '商品清单')}
              <span className="text-xs font-normal text-gray-400 ml-1.5">
                ({summary.totalItems}{t('b2b.orderItemTypes', '种')} · {summary.totalQuantity}{t('b2b.orderItemPieces', '件')})
              </span>
            </h3>
          </div>
          <div className="divide-y divide-gray-50">
            {cartItems.map((item) => (
              <div key={item.id} className="px-4 py-3 flex gap-3">
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {item.product_image ? (
                    <LazyImage
                      src={item.product_image}
                      alt={item.product_name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📦</div>
                  )}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm text-gray-900 line-clamp-1">{item.product_name}</h4>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">
                      TJS {Number(item.wholesale_price).toFixed(2)} × {item.quantity}{item.unit_measure}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">
                      TJS {(item.wholesale_price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {selectedGift && (
              <div className="px-4 py-3 flex gap-3 bg-amber-50/60">
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-amber-100 flex-shrink-0">
                  {selectedGift.image_url ? (
                    <LazyImage
                      src={selectedGift.image_url}
                      alt={getGiftProductName(selectedGift)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-amber-500 text-lg">🎁</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white">赠品</span>
                    <h4 className="text-sm text-gray-900 line-clamp-1">{getGiftProductName(selectedGift)}</h4>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">满额赠送 × {selectedGift.gift_quantity}{selectedGift.unit_measure || '件'}</span>
                    <span className="text-sm font-semibold text-amber-600">TJS 0.00</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* 配送方式 */}
        {/* ============================================================ */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-50">
            <TruckIcon className="w-4 h-4 text-primary flex-shrink-0" />
            <h3 className="text-sm font-semibold text-gray-900">{t('b2b.deliveryMethod', '配送方式')}</h3>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{t('b2b.merchantDelivery', '商家配送')}</span>
              <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">{t('b2b.freeShipping', '免运费')}</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">{t('b2b.deliveryEstimate', '预计1-3个工作日送达')}</p>
          </div>
        </div>

        {/* ============================================================ */}
        {/* 支付方式 */}
        {/* ============================================================ */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-50">
            <BanknotesIcon className="w-4 h-4 text-primary flex-shrink-0" />
            <h3 className="text-sm font-semibold text-gray-900">{t('b2b.paymentMethod', '支付方式')}</h3>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{t('b2b.codPayment', '货到付款（COD）')}</span>
              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <CheckCircleIcon className="w-4 h-4 text-white" />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">{t('b2b.codDescription', '收货时向配送员支付货款')}</p>
          </div>
        </div>

        {/* ============================================================ */}
        {/* 备注 */}
        {/* ============================================================ */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3">
            <label className="text-sm font-medium text-gray-700 mb-2 block">{t('b2b.orderNote', '订单备注（选填）')}</label>
            <input
              type="text"
              value={deliveryNote}
              onChange={(e) => setDeliveryNote(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
              placeholder={t('b2b.notePlaceholder', '如有特殊要求请在此备注...')}
            />
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 底部结算栏 */}
      {/* ============================================================ */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom">
        <div className="px-4 py-3">
          {/* Price Summary */}
          <div className="flex items-center justify-between mb-3">
            <div className="space-y-0.5">
              <div className="text-xs text-gray-500">
                {t('b2b.orderItemTypes', '共')} {summary.totalItems + (selectedGift ? 1 : 0)} {t('b2b.orderItemTypes', '种')}，{summary.totalQuantity + (selectedGift ? selectedGift.gift_quantity : 0)} {t('b2b.orderItemPieces', '件')}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xs text-gray-500">{t('b2b.totalAmount', '合计')}:</span>
                <span className="text-xl font-bold text-primary">
                  TJS {summary.totalAmount.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          {/* Submit Button */}
          <button
            onClick={handleSubmitOrder}
            disabled={submitting || !deliveryAddress.trim()}
            className={cn(
              'w-full py-3.5 rounded-xl text-sm font-semibold transition-all',
              submitting || !deliveryAddress.trim()
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-primary text-white active:bg-primary-dark shadow-lg shadow-primary/20'
            )}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t('b2b.submitting', '提交中...')}
              </span>
            ) : (
              `${t('b2b.confirmOrder', '确认下单')} · TJS ${summary.totalAmount.toFixed(2)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
