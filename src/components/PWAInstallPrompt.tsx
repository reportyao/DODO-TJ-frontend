/**
 * PWA 安装提示组件
 * 
 * 功能：
 * 1. 检测 PWA 安装提示
 * 2. 显示安装建议 UI
 * 3. 处理用户安装操作
 * 4. 管理提示显示状态
 */

import React, { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';
import {
  setupInstallPrompt,
  triggerInstallPrompt,
  canInstall,
  isInstalled,
} from '../utils/pwaUtils';

interface PWAInstallPromptProps {
  onInstalled?: () => void;
  dismissDuration?: number; // 毫秒，设置为 0 则不自动隐藏
}

export const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  onInstalled,
  dismissDuration = 0,
}) => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // 检查是否已安装
    if (isInstalled()) {
      onInstalled?.();
      return;
    }

    // 从 localStorage 检查用户是否已拒绝
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      setIsDismissed(true);
      return;
    }

    // 设置安装提示
    setupInstallPrompt(
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
  }, [onInstalled]);

  const handleInstall = async () => {
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
    localStorage.setItem('pwa-install-dismissed', 'true');

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
              <Download className="w-6 h-6 text-green-600" />
            </div>

            {/* 文本内容 */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                Install TezBarakat
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Add TezBarakat to your home screen for quick access and offline support.
              </p>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Dismiss"
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
            Not Now
          </button>
          <button
            onClick={handleInstall}
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Install
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;
