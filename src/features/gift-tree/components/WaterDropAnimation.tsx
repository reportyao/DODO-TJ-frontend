/**
 * 希望之树 - 浇水粒子动画（纯 CSS）
 *
 * 使用 CSS3 transform + opacity 实现，开启 GPU 硬件加速。
 * 渲染即播放，不需要外部 props 控制。
 * 在弱网环境下不渲染。
 * 增强版：水滴带有轻微摇摆效果，更自然。
 */
import React from 'react';
import { useNetwork } from '../../../contexts/NetworkContext';

const WaterDropAnimation: React.FC = () => {
  const { isSlow } = useNetwork();

  if (isSlow) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {/* Water drops falling with gentle sway */}
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="absolute animate-water-fall-enhanced"
          style={{
            left: `${8 + Math.random() * 84}%`,
            top: '-5%',
            fontSize: `${14 + Math.random() * 10}px`,
            animationDelay: `${i * 0.08}s`,
            animationDuration: `${0.9 + Math.random() * 0.4}s`,
            willChange: 'transform, opacity',
          }}
        >
          💧
        </div>
      ))}

      {/* Subtle sparkle particles */}
      {[...Array(4)].map((_, i) => (
        <div
          key={`s-${i}`}
          className="absolute w-1.5 h-1.5 rounded-full bg-cyan-300/60 animate-sparkle-drop"
          style={{
            left: `${20 + Math.random() * 60}%`,
            top: '-3%',
            animationDelay: `${0.2 + i * 0.15}s`,
            animationDuration: `${1 + Math.random() * 0.3}s`,
            willChange: 'transform, opacity',
          }}
        />
      ))}

      <style>{`
        @keyframes water-fall-enhanced {
          0% {
            transform: translateY(0) translateX(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          30% {
            transform: translateY(30vh) translateX(8px) rotate(90deg) scale(0.9);
            opacity: 0.9;
          }
          60% {
            transform: translateY(60vh) translateX(-4px) rotate(200deg) scale(0.6);
            opacity: 0.6;
          }
          100% {
            transform: translateY(100vh) translateX(2px) rotate(360deg) scale(0.2);
            opacity: 0;
          }
        }
        .animate-water-fall-enhanced {
          animation: water-fall-enhanced 1s ease-in forwards;
        }
        @keyframes sparkle-drop {
          0% {
            transform: translateY(0) scale(1);
            opacity: 0.8;
          }
          100% {
            transform: translateY(80vh) scale(0);
            opacity: 0;
          }
        }
        .animate-sparkle-drop {
          animation: sparkle-drop 1.2s ease-in forwards;
        }
      `}</style>
    </div>
  );
};

export default WaterDropAnimation;
