/**
 * B2B 进货单（购物车）页面
 * Phase 5: 前端交易链路
 *
 * 功能：
 * - 展示购物车商品列表
 * - 修改数量 / 删除商品（遵守 min_order_quantity 约束）
 * - 快选数量（10/50/100/200）+ 直接输入
 * - 满额赠送提示置顶在商品列表上方
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
  GiftIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useB2BCart, useB2BCartMutations, CartItem, getLatestGiftWithPurchaseState, GiftProductOption } from '../hooks/useB2B';
import { LazyImage } from '../components/LazyImage';
import toast from 'react-hot-toast';

/**
 * 获取购物车商品的本地化名称
 */
function getGiftProductName(item: GiftProductOption, lang: string): string {
  const name = item.name_i18n?.[lang] || item.name_i18n?.ru || item.name_i18n?.zh || item.name_i18n?.tg;
  return name || item.product_name || '';
}

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

/** 快选数量选项 */
const QUICK_QTY_OPTIONS = [10, 50, 100, 200];

export default function B2BCartPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'ru';
  const { data: cartItems, isLoading } = useB2BCart();
  const { updateItem, removeItem, clearCart } = useB2BCartMutations();
  const giftWithPurchase = getLatestGiftWithPurchaseState();
  const [selectedGiftProductId, setSelectedGiftProductId] = React.useState<string | null>(() => localStorage.getItem('b2b_selected_gift_product_id'));
  // 用于直接输入数量的编辑状态
  const [editingItemId, setEditingItemId] = React.useState<string | null>(null);
  const [editingValue, setEditingValue] = React.useState<string>('');

  // 汇总计算
  const totalAmount = cartItems?.reduce((sum, item) => sum + item.wholesale_price * item.quantity, 0) || 0;
  const totalItems = cartItems?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const productCount = cartItems?.length || 0;

  React.useEffect(() => {
    if (!giftWithPurchase?.eligible) {
      localStorage.removeItem('b2b_selected_gift_product_id');
      setSelectedGiftProductId(null);
      return;
    }
    const stillAvailable = giftWithPurchase.gift_products.some((gift) => gift.product_id === selectedGiftProductId);
    if (!stillAvailable) {
      const fallback = giftWithPurchase.gift_products[0]?.product_id || null;
      setSelectedGiftProductId(fallback);
      if (fallback) localStorage.setItem('b2b_selected_gift_product_id', fallback);
    }
  }, [giftWithPurchase?.eligible, giftWithPurchase?.rule_id, giftWithPurchase?.gift_products, selectedGiftProductId]);

  const handleSelectGift = (productId: string) => {
    setSelectedGiftProductId(productId);
    localStorage.setItem('b2b_selected_gift_product_id', productId);
  };

  // 修改数量（遵守 min_order_quantity 约束）
  const handleQuantityChange = async (item: CartItem, newQuantity: number) => {
    const minOrderQty = item.min_order_quantity || 1;
    try {
      if (newQuantity < minOrderQty) {
        // 如果减少到低于最小起批量，则移除商品
        await removeItem.mutateAsync(item.product_id);
        toast.success(t('b2b.removed') || '已移除');
        return;
      }
      if (newQuantity > item.stock) {
        toast.error(t('b2b.outOfStock') || '库存不足');
        return;
      }
      await updateItem.mutateAsync({ productId: item.product_id, quantity: newQuantity });
    } catch (err: any) {
      toast.error(err.message || (t('b2b.operationFailed') || '操作失败'));
    }
  };

  // 快选数量
  const handleQuickQty = async (item: CartItem, qty: number) => {
    const minOrderQty = item.min_order_quantity || 1;
    const finalQty = Math.max(qty, minOrderQty);
    if (finalQty > item.stock) {
      toast.error(t('b2b.outOfStock') || '库存不足');
      return;
    }
    try {
      await updateItem.mutateAsync({ productId: item.product_id, quantity: finalQty });
    } catch (err: any) {
      toast.error(err.message || (t('b2b.operationFailed') || '操作失败'));
    }
  };

  // 开始编辑数量
  const handleStartEdit = (item: CartItem) => {
    setEditingItemId(item.product_id);
    setEditingValue(String(item.quantity));
  };

  // 确认编辑数量
  const handleConfirmEdit = async (item: CartItem) => {
    const val = parseInt(editingValue, 10);
    setEditingItemId(null);
    if (isNaN(val) || val <= 0) return;
    await handleQuantityChange(item, val);
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
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
            className="px-8 py-2.5 bg-primary text-white rounded-xl text-sm font-medium active:bg-primary-dark"
          >
            {t('b2b.goShopping') || '去进货'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-44">
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

      {/* Gift With Purchase - 置顶在商品列表上方 */}
      {giftWithPurchase && (
        <div className="px-4 pt-3">
          <div className={`rounded-xl p-4 shadow-sm border-2 ${
            giftWithPurchase.eligible
              ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-300'
              : 'bg-gradient-to-r from-amber-50/80 to-yellow-50/80 border-amber-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                  giftWithPurchase.eligible
                    ? 'bg-amber-200 text-amber-700'
                    : 'bg-amber-100 text-amber-600'
                }`}>
                  <GiftIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-gray-900">{t('b2b.giftWithPurchase')}</div>
                  <div className="text-xs text-gray-600">{giftWithPurchase.rule_name_i18n?.[lang] || giftWithPurchase.rule_name || t('b2b.giftWholesaleExclusive')}</div>
                </div>
              </div>
              {giftWithPurchase.eligible ? (
                <span className="text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full border border-green-200">{t('b2b.giftEligible')}</span>
              ) : (
                <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full border border-amber-200">{t('b2b.giftRemainingAmount', { amount: giftWithPurchase.remaining_amount.toFixed(2) })}</span>
              )}
            </div>
            {/* Progress bar */}
            <div className="h-2.5 bg-white/70 rounded-full overflow-hidden mb-3 border border-amber-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  giftWithPurchase.eligible
                    ? 'bg-gradient-to-r from-green-400 to-green-500'
                    : 'bg-gradient-to-r from-amber-400 to-orange-400'
                }`}
                style={{ width: `${Math.min(giftWithPurchase.progress, 100)}%` }}
              />
            </div>
            {giftWithPurchase.eligible && giftWithPurchase.gift_products.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-600 font-medium">{t('b2b.giftSelectHint')}</div>
                {giftWithPurchase.gift_products.map((gift) => {
                  const active = selectedGiftProductId === gift.product_id;
                  return (
                    <button
                      key={gift.product_id}
                      type="button"
                      onClick={() => handleSelectGift(gift.product_id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg border-2 text-left transition-all ${active ? 'border-amber-500 bg-white shadow-sm' : 'border-transparent bg-white/60 hover:border-amber-200'}`}
                    >
                      <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                        {gift.image_url ? <LazyImage src={gift.image_url} alt={getGiftProductName(gift, lang)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div className="w-full h-full flex items-center justify-center text-gray-300">🎁</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 line-clamp-1">{getGiftProductName(gift, lang)}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {gift.wholesale_price ? (
                            <span className="text-[11px] text-gray-400 line-through decoration-gray-300">TJS {Number(gift.wholesale_price).toFixed(2)}</span>
                          ) : null}
                          <span className="text-[11px] font-medium text-green-600">{t('b2b.freeGiftPrice')}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{t('b2b.giftQuantityLabel', { quantity: gift.gift_quantity, unit: gift.unit_measure || t('b2b.orderItemPieces') })} · {t('b2b.giftStockLabel', { stock: gift.stock ?? '-' })}</div>
                      </div>
                      {active && <CheckCircleIcon className="w-5 h-5 text-amber-600" />}
                    </button>
                  );
                })}
              </div>
            ) : !giftWithPurchase.eligible && (
              <div className="text-xs text-gray-600">{t('b2b.giftThresholdHint', { amount: Number(giftWithPurchase.threshold_amount || 0).toFixed(2) })}</div>
            )}
          </div>
        </div>
      )}

      {/* Cart Items */}
      <div className="px-4 pt-3 space-y-2.5">
        {cartItems.map((item) => {
          const minQty = item.min_order_quantity || 1;
          const isEditing = editingItemId === item.product_id;
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
                  <div className="text-sm font-bold text-primary mt-0.5">
                    TJS {Number(item.wholesale_price).toFixed(2)}
                    <span className="text-xs text-gray-400 font-normal ml-1">/{item.unit_measure}</span>
                  </div>

                  {/* Quantity Controls & Actions */}
                  <div className="flex items-center justify-between mt-2">
                    {/* Quantity Stepper + Direct Input */}
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => handleQuantityChange(item, item.quantity - minQty)}
                        disabled={updateItem.isPending || removeItem.isPending}
                        className="px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <MinusIcon className="w-3.5 h-3.5" />
                      </button>
                      {isEditing ? (
                        <input
                          type="number"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => handleConfirmEdit(item)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmEdit(item); }}
                          autoFocus
                          className="w-14 py-1.5 text-xs font-bold text-center border-x border-gray-200 bg-white outline-none focus:bg-amber-50"
                          min={minQty}
                          max={item.stock}
                        />
                      ) : (
                        <button
                          onClick={() => handleStartEdit(item)}
                          className="px-3 py-1.5 text-xs font-bold min-w-[2.5rem] text-center border-x border-gray-200 bg-gray-50 hover:bg-amber-50 transition-colors cursor-text"
                        >
                          {item.quantity}
                        </button>
                      )}
                      <button
                        onClick={() => handleQuantityChange(item, item.quantity + minQty)}
                        disabled={item.quantity + minQty > item.stock || updateItem.isPending || removeItem.isPending}
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

                  {/* Quick Quantity Chips */}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {QUICK_QTY_OPTIONS.map((qty) => (
                      <button
                        key={qty}
                        onClick={() => handleQuickQty(item, qty)}
                        disabled={updateItem.isPending || removeItem.isPending}
                        className={`px-2 py-0.5 text-[11px] rounded-md border transition-all ${
                          item.quantity === qty
                            ? 'bg-primary/10 border-primary text-primary font-bold'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-primary/50 hover:text-primary'
                        } disabled:opacity-30`}
                      >
                        {qty}
                      </button>
                    ))}
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

      {/* Bottom Checkout Bar - 定位在底部导航栏上方 */}
      <div className="fixed left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] z-40" style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Summary */}
          <div>
            <div className="text-xs text-gray-500">
              {productCount} {t('b2b.orderItemTypes') || '种'} · {totalItems} {t('b2b.orderItemPieces') || '件'}
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-xs text-gray-500">{t('b2b.totalAmount') || '合计'}</span>
              <span className="text-lg font-bold text-primary">TJS {totalAmount.toFixed(2)}</span>
            </div>
          </div>
          {/* Checkout Button - Navigate to dedicated checkout page */}
          <button
            onClick={() => navigate('/b2b/checkout')}
            className="px-8 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold active:bg-primary-dark shadow-lg shadow-primary/20 transition-all"
          >
            {t('b2b.checkout') || '去结算'}
          </button>
        </div>
      </div>
    </div>
  );
}
