/**
 * PageLoadingFallback - 页面懒加载时的 Suspense fallback UI
 *
 * 设计原则：
 * 1. 轻量级：不依赖任何外部库（如 framer-motion），纯 CSS 动画
 * 2. 与 Layout 协调：只替换页面内容区域，不影响顶部 Header 和底部导航
 * 3. 视觉一致性：使用与应用主题一致的颜色（#B8860B）
 * 4. 快速闪烁防护：延迟 150ms 后才显示 loading，避免快速加载时的闪烁
 */

import { useState, useEffect } from 'react'

export function PageLoadingFallback() {
  // 延迟显示 loading 状态，避免快速加载时的闪烁
  const [showLoading, setShowLoading] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLoading(true)
    }, 150)

    return () => clearTimeout(timer)
  }, [])

  if (!showLoading) {
    // 在延迟期间返回空白占位，保持布局稳定
    return <div className="min-h-[60vh]" />
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center space-y-4">
        {/* 三点加载动画 - 纯 CSS */}
        <div className="flex space-x-2">
          <div
            className="w-2.5 h-2.5 bg-[#B8860B] rounded-full"
            style={{
              animation: 'page-loading-bounce 1.4s ease-in-out infinite',
              animationDelay: '0s',
            }}
          />
          <div
            className="w-2.5 h-2.5 bg-[#B8860B] rounded-full"
            style={{
              animation: 'page-loading-bounce 1.4s ease-in-out infinite',
              animationDelay: '0.2s',
            }}
          />
          <div
            className="w-2.5 h-2.5 bg-[#B8860B] rounded-full"
            style={{
              animation: 'page-loading-bounce 1.4s ease-in-out infinite',
              animationDelay: '0.4s',
            }}
          />
        </div>
        {/* 内联 keyframes 样式 */}
        <style>{`
          @keyframes page-loading-bounce {
            0%, 80%, 100% {
              transform: scale(0.6);
              opacity: 0.4;
            }
            40% {
              transform: scale(1);
              opacity: 1;
            }
          }
        `}</style>
      </div>
    </div>
  )
}
