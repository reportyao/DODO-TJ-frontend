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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ArrowLeftIcon className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold">{t('b2b.cart', '购物车')} ({summary.total_quantity})</h1>
        </div>
        {cartItems.length > 0 && (
          <button 
            onClick={() => {
              if (window.confirm(t('b2b.confirmClearCart', '确定要清空购物车吗？'))) {
                clearCart.mutate();
                setSelectedGifts({});
              }
            }}
            className="text-sm text-gray-500"
          >
            {t('b2b.clear', '清空')}
          </button>
        )}
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* 满额赠送置顶提示 (叠加模式) */}
        {giftState && (
          <div className="bg-white rounded-2xl p-5 border-2 border-orange-100 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 rounded-full -mr-12 -mt-12 opacity-50" />
            
            <div className="flex items-start gap-4 relative z-10">
              <div className="bg-gradient-to-br from-orange-400 to-red-500 p-3 rounded-2xl shadow-lg shadow-orange-100">
                <GiftIcon className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-gray-900">{t('b2b.giftWithPurchase', '满额送礼物')}</h3>
                  {giftState.eligible_count > 0 && (
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 animate-pulse">
                      <CheckCircleIcon className="w-3.5 h-3.5" />
                      {t('b2b.eligible', '已达标')} x{giftState.eligible_count}
                    </span>
                  )}
                </div>

                {/* 下一个目标的进度 */}
                {giftState.next_goal ? (
                  <div className="mt-3">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-600 font-medium">
                        {lang === 'zh' 
                          ? `再买 TJS ${giftState.next_goal.remaining_amount.toFixed(2)} 即可多得一份礼物`
                          : i18n.language === 'ru'
                            ? `Добавьте еще TJS ${giftState.next_goal.remaining_amount.toFixed(2)} для еще одного подарка`
                            : `Боз TJS ${giftState.next_goal.remaining_amount.toFixed(2)} илова кунед барои тӯҳфаи дигар`
                        }
                      </span>
                      <span className="text-orange-600 font-bold">{giftState.next_goal.progress}%</span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-50 shadow-inner">
                      <div 
                        className={cn(
                          "h-full transition-all duration-1000 ease-out rounded-full",
                          giftState.next_goal.progress >= 100 ? "bg-gradient-to-r from-green-400 to-green-500" : "bg-gradient-to-r from-orange-400 to-orange-500"
                        )}
                        style={{ width: `${giftState.next_goal.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-2 italic">
                      {giftState.next_goal.rule_name_i18n?.[lang] || giftState.next_goal.rule_name}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-green-600 font-medium mt-2">
                    {t('b2b.allGiftsUnlocked', '恭喜！您已解锁所有档位的赠品。')}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 购物车为空 */}
        {cartItems.length === 0 && !isLoading && (
          <div className="py-20 text-center space-y-4">
            <div className="bg-gray-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
              <ShoppingBagIcon className="w-10 h-10 text-gray-400" />
            </div>
            <p className="text-gray-500">{t('b2b.cartEmpty', '购物车空空如也')}</p>
            <Link to="/b2b" className="inline-block bg-orange-500 text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-orange-100">
              {t('b2b.goToShop', '去逛逛')}
            </Link>
          </div>
        )}

        {/* 商品列表 */}
        <div className="space-y-3">
          {cartItems.map((item) => (
            <div key={item.id} className="bg-white rounded-2xl p-4 flex gap-4 shadow-sm border border-gray-100 group">
              <div className="w-24 h-24 rounded-xl overflow-hidden bg-gray-50 flex-shrink-0 border border-gray-50">
                <LazyImage src={item.product_image} alt={item.product_name} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-bold text-gray-900 line-clamp-2 text-sm leading-snug">
                      {item.name_i18n?.[lang] || item.product_name}
                    </h3>
                    <button onClick={() => removeItem.mutate(item.product_id)} className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-orange-600 font-bold text-base">TJS {item.wholesale_price.toFixed(2)}</span>
                    <span className="text-xs text-gray-400">/{item.unit_measure}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center bg-gray-50 rounded-xl p-1 border border-gray-100 shadow-sm">
                    <button 
                      onClick={() => handleUpdateQuantity(item.product_id, item.quantity - 1, item.stock, item.min_order_quantity)}
                      className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600"
                    >
                      <MinusIcon className="w-4 h-4" />
                    </button>
                    <input 
                      type="number"
                      value={item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) handleUpdateQuantity(item.product_id, val, item.stock, item.min_order_quantity);
                      }}
                      className="w-12 text-center bg-transparent font-bold text-sm focus:outline-none"
                    />
                    <button 
                      onClick={() => handleUpdateQuantity(item.product_id, item.quantity + 1, item.stock, item.min_order_quantity)}
                      className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-orange-600"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-400 block mb-0.5">{t('b2b.subtotal', '小计')}</span>
                    <span className="font-bold text-gray-900 text-sm">TJS {item.subtotal.toFixed(2)}</span>
                  </div>
                </div>
                
                {/* 数量快选框 */}
                <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar py-1">
                  {[10, 50, 100, 200].map(qty => (
                    <button
                      key={qty}
                      onClick={() => handleUpdateQuantity(item.product_id, qty, item.stock, item.min_order_quantity)}
                      className={cn(
                        "flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border",
                        item.quantity === qty 
                          ? "bg-orange-500 text-white border-orange-500 shadow-sm" 
                          : "bg-white text-gray-500 border-gray-200 hover:border-orange-200"
                      )}
                    >
                      {qty}
                    </button>
                  ))}
                  <span className="text-[10px] text-gray-300 flex items-center ml-1">{t('b2b.quickQty', '快选')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 满额赠送选择区域 (多档位叠加) */}
        {giftState && giftState.rules && giftState.rules.length > 0 && (
          <div className="space-y-4 pt-4">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1 h-5 bg-orange-500 rounded-full" />
              <h2 className="text-lg font-bold text-gray-900">{t('b2b.chooseYourGifts', '选择您的赠品')}</h2>
            </div>
            
            {giftState.rules.map((rule: GiftRuleState) => (
              <div key={rule.rule_id} className="bg-white rounded-2xl p-4 shadow-sm border border-orange-100">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900">{rule.rule_name_i18n?.[lang] || rule.rule_name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{rule.description_i18n?.[lang] || rule.description}</p>
                  </div>
                  <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-bold">
                    {t('b2b.minAmount', '满')} TJS {rule.threshold_amount}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {rule.gift_products.map((gift) => (
                    <button
                      key={gift.product_id}
                      onClick={() => handleSelectGift(rule.rule_id, gift.product_id)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left group relative",
                        selectedGifts[rule.rule_id] === gift.product_id
                          ? "border-orange-500 bg-orange-50/30"
                          : "border-gray-50 bg-gray-50/50 hover:border-orange-200"
                      )}
                    >
                      <div className="w-14 h-14 rounded-lg overflow-hidden bg-white border border-gray-100 flex-shrink-0">
                        <LazyImage src={gift.image_url} alt={gift.product_name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-gray-900 text-sm truncate">
                          {getGiftProductNameFn(gift, lang)}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-400">{t('b2b.giftItemBadge', '赠品')} {gift.gift_quantity} {gift.unit_measure || t('b2b.unitPiece', '件')}</span>
                          <span className="text-[10px] text-gray-300">|</span>
                          <span className="text-xs text-gray-400">{t('b2b.inStock', '库存')} {gift.stock}</span>
                        </div>
                        {/* 价格展示：原价删除线 + 免费标签 */}
                        <div className="flex items-center gap-2 mt-1.5">
                          {gift.wholesale_price && gift.wholesale_price > 0 && (
                            <span className="text-[10px] text-gray-400 line-through decoration-gray-300">TJS {gift.wholesale_price.toFixed(2)}</span>
                          )}
                          <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            {t('b2b.freeGiftPrice', '免费')}
                          </span>
                        </div>
                      </div>
                      <div className={cn(
                        "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                        selectedGifts[rule.rule_id] === gift.product_id
                          ? "border-orange-500 bg-orange-500 text-white"
                          : "border-gray-200 bg-white"
                      )}>
                        {selectedGifts[rule.rule_id] === gift.product_id && <CheckCircleIcon className="w-5 h-5" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer / Checkout Bar */}
      {cartItems.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-lg border-t pb-safe">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">{t('b2b.totalAmount', '总计')}</span>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-orange-600">TJS {summary.total_amount.toFixed(2)}</span>
              </div>
            </div>
            <button 
              onClick={() => {
                // 检查是否所有达标规则都选了赠品
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
              className="flex-1 bg-gradient-to-r from-orange-500 to-orange-600 text-white h-14 rounded-2xl font-bold text-lg shadow-xl shadow-orange-100 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              {t('b2b.checkout', '去结算')}
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
