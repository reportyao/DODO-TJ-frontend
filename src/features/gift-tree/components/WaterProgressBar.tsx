/**
 * 希望之树 - 水滴进度条（含阶段奖励节点标记）
 *
 * 展示当前水滴进度，标记 200/500/800/1000 四个里程碑节点。
 * 已领取的节点显示勾选，未领取的显示锁定。
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { MILESTONES } from '../constants';

interface WaterProgressBarProps {
  currentWater: number;
  targetWater: number;
  milestone200Claimed: boolean;
  milestone500Claimed: boolean;
  milestone800Claimed: boolean;
}

const WaterProgressBar: React.FC<WaterProgressBarProps> = ({
  currentWater,
  targetWater,
  milestone200Claimed,
  milestone500Claimed,
  milestone800Claimed,
}) => {
  const { t } = useTranslation();
  const percent = Math.min((currentWater / targetWater) * 100, 100);

  const milestoneStates = [
    { ...MILESTONES[0], claimed: milestone200Claimed },
    { ...MILESTONES[1], claimed: milestone500Claimed },
    { ...MILESTONES[2], claimed: milestone800Claimed },
    { ...MILESTONES[3], claimed: currentWater >= targetWater },
  ];

  return (
    <div className="w-full px-4 py-3">
      {/* 水滴数字 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-lg">💧</span>
          <span className="text-accent font-bold text-lg">{currentWater}</span>
          <span className="text-muted-foreground text-sm">/{targetWater} {t('giftTree.drops', 'drops')}</span>
        </div>
        <span className="text-accent font-semibold text-sm">{Math.round(percent)}%</span>
      </div>

      {/* 进度条 */}
      <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${percent}%`,
            background: 'linear-gradient(90deg, #006B6B, #00A89D)',
          }}
        />
      </div>

      {/* 里程碑节点 */}
      <div className="relative mt-3 flex justify-between px-1">
        {milestoneStates.map((ms, idx) => {
          const pos = (ms.water / targetWater) * 100;
          const reached = currentWater >= ms.water;
          return (
            <div
              key={ms.water}
              className="flex flex-col items-center"
              style={{ width: '22%' }}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  ms.claimed
                    ? 'bg-accent text-white'
                    : reached
                    ? 'bg-primary text-white ring-2 ring-primary/30 animate-pulse'
                    : 'bg-gray-200 text-gray-400'
                }`}
              >
                {ms.claimed ? '✓' : reached ? ms.icon : '🔒'}
              </div>
              <span className={`text-[10px] mt-1 ${reached ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {ms.water}
              </span>
              <span className={`text-[9px] ${reached ? 'text-accent' : 'text-muted-foreground'}`}>
                {idx === 0 ? '1 coin' : idx === 1 ? '2 coins' : idx === 2 ? '1 coupon' : t('giftTree.freeGift', 'Gift')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WaterProgressBar;
