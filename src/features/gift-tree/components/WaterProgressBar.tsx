/**
 * 希望之树 - 水滴进度条（含阶段奖励节点标记）
 *
 * 展示当前水滴进度，标记 200/500/800/1000 四个里程碑节点。
 * 已达成的节点显示勾选，未达成的显示锁定。
 *
 * 多语言适配：
 * - 里程碑标签使用纯数字+短标记，不含长文字
 * - 进度数字使用 tabular-nums 对齐
 * - 水滴数使用弹性布局，长数字不会溢出
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { MILESTONES } from '../constants';

interface WaterProgressBarProps {
  currentWater: number;
  targetWater: number;
  claimedMilestones?: number[];
}

const WaterProgressBar: React.FC<WaterProgressBarProps> = ({
  currentWater,
  targetWater,
  claimedMilestones = [],
}) => {
  const { t } = useTranslation();
  const percent = Math.min((currentWater / targetWater) * 100, 100);

  // Short labels that work in all languages
  const msLabels = ['1 🪙', '2 🪙', '1 TJS', t('giftTree.freeGift', 'Gift')];

  return (
    <div className="w-full">
      {/* Water count header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
            <path d="M12 2C12 2 5 10 5 15C5 18.866 8.134 22 12 22C15.866 22 19 18.866 19 15C19 10 12 2 12 2Z" fill="#00897B" opacity="0.9"/>
          </svg>
          <span className="text-accent font-bold text-base tabular-nums">{currentWater}</span>
          <span className="text-muted-foreground text-xs tabular-nums">/{targetWater}</span>
        </div>
        <span className="text-accent font-semibold text-xs tabular-nums flex-shrink-0">{Math.round(percent)}%</span>
      </div>

      {/* Progress bar */}
      <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden shadow-inner">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${Math.max(percent, 3)}%`,
            background: 'linear-gradient(90deg, #00897B, #26A69A, #4DB6AC)',
          }}
        />
        {/* Milestone dots on bar */}
        {MILESTONES.map((ms) => {
          const msPercent = (ms.water / targetWater) * 100;
          if (msPercent > 100) return null;
          const reached = currentWater >= ms.water;
          return (
            <div
              key={ms.water}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: `${msPercent}%`, transform: `translateX(-50%) translateY(-50%)` }}
            >
              <div className={`w-2 h-2 rounded-full ${reached ? 'bg-amber-400' : 'bg-white border border-gray-300'}`} />
            </div>
          );
        })}
      </div>

      {/* Milestone nodes below */}
      <div className="flex justify-between mt-3 px-0.5">
        {MILESTONES.map((ms, idx) => {
          const reached = currentWater >= ms.water;
          const claimed = claimedMilestones.includes(ms.water);
          return (
            <div key={ms.water} className="flex flex-col items-center" style={{ width: '23%' }}>
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                  claimed
                    ? 'bg-accent text-white'
                    : reached
                    ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white ring-2 ring-amber-200/50'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {claimed ? '✓' : reached ? ms.icon : '🔒'}
              </div>
              <span className={`text-[10px] mt-1 tabular-nums ${reached ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {ms.water}
              </span>
              <span className={`text-[9px] leading-tight text-center ${reached ? 'text-accent font-medium' : 'text-muted-foreground'}`}>
                {msLabels[idx]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WaterProgressBar;
