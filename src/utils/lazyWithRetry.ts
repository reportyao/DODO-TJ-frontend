/**
 * lazyWithRetry - 带自动重试和预加载支持的 React.lazy 封装
 *
 * 解决以下问题：
 * 1. 弱网环境下动态 import 失败导致页面白屏
 * 2. 部署新版本后旧 chunk 文件不存在导致加载失败
 * 3. 核心页面需要在首屏加载后静默预加载
 *
 * 使用方式：
 *   const HomePage = lazyWithRetry(() => import('./pages/HomePage'))
 *   HomePage.preload() // 静默预加载（可选）
 */

import { lazy, type ComponentType } from 'react'
import { errorMonitor } from '../services/ErrorMonitorService'

/** 重试配置 */
const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000 // 基础延迟 1 秒，指数退避

/** 用于检测是否因为版本更新导致的 chunk 加载失败 */
const RELOAD_ATTEMPTED_KEY = 'chunk_reload_attempted'

/**
 * 判断错误是否为 chunk 加载失败
 * 覆盖以下场景：
 * - 网络中断：TypeError: Failed to fetch / NetworkError
 * - chunk 不存在：HTTP 404 → SyntaxError (尝试解析 HTML 为 JS)
 * - Vite 动态 import 失败：标准错误信息
 */
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  const name = error.name.toLowerCase()

  return (
    // Vite/Webpack 动态 import 失败
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('dynamically imported module') ||
    // Safari / iOS 常见模块脚本错误
    message.includes('importing a module script failed') ||
    message.includes('module script') ||
    // 通用网络错误
    message.includes('failed to fetch') ||
    message.includes('network error') ||
    message.includes('load failed') ||
    // chunk 文件返回 HTML（404 fallback 场景）
    message.includes('unexpected token') ||
    // 通用 chunk 加载错误名称
    name.includes('chunkerror') ||
    name.includes('chunkloaderror')
  )
}

function reportChunkImportFailure(error: unknown, attempt: number, retries: number) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined

  void errorMonitor.captureError({
    error_message: `[lazyWithRetry] Import attempt ${attempt}/${retries + 1} failed: ${errorMessage}`,
    error_stack: errorStack,
    component_name: 'lazyWithRetry',
    action_type: 'route_lazy_import_failed',
    action_data: {
      attempt,
      max_attempts: retries + 1,
      pathname: typeof window !== 'undefined' ? window.location.pathname : '',
      href: typeof window !== 'undefined' ? window.location.href : '',
      is_chunk_error: isChunkLoadError(error),
    },
  })
}

/**
 * 延迟函数，用于重试间隔（指数退避）
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 带重试的动态 import
 * - 每次重试前等待指数递增的时间（1s, 2s, 4s）
 * - 重试时在 URL 上添加时间戳参数，绕过浏览器缓存
 * - 如果所有重试都失败，且判断为版本更新导致，则尝试刷新页面一次
 */
async function importWithRetry<T>(
  importFn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 第一次尝试直接调用原始 import
      // 后续重试也调用原始 import（浏览器会重新发起网络请求）
      return await importFn()
    } catch (error) {
      const isLastAttempt = attempt === retries
      const isChunkError = isChunkLoadError(error)

      console.warn(
        `[lazyWithRetry] Import attempt ${attempt + 1}/${retries + 1} failed:`,
        error instanceof Error ? error.message : error
      )
      reportChunkImportFailure(error, attempt + 1, retries)

      if (isLastAttempt) {
        // 所有重试都失败了
        if (isChunkError) {
          // 可能是版本更新导致旧 chunk 不存在
          // 尝试刷新页面一次（使用 sessionStorage 防止无限循环）
          const reloadAttempted = sessionStorage.getItem(RELOAD_ATTEMPTED_KEY)
          if (!reloadAttempted) {
            console.warn('[lazyWithRetry] All retries failed, attempting page reload for new version')
            sessionStorage.setItem(RELOAD_ATTEMPTED_KEY, Date.now().toString())
            window.location.reload()
            // 返回一个永远不会 resolve 的 Promise，防止在 reload 前渲染错误 UI
            return new Promise(() => {})
          }
          // 已经尝试过刷新了，清除标记，让错误正常抛出
          sessionStorage.removeItem(RELOAD_ATTEMPTED_KEY)
        }
        // 抛出原始错误，让 ErrorBoundary 捕获
        throw error
      }

      // 等待后重试（指数退避：1s, 2s, 4s）
      const retryDelay = RETRY_DELAY_BASE * Math.pow(2, attempt)
      console.log(`[lazyWithRetry] Retrying in ${retryDelay}ms...`)
      await delay(retryDelay)
    }
  }

  // TypeScript 需要这行，实际不会执行到这里
  throw new Error('[lazyWithRetry] Unexpected: exhausted all retries')
}

/**
 * 扩展的 lazy 组件类型，支持 preload 方法
 */
type LazyComponentWithPreload<T extends ComponentType<any>> = React.LazyExoticComponent<T> & {
  preload: () => Promise<void>
}

/**
 * 创建带重试和预加载支持的 lazy 组件
 *
 * @param importFn - 动态 import 函数，例如 () => import('./pages/HomePage')
 * @returns 带有 preload() 方法的 React.lazy 组件
 *
 * @example
 * // 基本使用
 * const HomePage = lazyWithRetry(() => import('./pages/HomePage'))
 *
 * // 预加载核心页面
 * HomePage.preload()
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): LazyComponentWithPreload<T> {
  // 缓存 import 结果，避免重复加载
  let modulePromise: Promise<{ default: T }> | null = null

  const getModule = () => {
    if (!modulePromise) {
      modulePromise = importWithRetry(importFn).catch((error) => {
        // 如果加载失败，清除缓存以允许下次重试
        modulePromise = null
        throw error
      })
    }
    return modulePromise
  }

  // 创建 React.lazy 组件
  const LazyComponent = lazy(getModule) as LazyComponentWithPreload<T>

  // 添加 preload 方法：静默预加载，不抛出错误
  LazyComponent.preload = async () => {
    try {
      await getModule()
    } catch {
      // 预加载失败不影响用户体验，静默忽略
      // 用户实际导航到该页面时会再次触发加载（带重试）
    }
  }

  return LazyComponent
}

/**
 * 在应用首屏加载完成后，静默预加载核心页面
 * 使用 requestIdleCallback（如果可用）在浏览器空闲时执行
 * 否则使用 setTimeout 延迟执行，避免与首屏渲染竞争资源
 *
 * @param components - 需要预加载的 lazy 组件数组（按优先级排序）
 * @param delayMs - 首屏加载后等待的延迟时间（毫秒），默认 2 秒
 */
export function prefetchCorePages(
  components: LazyComponentWithPreload<any>[],
  delayMs: number = 2000
): void {
  const startPrefetch = () => {
    // 逐个预加载，每个间隔 500ms，避免同时发起过多请求
    components.forEach((component, index) => {
      setTimeout(() => {
        component.preload()
      }, index * 500)
    })
  }

  // 延迟执行，确保首屏渲染完成
  setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      // 浏览器空闲时执行预加载
      window.requestIdleCallback(startPrefetch, { timeout: 5000 })
    } else {
      // 降级方案：直接执行
      startPrefetch()
    }
  }, delayMs)
}

/**
 * 清除 chunk reload 标记
 * 在应用成功加载后调用，确保下次 chunk 加载失败时可以再次尝试刷新
 */
export function clearChunkReloadFlag(): void {
  sessionStorage.removeItem(RELOAD_ATTEMPTED_KEY)
}
