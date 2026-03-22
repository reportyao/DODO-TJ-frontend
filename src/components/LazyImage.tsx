import React, { useState, useCallback, CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

interface LazyImageProps {
  src: string
  alt: string
  placeholder?: string
  className?: string
  /** 额外的容器内联样式 */
  style?: CSSProperties
  width?: number
  height?: number
  onLoad?: () => void
  onError?: () => void
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
  /** 加载优先级：'high' 用于首屏可见图片，'low' 用于屏幕外图片 */
  priority?: 'high' | 'low' | 'auto'
}

/**
 * 图片组件 v5 - 移除自定义懒加载，回归浏览器原生 loading="lazy"
 *
 * 核心修复（v5）：
 * 1. 移除 IntersectionObserver 自定义懒加载逻辑，使用浏览器原生 loading="lazy"
 * 2. 移除 getOptimizedImageUrl 图片变换（之前 width*2 导致缩略图被放大）
 * 3. 容器不再强制设置 position:relative，由外部控制布局
 * 4. img 样式由外部 style 控制，组件只负责加载状态和错误处理
 *
 * 标准使用方式（参考 OrderManagementPage）：
 * ```
 * <div style={{ position: 'relative', width: '80px', height: '80px', overflow: 'hidden', borderRadius: '0.75rem' }}>
 *   <LazyImage
 *     src={imageUrl}
 *     alt="description"
 *     style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
 *   />
 * </div>
 * ```
 */
export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  placeholder,
  className = '',
  style: externalStyle,
  width,
  height,
  onLoad,
  onError,
  objectFit = 'cover',
  priority = 'auto',
}) => {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const { t } = useTranslation()

  const handleLoad = useCallback(() => {
    setIsLoading(false)
    onLoad?.()
  }, [onLoad])

  const handleError = useCallback(() => {
    setIsLoading(false)
    setHasError(true)
    onError?.()
  }, [onError])

  // 从 className 中检测 objectFit 覆盖
  let resolvedObjectFit = objectFit
  if (className.includes('object-contain')) resolvedObjectFit = 'contain'
  else if (className.includes('object-cover')) resolvedObjectFit = 'cover'
  else if (className.includes('object-fill')) resolvedObjectFit = 'fill'
  else if (className.includes('object-none')) resolvedObjectFit = 'none'
  else if (className.includes('object-scale-down')) resolvedObjectFit = 'scale-down'

  // 从 className 中移除 object-* 类（已通过内联样式处理）
  const containerClassName = className
    .replace(/\bobject-(cover|contain|fill|none|scale-down)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // 容器样式：保持 relative + overflow:hidden 以支持加载占位和错误提示
  const containerStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    ...externalStyle,
  }

  // img 样式：absolute 填充容器
  const imgStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: resolvedObjectFit,
    objectPosition: 'center',
    opacity: isLoading ? 0 : 1,
    transition: 'opacity 0.3s',
    maxWidth: 'none',
    display: 'block',
  }

  // 占位/错误层
  const overlayStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  }

  return (
    <div
      className={containerClassName}
      style={containerStyle}
    >
      <img
        src={src}
        alt={alt}
        loading={priority === 'high' ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-ignore - fetchpriority 是新的 HTML 属性，TS 尚未完全支持
        fetchpriority={priority === 'auto' ? undefined : priority}
        onLoad={handleLoad}
        onError={handleError}
        style={imgStyle}
      />

      {isLoading && (
        <div style={{ ...overlayStyle, backgroundColor: '#e5e7eb' }} />
      )}

      {hasError && (
        <div
          style={{
            ...overlayStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#e5e7eb',
          }}
        >
          <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{t('common.loadFailed')}</span>
        </div>
      )}
    </div>
  )
}

export default LazyImage
