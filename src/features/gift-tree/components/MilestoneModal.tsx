/**
 * 希望之树 - 阶段奖励弹窗
 *
 * 当水滴达到 200/500/800 阈值时弹出，展示奖励信息。
 * 参考 UI 设计图中的 "200 Drops Reached!" 弹窗。
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
    200: t('giftTree.milestone200', 'Congratulations! You earned 🪙 Lucky Coin!'),
    500: t('giftTree.milestone500', 'Amazing! You earned 🎁 2 Lucky Coins!'),
    800: t('giftTree.milestone800', 'Almost there! You earned 🎟️ 1 TJS Coupon!'),
  };

  const message = milestoneMessages[milestone] || t('giftTree.milestoneGeneric', 'Milestone reached!');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
        {/* Gold border */}
        <div className="absolute inset-0 rounded-2xl border-2 border-primary/40 pointer-events-none" />

        {/* Content */}
        <div className="p-6 text-center">
          {/* Gift icon */}
          <div className="text-5xl mb-3 animate-bounce">🎁</div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {milestone} {t('giftTree.dropsReached', 'Drops Reached!')}
          </h2>

          {/* Message */}
          <p className="text-muted-foreground text-sm mb-5">{message}</p>

          {/* Progress timeline */}
          <div className="flex items-center justify-between px-2 mb-6">
            {MILESTONES.map((ms, idx) => {
              const reached = currentWater >= ms.water;
              const isCurrent = ms.water === milestone;
              return (
                <React.Fragment key={ms.water}>
                  {idx > 0 && (
                    <div
                      className={`flex-1 h-0.5 mx-1 ${
                        currentWater >= ms.water ? 'bg-primary' : 'bg-gray-200'
                      }`}
                    />
                  )}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        reached
                          ? isCurrent
                            ? 'bg-primary text-white ring-4 ring-primary/20 scale-110'
                            : 'bg-accent text-white'
                          : 'bg-gray-200 text-gray-400'
                      }`}
                    >
                      {reached ? '✓' : '🔒'}
                    </div>
                    <span className="text-[10px] mt-1 text-muted-foreground">
                      {ms.water}
                    </span>
                    <span className={`text-[9px] ${reached ? 'text-accent font-medium' : 'text-muted-foreground'}`}>
                      {idx === 0 ? '1 coin' : idx === 1 ? '🎁 2 coins' : idx === 2 ? '1 coupon' : 'Gift'}
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
              className="w-full bg-accent text-white font-semibold py-3 rounded-xl hover:bg-accent/90 active:scale-[0.98] transition-all mb-2"
            >
              {t('giftTree.useLuckyCoin', 'Use Lucky Coin Now')}
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full text-foreground font-medium py-2 underline underline-offset-2 text-sm"
          >
            {t('giftTree.continueGrowing', 'Continue Growing')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MilestoneModal;
