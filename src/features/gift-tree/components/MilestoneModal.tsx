/**
 * 希望之树 - 阶段奖励弹窗
 *
 * 当水滴达到 200/500/800 阈值时弹出，展示奖励信息。
 * 对标设计图 "200 Drops Reached!" 弹窗。
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

  // Milestone labels (short, fits all languages)
  const msLabels = ['1 coin', '🎁 2', '1 TJS', t('giftTree.freeGift', 'Gift')];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal - slides up on mobile */}
      <div className="relative bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-3xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300">
        {/* Gold accent border */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300 via-amber-400 to-amber-300" />

        {/* Content */}
        <div className="p-5 sm:p-6 text-center max-h-[80vh] overflow-y-auto">
          {/* Gift icon with glow */}
          <div className="relative inline-block mb-3">
            <div className="absolute inset-0 bg-amber-200/40 rounded-full blur-xl scale-150" />
            <span className="relative text-5xl block" style={{ animation: 'gift-bounce 1s ease-in-out infinite' }}>🎁</span>
          </div>

          {/* Title - responsive size */}
          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-1.5 leading-tight">
            {milestone} {t('giftTree.dropsReached', 'Drops Reached!')}
          </h2>

          {/* Message - allows wrapping */}
          <p className="text-muted-foreground text-sm leading-relaxed mb-5 px-2">{message}</p>

          {/* Progress timeline - compact for long text */}
          <div className="flex items-center justify-between px-1 mb-5">
            {MILESTONES.map((ms, idx) => {
              const reached = currentWater >= ms.water;
              const isCurrent = ms.water === milestone;
              return (
                <React.Fragment key={ms.water}>
                  {idx > 0 && (
                    <div
                      className={`flex-1 h-0.5 mx-0.5 transition-colors ${
                        currentWater >= ms.water ? 'bg-amber-400' : 'bg-gray-200'
                      }`}
                    />
                  )}
                  <div className="flex flex-col items-center" style={{ minWidth: '48px' }}>
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        reached
                          ? isCurrent
                            ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white ring-4 ring-amber-200/50 scale-110'
                            : 'bg-accent text-white'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {reached ? '✓' : '🔒'}
                    </div>
                    <span className="text-[10px] mt-1 text-muted-foreground font-medium tabular-nums">
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
              className="w-full bg-gradient-to-r from-accent to-teal-600 text-white font-semibold py-3 rounded-xl active:scale-[0.98] transition-all mb-2 shadow-md shadow-accent/20 text-sm leading-snug"
            >
              {t('giftTree.useLuckyCoin', 'Use Lucky Coin Now')}
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full text-foreground font-medium py-2.5 text-sm underline underline-offset-2 decoration-gray-300"
          >
            {t('giftTree.continueGrowing', 'Continue Growing')}
          </button>
        </div>
      </div>

      {/* Animation */}
      <style>{`
        @keyframes gift-bounce {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-8px) rotate(-3deg); }
          75% { transform: translateY(-4px) rotate(3deg); }
        }
      `}</style>
    </div>
  );
};

export default MilestoneModal;
