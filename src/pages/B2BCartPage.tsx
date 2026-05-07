/**
 * B2B 进货单（购物车）页面
 * Phase 5: 前端交易链路
 *
 * 功能：
 * - 展示购物车商品列表
 * - 修改数量 / 删除商品（遵守 min_order_quantity 约束）
 * - 显示合计金额和商品数
 * - 点击"去结算"跳转到 B2BCheckoutPage
 *
 * 路由: /b2b/cart
 * 依赖: useB2BCart, useB2BCartMutations
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon,
  TrashIcon,
  MinusIcon,
  PlusIcon,
  ShoppingCartIcon,
} from '@heroicons/react/24/outline';
import { useB2BCart, useB2BCartMutations, CartItem } from '../hooks/useB2B';
import { LazyImage } from '../components/LazyImage';
import toast from 'react-hot-toast';

/**
 * 获取购物车商品的本地化名称
 */
function getCartItemName(item: CartItem, lang: string): string {
  if (item.name_i18n) {
    const name = item.name_i18n[lang as keyof typeof item.name_i18n]
      || item.name_i18n.ru
      || item.name_i18n.zh
      || item.name_i18n.tg;
    if (name) return name;
  }
  return item.product_name || '商品';
}

export default function B2BCartPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'ru';
  const { data: cartItems, isLoading } = useB2BCart();
  const { updateItem, removeItem, clearCart } = useB2BCartMutations();

  // 汇总计算
  const totalAmount = cartItems?.reduce((sum, item) => sum + item.wholesale_price * item.quantity, 0) || 0;
  const totalItems = cartItems?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const productCount = cartItems?.length || 0;

  // 修改数量（遵守 min_order_quantity 约束）
  const handleQuantityChange = async (productId: string, newQuantity: number, minOrderQty: number) => {
    try {
      if (newQuantity < minOrderQty) {
        // 如果减少到低于最小起批量，则移除商品
        await removeItem.mutateAsync(productId);
        toast.success(t('b2b.removed') || '已移除');
      } else {
        await updateItem.mutateAsync({ productId, quantity: newQuantity });
      }
    } catch (err: any) {
      toast.error(err.message || (t('b2b.operationFailed') || '操作失败'));
    }
  };

  // 删除商品
  const handleRemove = async (productId: string) => {
    try {
      await removeItem.mutateAsync(productId);
      toast.success(t('b2b.removed') || '已移除');
    } catch (err: any) {
      toast.error(err.message || (t('b2b.operationFailed') || '删除失败'));
    }
  };

  // 清空购物车
  const handleClearCart = () => {
    if (!cartItems || cartItems.length === 0) return;
    if (confirm(t('b2b.confirmClearCart') || '确定清空进货单？')) {
      clearCart.mutate();
    }
  };

  // Loading 状态
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 空购物车
  if (!cartItems || cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="sticky top-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1">
            <ArrowLeftIcon className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-base font-semibold text-gray-900">{t('b2b.cart')}</h1>
        </div>
        {/* Empty State */}
        <div className="flex flex-col items-center justify-center pt-24 px-6">
          <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <ShoppingCartIcon className="w-10 h-10 text-gray-300" />
          </div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">{t('b2b.cartEmpty')}</h2>
          <p className="text-sm text-gray-400 mb-6 text-center">{t('b2b.goShoppingHint') || '去进货大厅挑选商品吧'}</p>
          <button
            onClick={() => navigate('/b2b')}
            className="px-8 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium active:bg-blue-700"
          >
            {t('b2b.goShopping') || '去进货'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1">
            <ArrowLeftIcon className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-base font-semibold text-gray-900">
            {t('b2b.cart')}
            <span className="text-xs font-normal text-gray-400 ml-1.5">({productCount})</span>
          </h1>
        </div>
        {/* Clear Cart Button */}
        <button
          onClick={handleClearCart}
          className="text-xs text-red-500 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
        >
          {t('b2b.clearCart') || '清空'}
        </button>
      </div>

      {/* Cart Items */}
      <div className="px-4 pt-3 space-y-2.5">
        {cartItems.map((item) => {
          const minQty = item.min_order_quantity || 1;
          return (
            <div key={item.id} className="bg-white rounded-xl p-3 shadow-sm">
              <div className="flex gap-3">
                {/* Product Image */}
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {item.product_image ? (
                    <LazyImage
                      src={item.product_image}
                      alt={getCartItemName(item, lang)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">📦</div>
                  )}
                </div>

                {/* Product Info */}
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 line-clamp-1">{getCartItemName(item, lang)}</h4>
                  <div className="text-sm font-bold text-blue-700 mt-0.5">
                    TJS {Number(item.wholesale_price).toFixed(2)}
                    <span className="text-xs text-gray-400 font-normal ml-1">/{item.unit_measure}</span>
                  </div>

                  {/* Quantity Controls & Actions */}
                  <div className="flex items-center justify-between mt-2">
                    {/* Quantity Stepper - 步进为 min_order_quantity */}
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => handleQuantityChange(item.product_id, item.quantity - minQty, minQty)}
                        className="px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                      >
                        <MinusIcon className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-3 py-1.5 text-xs font-bold min-w-[2.5rem] text-center border-x border-gray-200 bg-gray-50">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleQuantityChange(item.product_id, item.quantity + minQty, minQty)}
                        disabled={item.quantity + minQty > item.stock}
                        className="px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Subtotal & Delete */}
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-gray-900">
                        TJS {(item.wholesale_price * item.quantity).toFixed(2)}
                      </span>
                      <button
                        onClick={() => handleRemove(item.product_id)}
                        className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Stock Warning */}
                  {item.stock <= 10 && (
                    <div className="text-[10px] text-orange-500 mt-1">
                      {t('b2b.stockLow') || '仅剩'} {item.stock} {item.unit_measure}
                    </div>
                  )}
                  {/* Unavailable Warning */}
                  {!item.is_available && (
                    <div className="text-[10px] text-red-500 mt-1">
                      {t('b2b.productUnavailable') || '商品已下架'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Checkout Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom">
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Summary */}
          <div>
            <div className="text-xs text-gray-500">
              {productCount} {t('b2b.orderItemTypes') || '种'} · {totalItems} {t('b2b.orderItemPieces') || '件'}
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-xs text-gray-500">{t('b2b.totalAmount') || '合计'}</span>
              <span className="text-lg font-bold text-blue-700">TJS {totalAmount.toFixed(2)}</span>
            </div>
          </div>
          {/* Checkout Button - Navigate to dedicated checkout page */}
          <button
            onClick={() => navigate('/b2b/checkout')}
            className="px-8 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold active:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all"
          >
            {t('b2b.checkout') || '去结算'}
          </button>
        </div>
      </div>
    </div>
  );
}
