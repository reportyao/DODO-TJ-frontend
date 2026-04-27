/**
 * 希望之树 - 树的视觉展示组件
 *
 * 根据水滴进度展示不同阶段的树（5阶段渐变）。
 * 使用精美 SVG + CSS 动画实现手绘插画风格视觉效果。
 * 参考设计图：草地、花朵、星星装饰、暖色调。
 * 弱网自动降级动画效果。
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
    <div className="relative flex flex-col items-center justify-center py-2 px-4 select-none">
      {/* Decorative sparkles - only on good network */}
      {!isSlow && stageIndex >= 2 && (
        <>
          <div className="absolute top-4 right-10 opacity-80" style={{ animation: 'sparkle 2.5s ease-in-out infinite' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" fill="#D4A574" opacity="0.85"/>
            </svg>
          </div>
          <div className="absolute top-14 left-6 opacity-60" style={{ animation: 'sparkle 3s ease-in-out infinite', animationDelay: '1s' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" fill="#D4A574" opacity="0.7"/>
            </svg>
          </div>
          {stageIndex >= 3 && (
            <>
              <div className="absolute top-8 left-1/4 opacity-50" style={{ animation: 'sparkle 3.5s ease-in-out infinite', animationDelay: '1.8s' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" fill="#E0B98A" opacity="0.6"/>
                </svg>
              </div>
              <div className="absolute bottom-20 right-6 opacity-40" style={{ animation: 'sparkle 4s ease-in-out infinite', animationDelay: '0.5s' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" fill="#D4A574" opacity="0.5"/>
                </svg>
              </div>
            </>
          )}
        </>
      )}

      {/* Golden swirl decoration for mature/complete */}
      {!isSlow && stageIndex >= 3 && (
        <div className="absolute inset-0 pointer-events-none" style={{ animation: 'slow-rotate 25s linear infinite' }}>
          <svg className="w-full h-full opacity-[0.07]" viewBox="0 0 300 300">
            <circle cx="150" cy="150" r="130" fill="none" stroke="#D4A574" strokeWidth="1.5" strokeDasharray="10 15" />
            <circle cx="150" cy="150" r="105" fill="none" stroke="#E0B98A" strokeWidth="1" strokeDasharray="6 20" />
          </svg>
        </div>
      )}

      {/* Floating particles for mature+ */}
      {!isSlow && stageIndex >= 3 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1.5 h-1.5 rounded-full bg-amber-300/40"
              style={{
                left: `${15 + i * 18}%`,
                top: `${20 + (i % 3) * 25}%`,
                animation: `float-particle ${3 + i * 0.5}s ease-in-out infinite`,
                animationDelay: `${i * 0.7}s`,
              }}
            />
          ))}
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

        {/* Watering effect - water drops */}
        {isWatering && !isSlow && (
          <div className="absolute -top-2 -right-2" style={{ animation: 'pour-water 1.5s ease-in-out' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path d="M30 8C30 8 20 20 20 28C20 33 24 36 28 36C32 36 36 33 36 28C36 20 30 8 30 8Z" fill="#4DB6AC" opacity="0.3"/>
              <path d="M24 18L26 14L28 18" stroke="#4DB6AC" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="22" cy="28" r="2" fill="#4DB6AC" opacity="0.5"/>
              <circle cx="28" cy="32" r="1.5" fill="#4DB6AC" opacity="0.4"/>
            </svg>
          </div>
        )}
      </div>

      {/* Ground / grass - enhanced with more detail */}
      <div className="relative w-72 -mt-3">
        <svg viewBox="0 0 290 50" className="w-full">
          <defs>
            <radialGradient id="grassGrad2" cx="50%" cy="30%" r="55%">
              <stop offset="0%" stopColor="#7CB342" stopOpacity="0.45" />
              <stop offset="40%" stopColor="#8BC34A" stopOpacity="0.35" />
              <stop offset="70%" stopColor="#AED581" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#C5E1A5" stopOpacity="0.05" />
            </radialGradient>
          </defs>
          <ellipse cx="145" cy="24" rx="140" ry="22" fill="url(#grassGrad2)" />
          {/* Decorative grass blades */}
          {stageIndex >= 1 && (
            <g opacity="0.3">
              <path d="M60 24 Q58 18 62 14" stroke="#66BB6A" strokeWidth="1" fill="none" strokeLinecap="round"/>
              <path d="M90 22 Q92 16 88 12" stroke="#81C784" strokeWidth="1" fill="none" strokeLinecap="round"/>
              <path d="M200 22 Q198 16 202 12" stroke="#66BB6A" strokeWidth="1" fill="none" strokeLinecap="round"/>
              <path d="M230 24 Q232 18 228 14" stroke="#81C784" strokeWidth="1" fill="none" strokeLinecap="round"/>
            </g>
          )}
          {/* Small flowers on grass */}
          {stageIndex >= 2 && (
            <>
              <circle cx="45" cy="20" r="3.5" fill="#FFB74D" opacity="0.5" />
              <circle cx="45" cy="20" r="1.5" fill="#FF9800" opacity="0.4" />
              <circle cx="100" cy="24" r="3" fill="#FFCC80" opacity="0.45" />
              <circle cx="195" cy="18" r="3.5" fill="#FFB74D" opacity="0.5" />
              <circle cx="195" cy="18" r="1.5" fill="#FF9800" opacity="0.4" />
              <circle cx="245" cy="22" r="2.5" fill="#FFCC80" opacity="0.4" />
            </>
          )}
          {stageIndex >= 3 && (
            <>
              <circle cx="70" cy="16" r="2.5" fill="#F8BBD0" opacity="0.5" />
              <circle cx="70" cy="16" r="1" fill="#F48FB1" opacity="0.4" />
              <circle cx="220" cy="16" r="3" fill="#F8BBD0" opacity="0.5" />
              <circle cx="220" cy="16" r="1.2" fill="#F48FB1" opacity="0.4" />
              {/* Decorative swirl */}
              <path d="M155 18 Q158 14 160 18 Q163 14 166 18" stroke="#AED581" strokeWidth="1" fill="none" opacity="0.3" strokeLinecap="round"/>
              <path d="M130 22 Q133 18 136 22" stroke="#C5E1A5" strokeWidth="1" fill="none" opacity="0.25" strokeLinecap="round"/>
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
          0%, 100% { transform: rotate(-1.5deg); transform-origin: center bottom; }
          50% { transform: rotate(1.5deg); transform-origin: center bottom; }
        }
        @keyframes bloom {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        @keyframes float-particle {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
          25% { transform: translateY(-12px) translateX(4px); opacity: 0.6; }
          50% { transform: translateY(-20px) translateX(-2px); opacity: 0.4; }
          75% { transform: translateY(-8px) translateX(-6px); opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

/* ========== Stage 1: Seed ========== */
const SeedTree: React.FC = () => (
  <svg width="180" height="200" viewBox="0 0 180 200">
    {/* Soil mound with texture */}
    <ellipse cx="90" cy="178" rx="50" ry="14" fill="#8D6E63" opacity="0.25" />
    <ellipse cx="90" cy="175" rx="35" ry="8" fill="#A1887F" opacity="0.15" />
    {/* Seed */}
    <ellipse cx="90" cy="160" rx="14" ry="9" fill="#6D4C41" />
    <ellipse cx="88" cy="158" rx="8" ry="5" fill="#8D6E63" opacity="0.5" />
    {/* Tiny sprout emerging */}
    <path d="M90 158 Q90 140 87 128" stroke="#66BB6A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <ellipse cx="84" cy="125" rx="8" ry="5" fill="#81C784" transform="rotate(-25 84 125)" />
    <ellipse cx="84" cy="125" rx="5" ry="3" fill="#A5D6A7" transform="rotate(-25 84 125)" opacity="0.6" />
    {/* Tiny water drop */}
    <path d="M96 145 Q96 140 98 138 Q100 140 100 145 Q100 148 98 149 Q96 148 96 145Z" fill="#4DB6AC" opacity="0.4"/>
  </svg>
);

/* ========== Stage 2: Sprout ========== */
const SproutTree: React.FC = () => (
  <svg width="180" height="220" viewBox="0 0 180 220">
    {/* Stem with slight curve */}
    <path d="M90 210 Q88 170 86 140 Q84 120 88 105" stroke="#6D4C41" strokeWidth="5" fill="none" strokeLinecap="round" />
    {/* Branch hints */}
    <path d="M87 140 Q75 135 68 130" stroke="#795548" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <path d="M88 125 Q100 118 108 115" stroke="#795548" strokeWidth="2" fill="none" strokeLinecap="round" />
    {/* Leaves with depth */}
    <g style={{ animation: 'sway 4.5s ease-in-out infinite' }}>
      <ellipse cx="62" cy="125" rx="22" ry="12" fill="#66BB6A" transform="rotate(-30 62 125)" />
      <ellipse cx="62" cy="125" rx="14" ry="7" fill="#81C784" transform="rotate(-30 62 125)" opacity="0.6" />
      <ellipse cx="112" cy="110" rx="20" ry="11" fill="#4CAF50" transform="rotate(25 112 110)" />
      <ellipse cx="112" cy="110" rx="12" ry="6" fill="#66BB6A" transform="rotate(25 112 110)" opacity="0.6" />
      <ellipse cx="80" cy="95" rx="18" ry="10" fill="#81C784" transform="rotate(-15 80 95)" />
      <ellipse cx="80" cy="95" rx="10" ry="5" fill="#A5D6A7" transform="rotate(-15 80 95)" opacity="0.5" />
    </g>
  </svg>
);

/* ========== Stage 3: Young Tree ========== */
const YoungTree: React.FC = () => (
  <svg width="220" height="260" viewBox="0 0 220 260">
    {/* Trunk with natural curve */}
    <path d="M110 250 Q108 200 106 165 Q104 140 108 115" stroke="#5D4037" strokeWidth="9" fill="none" strokeLinecap="round" />
    {/* Branches */}
    <path d="M106 165 Q75 150 55 140" stroke="#6D4C41" strokeWidth="5" fill="none" strokeLinecap="round" />
    <path d="M108 140 Q140 125 165 115" stroke="#6D4C41" strokeWidth="4.5" fill="none" strokeLinecap="round" />
    <path d="M107 125 Q80 108 60 95" stroke="#6D4C41" strokeWidth="4" fill="none" strokeLinecap="round" />
    <path d="M109 110 Q130 98 150 88" stroke="#6D4C41" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    {/* Leaf clusters with layered depth */}
    <g style={{ animation: 'sway 5s ease-in-out infinite' }}>
      <ellipse cx="48" cy="132" rx="28" ry="20" fill="#388E3C" opacity="0.85" />
      <ellipse cx="48" cy="132" rx="18" ry="12" fill="#4CAF50" opacity="0.5" />
      <ellipse cx="168" cy="108" rx="25" ry="17" fill="#4CAF50" opacity="0.85" />
      <ellipse cx="168" cy="108" rx="16" ry="10" fill="#66BB6A" opacity="0.5" />
      <ellipse cx="55" cy="88" rx="30" ry="20" fill="#2E7D32" opacity="0.8" />
      <ellipse cx="55" cy="88" rx="20" ry="12" fill="#388E3C" opacity="0.5" />
      <ellipse cx="110" cy="75" rx="35" ry="22" fill="#4CAF50" opacity="0.9" />
      <ellipse cx="110" cy="75" rx="22" ry="14" fill="#66BB6A" opacity="0.5" />
      <ellipse cx="155" cy="82" rx="22" ry="15" fill="#66BB6A" opacity="0.85" />
    </g>
    {/* Small flowers */}
    <g style={{ animation: 'bloom 3.5s ease-in-out infinite' }}>
      <circle cx="75" cy="118" r="4.5" fill="#FFB74D" opacity="0.7" />
      <circle cx="75" cy="118" r="2" fill="#FF9800" opacity="0.5" />
      <circle cx="145" cy="100" r="4" fill="#F8BBD0" opacity="0.65" />
      <circle cx="145" cy="100" r="1.5" fill="#F48FB1" opacity="0.5" />
      <circle cx="90" cy="70" r="3.5" fill="#FFCCBC" opacity="0.6" />
    </g>
  </svg>
);

/* ========== Stage 4: Mature Tree (with flowers) ========== */
const MatureTree: React.FC = () => (
  <svg width="260" height="300" viewBox="0 0 260 300">
    {/* Trunk with bark texture */}
    <path d="M130 290 Q127 235 124 195 Q120 165 128 130" stroke="#4E342E" strokeWidth="13" fill="none" strokeLinecap="round" />
    <path d="M128 260 Q126 240 125 220" stroke="#5D4037" strokeWidth="2" fill="none" opacity="0.3" strokeLinecap="round" />
    <path d="M132 250 Q131 235 130 215" stroke="#3E2723" strokeWidth="1.5" fill="none" opacity="0.2" strokeLinecap="round" />
    {/* Major branches */}
    <path d="M124 195 Q85 175 48 158" stroke="#5D4037" strokeWidth="7" fill="none" strokeLinecap="round" />
    <path d="M127 170 Q165 152 200 142" stroke="#5D4037" strokeWidth="6.5" fill="none" strokeLinecap="round" />
    <path d="M125 150 Q85 128 50 110" stroke="#5D4037" strokeWidth="5.5" fill="none" strokeLinecap="round" />
    <path d="M129 135 Q160 118 190 105" stroke="#5D4037" strokeWidth="5" fill="none" strokeLinecap="round" />
    <path d="M127 120 Q105 95 88 72" stroke="#5D4037" strokeWidth="4.5" fill="none" strokeLinecap="round" />
    <path d="M130 115 Q155 90 172 65" stroke="#5D4037" strokeWidth="4" fill="none" strokeLinecap="round" />
    {/* Rich leaf canopy with depth layers */}
    <g style={{ animation: 'sway 6s ease-in-out infinite' }}>
      {/* Back layer - darker */}
      <ellipse cx="42" cy="148" rx="34" ry="24" fill="#2E7D32" opacity="0.85" />
      <ellipse cx="205" cy="132" rx="32" ry="22" fill="#2E7D32" opacity="0.8" />
      <ellipse cx="45" cy="100" rx="36" ry="24" fill="#1B5E20" opacity="0.75" />
      {/* Middle layer */}
      <ellipse cx="130" cy="72" rx="48" ry="32" fill="#388E3C" opacity="0.9" />
      <ellipse cx="195" cy="95" rx="32" ry="22" fill="#388E3C" opacity="0.85" />
      <ellipse cx="80" cy="58" rx="34" ry="22" fill="#4CAF50" opacity="0.85" />
      <ellipse cx="170" cy="62" rx="32" ry="20" fill="#388E3C" opacity="0.85" />
      {/* Front layer - lighter */}
      <ellipse cx="60" cy="130" rx="25" ry="18" fill="#4CAF50" opacity="0.7" />
      <ellipse cx="185" cy="118" rx="22" ry="16" fill="#66BB6A" opacity="0.7" />
      <ellipse cx="130" cy="48" rx="28" ry="18" fill="#66BB6A" opacity="0.7" />
      <ellipse cx="95" cy="80" rx="20" ry="14" fill="#81C784" opacity="0.6" />
    </g>
    {/* Flowers - pink cherry blossoms */}
    <g style={{ animation: 'bloom 3s ease-in-out infinite' }}>
      <circle cx="58" cy="138" r="6" fill="#F8BBD0" opacity="0.9" />
      <circle cx="58" cy="138" r="3" fill="#F48FB1" />
      <circle cx="58" cy="138" r="1.2" fill="#EC407A" opacity="0.6" />
      <circle cx="180" cy="122" r="5.5" fill="#F8BBD0" opacity="0.9" />
      <circle cx="180" cy="122" r="2.5" fill="#F48FB1" />
      <circle cx="105" cy="65" r="5" fill="#FFCCBC" opacity="0.9" />
      <circle cx="105" cy="65" r="2.5" fill="#FF8A65" />
      <circle cx="150" cy="78" r="4.5" fill="#F8BBD0" opacity="0.85" />
      <circle cx="150" cy="78" r="2" fill="#F48FB1" />
      <circle cx="75" cy="92" r="5" fill="#FFCCBC" opacity="0.85" />
      <circle cx="75" cy="92" r="2.5" fill="#FF8A65" />
      <circle cx="195" cy="100" r="4" fill="#F8BBD0" opacity="0.75" />
      <circle cx="195" cy="100" r="1.5" fill="#F48FB1" />
    </g>
  </svg>
);

/* ========== Stage 5: Complete Tree (with fruits) ========== */
const CompleteTree: React.FC = () => (
  <svg width="280" height="320" viewBox="0 0 280 320">
    {/* Trunk with bark texture */}
    <path d="M140 310 Q137 250 133 205 Q129 170 138 130" stroke="#3E2723" strokeWidth="15" fill="none" strokeLinecap="round" />
    <path d="M138 280 Q136 260 135 240" stroke="#4E342E" strokeWidth="2" fill="none" opacity="0.3" strokeLinecap="round" />
    <path d="M142 270 Q141 250 140 230" stroke="#3E2723" strokeWidth="1.5" fill="none" opacity="0.2" strokeLinecap="round" />
    {/* Major branches */}
    <path d="M133 205 Q85 185 38 165" stroke="#4E342E" strokeWidth="8" fill="none" strokeLinecap="round" />
    <path d="M137 180 Q180 160 225 148" stroke="#4E342E" strokeWidth="7.5" fill="none" strokeLinecap="round" />
    <path d="M135 160 Q85 135 42 115" stroke="#4E342E" strokeWidth="7" fill="none" strokeLinecap="round" />
    <path d="M139 145 Q175 125 215 112" stroke="#4E342E" strokeWidth="6" fill="none" strokeLinecap="round" />
    <path d="M137 130 Q110 100 90 70" stroke="#4E342E" strokeWidth="5.5" fill="none" strokeLinecap="round" />
    <path d="M140 125 Q165 95 185 65" stroke="#4E342E" strokeWidth="5" fill="none" strokeLinecap="round" />
    {/* Rich leaf canopy - 3 depth layers */}
    <g style={{ animation: 'sway 6s ease-in-out infinite' }}>
      {/* Back layer */}
      <ellipse cx="32" cy="155" rx="38" ry="28" fill="#1B5E20" opacity="0.85" />
      <ellipse cx="230" cy="140" rx="36" ry="25" fill="#1B5E20" opacity="0.8" />
      <ellipse cx="38" cy="105" rx="40" ry="28" fill="#2E7D32" opacity="0.85" />
      {/* Middle layer */}
      <ellipse cx="140" cy="75" rx="55" ry="38" fill="#2E7D32" opacity="0.9" />
      <ellipse cx="220" cy="102" rx="35" ry="24" fill="#388E3C" opacity="0.9" />
      <ellipse cx="85" cy="55" rx="38" ry="26" fill="#388E3C" opacity="0.85" />
      <ellipse cx="190" cy="60" rx="36" ry="24" fill="#2E7D32" opacity="0.9" />
      <ellipse cx="140" cy="42" rx="32" ry="22" fill="#4CAF50" opacity="0.8" />
      {/* Front layer */}
      <ellipse cx="65" cy="140" rx="28" ry="20" fill="#4CAF50" opacity="0.7" />
      <ellipse cx="200" cy="128" rx="25" ry="18" fill="#66BB6A" opacity="0.7" />
      <ellipse cx="110" cy="90" rx="22" ry="16" fill="#81C784" opacity="0.6" />
    </g>
    {/* Orange fruits with highlights */}
    <g>
      <circle cx="55" cy="135" r="9" fill="#E65100" opacity="0.9" />
      <circle cx="55" cy="135" r="7" fill="#FF9800" />
      <circle cx="53" cy="133" r="3" fill="#FFB74D" opacity="0.7" />
      <circle cx="210" cy="125" r="9" fill="#E65100" opacity="0.9" />
      <circle cx="210" cy="125" r="7" fill="#FF9800" />
      <circle cx="208" cy="123" r="3" fill="#FFB74D" opacity="0.7" />
      <circle cx="105" cy="60" r="8" fill="#E65100" opacity="0.9" />
      <circle cx="105" cy="60" r="6" fill="#FF9800" />
      <circle cx="103" cy="58" r="2.5" fill="#FFB74D" opacity="0.7" />
      <circle cx="175" cy="68" r="8" fill="#E65100" opacity="0.9" />
      <circle cx="175" cy="68" r="6" fill="#FF9800" />
      <circle cx="173" cy="66" r="2.5" fill="#FFB74D" opacity="0.7" />
      <circle cx="78" cy="90" r="7.5" fill="#E65100" opacity="0.9" />
      <circle cx="78" cy="90" r="5.5" fill="#FF9800" />
      <circle cx="76" cy="88" r="2" fill="#FFB74D" opacity="0.7" />
      <circle cx="200" cy="90" r="7.5" fill="#E65100" opacity="0.9" />
      <circle cx="200" cy="90" r="5.5" fill="#FF9800" />
      <circle cx="198" cy="88" r="2" fill="#FFB74D" opacity="0.7" />
      <circle cx="140" cy="48" r="7" fill="#E65100" opacity="0.85" />
      <circle cx="140" cy="48" r="5" fill="#FF9800" />
      <circle cx="138" cy="46" r="2" fill="#FFB74D" opacity="0.7" />
    </g>
    {/* Celebration confetti */}
    <g style={{ animation: 'sparkle 2s ease-in-out infinite' }}>
      <rect x="25" y="30" width="5" height="10" rx="1" fill="#F44336" opacity="0.7" transform="rotate(30 27 35)" />
      <rect x="245" y="25" width="5" height="10" rx="1" fill="#2196F3" opacity="0.7" transform="rotate(-20 247 30)" />
      <rect x="65" y="15" width="4" height="8" rx="1" fill="#FFC107" opacity="0.7" transform="rotate(45 67 19)" />
      <rect x="210" y="18" width="4" height="8" rx="1" fill="#4CAF50" opacity="0.7" transform="rotate(-35 212 22)" />
      <rect x="140" y="8" width="5" height="10" rx="1" fill="#FF9800" opacity="0.7" transform="rotate(15 142 13)" />
      <rect x="100" y="20" width="3" height="7" rx="1" fill="#9C27B0" opacity="0.5" transform="rotate(60 101 23)" />
      <rect x="180" y="12" width="3" height="7" rx="1" fill="#00BCD4" opacity="0.5" transform="rotate(-45 181 15)" />
    </g>
  </svg>
);

export default TreeCanvas;
