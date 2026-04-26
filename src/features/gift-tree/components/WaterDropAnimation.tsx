/**
 * 希望之树 - 浇水粒子动画（纯 CSS）
 *
 * 使用 CSS3 transform + opacity 实现，开启 GPU 硬件加速。
 * 渲染即播放，不需要外部 props 控制。
 * 在弱网环境下不渲染。
 */
import React from 'react';
import { useNetwork } from '../../../contexts/NetworkContext';

const WaterDropAnimation: React.FC = () => {
  const { isSlow } = useNetwork();

  if (isSlow) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {/* Water drops falling */}
      {[...Array(10)].map((_, i) => (
        <div
          key={i}
          className="absolute text-blue-400 animate-water-fall"
          style={{
            left: `${10 + Math.random() * 80}%`,
            top: '-5%',
            fontSize: `${14 + Math.random() * 10}px`,
            animationDelay: `${i * 0.1}s`,
            animationDuration: `${0.8 + Math.random() * 0.5}s`,
            willChange: 'transform, opacity',
          }}
        >
          💧
        </div>
      ))}

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
      `}</style>
    </div>
  );
};

export default WaterDropAnimation;
