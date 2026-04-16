const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
}

type LogLevel = keyof typeof LOG_LEVELS

const isDevelopment = import.meta.env.MODE === 'development'
const currentLogLevel: LogLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'INFO'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel]
}

function sanitizeObject(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {return obj}

  const SENSITIVE_KEYS = [
    'password',
    'token',
    'secret',
    'apikey',
    'authorization',
    'x-api-key',
    'x-auth-token'
  ]

  const sanitized: Record<string, any> = Array.isArray(obj) ? [...(obj as any[])] : { ...(obj as Record<string, any>) }

  for (const key in sanitized) {
    if (!Object.prototype.hasOwnProperty.call(sanitized, key)) {continue}
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      sanitized[key] = '***REDACTED***'
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key])
    }
  }

  return sanitized
}

function formatMessage(level: string, message: string): string {
  return `[${new Date().toISOString()}] [${level}] ${message}`
}

export const logger = {
  debug: (message: string, data?: unknown): void => {
    if (!isDevelopment || !shouldLog('DEBUG')) {return}
    console.debug(formatMessage('DEBUG', message), sanitizeObject(data))
  },

  info: (message: string, data?: unknown): void => {
    if (!shouldLog('INFO')) {return}
    console.info(formatMessage('INFO', message), sanitizeObject(data))
  },

  warn: (message: string, data?: unknown): void => {
    if (!shouldLog('WARN')) {return}
    console.warn(formatMessage('WARN', message), sanitizeObject(data))
  },

  error: (message: string, error?: unknown): void => {
    if (!shouldLog('ERROR')) {return}
    console.error(formatMessage('ERROR', message), sanitizeObject(error))
  }
}
