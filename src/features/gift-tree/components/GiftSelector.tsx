/**
 * 希望之树 - 选择礼物页面
 *
 * 新用户首次进入时展示可选礼物列表。
 * 对标设计图 "Your Tree is Ready! Choose Your Gift" 页面。
 * 精美暖色调设计，带有金色粒子和彩纸装饰。
 *
 * 多语言适配：
 * - 标题使用 text-xl，俄语/塔吉克语不会溢出
 * - 礼物名称使用 line-clamp-2 + min-h
 * - 按钮文字使用 whitespace-nowrap + min-w
 * - 底部提示使用 leading-snug 紧凑行高
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { getLocalizedText } from '../../../lib/utils';
import { LazyImage } from '../../../components/LazyImage';
import { useGiftItems, useGiftTreeStatus, useStartTree } from '../hooks/useGiftTree';
import type { GiftItem } from '../types';

const GiftSelector: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'zh';

  const { data: status, isLoading: isStatusLoading } = useGiftTreeStatus();
  const { data: giftItems, isLoading, error } = useGiftItems();
  const startTree = useStartTree();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (isStatusLoading || !status) {
      return;
    }

    if (status.tree?.status === 'COMPLETED' || status.tree?.status === 'CLAIMED') {
      navigate('/gift-tree/complete', { replace: true });
      return;
    }

    if (status.has_tree && status.tree?.status === 'GROWING') {
      navigate('/gift-tree', { replace: true });
    }
  }, [status, isStatusLoading, navigate]);

  const handleChoose = async (item: GiftItem) => {
    if (startTree.isPending) {
      return;
    }
    setSelectedId(item.id);
    try {
      await startTree.mutateAsync(item.id);
      toast.success(t('giftTree.treeStarted', 'Your tree has started growing!'));
      navigate('/gift-tree', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Failed to start tree';
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
      } else if (msg.includes('ERR_INVALID_SESSION') || msg.includes('ERR_MISSING_SESSION')) {
        toast.error(t('common.sessionExpired', 'Session expired, please login again'));
      } else {
        toast.error(msg);
      }
    } finally {
      setSelectedId(null);
    }
  };

  if (isStatusLoading || isLoading || (status?.has_tree && status.tree?.status === 'GROWING')) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 border-[3px] border-accent/15 rounded-full" />
            <div className="absolute inset-0 border-[3px] border-accent border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-xl">🌳</div>
          </div>
          <span className="text-muted-foreground text-sm">{t('common.loading', 'Loading...')}</span>
        </div>
      </div>
    );
  }

  if (error || !giftItems?.length) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center mb-4 shadow-sm">
          <span className="text-4xl">🎁</span>
        </div>
        <h2 className="text-lg font-bold text-foreground mb-2 text-center">
          {t('giftTree.noGiftsTitle', 'Gifts Coming Soon')}
        </h2>
        <p className="text-muted-foreground text-sm text-center leading-snug max-w-xs">
          {t('giftTree.noGiftsDesc', 'New gifts are being prepared. Please check back later!')}
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-6 bg-gradient-to-r from-accent to-teal-600 text-white px-8 py-3 rounded-2xl font-semibold active:scale-95 transition-transform shadow-lg shadow-accent/20"
        >
          {t('common.back', 'Back')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] relative overflow-hidden">
      {/* Background floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${4 + (i % 3) * 2}px`,
              height: `${4 + (i % 3) * 2}px`,
              background: i % 2 === 0 ? 'rgba(212, 165, 116, 0.3)' : 'rgba(224, 185, 138, 0.25)',
              left: `${8 + i * 12}%`,
              top: `${10 + (i % 4) * 20}%`,
              animation: `float-particle-gift ${4 + i * 0.6}s ease-in-out infinite`,
              animationDelay: `${i * 0.4}s`,
            }}
          />
        ))}
      </div>

      {/* Header with tree illustration and confetti */}
      <div className="relative pt-8 pb-6 text-center overflow-hidden">
        {/* Floating confetti decorations */}
        <div className="absolute top-3 left-5 opacity-70" style={{ animation: 'confetti-float 3s ease-in-out infinite' }}>
          <svg width="22" height="22" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1.5" fill="#E0B98A" transform="rotate(25 8 7)" opacity="0.8"/></svg>
        </div>
        <div className="absolute top-6 right-7 opacity-60" style={{ animation: 'confetti-float 3.5s ease-in-out infinite', animationDelay: '0.5s' }}>
          <svg width="20" height="20" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1.5" fill="#4DB6AC" transform="rotate(-20 8 7)" opacity="0.7"/></svg>
        </div>
        <div className="absolute top-12 left-1/4 opacity-50" style={{ animation: 'confetti-float 4s ease-in-out infinite', animationDelay: '1s' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10L12 2Z" fill="#D4A574" opacity="0.6"/>
          </svg>
        </div>
        <div className="absolute top-16 right-1/4 opacity-40" style={{ animation: 'confetti-float 3.8s ease-in-out infinite', animationDelay: '1.5s' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10L12 2Z" fill="#B8860B" opacity="0.5"/>
          </svg>
        </div>

        {/* Tree illustration - beautiful SVG with fruits */}
        <div className="mb-5 relative inline-block">
          <div className="absolute inset-0 bg-green-200/15 rounded-full blur-3xl scale-[2.5]" />
          <svg width="120" height="120" viewBox="0 0 120 120" className="relative mx-auto">
            {/* Trunk */}
            <path d="M60 115 Q59 85 57 65" stroke="#6D4C41" strokeWidth="7" fill="none" strokeLinecap="round" />
            <path d="M57 80 Q45 75 38 70" stroke="#795548" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M58 70 Q70 65 78 60" stroke="#795548" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            {/* Leaf canopy */}
            <ellipse cx="60" cy="42" rx="42" ry="32" fill="#4CAF50" opacity="0.9" />
            <ellipse cx="38" cy="38" rx="24" ry="20" fill="#66BB6A" opacity="0.8" />
            <ellipse cx="78" cy="38" rx="24" ry="20" fill="#81C784" opacity="0.8" />
            <ellipse cx="60" cy="26" rx="26" ry="18" fill="#A5D6A7" opacity="0.7" />
            <ellipse cx="45" cy="50" rx="16" ry="12" fill="#66BB6A" opacity="0.6" />
            <ellipse cx="75" cy="48" rx="16" ry="12" fill="#81C784" opacity="0.6" />
            {/* Orange fruits */}
            <circle cx="38" cy="32" r="6" fill="#E65100" opacity="0.9" />
            <circle cx="38" cy="32" r="4.5" fill="#FF9800" />
            <circle cx="36" cy="30" r="1.8" fill="#FFB74D" opacity="0.7" />
            <circle cx="72" cy="30" r="6" fill="#E65100" opacity="0.9" />
            <circle cx="72" cy="30" r="4.5" fill="#FF9800" />
            <circle cx="70" cy="28" r="1.8" fill="#FFB74D" opacity="0.7" />
            <circle cx="55" cy="45" r="5" fill="#E65100" opacity="0.85" />
            <circle cx="55" cy="45" r="3.5" fill="#FF9800" />
            <circle cx="53" cy="43" r="1.5" fill="#FFB74D" opacity="0.7" />
            <circle cx="80" cy="42" r="5" fill="#E65100" opacity="0.85" />
            <circle cx="80" cy="42" r="3.5" fill="#FF9800" />
          </svg>
          {/* Confetti around tree */}
          <div className="absolute -top-1 -right-2" style={{ animation: 'confetti-float 2.5s ease-in-out infinite' }}>
            <svg width="12" height="12" viewBox="0 0 12 12"><rect width="4" height="6" rx="1" fill="#F5A623" opacity="0.7" transform="rotate(30 2 3)"/></svg>
          </div>
          <div className="absolute -top-2 -left-3" style={{ animation: 'confetti-float 3s ease-in-out infinite', animationDelay: '0.8s' }}>
            <svg width="10" height="10" viewBox="0 0 12 12"><rect width="4" height="6" rx="1" fill="#4DB6AC" opacity="0.6" transform="rotate(-25 2 3)"/></svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight px-6">
          {t('giftTree.treeReady', 'Your Tree is Ready!')}
        </h1>
        <p className="text-accent font-bold text-lg sm:text-xl mt-1 px-6">
          {t('giftTree.chooseGift', 'Choose Your Gift')}
        </p>
      </div>

      {/* Game rules */}
      <div className="px-4 mb-4 relative z-10">
        <div className="bg-white/80 rounded-2xl p-3.5 border border-[#FFF3E0] shadow-sm">
          <div className="text-sm font-bold text-foreground mb-1.5">
            {t('giftTree.howToPlayTitle', 'How to play')}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('giftTree.howToPlaySelect', 'Choose a gift first. Complete real tasks to collect drops. When the tree is full, show the pickup code at DODO and take the gift.')}
          </p>
        </div>
      </div>

      {/* Gift cards grid */}
      <div className="px-4 pb-4 relative z-10">
        <div className="grid grid-cols-2 gap-3">
          {giftItems.map((item, idx) => {
            const available = item.stock - item.reserved_stock;
            const name = getLocalizedText(item.name_i18n, lang) || item.name;
            const isFirst = idx === 0;
            const isSelected = selectedId === item.id;
            const isLastOdd = giftItems.length % 2 === 1 && idx === giftItems.length - 1;
            const imgSrc = item.image_url || null;

            return (
              <div
                key={item.id}
                className={`relative bg-white rounded-2xl overflow-hidden shadow-sm transition-all duration-200 ${
                  isSelected
                    ? 'border-2 border-accent ring-2 ring-accent/15 scale-[0.97] shadow-md'
                    : 'border-2 border-transparent hover:shadow-md'
                } ${isLastOdd ? 'col-span-2 max-w-[200px] mx-auto' : ''}`}
              >
                {/* Popular badge for first item */}
                {isFirst && (
                  <div className="absolute -top-0 right-2 z-10">
                    <div className="bg-gradient-to-r from-orange-400 to-orange-500 text-white text-[10px] font-bold px-3 py-1 rounded-b-lg shadow-sm">
                      {t('giftTree.popular', 'Popular')}
                    </div>
                  </div>
                )}

                <div className="p-3.5 pb-3">
                  {/* Gift image */}
                  <div className="flex justify-center mb-3">
                    {imgSrc ? (
                      <div className="relative w-[4.5rem] h-[4.5rem] overflow-hidden rounded-xl bg-gradient-to-br from-[#FFF8F0] to-[#FFF3E0]">
                        <LazyImage
                          src={imgSrc}
                          alt={name}
                          objectFit="contain"
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                        />
                      </div>
                    ) : (
                      <div className="w-[4.5rem] h-[4.5rem] bg-gradient-to-br from-[#FFF8F0] to-[#FFE0B2] rounded-xl flex items-center justify-center text-3xl shadow-inner">
                        🎁
                      </div>
                    )}
                  </div>

                  {/* Gift name */}
                  <h3 className="font-bold text-foreground text-[13px] text-center leading-tight line-clamp-2 min-h-[2.2rem] mb-0.5">
                    {name}
                  </h3>

                  {/* Stock info */}
                  <p className="text-muted-foreground text-[11px] text-center mb-3 tabular-nums">
                    {available} {t('giftTree.left', 'left')}
                  </p>

                  {/* Choose button */}
                  <button
                    onClick={() => handleChoose(item)}
                    disabled={startTree.isPending || available <= 0}
                    className={`w-full py-2.5 rounded-xl font-semibold text-[13px] transition-all active:scale-95 leading-snug ${
                      available <= 0
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-accent to-teal-600 text-white shadow-sm shadow-accent/20 hover:shadow-md'
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
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom tip */}
      <div className="text-center pb-8 px-6 relative z-10">
        <div className="flex items-start justify-center gap-1.5 text-muted-foreground text-[11px] leading-snug">
          <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>{t('giftTree.pickupTip', 'Pick up at your nearest DODO point within 15 days after completion')}</span>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes confetti-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-10px) rotate(12deg); }
        }
        @keyframes float-particle-gift {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.2; }
          25% { transform: translateY(-15px) translateX(5px); opacity: 0.5; }
          50% { transform: translateY(-25px) translateX(-3px); opacity: 0.3; }
          75% { transform: translateY(-10px) translateX(-8px); opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

export default GiftSelector;
