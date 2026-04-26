/**
 * 希望之树 - 选择礼物页面
 *
 * 新用户首次进入时展示可选礼物列表。
 * 参考 UI 设计图中的 "Your Tree is Ready! Choose Your Gift" 页面。
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useGiftItems, useStartTree } from '../hooks/useGiftTree';
import type { GiftItem } from '../types';

function getLocalizedText(
  i18n: Record<string, string> | undefined | null,
  lang: string
): string {
  if (!i18n) return '';
  return i18n[lang] || i18n['zh'] || i18n['en'] || Object.values(i18n)[0] || '';
}

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
        toast.error(t('giftTree.outOfStock', 'This gift is out of stock'));
      } else if (msg.includes('ERR_ALREADY_GROWING')) {
        toast.error(t('giftTree.alreadyGrowing', 'You already have a growing tree'));
        navigate('/gift-tree', { replace: true });
      } else if (msg.includes('ERR_COOLDOWN')) {
        toast.error(t('giftTree.cooldown', 'Please wait for cooldown period'));
      } else {
        toast.error(msg);
      }
    } finally {
      setSelectedId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-3 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !giftItems?.length) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex flex-col items-center justify-center p-6">
        <span className="text-5xl mb-4">🎁</span>
        <h2 className="text-lg font-bold text-foreground mb-2">
          {t('giftTree.noGiftsTitle', 'Gifts Coming Soon')}
        </h2>
        <p className="text-muted-foreground text-sm text-center">
          {t('giftTree.noGiftsDesc', 'New gifts are being prepared. Please check back later!')}
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-6 bg-accent text-white px-6 py-2.5 rounded-xl font-medium"
        >
          {t('common.back', 'Back')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      {/* Header with tree illustration */}
      <div className="relative pt-8 pb-4 text-center">
        {/* Confetti decorations */}
        <div className="absolute top-4 left-6 text-xl animate-pulse">🎊</div>
        <div className="absolute top-8 right-8 text-lg animate-pulse" style={{ animationDelay: '0.5s' }}>🎉</div>

        {/* Tree illustration */}
        <div className="text-7xl mb-4">🌳</div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-foreground leading-tight px-6">
          {t('giftTree.treeReady', 'Your Tree is Ready!')}
          <br />
          {t('giftTree.chooseGift', 'Choose Your Gift')}
        </h1>
      </div>

      {/* Gift cards grid */}
      <div className="px-4 pb-6">
        <div className={`grid ${giftItems.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'} gap-3`}>
          {giftItems.map((item, idx) => {
            const available = item.stock - item.reserved_stock;
            const name = getLocalizedText(item.name_i18n, lang) || item.name;
            const isPopular = idx === 0;
            const isSelected = selectedId === item.id;

            return (
              <div
                key={item.id}
                className={`relative bg-white rounded-2xl p-4 shadow-sm border transition-all ${
                  isSelected ? 'border-accent ring-2 ring-accent/20' : 'border-gray-100'
                } ${giftItems.length === 3 && idx === 2 ? 'col-span-2 max-w-[200px] mx-auto' : ''}`}
              >
                {/* Popular badge */}
                {isPopular && (
                  <div className="absolute -top-2 right-2 bg-warning text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Popular
                  </div>
                )}

                {/* Gift image */}
                <div className="flex justify-center mb-3">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={name}
                      className="w-20 h-20 object-contain rounded-lg"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-primary-light/30 rounded-lg flex items-center justify-center text-3xl">
                      🎁
                    </div>
                  )}
                </div>

                {/* Gift name */}
                <h3 className="font-bold text-foreground text-sm text-center mb-1 truncate">
                  {name}
                </h3>

                {/* Stock info */}
                <p className="text-muted-foreground text-xs text-center mb-3">
                  {available} {t('giftTree.left', 'left')}
                </p>

                {/* Choose button */}
                <button
                  onClick={() => handleChoose(item)}
                  disabled={startTree.isPending || available <= 0}
                  className={`w-full py-2 rounded-xl font-semibold text-sm transition-all active:scale-95 ${
                    available <= 0
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-accent text-white hover:bg-accent/90'
                  }`}
                >
                  {isSelected && startTree.isPending
                    ? t('common.loading', 'Loading...')
                    : available <= 0
                    ? t('giftTree.outOfStock', 'Out of Stock')
                    : t('giftTree.choose', 'Choose')}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom tip */}
      <div className="text-center pb-8 px-6">
        <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
          <span>📍</span>
          <span>{t('giftTree.pickupTip', 'Pick up at your nearest DODO point within 7 days')}</span>
        </div>
      </div>
    </div>
  );
};

export default GiftSelector;
