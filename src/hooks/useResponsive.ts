import { useEffect, useState, useCallback } from 'react'

// 响应式断点定义
export const BREAKPOINTS = {
  xs: 320,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

interface ResponsiveState {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  currentBreakpoint: Breakpoint
  screenWidth: number
  screenHeight: number
  isPortrait: boolean
  isLandscape: boolean
}

/**
 * 响应式设计hook
 * 提供设备类型、屏幕尺寸、方向等信息
 */
export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>({
    isMobile: false,
    isTablet: false,
    isDesktop: false,
    currentBreakpoint: 'md',
    screenWidth: typeof window !== 'undefined' ? window.innerWidth : 768,
    screenHeight: typeof window !== 'undefined' ? window.innerHeight : 1024,
    isPortrait: true,
    isLandscape: false,
  })

  const getBreakpoint = useCallback((width: number): Breakpoint => {
    if (width < BREAKPOINTS.sm) {return 'xs'}
    if (width < BREAKPOINTS.md) {return 'sm'}
    if (width < BREAKPOINTS.lg) {return 'md'}
    if (width < BREAKPOINTS.xl) {return 'lg'}
    if (width < BREAKPOINTS['2xl']) {return 'xl'}
    return '2xl'
  }, [])

  const updateState = useCallback(() => {
    const width = window.innerWidth
    const height = window.innerHeight
    const breakpoint = getBreakpoint(width)

    setState({
      isMobile: width < BREAKPOINTS.md,
      isTablet: width >= BREAKPOINTS.md && width < BREAKPOINTS.lg,
      isDesktop: width >= BREAKPOINTS.lg,
      currentBreakpoint: breakpoint,
      screenWidth: width,
      screenHeight: height,
      isPortrait: height >= width,
      isLandscape: height < width,
    })
  }, [getBreakpoint])

  useEffect(() => {
    updateState()

    // 使用 ResizeObserver 获得更好的性能
    const resizeObserver = new ResizeObserver(() => {
      updateState()
    })

    // 监听 window 尺寸变化
    const handleResize = () => {
      updateState()
    }

    window.addEventListener('resize', handleResize, { passive: true })
    window.addEventListener('orientationchange', handleResize, { passive: true })

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
      resizeObserver.disconnect()
    }
  }, [updateState])

  return state
}

/**
 * 简化版hook - 仅检查是否为移动设备
 */
export function useIsMobile(): boolean {
  const { isMobile } = useResponsive()
  return isMobile
}

/**
 * 检查是否为特定断点
 */
export function useIsBreakpoint(breakpoint: Breakpoint): boolean {
  const { currentBreakpoint } = useResponsive()
  return currentBreakpoint === breakpoint
}

/**
 * 检查是否大于等于特定断点
 */
export function useIsAboveBreakpoint(breakpoint: Breakpoint): boolean {
  const { screenWidth } = useResponsive()
  return screenWidth >= BREAKPOINTS[breakpoint]
}

/**
 * 检查是否小于特定断点
 */
export function useIsBelowBreakpoint(breakpoint: Breakpoint): boolean {
  const { screenWidth } = useResponsive()
  return screenWidth < BREAKPOINTS[breakpoint]
}
