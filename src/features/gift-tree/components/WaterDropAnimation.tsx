/**
 * 希望之树 - 浇水粒子动画（纯 CSS）
 *
 * 使用 CSS3 transform + opacity 实现，开启 GPU 硬件加速。
 * 在弱网环境下不渲染。
 */
import React from 'react';
import { useNetwork } from '../../../contexts/NetworkContext';

interface WaterDropAnimationProps {
  isActive: boolean;
  waterCount?: number;
}

const WaterDropAnimation: React.FC<WaterDropAnimationProps> = ({
  isActive,
  waterCount = 0,
}) => {
  const { isSlow } = useNetwork();

  if (!isActive || isSlow) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {/* Water drops falling */}
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="absolute text-blue-400 animate-water-fall"
          style={{
            left: `${15 + Math.random() * 70}%`,
            top: '-10%',
            fontSize: `${14 + Math.random() * 10}px`,
            animationDelay: `${i * 0.12}s`,
            animationDuration: `${0.8 + Math.random() * 0.4}s`,
            willChange: 'transform, opacity',
          }}
        >
          💧
        </div>
      ))}

      {/* Water count popup */}
      {waterCount > 0 && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 animate-water-count">
          <span className="text-accent font-bold text-2xl drop-shadow-lg">
            +{waterCount} 💧
          </span>
        </div>
      )}

      <style>{`
        @keyframes water-fall {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          70% {
            opacity: 0.8;
          }
          100% {
            transform: translateY(100vh) rotate(360deg) scale(0.3);
            opacity: 0;
          }
        }
        .animate-water-fall {
          animation: water-fall 1s ease-in forwards;
        }
        @keyframes water-count {
          0% {
            transform: translate(-50%, 0) scale(0.5);
            opacity: 0;
          }
          30% {
            transform: translate(-50%, -20px) scale(1.2);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -60px) scale(1);
            opacity: 0;
          }
        }
        .animate-water-count {
          animation: water-count 1.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default WaterDropAnimation;
