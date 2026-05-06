/**
 * B2B 进货单（购物车）页面
 * Phase 4: 前端核心展示层
 *
 * 功能：
 * - 展示购物车商品列表
 * - 修改数量 / 删除商品
 * - 显示合计金额
 * - 提交订单（调用 b2b-checkout edge function）
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, TrashIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useB2BCart, useB2BCartMutations } from '../hooks/useB2B';
import { useUser } from '../contexts/UserContext';
import { useSupabase } from '../contexts/SupabaseContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { LazyImage } from '../components/LazyImage';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';

export default function B2BCartPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, sessionToken } = useUser();
  const { supabase } = useSupabase();
  const { data: cartItems, isLoading } = useB2BCart();
  const { upsertItem, removeItem, clearCart } = useB2BCartMutations();

  const [checkoutMode, setCheckoutMode] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const totalAmount = cartItems?.reduce((sum, item) => sum + item.wholesale_price * item.quantity, 0) || 0;
  const totalItems = cartItems?.reduce((sum, item) => sum + item.quantity, 0) || 0;

  const handleQuantityChange = async (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      await removeItem.mutateAsync(productId);
    } else {
      await upsertItem.mutateAsync({ productId, quantity: newQuantity });
    }
  };

  const handleRemove = async (productId: string) => {
    try {
      await removeItem.mutateAsync(productId);
      toast.success('已移除');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCheckout = async () => {
    if (!user || !sessionToken) {
      toast.error('请先登录');
      navigate('/login');
      return;
    }
    if (!deliveryAddress.trim()) {
      toast.error(t('b2b.deliveryAddress') + ' 不能为空');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('b2b-checkout', {
        method: 'POST',
        body: {
          delivery_address: deliveryAddress.trim(),
          delivery_note: deliveryNote.trim() || null,
          payment_method: 'cod',
        },
        headers: { 'x-session-token': sessionToken },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));

      toast.success(t('b2b.orderSuccess'));
      // Invalidate cart
      clearCart.mutate();
      // Navigate to orders
      navigate('/b2b/orders');
    } catch (err: any) {
      toast.error(err.message || '下单失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeftIcon className="w-5 h-5 text-gray-700" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 flex-1">
          {t('b2b.cart')} {cartItems?.length ? `(${cartItems.length})` : ''}
        </h1>
        {cartItems && cartItems.length > 0 && !checkoutMode && (
          <button
            onClick={() => {
              if (confirm('清空进货单？')) clearCart.mutate();
            }}
            className="text-xs text-red-500"
          >
            清空
          </button>
        )}
      </div>

      {/* Cart Items */}
      {!cartItems || cartItems.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🛒</div>
          <p className="text-gray-500 mb-4">{t('b2b.cartEmpty')}</p>
          <button
            onClick={() => navigate('/b2b')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
          >
            {t('b2b.home')}
          </button>
        </div>
      ) : checkoutMode ? (
        /* Checkout Form */
        <div className="px-4 pt-4 space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">订单确认</h3>
            <div className="text-sm text-gray-600 mb-2">
              共 {cartItems.length} 种商品，{totalItems} 件
            </div>
            <div className="text-lg font-bold text-blue-700">
              {t('b2b.totalAmount')}: TJS {totalAmount.toFixed(2)}
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('b2b.deliveryAddress')} *
              </label>
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm h-20 resize-none focus:ring-2 focus:ring-blue-200 focus:outline-none"
                placeholder="请输入收货地址"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('b2b.deliveryNote')}
              </label>
              <input
                type="text"
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
                placeholder="备注信息（可选）"
              />
            </div>
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
              支付方式：货到付款（COD）
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setCheckoutMode(false)}
              className="flex-1 py-3 border rounded-xl text-sm font-medium text-gray-700"
            >
              返回修改
            </button>
            <button
              onClick={handleCheckout}
              disabled={submitting}
              className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? '提交中...' : t('b2b.checkout')}
            </button>
          </div>
        </div>
      ) : (
        /* Cart List */
        <div className="px-4 pt-3 space-y-2.5">
          {cartItems.map((item) => (
            <div key={item.id} className="bg-white rounded-xl p-3 shadow-sm flex gap-3">
              {/* Image */}
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                {item.product_image ? (
                  <LazyImage
                    src={item.product_image}
                    alt={item.product_name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">📦</div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-gray-900 line-clamp-1">{item.product_name}</h4>
                <div className="text-sm font-bold text-blue-700 mt-0.5">
                  TJS {Number(item.wholesale_price).toFixed(2)}
                  <span className="text-xs text-gray-400 font-normal ml-1">/{item.unit_measure}</span>
                </div>

                {/* Quantity Controls */}
                <div className="flex items-center justify-between mt-1.5">
                  <div className="flex items-center border rounded overflow-hidden">
                    <button
                      onClick={() => handleQuantityChange(item.product_id, item.quantity - 1)}
                      className="px-2 py-1 text-gray-500 hover:bg-gray-50"
                    >
                      <MinusIcon className="w-3 h-3" />
                    </button>
                    <span className="px-2 py-1 text-xs font-bold min-w-[2rem] text-center border-x">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleQuantityChange(item.product_id, item.quantity + 1)}
                      disabled={item.quantity >= item.stock}
                      className="px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                    >
                      <PlusIcon className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      TJS {(item.wholesale_price * item.quantity).toFixed(2)}
                    </span>
                    <button
                      onClick={() => handleRemove(item.product_id)}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bottom Bar (only in cart list mode) */}
      {cartItems && cartItems.length > 0 && !checkoutMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-50 safe-area-bottom">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500">{totalItems} 件商品</div>
              <div className="text-lg font-bold text-blue-700">TJS {totalAmount.toFixed(2)}</div>
            </div>
            <button
              onClick={() => setCheckoutMode(true)}
              className="px-8 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold active:bg-blue-700"
            >
              {t('b2b.checkout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
