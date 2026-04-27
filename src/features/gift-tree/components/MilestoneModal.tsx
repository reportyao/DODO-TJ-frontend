/**
 * 希望之树 - 阶段奖励弹窗
 *
 * 当水滴达到 200/500/800 阈值时弹出，展示奖励信息。
 * 对标设计图 "200 Drops Reached!" 弹窗。
 * 精美金色光晕效果 + 进度时间线 + 动画礼盒。
 *
 * 多语言适配：
 * - 标题使用 text-xl 而非 text-2xl，避免俄语溢出
 * - 里程碑标签使用缩写，固定宽度
 * - 按钮文字允许换行
 * - 弹窗内容可滚动
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MilestoneReward } from '../types';
import { MILESTONES } from '../constants';

interface MilestoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  rewards: MilestoneReward[];
  currentWater: number;
  targetWater: number;
}

const MilestoneModal: React.FC<MilestoneModalProps> = ({
  isOpen,
  onClose,
  rewards,
  currentWater,
  targetWater,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!isOpen || rewards.length === 0) return null;

  const latestReward = rewards[rewards.length - 1];
  const milestone = latestReward.milestone;

  const milestoneMessages: Record<number, string> = {
    200: t('giftTree.milestone200', 'You earned 🪙 Lucky Coin!'),
    500: t('giftTree.milestone500', 'You earned 🎁 2 Lucky Coins!'),
    800: t('giftTree.milestone800', 'You earned 🎟️ 1 TJS Coupon!'),
  };

  const message = milestoneMessages[milestone] || t('giftTree.milestoneGeneric', 'Milestone reached!');
  const msLabels = ['1 coin', '🎁 2', '1 TJS', t('giftTree.freeGift', 'Gift')];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-3xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300">
        {/* Gold accent border - enhanced gradient */}
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-amber-300 via-amber-400 to-amber-300" />
        {/* Subtle golden glow at top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-amber-200/20 rounded-full blur-3xl" />

        {/* Content */}
        <div className="relative p-5 sm:p-6 text-center max-h-[80vh] overflow-y-auto">
          {/* Confetti decoration */}
          <div className="absolute top-4 left-6 opacity-50" style={{ animation: 'confetti-ms 3s ease-in-out infinite' }}>
            <svg width="14" height="14" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1" fill="#D4A574" transform="rotate(25 8 7)" opacity="0.8"/></svg>
          </div>
          <div className="absolute top-6 right-8 opacity-40" style={{ animation: 'confetti-ms 3.5s ease-in-out infinite', animationDelay: '0.5s' }}>
            <svg width="12" height="12" viewBox="0 0 20 20"><rect x="4" y="2" width="5" height="10" rx="1" fill="#4DB6AC" transform="rotate(-20 8 7)" opacity="0.7"/></svg>
          </div>

          {/* Gift icon with golden glow */}
          <div className="relative inline-block mb-4">
            <div className="absolute inset-0 bg-amber-200/30 rounded-full blur-2xl scale-[2]" />
            <div className="relative w-16 h-16 bg-gradient-to-br from-amber-100 to-amber-50 rounded-full flex items-center justify-center shadow-sm">
              <span className="text-4xl block" style={{ animation: 'gift-bounce 1s ease-in-out infinite' }}>🎁</span>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-1.5 leading-tight">
            {milestone} {t('giftTree.dropsReached', 'Drops Reached!')}
          </h2>

          {/* Message */}
          <p className="text-muted-foreground text-sm leading-relaxed mb-6 px-2">{message}</p>

          {/* Progress timeline - enhanced with golden accents */}
          <div className="flex items-center justify-between px-1 mb-6">
            {MILESTONES.map((ms, idx) => {
              const reached = currentWater >= ms.water;
              const isCurrent = ms.water === milestone;
              return (
                <React.Fragment key={ms.water}>
                  {idx > 0 && (
                    <div
                      className={`flex-1 h-0.5 mx-0.5 transition-colors duration-500 ${
                        currentWater >= ms.water
                          ? 'bg-gradient-to-r from-amber-400 to-amber-300'
                          : 'bg-gray-200'
                      }`}
                    />
                  )}
                  <div className="flex flex-col items-center" style={{ minWidth: '50px' }}>
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                        reached
                          ? isCurrent
                            ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white ring-4 ring-amber-200/50 scale-110 shadow-md shadow-amber-200/40'
                            : 'bg-gradient-to-br from-accent to-teal-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-400 border border-gray-200'
                      }`}
                    >
                      {reached ? '✓' : '🔒'}
                    </div>
                    <span className="text-[10px] mt-1.5 text-muted-foreground font-medium tabular-nums">
                      {ms.water}
                    </span>
                    <span className={`text-[9px] leading-tight text-center ${reached ? 'text-accent font-medium' : 'text-muted-foreground'}`}>
                      {msLabels[idx]}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* Action buttons */}
          {latestReward.reward_type === 'bonus_balance' && (
            <button
              onClick={() => {
                onClose();
                navigate('/lottery');
              }}
              className="w-full bg-gradient-to-r from-accent to-teal-600 text-white font-semibold py-3.5 rounded-2xl active:scale-[0.98] transition-all mb-2.5 shadow-lg shadow-accent/20 text-sm leading-snug"
            >
              {t('giftTree.useLuckyCoin', 'Use Lucky Coin Now')}
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full text-foreground font-medium py-2.5 text-sm underline underline-offset-4 decoration-gray-300 hover:decoration-gray-400 transition-colors"
          >
            {t('giftTree.continueGrowing', 'Continue Growing')}
          </button>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes gift-bounce {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-6px) rotate(-3deg); }
          75% { transform: translateY(-3px) rotate(3deg); }
        }
        @keyframes confetti-ms {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(10deg); }
        }
      `}</style>
    </div>
  );
};

export default MilestoneModal;
