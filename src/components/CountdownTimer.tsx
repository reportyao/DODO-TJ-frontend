// 180秒倒计时组件
// 用于商城售罄后显示处理倒计时

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';

interface CountdownTimerProps {
  drawTime: string;  // ISO 8601 格式的处理时间
  onCountdownEnd?: () => void;  // 倒计时结束回调
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ 
  drawTime, 
  onCountdownEnd 
}) => {
  const { t } = useTranslation();
  const [timeLeft, setTimeLeft] = useState(0);
  const [isEnded, setIsEnded] = useState(false);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = new Date(drawTime).getTime();
      const diff = Math.max(0, target - now);
      
      setTimeLeft(diff);
      
      if (diff <= 0 && !isEnded) {
        setIsEnded(true);
        if (onCountdownEnd) {
          onCountdownEnd();
        }
      }
    };

    // 立即计算一次
    calculateTimeLeft();

    // 每秒更新一次
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [drawTime, isEnded, onCountdownEnd]);

  // 转换为分钟和秒
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  // 如果倒计时已结束
  if (isEnded) {
    return (
      <div className="bg-green-100 border-2 border-green-500 rounded-lg p-6 text-center animate-pulse">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Clock className="w-6 h-6 text-green-600" />
          <p className="text-lg font-bold text-green-800">
            {t('lottery.drawing_now')}
          </p>
        </div>
        <p className="text-sm text-green-600">
          {t('lottery.please_wait')}
        </p>
      </div>
    );
  }

  // 根据剩余时间选择颜色
  const getColorClasses = () => {
    if (minutes >= 2) {
      return {
        bg: 'bg-amber-100',
        border: 'border-primary',
        text: 'text-primary-dark',
        timer: 'text-primary',
      };
    } else if (minutes >= 1) {
      return {
        bg: 'bg-yellow-100',
        border: 'border-yellow-500',
        text: 'text-yellow-800',
        timer: 'text-yellow-600',
      };
    } else {
      return {
        bg: 'bg-red-100',
        border: 'border-red-500',
        text: 'text-red-800',
        timer: 'text-red-600',
      };
    }
  };

  const colors = getColorClasses();

  return (
    <div className={`${colors.bg} border-2 ${colors.border} rounded-lg p-6 text-center`}>
      <div className="flex items-center justify-center gap-2 mb-3">
        <Clock className={`w-6 h-6 ${colors.timer}`} />
        <p className={`text-lg font-bold ${colors.text}`}>
          {t('lottery.drawing_in')}
        </p>
      </div>
      
      <div className="flex items-center justify-center gap-2">
        <div className="flex flex-col items-center">
          <div className={`text-5xl font-bold ${colors.timer} tabular-nums`}>
            {minutes.toString().padStart(2, '0')}
          </div>
          <div className={`text-sm ${colors.text} mt-1`}>
            {t('lottery.minutes')}
          </div>
        </div>
        
        <div className={`text-5xl font-bold ${colors.timer}`}>:</div>
        
        <div className="flex flex-col items-center">
          <div className={`text-5xl font-bold ${colors.timer} tabular-nums`}>
            {seconds.toString().padStart(2, '0')}
          </div>
          <div className={`text-sm ${colors.text} mt-1`}>
            {t('lottery.seconds')}
          </div>
        </div>
      </div>

      <p className={`text-sm ${colors.text} mt-4`}>
        {t('lottery.countdown_hint')}
      </p>
    </div>
  );
};

export default CountdownTimer;
