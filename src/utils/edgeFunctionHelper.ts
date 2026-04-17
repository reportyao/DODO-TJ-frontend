import { FunctionsHttpError } from '@supabase/supabase-js'
import { errorMonitor } from '../services/ErrorMonitorService'
import i18n from '../i18n/config'

/**
 * 从 Supabase Edge Function 错误中提取实际的业务错误信息，
 * 并自动上报到错误监控系统（ErrorMonitorService → error_logs 表 → 管理后台）。
 * 
 * 国际化支持：
 * 支持以下三种错误响应格式的 error_code 提取：
 *   格式A（标准）: { error_code: "ERR_XXX", error: "中文消息" }
 *   格式B（嵌套）: { error: { code: "ERR_XXX", message: "中文消息" } }
 *   格式C（纯文本）: { error: "中文消息" }
 * 
 * 提取到 error_code 后，优先使用 i18n 翻译系统将错误码映射为
 * 当前语言的错误提示。如果没有 error_code 或翻译缺失，
 * 则回退到 error/message 字段的原始文本。
 * 
 * 会话过期自动登出：
 * 当检测到 ERR_SESSION_EXPIRED / ERR_INVALID_SESSION / ERR_MISSING_SESSION
 * 或 HTTP 401 状态码时，自动清除本地 session 并重定向到登录页。
 * 
 * 使用方式：
 * 将 `if (error) throw error` 替换为：
 * `if (error) throw new Error(await extractEdgeFunctionError(error))`
 */

// 会话相关错误码集合
const SESSION_ERROR_CODES = new Set([
  'ERR_SESSION_EXPIRED',
  'ERR_INVALID_SESSION',
  'ERR_MISSING_SESSION',
  'ERR_MISSING_TOKEN',
  'ERR_INVALID_TOKEN',
])

// 防止短时间内多次触发 force logout（避免并发请求同时过期时重复跳转）
let _isForceLoggingOut = false

/**
 * 强制登出：清除本地 session 并重定向到登录页
 * 使用防抖机制避免并发请求同时触发多次登出
 */
function forceLogout() {
  if (_isForceLoggingOut) {return}
  _isForceLoggingOut = true

  console.warn('[Session] Force logout triggered: session expired or invalid')

  // 清除本地存储的 session 数据
  localStorage.removeItem('custom_session_token')
  localStorage.removeItem('custom_user')
  localStorage.removeItem('cached_wallets')

  // 通知 UserContext 更新状态（通过自定义事件）
  window.dispatchEvent(new CustomEvent('force-logout'))

  // 延迟重定向，给 UserContext 时间处理状态更新
  setTimeout(() => {
    const currentPath = window.location.pathname + window.location.search
    // 避免在登录页循环重定向
    if (!currentPath.startsWith('/login')) {
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}&reason=session_expired`
    }
    // 重置防抖标记（延迟较长以确保页面跳转完成）
    setTimeout(() => { _isForceLoggingOut = false }, 3000)
  }, 100)
}

/**
 * 将 error_code 翻译为当前语言的错误提示
 * @param errorCode - 标准化错误码，如 "ERR_INSUFFICIENT_BALANCE"
 * @returns 翻译后的错误提示，如果翻译不存在则返回 null
 */
function translateErrorCode(errorCode: string): string | null {
  if (!errorCode || !errorCode.startsWith('ERR_')) {return null}
  const translationKey = `edgeErrors.${errorCode}`
  const translated = i18n.t(translationKey)
  // i18n.t 在 key 不存在时返回 key 本身
  if (translated === translationKey) {return null}
  return translated
}

export async function extractEdgeFunctionError(error: unknown): Promise<string> {
  let errorMessage = 'Unknown error'
  let errorCode = ''
  let apiEndpoint = ''
  let statusCode = 0

  if (error instanceof FunctionsHttpError) {
    try {
      const response = error.context as Response
      if (response) {
        apiEndpoint = response.url || ''
        statusCode = response.status || 0

        if (typeof response.json === 'function') {
          const body = await response.json()
          
          // 提取 error_code（兼容多种响应格式）
          // 格式A（标准）: { error_code: "ERR_XXX" }
          if (body?.error_code) {
            errorCode = body.error_code
          }
          // 格式B（嵌套）: { error: { code: "ERR_XXX" } }
          else if (body?.error && typeof body.error === 'object' && body.error.code) {
            errorCode = body.error.code
          }
          
          // 提取错误消息
          if (body?.error) {
            errorMessage = typeof body.error === 'object'
              ? body.error.message || JSON.stringify(body.error)
              : body.error
          } else if (body?.message) {
            errorMessage = body.message
          } else {
            errorMessage = error.message
          }
        } else {
          errorMessage = error.message
        }
      } else {
        errorMessage = error.message
      }
    } catch {
      // JSON 解析失败时回退到原始消息
      errorMessage = error.message
    }
  } else if (error instanceof Error) {
    errorMessage = error.message
    // 检查错误消息本身是否是错误码
    if (errorMessage.startsWith('ERR_')) {
      errorCode = errorMessage
    }
  } else {
    errorMessage = String(error)
  }

  // 如果有 error_code，尝试翻译为当前语言
  if (errorCode) {
    const translated = translateErrorCode(errorCode)
    if (translated) {
      errorMessage = translated
    }
  }

  // ========================================
  // 全局 Session 过期拦截：自动强制登出
  // ========================================
  // 条件1: error_code 属于会话相关错误
  // 条件2: HTTP 状态码为 401（未授权）
  const isSessionError = SESSION_ERROR_CODES.has(errorCode)
  const is401 = statusCode === 401

  if (isSessionError || is401) {
    forceLogout()
  }

  // 自动上报到错误监控系统（异步，不阻塞业务流程）
  try {
    errorMonitor.captureApiError(
      apiEndpoint || 'edge-function',
      'POST',
      statusCode,
      errorCode ? `[${errorCode}] ${errorMessage}` : errorMessage,
    )
  } catch {
    // 上报失败不影响业务
  }

  return errorMessage
}
