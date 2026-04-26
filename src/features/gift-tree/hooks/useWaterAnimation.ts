/**
 * 希望之树 - 浇水动画控制 Hook
 *
 * 管理浇水按钮的动画状态和粒子效果。
 * 在弱网环境下自动降级为简单动画。
 */
import { useState, useCallback, useRef } from 'react';
import { useNetwork } from '../../../contexts/NetworkContext';

export interface WaterAnimationState {
  isAnimating: boolean;
  showParticles: boolean;
  waterCount: number;
}

export function useWaterAnimation() {
  const { isSlow } = useNetwork();
  const [state, setState] = useState<WaterAnimationState>({
    isAnimating: false,
    showParticles: false,
    waterCount: 0,
  });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerAnimation = useCallback(
    (waterEarned: number) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setState({
        isAnimating: true,
        showParticles: !isSlow,
        waterCount: waterEarned,
      });

      timeoutRef.current = setTimeout(
        () => {
          setState({
            isAnimating: false,
            showParticles: false,
            waterCount: 0,
          });
        },
        isSlow ? 500 : 1500
      );
    },
    [isSlow]
  );

  const resetAnimation = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setState({
      isAnimating: false,
      showParticles: false,
      waterCount: 0,
    });
  }, []);

  return {
    ...state,
    triggerAnimation,
    resetAnimation,
  };
}
