/**
 * PWA 更新通知组件
 * 
 * 功能：
 * 1. 检测 Service Worker 更新
 * 2. 显示更新通知（支持多语言）
 * 3. 处理用户更新操作
 * 4. 自动刷新应用
 */

import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { onPWAUpdate, forceUpdate } from '../utils/pwaUtils';

interface PWAUpdateNotificationProps {
  autoHideDuration?: number; // 毫秒，设置为 0 则不自动隐藏
}

export const PWAUpdateNotification: React.FC<PWAUpdateNotificationProps> = ({
  autoHideDuration = 0,
}) => {
  const { t } = useTranslation();
  const [showNotification, setShowNotification] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    // 用于清理自动隐藏定时器的引用
    let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

    // 监听 PWA 更新事件
    const unsubscribe = onPWAUpdate((detail) => {
      console.log('[PWAUpdateNotification] Update available:', detail);
      setShowNotification(true);

      // 自动隐藏（注意：定时器引用必须在 useEffect 作用域内管理，不能在回调内返回）
      if (autoHideDuration > 0) {
        if (autoHideTimer) clearTimeout(autoHideTimer);
        autoHideTimer = setTimeout(() => {
          setShowNotification(false);
        }, autoHideDuration);
      }
    });

    // 组件卸载时：取消事件监听 + 清理定时器
    return () => {
      unsubscribe();
      if (autoHideTimer) clearTimeout(autoHideTimer);
    };
  }, [autoHideDuration]);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await forceUpdate();
    } catch (error) {
      console.error('[PWAUpdateNotification] Failed to update:', error);
      setIsUpdating(false);
    }
  };

  const handleDismiss = () => {
    setShowNotification(false);
  };

  if (!showNotification) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 right-4 z-50 max-w-sm mx-auto">
      <div className="bg-amber-50 rounded-lg shadow-lg border border-amber-200 overflow-hidden">
        {/* 内容区域 */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* 图标 */}
            <div className="flex-shrink-0 mt-1">
              <RefreshCw className="w-6 h-6 text-primary" />
            </div>

            {/* 文本内容 */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                {t('pwa.updateTitle', 'Навсозӣ дастрас аст')}
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                {t('pwa.updateDesc', 'Версияи нави DODO дастрас аст. Лутфан навсозӣ кунед барои имконоти нав.')}
              </p>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={handleDismiss}
              disabled={isUpdating}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label={t('common.close', 'Пӯшидан')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="bg-amber-100 px-4 py-3 flex gap-2 border-t border-amber-200">
          <button
            onClick={handleDismiss}
            disabled={isUpdating}
            className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('pwa.later', 'Баъдтар')}
          </button>
          <button
            onClick={handleUpdate}
            disabled={isUpdating}
            className="flex-1 px-3 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary-dark disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isUpdating ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t('pwa.updating', 'Навсозӣ...')}
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                {t('pwa.updateNow', 'Навсозӣ кунед')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PWAUpdateNotification;
