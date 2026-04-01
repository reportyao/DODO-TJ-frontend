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
 * 使用方式：
 * 将 `if (error) throw error` 替换为：
 * `if (error) throw new Error(await extractEdgeFunctionError(error))`
 */

/**
 * 将 error_code 翻译为当前语言的错误提示
 * @param errorCode - 标准化错误码，如 "ERR_INSUFFICIENT_BALANCE"
 * @returns 翻译后的错误提示，如果翻译不存在则返回 null
 */
function translateErrorCode(errorCode: string): string | null {
  if (!errorCode || !errorCode.startsWith('ERR_')) return null
  const translationKey = `edgeErrors.${errorCode}`
  const translated = i18n.t(translationKey)
  // i18n.t 在 key 不存在时返回 key 本身
  if (translated === translationKey) return null
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
