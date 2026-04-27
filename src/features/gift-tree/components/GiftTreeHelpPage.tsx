/**
 * 希望之树 - 好友助力页面
 *
 * 当用户通过分享链接进入时，展示好友的树并提供助力按钮。
 * URL: /gift-tree/help/:ownerId
 * ownerId 是树主人的 user_id（非 tree.id）。
 * 精美暖色调设计，带有树插画和水滴动画。
 *
 * 多语言适配：
 * - 描述文字使用 leading-relaxed + max-w-xs 控制宽度
 * - 按钮使用 min-h-[48px] + text-[13px] 防止俄语溢出
 * - 错误信息使用 leading-snug 紧凑行高
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useHelpFriend } from '../hooks/useGiftTree';

const GiftTreeHelpPage: React.FC = () => {
  const { ownerId } = useParams<{ ownerId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const helpFriend = useHelpFriend();
  const [helped, setHelped] = useState(false);
  const [waterEarned, setWaterEarned] = useState(0);

  const handleHelp = async () => {
    if (!ownerId || helpFriend.isPending || helped) return;
    try {
      const result = await helpFriend.mutateAsync({ treeOwnerId: ownerId });
      if (result.success) {
        setHelped(true);
        setWaterEarned(result.water_earned);
        toast.success(
          t('giftTree.helpSuccess', 'Success! Sent {{water}} drops').replace(
            '{{water}}',
            String(result.water_earned)
          ),
          { duration: 3000 }
        );
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('ERR_ALREADY_HELPED') || msg.includes('ERR_DUPLICATE')) {
        toast(t('giftTree.alreadyHelped', 'Already helped today'), { icon: '⚠️' });
        setHelped(true);
      } else if (msg.includes('ERR_SELF_HELP')) {
        toast(t('giftTree.selfHelp', "Can't help yourself"), { icon: '⚠️' });
      } else if (msg.includes('ERR_NO_TREE')) {
        toast.error(t('giftTree.noTree', 'No tree found'));
      } else if (msg.includes('ERR_HELP_LIMIT')) {
        toast(t('giftTree.helpLimit', 'Help limit reached'), { icon: '⚠️' });
        setHelped(true);
      } else {
        toast.error(msg || t('common.error', 'Error'));
      }
    }
  };

  if (!ownerId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center mb-4 shadow-sm">
          <span className="text-4xl">😔</span>
        </div>
        <p className="text-muted-foreground text-center text-sm leading-snug mb-4">
          {t('common.error', 'Invalid link')}
        </p>
        <button
          onClick={() => navigate('/')}
          className="bg-gradient-to-r from-accent to-teal-600 text-white px-8 py-3 rounded-2xl font-semibold active:scale-95 transition-transform shadow-lg shadow-accent/20 text-[13px]"
        >
          {t('common.backToHome', 'Home')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${3 + (i % 3) * 2}px`,
              height: `${3 + (i % 3) * 2}px`,
              background: i % 2 === 0 ? 'rgba(212, 165, 116, 0.25)' : 'rgba(77, 182, 172, 0.2)',
              left: `${10 + i * 18}%`,
              top: `${15 + (i % 3) * 25}%`,
              animation: `float-help ${4 + i * 0.5}s ease-in-out infinite`,
              animationDelay: `${i * 0.5}s`,
            }}
          />
        ))}
      </div>

      <div className="w-full max-w-sm text-center relative z-10">
        {/* Tree illustration - enhanced SVG */}
        <div className="relative mb-6 inline-block">
          <div className="absolute inset-0 bg-green-200/15 rounded-full blur-3xl scale-[2.5]" />
          <svg width="120" height="120" viewBox="0 0 120 120" className="relative">
            {/* Trunk */}
            <path d="M60 115 Q59 85 57 65" stroke="#6D4C41" strokeWidth="7" fill="none" strokeLinecap="round" />
            <path d="M57 80 Q45 75 38 70" stroke="#795548" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M58 70 Q70 65 78 60" stroke="#795548" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            {/* Leaf canopy */}
            <ellipse cx="60" cy="42" rx="42" ry="32" fill="#4CAF50" opacity="0.9" />
            <ellipse cx="38" cy="38" rx="24" ry="20" fill="#66BB6A" opacity="0.8" />
            <ellipse cx="78" cy="38" rx="24" ry="20" fill="#81C784" opacity="0.8" />
            <ellipse cx="60" cy="26" rx="26" ry="18" fill="#A5D6A7" opacity="0.7" />
            {/* Flowers */}
            <circle cx="40" cy="35" r="4" fill="#F8BBD0" opacity="0.8" />
            <circle cx="40" cy="35" r="1.5" fill="#F48FB1" />
            <circle cx="75" cy="33" r="3.5" fill="#FFCCBC" opacity="0.8" />
            <circle cx="75" cy="33" r="1.5" fill="#FF8A65" />
            <circle cx="58" cy="48" r="3" fill="#F8BBD0" opacity="0.7" />
          </svg>
          {!helped && (
            <span className="absolute -bottom-1 right-0 text-3xl" style={{ animation: 'bounce-water 1.5s ease-in-out infinite' }}>💧</span>
          )}
          {helped && (
            <span className="absolute -top-2 -right-3 text-2xl" style={{ animation: 'sparkle-help 1.5s ease-in-out infinite' }}>✨</span>
          )}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100/60">
          <h1 className="text-lg font-bold text-foreground leading-tight mb-2">
            {helped
              ? t('giftTree.helpThanks', 'Thanks for helping!')
              : t('giftTree.helpTitle', 'Water the tree!')}
          </h1>

          <p className="text-muted-foreground text-sm leading-relaxed mb-5 px-1 max-w-xs mx-auto">
            {helped
              ? `+${waterEarned} ${t('giftTree.drops', 'drops')}`
              : t('giftTree.helpDesc', 'Your friend is growing a tree on DODO. Tap to help!')}
          </p>

          {helped ? (
            <div className="space-y-3">
              {waterEarned > 0 && (
                <div className="bg-gradient-to-r from-accent/5 to-teal-50 rounded-xl py-3.5 mb-2">
                  <span className="text-accent font-bold text-xl">+{waterEarned} 💧</span>
                </div>
              )}
              <button
                onClick={() => navigate('/gift-tree')}
                className="w-full bg-gradient-to-r from-accent to-teal-600 text-white font-semibold py-3.5 rounded-2xl active:scale-[0.98] transition-all shadow-lg shadow-accent/20 text-[13px] min-h-[48px] leading-snug"
              >
                {t('giftTree.growYourOwn', 'Grow Your Own')}
              </button>
            </div>
          ) : (
            <button
              onClick={handleHelp}
              disabled={helpFriend.isPending}
              className="w-full bg-gradient-to-r from-accent to-teal-600 text-white font-semibold py-4 rounded-2xl active:scale-[0.98] transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-2.5 text-[13px] min-h-[48px] disabled:opacity-60"
            >
              {helpFriend.isPending ? (
                <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C12 2 5 10 5 15C5 18.866 8.134 22 12 22C15.866 22 19 18.866 19 15C19 10 12 2 12 2Z" fill="white" opacity="0.9"/>
                    <path d="M12 4C12 4 7 10.5 7 14.5C7 17.538 9.239 20 12 20" fill="white" opacity="0.3"/>
                  </svg>
                  <span>{t('giftTree.helpButton', 'Water')}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Back link */}
        <button
          onClick={() => navigate('/')}
          className="mt-5 text-foreground/50 text-[13px] underline underline-offset-4 decoration-gray-300 active:opacity-60"
        >
          {t('common.backToHome', 'Home')}
        </button>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes sparkle-help {
          0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.7; }
          50% { transform: scale(1.3) rotate(15deg); opacity: 1; }
        }
        @keyframes bounce-water {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes float-help {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.2; }
          50% { transform: translateY(-18px) translateX(-4px); opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default GiftTreeHelpPage;
