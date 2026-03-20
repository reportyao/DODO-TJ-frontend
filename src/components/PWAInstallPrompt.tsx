/**
 * PWA 安装提示组件
 * 
 * 功能：
 * 1. 检测 PWA 安装提示
 * 2. 显示安装建议 UI（支持多语言）
 * 3. 处理用户安装操作
 * 4. 管理提示显示状态
 * 5. iOS Safari 特殊处理（提示手动添加到主屏幕）
 */

import React, { useEffect, useState } from 'react';
import { X, Download, Share } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  setupInstallPrompt,
  triggerInstallPrompt,
  isInstalled,
} from '../utils/pwaUtils';

interface PWAInstallPromptProps {
  onInstalled?: () => void;
  dismissDuration?: number; // 毫秒，设置为 0 则不自动隐藏
}

/**
 * 检测是否为 iOS Safari（不支持 beforeinstallprompt）
 */
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

export const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  onInstalled,
  dismissDuration = 0,
}) => {
  const { t } = useTranslation();
  const [showPrompt, setShowPrompt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // 检查是否已安装
    if (isInstalled()) {
      onInstalled?.();
      return;
    }

    // 从 localStorage 检查用户是否已拒绝
    const dismissedTime = localStorage.getItem('pwa-install-dismissed');
    if (dismissedTime) {
      // 检查是否已过期（默认7天后重新提示）
      const dismissedAt = parseInt(dismissedTime, 10);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - dismissedAt < sevenDays) {
        setIsDismissed(true);
        return;
      } else {
        localStorage.removeItem('pwa-install-dismissed');
      }
    }

    // iOS Safari 特殊处理
    if (isIOSSafari()) {
      setIsIOS(true);
      setShowPrompt(true);
      return;
    }

    // 设置安装提示（标准 Chrome/Edge/Samsung 等浏览器）
    // setupInstallPrompt 现在返回清理函数，防止内存泄漏
    const cleanup = setupInstallPrompt(
      (canInstall) => {
        if (canInstall) {
          setShowPrompt(true);
        }
      },
      () => {
        setShowPrompt(false);
        onInstalled?.();
      }
    );
    return cleanup;
  }, [onInstalled]);

  const handleInstall = async () => {
    if (isIOS) {
      // iOS 不支持自动安装，只能提示用户手动操作
      return;
    }

    setIsLoading(true);
    try {
      const installed = await triggerInstallPrompt();
      if (installed) {
        setShowPrompt(false);
        onInstalled?.();
      }
    } catch (error) {
      console.error('[PWAInstallPrompt] Failed to install:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setIsDismissed(true);
    // 存储时间戳而非布尔值，支持过期重新提示
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());

    // 自动隐藏后重置状态
    if (dismissDuration > 0) {
      setTimeout(() => {
        localStorage.removeItem('pwa-install-dismissed');
      }, dismissDuration);
    }
  };

  if (!showPrompt || isDismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto">
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
        {/* 内容区域 */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* 图标 */}
            <div className="flex-shrink-0 mt-1">
              {isIOS ? (
                <Share className="w-6 h-6 text-green-600" />
              ) : (
                <Download className="w-6 h-6 text-green-600" />
              )}
            </div>

            {/* 文本内容 */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                {t('pwa.installTitle', 'Насб кунед DODO')}
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                {isIOS
                  ? t('pwa.installDescIOS', 'Тугмаи «Мубодила» -ро пахш кунед ва «Ба саҳифаи асосӣ илова кунед» -ро интихоб кунед')
                  : t('pwa.installDesc', 'DODO-ро ба саҳифаи асосӣ илова кунед барои дастрасии зуд ва кори офлайн')
                }
              </p>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={t('common.close', 'Пӯшидан')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="bg-gray-50 px-4 py-3 flex gap-2 border-t border-gray-200">
          <button
            onClick={handleDismiss}
            className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            {t('pwa.notNow', 'Баъдтар')}
          </button>
          {!isIOS && (
            <button
              onClick={handleInstall}
              disabled={isLoading}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {t('pwa.installing', 'Насб...')}
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  {t('pwa.install', 'Насб кунед')}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;
