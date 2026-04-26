/**
 * 希望之树 - 树的视觉展示组件
 *
 * 根据水滴进度展示不同阶段的树（5阶段渐变）。
 * 使用 SVG + CSS 动画实现精美视觉，弱网自动降级。
 * 对标设计图中的树视觉效果：草地、花朵、星星装饰。
 */
import React, { useMemo } from 'react';
import { useNetwork } from '../../../contexts/NetworkContext';
import { getTreeStage, type TreeStage } from '../types';

interface TreeCanvasProps {
  currentWater: number;
  targetWater: number;
  isWatering?: boolean;
}

const TreeCanvas: React.FC<TreeCanvasProps> = ({
  currentWater,
  targetWater,
  isWatering = false,
}) => {
  const { isSlow } = useNetwork();
  const stage = useMemo(
    () => getTreeStage(currentWater, targetWater),
    [currentWater, targetWater]
  );

  const stageIndex = ['seed', 'sprout', 'young', 'mature', 'complete'].indexOf(stage);

  return (
    <div className="relative flex flex-col items-center justify-center py-4 px-4 select-none">
      {/* Decorative sparkles - only on good network */}
      {!isSlow && stageIndex >= 2 && (
        <>
          <div className="absolute top-6 right-12 opacity-70" style={{ animation: 'sparkle 2s ease-in-out infinite' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10L12 2Z" fill="#F5A623" opacity="0.8"/>
            </svg>
          </div>
          <div className="absolute top-16 left-8 opacity-50" style={{ animation: 'sparkle 2.5s ease-in-out infinite', animationDelay: '0.8s' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10L12 2Z" fill="#F5A623" opacity="0.7"/>
            </svg>
          </div>
          {stageIndex >= 3 && (
            <div className="absolute top-10 right-1/4 opacity-60" style={{ animation: 'sparkle 3s ease-in-out infinite', animationDelay: '1.5s' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10L12 2Z" fill="#F5A623" opacity="0.6"/>
              </svg>
            </div>
          )}
        </>
      )}

      {/* Swirl decoration for mature/complete */}
      {!isSlow && stageIndex >= 3 && (
        <div className="absolute inset-0 pointer-events-none" style={{ animation: 'slow-rotate 20s linear infinite' }}>
          <svg className="w-full h-full opacity-10" viewBox="0 0 300 300">
            <circle cx="150" cy="150" r="120" fill="none" stroke="#D4A574" strokeWidth="1" strokeDasharray="8 12" />
            <circle cx="150" cy="150" r="100" fill="none" stroke="#D4A574" strokeWidth="0.5" strokeDasharray="4 16" />
          </svg>
        </div>
      )}

      {/* Tree SVG */}
      <div
        className={`relative transition-transform duration-700 ease-out ${
          isWatering && !isSlow ? 'scale-[1.03]' : ''
        }`}
      >
        {stage === 'seed' && <SeedTree />}
        {stage === 'sprout' && <SproutTree />}
        {stage === 'young' && <YoungTree />}
        {stage === 'mature' && <MatureTree />}
        {stage === 'complete' && <CompleteTree />}

        {/* Watering effect */}
        {isWatering && !isSlow && (
          <div className="absolute top-0 right-0 w-16 h-16" style={{ animation: 'pour-water 1.5s ease-in-out' }}>
            <svg viewBox="0 0 64 64" className="w-full h-full">
              <text x="8" y="40" fontSize="32">🚿</text>
            </svg>
          </div>
        )}
      </div>

      {/* Ground / grass */}
      <div className="relative w-64 -mt-2">
        <svg viewBox="0 0 260 40" className="w-full">
          <defs>
            <radialGradient id="grassGrad" cx="50%" cy="30%" r="60%">
              <stop offset="0%" stopColor="#8BC34A" stopOpacity="0.4" />
              <stop offset="60%" stopColor="#AED581" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#C5E1A5" stopOpacity="0.1" />
            </radialGradient>
          </defs>
          <ellipse cx="130" cy="20" rx="125" ry="18" fill="url(#grassGrad)" />
          {/* Small flowers on grass */}
          {stageIndex >= 2 && (
            <>
              <circle cx="40" cy="18" r="3" fill="#FFB74D" opacity="0.6" />
              <circle cx="90" cy="22" r="2.5" fill="#FF8A65" opacity="0.5" />
              <circle cx="180" cy="16" r="3" fill="#FFB74D" opacity="0.6" />
              <circle cx="220" cy="20" r="2" fill="#FFCC80" opacity="0.5" />
            </>
          )}
          {stageIndex >= 3 && (
            <>
              <circle cx="60" cy="14" r="2" fill="#F48FB1" opacity="0.5" />
              <circle cx="200" cy="14" r="2.5" fill="#F48FB1" opacity="0.5" />
              <path d="M150 12 Q152 8 154 12 Q158 10 156 14 Q158 18 154 16 Q152 20 150 16 Q146 18 148 14 Q146 10 150 12Z" fill="#FF8A65" opacity="0.4" />
            </>
          )}
        </svg>
      </div>

      {/* Inline CSS animations */}
      <style>{`
        @keyframes sparkle {
          0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.5; }
          50% { transform: scale(1.3) rotate(15deg); opacity: 1; }
        }
        @keyframes slow-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pour-water {
          0% { opacity: 0; transform: translate(10px, -10px) rotate(-30deg); }
          20% { opacity: 1; transform: translate(0, 0) rotate(-15deg); }
          80% { opacity: 1; transform: translate(0, 0) rotate(-15deg); }
          100% { opacity: 0; transform: translate(-5px, 5px) rotate(0deg); }
        }
        @keyframes sway {
          0%, 100% { transform: rotate(-1deg); }
          50% { transform: rotate(1deg); }
        }
        @keyframes bloom {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};

/* ========== Stage 1: Seed ========== */
const SeedTree: React.FC = () => (
  <svg width="160" height="180" viewBox="0 0 160 180">
    {/* Soil mound */}
    <ellipse cx="80" cy="165" rx="45" ry="12" fill="#8D6E63" opacity="0.3" />
    {/* Seed */}
    <ellipse cx="80" cy="150" rx="12" ry="8" fill="#795548" />
    {/* Tiny sprout */}
    <path d="M80 150 Q80 135 78 125" stroke="#66BB6A" strokeWidth="2" fill="none" strokeLinecap="round" />
    <ellipse cx="76" cy="122" rx="6" ry="4" fill="#81C784" transform="rotate(-20 76 122)" />
  </svg>
);

/* ========== Stage 2: Sprout ========== */
const SproutTree: React.FC = () => (
  <svg width="160" height="200" viewBox="0 0 160 200">
    {/* Stem */}
    <path d="M80 190 Q80 140 78 100" stroke="#6D4C41" strokeWidth="4" fill="none" strokeLinecap="round" />
    {/* Leaves */}
    <g style={{ animation: 'sway 4s ease-in-out infinite' }}>
      <ellipse cx="65" cy="110" rx="18" ry="10" fill="#81C784" transform="rotate(-30 65 110)" />
      <ellipse cx="95" cy="100" rx="16" ry="9" fill="#66BB6A" transform="rotate(25 95 100)" />
      <ellipse cx="72" cy="85" rx="14" ry="8" fill="#A5D6A7" transform="rotate(-15 72 85)" />
    </g>
  </svg>
);

/* ========== Stage 3: Young Tree ========== */
const YoungTree: React.FC = () => (
  <svg width="200" height="240" viewBox="0 0 200 240">
    {/* Trunk */}
    <path d="M100 230 Q100 180 98 140 Q96 120 100 100" stroke="#6D4C41" strokeWidth="8" fill="none" strokeLinecap="round" />
    {/* Branches */}
    <path d="M98 140 Q70 130 55 120" stroke="#795548" strokeWidth="4" fill="none" strokeLinecap="round" />
    <path d="M100 120 Q130 110 145 100" stroke="#795548" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    <path d="M99 105 Q75 90 60 80" stroke="#795548" strokeWidth="3" fill="none" strokeLinecap="round" />
    {/* Leaf clusters */}
    <g style={{ animation: 'sway 5s ease-in-out infinite' }}>
      <ellipse cx="50" cy="112" rx="22" ry="16" fill="#66BB6A" opacity="0.85" />
      <ellipse cx="148" cy="92" rx="20" ry="14" fill="#81C784" opacity="0.85" />
      <ellipse cx="55" cy="72" rx="24" ry="16" fill="#4CAF50" opacity="0.8" />
      <ellipse cx="100" cy="65" rx="28" ry="18" fill="#66BB6A" opacity="0.9" />
      <ellipse cx="140" cy="75" rx="18" ry="12" fill="#81C784" opacity="0.8" />
    </g>
    {/* Small flowers */}
    <circle cx="70" cy="100" r="4" fill="#FFB74D" opacity="0.7" />
    <circle cx="130" cy="85" r="3.5" fill="#F48FB1" opacity="0.6" />
  </svg>
);

/* ========== Stage 4: Mature Tree (with flowers) ========== */
const MatureTree: React.FC = () => (
  <svg width="240" height="280" viewBox="0 0 240 280">
    {/* Trunk */}
    <path d="M120 270 Q118 220 115 180 Q112 150 120 120" stroke="#5D4037" strokeWidth="12" fill="none" strokeLinecap="round" />
    {/* Major branches */}
    <path d="M115 180 Q80 165 50 150" stroke="#6D4C41" strokeWidth="6" fill="none" strokeLinecap="round" />
    <path d="M118 160 Q155 145 185 135" stroke="#6D4C41" strokeWidth="5.5" fill="none" strokeLinecap="round" />
    <path d="M117 140 Q85 120 55 105" stroke="#6D4C41" strokeWidth="5" fill="none" strokeLinecap="round" />
    <path d="M120 125 Q150 110 175 95" stroke="#6D4C41" strokeWidth="4.5" fill="none" strokeLinecap="round" />
    <path d="M119 110 Q100 85 90 65" stroke="#6D4C41" strokeWidth="4" fill="none" strokeLinecap="round" />
    {/* Leaf canopy */}
    <g style={{ animation: 'sway 6s ease-in-out infinite' }}>
      <ellipse cx="45" cy="140" rx="30" ry="22" fill="#4CAF50" opacity="0.85" />
      <ellipse cx="190" cy="125" rx="28" ry="20" fill="#66BB6A" opacity="0.85" />
      <ellipse cx="50" cy="95" rx="32" ry="22" fill="#388E3C" opacity="0.8" />
      <ellipse cx="120" cy="70" rx="40" ry="28" fill="#4CAF50" opacity="0.9" />
      <ellipse cx="180" cy="85" rx="28" ry="20" fill="#66BB6A" opacity="0.85" />
      <ellipse cx="85" cy="55" rx="30" ry="20" fill="#81C784" opacity="0.8" />
      <ellipse cx="155" cy="60" rx="28" ry="18" fill="#4CAF50" opacity="0.85" />
    </g>
    {/* Flowers */}
    <g style={{ animation: 'bloom 3s ease-in-out infinite' }}>
      <circle cx="60" cy="130" r="5" fill="#F8BBD0" opacity="0.9" />
      <circle cx="60" cy="130" r="2" fill="#F48FB1" />
      <circle cx="170" cy="115" r="5" fill="#F8BBD0" opacity="0.9" />
      <circle cx="170" cy="115" r="2" fill="#F48FB1" />
      <circle cx="100" cy="60" r="4.5" fill="#FFCCBC" opacity="0.9" />
      <circle cx="100" cy="60" r="2" fill="#FF8A65" />
      <circle cx="140" cy="75" r="4" fill="#F8BBD0" opacity="0.8" />
      <circle cx="140" cy="75" r="1.5" fill="#F48FB1" />
      <circle cx="75" cy="85" r="4.5" fill="#FFCCBC" opacity="0.85" />
      <circle cx="75" cy="85" r="2" fill="#FF8A65" />
    </g>
  </svg>
);

/* ========== Stage 5: Complete Tree (with fruits) ========== */
const CompleteTree: React.FC = () => (
  <svg width="260" height="300" viewBox="0 0 260 300">
    {/* Trunk */}
    <path d="M130 290 Q128 235 124 190 Q120 155 130 120" stroke="#4E342E" strokeWidth="14" fill="none" strokeLinecap="round" />
    {/* Major branches */}
    <path d="M124 195 Q80 175 40 155" stroke="#5D4037" strokeWidth="7" fill="none" strokeLinecap="round" />
    <path d="M127 170 Q170 150 210 140" stroke="#5D4037" strokeWidth="6.5" fill="none" strokeLinecap="round" />
    <path d="M126 150 Q80 125 45 105" stroke="#5D4037" strokeWidth="6" fill="none" strokeLinecap="round" />
    <path d="M130 135 Q165 115 200 100" stroke="#5D4037" strokeWidth="5.5" fill="none" strokeLinecap="round" />
    <path d="M128 120 Q105 90 85 60" stroke="#5D4037" strokeWidth="5" fill="none" strokeLinecap="round" />
    <path d="M130 115 Q155 85 170 55" stroke="#5D4037" strokeWidth="4.5" fill="none" strokeLinecap="round" />
    {/* Rich leaf canopy */}
    <g style={{ animation: 'sway 6s ease-in-out infinite' }}>
      <ellipse cx="35" cy="145" rx="35" ry="25" fill="#388E3C" opacity="0.9" />
      <ellipse cx="215" cy="130" rx="32" ry="22" fill="#4CAF50" opacity="0.9" />
      <ellipse cx="40" cy="95" rx="38" ry="26" fill="#2E7D32" opacity="0.85" />
      <ellipse cx="130" cy="65" rx="50" ry="35" fill="#388E3C" opacity="0.9" />
      <ellipse cx="205" cy="90" rx="32" ry="22" fill="#4CAF50" opacity="0.9" />
      <ellipse cx="80" cy="48" rx="35" ry="24" fill="#66BB6A" opacity="0.85" />
      <ellipse cx="175" cy="52" rx="34" ry="22" fill="#4CAF50" opacity="0.9" />
      <ellipse cx="130" cy="35" rx="30" ry="20" fill="#81C784" opacity="0.8" />
    </g>
    {/* Orange fruits */}
    <g>
      <circle cx="55" cy="125" r="8" fill="#FF9800" />
      <circle cx="55" cy="125" r="6" fill="#FFB74D" />
      <circle cx="195" cy="115" r="8" fill="#FF9800" />
      <circle cx="195" cy="115" r="6" fill="#FFB74D" />
      <circle cx="100" cy="55" r="7" fill="#FF9800" />
      <circle cx="100" cy="55" r="5" fill="#FFB74D" />
      <circle cx="160" cy="60" r="7" fill="#FF9800" />
      <circle cx="160" cy="60" r="5" fill="#FFB74D" />
      <circle cx="75" cy="80" r="6.5" fill="#FF9800" />
      <circle cx="75" cy="80" r="4.5" fill="#FFB74D" />
      <circle cx="185" cy="80" r="6.5" fill="#FF9800" />
      <circle cx="185" cy="80" r="4.5" fill="#FFB74D" />
    </g>
    {/* Confetti for complete */}
    <g style={{ animation: 'sparkle 2s ease-in-out infinite' }}>
      <rect x="30" y="30" width="4" height="8" fill="#F44336" opacity="0.7" transform="rotate(30 32 34)" />
      <rect x="220" y="25" width="4" height="8" fill="#2196F3" opacity="0.7" transform="rotate(-20 222 29)" />
      <rect x="60" y="15" width="3" height="7" fill="#FFC107" opacity="0.7" transform="rotate(45 61 18)" />
      <rect x="190" y="20" width="3" height="7" fill="#4CAF50" opacity="0.7" transform="rotate(-35 191 23)" />
      <rect x="130" y="10" width="4" height="8" fill="#FF9800" opacity="0.7" transform="rotate(15 132 14)" />
    </g>
  </svg>
);

export default TreeCanvas;
