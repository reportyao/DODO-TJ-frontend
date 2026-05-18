import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  TrashIcon,
  ShoppingBagIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  PlusIcon,
  MinusIcon,
  GiftIcon,
  CheckCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { useB2BCart, useB2BCartMutations, GiftProductOption, GiftRuleState } from '../hooks/useB2B';
import { useUser } from '../contexts/UserContext';
import { LazyImage } from '../components/LazyImage';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';

function getGiftProductNameFn(item: GiftProductOption, lang = 'ru'): string {
  const name = item.name_i18n?.[lang] || item.name_i18n?.ru || item.name_i18n?.zh || item.name_i18n?.tg;
  return name || item.product_name || '';
}

export default function B2BCartPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'ru';
  const navigate = useNavigate();
  const { user } = useUser();
  const { data: cartData, isLoading } = useB2BCart();
  const { updateItem, removeItem, clearCart } = useB2BCartMutations();

  // 多档位赠品选择状态：Record<rule_id, product_id>
  const [selectedGifts, setSelectedGifts] = useState<Record<string, string>>({});

  // 从 localStorage 初始化已选赠品
  useEffect(() => {
    try {
      const saved = localStorage.getItem('b2b_selected_gift_ids');
      if (saved) {
        setSelectedGifts(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load selected gifts', e);
    }
  }, []);

  // 持久化已选赠品
  useEffect(() => {
    localStorage.setItem('b2b_selected_gift_ids', JSON.stringify(selectedGifts));
  }, [selectedGifts]);

  const cartItems = cartData?.items || [];
  const summary = cartData?.summary || { total_quantity: 0, total_amount: 0 };
  const giftState = cartData?.gift_with_purchase;

  const handleUpdateQuantity = (productId: string, newQty: number, stock: number, minQty: number) => {
    if (newQty > stock) {
      toast.error(t('b2b.outOfStock', '库存不足'));
      return;
    }
    if (newQty < minQty && newQty !== 0) {
      toast.error(t('b2b.minOrderQuantity', '未达到起订量'));
      return;
    }
    updateItem.mutate({ productId, quantity: newQty });
  };

  const handleSelectGift = (ruleId: string, productId: string) => {
    setSelectedGifts(prev => ({
      ...prev,
      [ruleId]: productId
    }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ArrowLeftIcon className="w-6 h-6 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">{t('b2b.cart', '进货单')} ({summary.total_quantity})</h1>
        </div>
        {cartItems.length > 0 && (
          <button 
            onClick={() => {
              if (window.confirm(t('b2b.confirmClearCart', '确定要清空购物车吗？'))) {
                clearCart.mutate();
                setSelectedGifts({});
              }
            }}
            className="text-sm text-muted-foreground hover:text-destructive transition-colors"
          >
            {t('b2b.clear', '清空')}
          </button>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-4 space-y-3">
        {/* ═══════════════════════════════════════════════════
            满额赠送整体模块（进度 + 赠品选择合为一体）
            放在商品列表上方
           ═══════════════════════════════════════════════════ */}
        {giftState && (
          <div className="bg-gradient-to-b from-primary-light/20 to-white rounded-2xl shadow-sm overflow-hidden">
            {/* 顶部：满额赠送进度条区域 */}
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-primary to-primary-dark p-2.5 rounded-xl">
                  <GiftIcon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-foreground text-base">{t('b2b.giftWithPurchase', '满额赠送')}</h3>
                    {giftState.eligible_count > 0 && (
                      <span className="bg-success-light text-success text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                        <CheckCircleIcon className="w-3.5 h-3.5" />
                        {t('b2b.eligible', '已达标')} x{giftState.eligible_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 进度条 */}
              {giftState.next_goal ? (
                <div className="mt-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-muted-foreground text-xs">
                      {lang === 'zh' 
                        ? `再买 TJS ${giftState.next_goal.remaining_amount.toFixed(2)} 即可多得一份礼物`
                        : i18n.language === 'ru'
                          ? `Добавьте еще TJS ${giftState.next_goal.remaining_amount.toFixed(2)} для подарка`
                          : `Боз TJS ${giftState.next_goal.remaining_amount.toFixed(2)} илова кунед барои тӯҳфа`
                      }
                    </span>
                    <span className="text-primary font-bold text-xs">{giftState.next_goal.progress}%</span>
                  </div>
                  <div className="h-2 bg-white rounded-full overflow-hidden shadow-inner">
                    <div 
                      className={cn(
                        "h-full transition-all duration-1000 ease-out rounded-full",
                        giftState.next_goal.progress >= 100 
                          ? "bg-success" 
                          : "bg-gradient-to-r from-primary-light to-primary"
                      )}
                      style={{ width: `${Math.min(giftState.next_goal.progress, 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-success font-medium mt-2 flex items-center gap-1">
                  <SparklesIcon className="w-4 h-4" />
                  {t('b2b.allGiftsUnlocked', '恭喜！您已解锁所有档位的赠品。')}
                </p>
              )}
            </div>

            {/* 赠品选择区域 */}
            {giftState.rules && giftState.rules.length > 0 && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground font-medium pt-2">
                  {t('b2b.chooseYourGifts', '选择您的赠品')}
                </p>

                {giftState.rules.map((rule: GiftRuleState) => (
                  <div key={rule.rule_id} className="space-y-2">
                    {/* 规则标题行 */}
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-foreground">
                        {rule.rule_name_i18n?.[lang] || rule.rule_name}
                      </h4>
                      <span className="text-[10px] bg-primary/10 text-primary-dark px-2 py-0.5 rounded-full font-bold">
                        {t('b2b.minAmount', '满')} TJS {rule.threshold_amount}
                      </span>
                    </div>

                    {/* 赠品选项列表 */}
                    {rule.gift_products.map((gift) => {
                      const isSelected = selectedGifts[rule.rule_id] === gift.product_id;
                      return (
                        <button
                          key={gift.product_id}
                          onClick={() => handleSelectGift(rule.rule_id, gift.product_id)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left",
                            isSelected
                              ? "bg-primary/5 ring-2 ring-primary/40"
                              : "bg-white hover:bg-gray-50"
                          )}
                        >
                          {/* 赠品图片 */}
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-50 flex-shrink-0">
                            <LazyImage src={gift.image_url} alt={gift.product_name} className="w-full h-full object-cover" />
                          </div>
                          {/* 赠品信息 */}
                          <div className="flex-1 min-w-0">
                            <h5 className="font-bold text-foreground text-sm truncate leading-tight">
                              {getGiftProductNameFn(gift, lang)}
                            </h5>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-muted-foreground">
                                {t('b2b.giftItemBadge', '赠品')} {gift.gift_quantity}{gift.unit_measure || t('b2b.unitPiece', '件')}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {t('b2b.inStock', '有货')} {gift.stock}
                              </span>
                            </div>
                            {/* 价格 */}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {gift.wholesale_price && gift.wholesale_price > 0 && (
                                <span className="text-[11px] text-muted-foreground line-through">
                                  TJS {gift.wholesale_price.toFixed(2)}
                                </span>
                              )}
                              <span className="text-[11px] font-bold text-success">
                                {t('b2b.freeGiftPrice', '免费')}
                              </span>
                            </div>
                          </div>
                          {/* 选中指示器 */}
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                            isSelected
                              ? "bg-primary text-white shadow-sm"
                              : "bg-gray-100"
                          )}>
                            {isSelected && (
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            购物车为空
           ═══════════════════════════════════════════════════ */}
        {cartItems.length === 0 && !isLoading && (
          <div className="py-20 text-center space-y-4">
            <div className="bg-gray-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
              <ShoppingBagIcon className="w-10 h-10 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">{t('b2b.cartEmpty', '购物车空空如也')}</p>
            <Link to="/b2b" className="inline-block bg-primary text-white px-8 py-3 rounded-full font-bold shadow-md">
              {t('b2b.goToShop', '去逛逛')}
            </Link>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            商品列表
           ═══════════════════════════════════════════════════ */}
        {cartItems.length > 0 && (
          <div className="space-y-3">
            {cartItems.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl p-4 shadow-sm">
                {/* 商品主体：图片 + 信息 */}
                <div className="flex gap-3">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-50 flex-shrink-0">
                    <LazyImage src={item.product_image} alt={item.product_name} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-bold text-foreground line-clamp-2 text-sm leading-snug">
                        {item.name_i18n?.[lang] || item.product_name}
                      </h3>
                      <button 
                        onClick={() => removeItem.mutate(item.product_id)} 
                        className="p-1.5 text-gray-300 hover:text-destructive transition-colors flex-shrink-0 rounded-lg hover:bg-destructive-light"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-1.5">
                      <span className="text-primary font-bold text-lg">TJS {item.wholesale_price.toFixed(2)}</span>
                      <span className="text-[11px] text-muted-foreground">/{item.unit_measure}</span>
                    </div>
                  </div>
                </div>

                {/* 数量控制 + 小计 */}
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center">
                    <button 
                      onClick={() => handleUpdateQuantity(item.product_id, item.quantity - 1, item.stock, item.min_order_quantity)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-foreground"
                    >
                      <MinusIcon className="w-3.5 h-3.5" />
                    </button>
                    <input 
                      type="number"
                      value={item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) handleUpdateQuantity(item.product_id, val, item.stock, item.min_order_quantity);
                      }}
                      className="w-12 h-8 text-center font-bold text-sm focus:outline-none mx-1 rounded-lg bg-gray-50"
                    />
                    <button 
                      onClick={() => handleUpdateQuantity(item.product_id, item.quantity + 1, item.stock, item.min_order_quantity)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors text-primary"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-muted-foreground">{t('b2b.subtotal', '小计')}</span>
                    <p className="font-bold text-foreground">TJS {item.subtotal.toFixed(2)}</p>
                  </div>
                </div>

                {/* 数量快选 */}
                <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
                  {[10, 50, 100, 200].map(qty => (
                    <button
                      key={qty}
                      onClick={() => handleUpdateQuantity(item.product_id, qty, item.stock, item.min_order_quantity)}
                      className={cn(
                        "flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all",
                        item.quantity === qty 
                          ? "bg-primary text-white" 
                          : "bg-gray-100 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      )}
                    >
                      {qty}
                    </button>
                  ))}
                  <span className="text-[10px] text-gray-300 flex items-center ml-1">{t('b2b.quickQty', '快选')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════
          底部结算栏
         ═══════════════════════════════════════════════════ */}
      {cartItems.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-gray-100 pb-safe">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-[11px] text-muted-foreground">{t('b2b.totalAmount', '总计')}</span>
              <span className="text-xl font-black text-primary">TJS {summary.total_amount.toFixed(2)}</span>
            </div>
            <button 
              onClick={() => {
                if (giftState && giftState.rules.length > 0) {
                  const unselectedRules = giftState.rules.filter(r => !selectedGifts[r.rule_id]);
                  if (unselectedRules.length > 0) {
                    if (!window.confirm(t('b2b.confirmNoGift', '您还有赠品未选择，确定要直接结算吗？'))) {
                      return;
                    }
                  }
                }
                navigate('/b2b/checkout');
              }}
              className="flex-1 max-w-[200px] bg-gradient-to-r from-primary to-primary-dark text-white h-12 rounded-xl font-bold text-base shadow-lg shadow-primary/20 flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            >
              {t('b2b.checkout', '去结算')}
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
