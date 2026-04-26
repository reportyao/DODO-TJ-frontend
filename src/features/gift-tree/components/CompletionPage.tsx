/**
 * 希望之树 - 完成页面（核销码展示）
 *
 * 当树完成生长后，展示核销码和领取信息。
 * 用户可以到门店出示核销码领取礼物。
 *
 * 多语言适配：
 * - 步骤文字使用 leading-snug 紧凑行高，允许换行
 * - 按钮文字使用 text-[13px] 避免俄语溢出
 * - 核销码使用 tracking-[0.2em] 保证可读性
 * - 所有文字区域使用 min-w-0 + flex-1 防止溢出
 */
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { getLocalizedText } from '../../../lib/utils';
import { useGiftTreeStatus } from '../hooks/useGiftTree';

const CompletionPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'zh';
  const { data: status, isLoading } = useGiftTreeStatus();
  const [copied, setCopied] = useState(false);

  const tree = status?.tree;
  const giftItem = tree?.gift_item || tree?.gift_snapshot;

  // Expiry calculation
  const expiryInfo = useMemo(() => {
    if (!tree?.pickup_code_expires_at) return null;
    const expires = new Date(tree.pickup_code_expires_at);
    const now = new Date();
    const diffMs = expires.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return {
      date: expires.toLocaleDateString(),
      daysLeft: Math.max(0, diffDays),
      isExpired: diffMs <= 0,
    };
  }, [tree]);

  const handleCopy = async () => {
    if (!tree?.pickup_code) return;
    try {
      await navigator.clipboard.writeText(tree.pickup_code);
    } catch {
      // Fallback
      const el = document.createElement('input');
      el.value = tree.pickup_code;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    toast.success(t('giftTree.copied', 'Copied!'));
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] to-[#FFF3E0] flex items-center justify-center">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 border-3 border-accent/20 rounded-full" />
          <div className="absolute inset-0 border-3 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!tree || (tree.status !== 'COMPLETED' && tree.status !== 'CLAIMED')) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] to-[#FFF3E0] flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4">
          <span className="text-3xl">🌳</span>
        </div>
        <p className="text-foreground font-medium text-center mb-4 leading-snug">
          {t('giftTree.noCompletedTree', 'No completed tree found')}
        </p>
        <button
          onClick={() => navigate('/gift-tree', { replace: true })}
          className="bg-gradient-to-r from-accent to-teal-600 text-white px-8 py-2.5 rounded-full font-medium active:scale-95 transition-transform shadow-md shadow-accent/20 text-[13px]"
        >
          {t('giftTree.goToTree', 'Go to Tree')}
        </button>
      </div>
    );
  }

  const giftName = giftItem
    ? getLocalizedText(giftItem.name_i18n, lang) || giftItem.name
    : t('giftTree.gift', 'Gift');

  const isClaimed = tree.status === 'CLAIMED';

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0]">
      {/* Header with back button */}
      <div className="sticky top-0 z-10 bg-[#FDF6EC]/95 backdrop-blur-sm px-4 py-3 flex items-center">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-90 transition-all"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Celebration section */}
      <div className="pt-2 pb-5 text-center overflow-hidden relative">
        {/* Confetti */}
        <div className="absolute top-2 left-8 opacity-60" style={{ animation: 'confetti-float 3s ease-in-out infinite' }}>
          <svg width="16" height="16" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1" fill="#F5A623" transform="rotate(25 8 7)" opacity="0.7"/></svg>
        </div>
        <div className="absolute top-4 right-10 opacity-50" style={{ animation: 'confetti-float 3.5s ease-in-out infinite', animationDelay: '0.5s' }}>
          <svg width="14" height="14" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1" fill="#4DB6AC" transform="rotate(-20 8 7)" opacity="0.7"/></svg>
        </div>

        <div className="relative inline-block mb-3">
          <div className="absolute inset-0 bg-amber-200/30 rounded-full blur-2xl scale-[2]" />
          <span className="relative text-6xl block" style={{ animation: 'celebrate 2s ease-in-out infinite' }}>
            {isClaimed ? '✅' : '🏆'}
          </span>
        </div>

        <h1 className="text-xl font-bold text-foreground leading-tight px-6 mb-1">
          {isClaimed
            ? t('giftTree.alreadyClaimed', 'Gift Claimed')
            : t('giftTree.congratulations', 'Congratulations!')}
        </h1>
        <p className="text-muted-foreground text-sm leading-snug px-8">
          {isClaimed
            ? t('giftTree.treeCompleted', 'Your tree has fully grown!')
            : t('giftTree.completed', 'Pick up your gift at the store')}
        </p>
      </div>

      {/* Gift info card */}
      <div className="mx-4 bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100/60 mb-4">
        {/* Gift image area */}
        <div className="bg-gradient-to-br from-[#FFF3E0] to-[#FFE0B2] p-5 flex justify-center">
          {giftItem?.image_url ? (
            <img
              src={giftItem.image_url}
              alt={giftName}
              className="w-24 h-24 object-contain rounded-xl"
              loading="lazy"
            />
          ) : (
            <div className="w-24 h-24 bg-white/50 rounded-xl flex items-center justify-center text-4xl">
              🎁
            </div>
          )}
        </div>

        <div className="p-4 text-center">
          {/* Gift name - allows wrapping for long names */}
          <h2 className="text-base font-bold text-foreground mb-1 leading-tight line-clamp-2">{giftName}</h2>
          {giftItem?.value_tjs && (
            <span className="text-accent text-xs font-medium">{giftItem.value_tjs} TJS</span>
          )}

          {isClaimed ? (
            <div className="mt-3 bg-green-50 text-green-700 rounded-xl p-3 flex items-center justify-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="font-semibold text-sm leading-snug">
                {t('giftTree.alreadyClaimed', 'Gift Claimed')}
              </span>
            </div>
          ) : (
            <>
              {/* Expiry badge */}
              {expiryInfo && (
                <div className="flex justify-center mt-2 mb-3">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-3 py-1 rounded-full ${
                    expiryInfo.isExpired
                      ? 'bg-red-50 text-red-600'
                      : expiryInfo.daysLeft <= 2
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-gray-50 text-muted-foreground'
                  }`}>
                    {expiryInfo.isExpired ? '⏰' : '⏳'}
                    <span>
                      {expiryInfo.isExpired
                        ? t('giftTree.expired', 'Expired')
                        : `${expiryInfo.daysLeft} ${t('giftTree.daysLeft', 'days left')}`}
                    </span>
                  </span>
                </div>
              )}

              {/* Pickup code - large, prominent */}
              <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-4 mt-2">
                <div className="text-muted-foreground text-[11px] mb-2 font-medium">
                  {t('giftTree.pickupCode', 'Pickup Code')}
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-2xl font-bold text-foreground tracking-[0.2em] tabular-nums select-all">
                    {tree.pickup_code}
                  </span>
                  <button
                    onClick={handleCopy}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all flex-shrink-0 border ${
                      copied
                        ? 'bg-green-100 text-green-600 border-green-200'
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 active:scale-90'
                    }`}
                  >
                    {copied ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                {expiryInfo && !expiryInfo.isExpired && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {t('giftTree.expiresAt', 'Valid until')}: {expiryInfo.date}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* How to pickup - step by step */}
      {!isClaimed && (
        <div className="mx-4 bg-white rounded-2xl p-4 shadow-sm border border-gray-100/60 mb-6">
          <h3 className="font-bold text-foreground text-[13px] mb-3">
            {t('giftTree.howToPickup', 'How to pick up:')}
          </h3>
          <div className="space-y-2.5">
            {[
              { icon: '📍', text: t('giftTree.step1', 'Go to nearest DODO') },
              { icon: '📱', text: t('giftTree.step2', 'Show code to staff') },
              { icon: '🎁', text: t('giftTree.step3', 'Get your gift!') },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent/10 to-accent/5 flex items-center justify-center text-sm flex-shrink-0">
                  {step.icon}
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <span className="text-[12px] text-foreground/80 leading-snug">{i + 1}. {step.text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 pb-8 space-y-2.5">
        {isClaimed && (
          <button
            onClick={() => navigate('/gift-tree/select')}
            className="w-full bg-gradient-to-r from-accent to-teal-600 text-white font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-all shadow-md shadow-accent/20 text-[13px] leading-snug"
          >
            {t('giftTree.startNewTree', 'Start New Tree')}
          </button>
        )}
        <button
          onClick={() => navigate('/gift-tree')}
          className={`w-full font-semibold py-3 rounded-xl active:scale-[0.98] transition-all text-[13px] leading-snug ${
            isClaimed
              ? 'bg-white text-foreground border border-gray-200'
              : 'bg-gradient-to-r from-accent to-teal-600 text-white shadow-md shadow-accent/20'
          }`}
        >
          {t('giftTree.backToTree', 'Back to Tree')}
        </button>
        <button
          onClick={() => navigate('/')}
          className="w-full text-foreground/60 font-medium py-2.5 text-[13px] underline underline-offset-2 decoration-gray-300"
        >
          {t('common.backToHome', 'Home')}
        </button>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes celebrate {
          0%, 100% { transform: scale(1) rotate(0deg); }
          25% { transform: scale(1.05) rotate(-3deg); }
          75% { transform: scale(1.05) rotate(3deg); }
        }
        @keyframes confetti-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(10deg); }
        }
      `}</style>
    </div>
  );
};

export default CompletionPage;
