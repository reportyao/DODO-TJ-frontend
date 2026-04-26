/**
 * 希望之树 - 选择礼物页面
 *
 * 新用户首次进入时展示可选礼物列表。
 * 对标设计图 "Your Tree is Ready! Choose Your Gift" 页面。
 *
 * 多语言适配：
 * - 标题使用 text-xl，俄语/塔吉克语不会溢出
 * - 礼物名称使用 line-clamp-2 + min-h
 * - 按钮文字使用 whitespace-nowrap + min-w
 * - 底部提示使用 leading-snug 紧凑行高
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { getLocalizedText, getOptimizedImageUrl } from '../../../lib/utils';
import { useGiftItems, useStartTree } from '../hooks/useGiftTree';
import type { GiftItem } from '../types';

const GiftSelector: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'zh';

  const { data: giftItems, isLoading, error } = useGiftItems();
  const startTree = useStartTree();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleChoose = async (item: GiftItem) => {
    if (startTree.isPending) return;
    setSelectedId(item.id);
    try {
      await startTree.mutateAsync(item.id);
      toast.success(t('giftTree.treeStarted', 'Your tree has started growing!'));
      navigate('/gift-tree', { replace: true });
    } catch (err: any) {
      const msg = err?.message || 'Failed to start tree';
      if (msg.includes('ERR_OUT_OF_STOCK')) {
        toast.error(t('giftTree.outOfStock', 'Out of stock'));
      } else if (msg.includes('ERR_ALREADY_GROWING')) {
        toast.error(t('giftTree.alreadyGrowing', 'You already have a growing tree'));
        navigate('/gift-tree', { replace: true });
      } else if (msg.includes('ERR_COOLDOWN')) {
        toast.error(t('giftTree.cooldown', 'Please wait for cooldown'));
      } else if (msg.includes('ERR_UNCLAIMED')) {
        toast.error(t('giftTree.unclaimed', 'Please claim your gift first'));
        navigate('/gift-tree/complete', { replace: true });
      } else {
        toast.error(msg);
      }
    } finally {
      setSelectedId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FDF6EC] flex items-center justify-center">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 border-3 border-accent/20 rounded-full" />
          <div className="absolute inset-0 border-3 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !giftItems?.length) {
    return (
      <div className="min-h-screen bg-[#FDF6EC] flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4">
          <span className="text-3xl">🎁</span>
        </div>
        <h2 className="text-lg font-bold text-foreground mb-2 text-center">
          {t('giftTree.noGiftsTitle', 'Gifts Coming Soon')}
        </h2>
        <p className="text-muted-foreground text-sm text-center leading-snug max-w-xs">
          {t('giftTree.noGiftsDesc', 'New gifts are being prepared. Please check back later!')}
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-6 bg-gradient-to-r from-accent to-teal-600 text-white px-8 py-2.5 rounded-full font-medium active:scale-95 transition-transform shadow-md"
        >
          {t('common.back', 'Back')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] to-[#FFF3E0]">
      {/* Header with tree illustration and confetti */}
      <div className="relative pt-8 pb-5 text-center overflow-hidden">
        {/* Floating confetti decorations */}
        <div className="absolute top-4 left-6 opacity-70" style={{ animation: 'confetti-float 3s ease-in-out infinite' }}>
          <svg width="20" height="20" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1" fill="#F5A623" transform="rotate(25 8 7)" opacity="0.7"/></svg>
        </div>
        <div className="absolute top-8 right-8 opacity-60" style={{ animation: 'confetti-float 3.5s ease-in-out infinite', animationDelay: '0.5s' }}>
          <svg width="18" height="18" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1" fill="#4DB6AC" transform="rotate(-20 8 7)" opacity="0.7"/></svg>
        </div>
        <div className="absolute top-14 left-1/4 opacity-50" style={{ animation: 'confetti-float 4s ease-in-out infinite', animationDelay: '1s' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10L12 2Z" fill="#F5A623" opacity="0.6"/>
          </svg>
        </div>

        {/* Tree illustration - SVG instead of emoji for consistency */}
        <div className="mb-4">
          <svg width="100" height="100" viewBox="0 0 100 100" className="mx-auto">
            <path d="M50 95 Q50 70 48 55" stroke="#6D4C41" strokeWidth="6" fill="none" strokeLinecap="round" />
            <ellipse cx="50" cy="40" rx="35" ry="28" fill="#4CAF50" opacity="0.9" />
            <ellipse cx="35" cy="35" rx="20" ry="18" fill="#66BB6A" opacity="0.8" />
            <ellipse cx="65" cy="35" rx="20" ry="18" fill="#81C784" opacity="0.8" />
            <ellipse cx="50" cy="25" rx="22" ry="16" fill="#A5D6A7" opacity="0.7" />
            <circle cx="35" cy="30" r="5" fill="#FF9800" />
            <circle cx="35" cy="30" r="3.5" fill="#FFB74D" />
            <circle cx="60" cy="28" r="5" fill="#FF9800" />
            <circle cx="60" cy="28" r="3.5" fill="#FFB74D" />
            <circle cx="48" cy="42" r="4" fill="#FF9800" />
            <circle cx="48" cy="42" r="2.5" fill="#FFB74D" />
          </svg>
        </div>

        {/* Title - responsive text size */}
        <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight px-6">
          {t('giftTree.treeReady', 'Your Tree is Ready!')}
        </h1>
        <p className="text-accent font-semibold text-base sm:text-lg mt-1 px-6">
          {t('giftTree.chooseGift', 'Choose Your Gift')}
        </p>
      </div>

      {/* Gift cards grid */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {giftItems.map((item, idx) => {
            const available = item.stock - item.reserved_stock;
            const name = getLocalizedText(item.name_i18n, lang) || item.name;
            const isFirst = idx === 0;
            const isSelected = selectedId === item.id;
            const isLastOdd = giftItems.length % 2 === 1 && idx === giftItems.length - 1;
            // Optimize image URL if available
            const imgSrc = item.image_url
              ? getOptimizedImageUrl(item.image_url, { width: 200, height: 200 })
              : null;

            return (
              <div
                key={item.id}
                className={`relative bg-white rounded-2xl p-3.5 shadow-sm border-2 transition-all ${
                  isSelected ? 'border-accent ring-2 ring-accent/20 scale-[0.98]' : 'border-gray-100/60 hover:border-gray-200'
                } ${isLastOdd ? 'col-span-2 max-w-[200px] mx-auto' : ''}`}
              >
                {/* Popular badge for first item */}
                {isFirst && (
                  <div className="absolute -top-2 right-3 bg-gradient-to-r from-orange-400 to-orange-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm z-10">
                    Popular
                  </div>
                )}

                {/* Gift image */}
                <div className="flex justify-center mb-3">
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={name}
                      className="w-20 h-20 object-contain rounded-xl"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-gradient-to-br from-[#FFF3E0] to-[#FFE0B2] rounded-xl flex items-center justify-center text-3xl">
                      🎁
                    </div>
                  )}
                </div>

                {/* Gift name - 2 lines max, min height for consistency */}
                <h3 className="font-bold text-foreground text-[13px] text-center leading-tight line-clamp-2 min-h-[2.2rem] mb-1">
                  {name}
                </h3>

                {/* Stock info */}
                <p className="text-muted-foreground text-[11px] text-center mb-3 tabular-nums">
                  {available} {t('giftTree.left', 'left')}
                </p>

                {/* Choose button - min width to prevent collapse */}
                <button
                  onClick={() => handleChoose(item)}
                  disabled={startTree.isPending || available <= 0}
                  className={`w-full py-2.5 rounded-xl font-semibold text-[13px] transition-all active:scale-95 leading-snug ${
                    available <= 0
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-accent to-teal-600 text-white shadow-sm shadow-accent/20'
                  }`}
                >
                  {isSelected && startTree.isPending ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : available <= 0 ? (
                    t('giftTree.outOfStock', 'Out of Stock')
                  ) : (
                    t('giftTree.choose', 'Choose')
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom tip */}
      <div className="text-center pb-8 px-6">
        <div className="flex items-start justify-center gap-1.5 text-muted-foreground text-[11px] leading-snug">
          <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>{t('giftTree.pickupTip', 'Pick up at your nearest DODO point within 7 days')}</span>
        </div>
      </div>

      {/* Confetti animation */}
      <style>{`
        @keyframes confetti-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(10deg); }
        }
      `}</style>
    </div>
  );
};

export default GiftSelector;
