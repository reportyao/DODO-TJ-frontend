/**
 * 希望之树 - 树的视觉展示组件
 *
 * 根据水滴进度展示不同阶段的树。
 * 使用纯 CSS 动画实现，在弱网下自动降级为静态展示。
 * 不使用 Lottie 或 3D 库，保持轻量。
 */
import React, { useMemo } from 'react';
import { useNetwork } from '../../../contexts/NetworkContext';
import { getTreeStage, type TreeStage } from '../types';

interface TreeCanvasProps {
  currentWater: number;
  targetWater: number;
  isWatering?: boolean;
  userName?: string;
}

/** 树阶段对应的 emoji 和样式 */
const TREE_VISUALS: Record<TreeStage, { emoji: string; size: string; glow: string }> = {
  seed: { emoji: '🌱', size: 'text-6xl', glow: '' },
  sprout: { emoji: '🌿', size: 'text-7xl', glow: '' },
  young: { emoji: '🌳', size: 'text-8xl', glow: '' },
  mature: { emoji: '🌳', size: 'text-9xl', glow: 'drop-shadow-lg' },
  complete: { emoji: '🎄', size: 'text-9xl', glow: 'drop-shadow-xl' },
};

const TreeCanvas: React.FC<TreeCanvasProps> = ({
  currentWater,
  targetWater,
  isWatering = false,
  userName,
}) => {
  const { isSlow } = useNetwork();
  const stage = useMemo(
    () => getTreeStage(currentWater, targetWater),
    [currentWater, targetWater]
  );
  const visual = TREE_VISUALS[stage];
  const percent = Math.round((currentWater / targetWater) * 100);

  return (
    <div className="relative flex flex-col items-center justify-center py-6">
      {/* 背景装饰 - 仅在非弱网下显示 */}
      {!isSlow && (
        <>
          {/* 闪烁星星 */}
          <div className="absolute top-4 right-8 text-xl animate-pulse opacity-60">✨</div>
          <div className="absolute top-12 left-10 text-lg animate-pulse opacity-40" style={{ animationDelay: '0.5s' }}>✨</div>
          {stage === 'complete' && (
            <>
              <div className="absolute top-2 left-1/4 text-sm animate-bounce opacity-70">🎊</div>
              <div className="absolute top-6 right-1/4 text-sm animate-bounce opacity-70" style={{ animationDelay: '0.3s' }}>🎉</div>
            </>
          )}
        </>
      )}

      {/* 用户名 */}
      {userName && (
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center text-sm">
            👤
          </div>
          <span className="text-foreground font-medium text-sm">{userName}</span>
        </div>
      )}

      {/* 树 */}
      <div
        className={`relative transition-transform duration-500 ${visual.glow} ${
          isWatering && !isSlow ? 'scale-105' : ''
        }`}
      >
        <span className={`${visual.size} block`} role="img" aria-label="tree">
          {visual.emoji}
        </span>

        {/* 浇水动画 - 水滴粒子 */}
        {isWatering && !isSlow && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[...Array(6)].map((_, i) => (
              <span
                key={i}
                className="absolute text-blue-400 text-sm animate-water-drop"
                style={{
                  left: `${20 + Math.random() * 60}%`,
                  top: `${Math.random() * 30}%`,
                  animationDelay: `${i * 0.15}s`,
                  animationDuration: '1s',
                }}
              >
                💧
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 草地 */}
      <div className="w-48 h-6 bg-gradient-to-t from-green-200 to-green-100 rounded-full mt-1 opacity-60" />

      {/* CSS 动画定义 */}
      <style>{`
        @keyframes water-drop {
          0% { transform: translateY(-20px) scale(1); opacity: 1; }
          100% { transform: translateY(60px) scale(0.5); opacity: 0; }
        }
        .animate-water-drop {
          animation: water-drop 1s ease-in forwards;
        }
      `}</style>
    </div>
  );
};

export default TreeCanvas;
