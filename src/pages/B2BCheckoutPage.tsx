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
import React, { useState, useMemo, useEffect } from 'react';
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
import { useB2BCart, useWholesalerProfile, useB2BCartMutations } from '../hooks/useB2B';
import { useUser } from '../contexts/UserContext';
import { useSupabase } from '../contexts/SupabaseContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { LazyImage } from '../components/LazyImage';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';

// ============================================================
// 订单成功弹窗组件
// ============================================================
interface OrderSuccessModalProps {
  isOpen: boolean;
  orderNumber: string;
  totalAmount: number;
  onViewOrder: () => void;
  onContinueShopping: () => void;
}

function OrderSuccessModal({ isOpen, orderNumber, totalAmount, onViewOrder, onContinueShopping }: OrderSuccessModalProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 mx-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in duration-300">
        {/* Success Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircleIcon className="w-10 h-10 text-green-600" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-lg font-bold text-gray-900 text-center mb-1">
          {t('b2b.orderSuccess') || '下单成功！'}
        </h2>
        <p className="text-sm text-gray-500 text-center mb-4">
          {t('b2b.orderSubmittedWaiting') || '订单已提交，等待配送'}
        </p>

        {/* Order Info */}
        <div className="bg-gray-50 rounded-xl p-3 mb-5 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{t('b2b.orderNumber') || '订单号'}</span>
            <span className="font-mono text-gray-900 text-xs">{orderNumber}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{t('b2b.orderAmount') || '订单金额'}</span>
            <span className="font-bold text-primary">TJS {totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{t('b2b.paymentMethod') || '支付方式'}</span>
            <span className="text-gray-700">{t('b2b.codPayment') || '货到付款'}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2.5">
          <button
            onClick={onViewOrder}
            className="w-full py-3 bg-primary text-white rounded-xl text-sm font-semibold active:bg-primary-dark transition-colors"
          >
            {t('b2b.viewOrder') || '查看订单'}
          </button>
          <button
            onClick={onContinueShopping}
            className="w-full py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium active:bg-gray-50 transition-colors"
          >
            {t('b2b.continueShopping') || '继续进货'}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  // 表单状态
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addressEditing, setAddressEditing] = useState(false);

  // 订单成功弹窗状态
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [successOrderNumber, setSuccessOrderNumber] = useState('');
  const [successTotalAmount, setSuccessTotalAmount] = useState(0);

  // 初始化地址：优先使用批发商注册的配送地址；没有批发商资料时也允许用户手动填写。
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
      const { data, error } = await supabase.functions.invoke('b2b-checkout', {
        method: 'POST',
        body: {
          delivery_address: deliveryAddress.trim(),
          delivery_note: deliveryNote.trim() || null,
        },
        headers: { 'x-session-token': sessionToken },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));

      if (data?.success) {
        // 清空购物车缓存
        clearCart.mutate();
        // 显示成功弹窗
        setSuccessOrderNumber(data.order?.order_number || '');
        setSuccessTotalAmount(data.order?.total_amount || summary.totalAmount);
        setOrderSuccess(true);
      } else {
        throw new Error(data?.error || t('b2b.orderFailed', '下单失败'));
      }
    } catch (err: any) {
      toast.error(err.message || t('b2b.orderFailed', '下单失败，请重试'));
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
                {t('b2b.orderItemTypes', '共')} {summary.totalItems} {t('b2b.orderItemTypes', '种')}，{summary.totalQuantity} {t('b2b.orderItemPieces', '件')}
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

      {/* 订单成功弹窗 */}
      <OrderSuccessModal
        isOpen={orderSuccess}
        orderNumber={successOrderNumber}
        totalAmount={successTotalAmount}
        onViewOrder={() => navigate('/b2b/orders')}
        onContinueShopping={() => navigate('/b2b')}
      />
    </div>
  );
}
