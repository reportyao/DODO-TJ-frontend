import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SafeMotion } from './SafeMotion';
import { GiftIcon } from '@heroicons/react/24/solid';

interface SpinFloatingButtonProps {
  spinCount?: number;
}

/**
 * 首页浮动入口按钮
 * 位置：右侧中间，点击跳转到抽奖页面
 * 样式：动态抖动的礼盒图标
 */
const SpinFloatingButton: React.FC<SpinFloatingButtonProps> = ({ spinCount = 0 }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isShaking, setIsShaking] = useState(false);

  // 定期抖动动画
  useEffect(() => {
    const interval = setInterval(() => {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 1000);
    }, 5000);

    // 初始抖动
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 1000);

    return () => clearInterval(interval);
  }, []);

  const handleClick = () => {
    navigate('/spin');
  };

  return (
    <SafeMotion
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5 }}
      className="fixed right-4 top-1/2 -translate-y-1/2 z-40"
    >
      <button
        onClick={handleClick}
        className="relative group"
        aria-label={t('spin.floatingButton')}
      >
        {/* 光晕效果 */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary to-primary-light rounded-full blur-lg opacity-50 group-hover:opacity-75 transition-opacity" />
        
        {/* 主按钮 */}
        <SafeMotion
          animate={isShaking ? {
            rotate: [0, -15, 15, -10, 10, -5, 5, 0],
            scale: [1, 1.05, 1.05, 1.05, 1.05, 1.02, 1.02, 1]
          } : {}}
          transition={{ duration: 0.8 }}
          className="relative w-12 h-12 bg-gradient-to-br from-primary to-primary rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-shadow"
        >
          <GiftIcon className="w-6 h-6 text-white" />
          
          {/* 抽奖次数徽章 */}
          {spinCount > 0 && (
            <SafeMotion
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-red-500 rounded-full flex items-center justify-center px-1"
            >
              <span className="text-xs font-bold text-white">
                {spinCount > 99 ? '99+' : spinCount}
              </span>
            </SafeMotion>
          )}
        </SafeMotion>
        

      </button>
    </SafeMotion>
  );
};

export default SpinFloatingButton;
