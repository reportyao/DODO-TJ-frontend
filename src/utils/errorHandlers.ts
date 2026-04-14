// 全局错误处理器，专门处理 DOM 操作错误
const isIgnorableDomAnimationError = (error: unknown, fallbackMessage = '') => {
  if (!(error instanceof Error)) {
    return (
      fallbackMessage.includes('removeChild') ||
      fallbackMessage.includes('insertBefore') ||
      fallbackMessage.includes('NotFoundError')
    )
  }

  return (
    error.name === 'NotFoundError' ||
    error.message.includes('removeChild') ||
    error.message.includes('insertBefore')
  )
}

const logIgnoredDomAnimationError = (source: string, error: unknown) => {
  if (import.meta.env.DEV) {
    console.debug(`[DOM animation warning][${source}]`, error)
  }
}

export const setupGlobalErrorHandlers = () => {
  // 捕获未处理的 Promise 错误
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason);

    // 过滤 Service Worker 更新失败（开发/代理环境的已知问题，生产环境不影响功能）
    if (
      message.includes('ServiceWorker') ||
      message.includes('service-worker') ||
      message.includes('Failed to update a ServiceWorker') ||
      message.includes('bad HTTP response code')
    ) {
      event.preventDefault();
      return;
    }

    // 过滤 Framer Motion DOM 操作错误（React 严格模式兼容性问题）
    if (isIgnorableDomAnimationError(reason, message)) {
      logIgnoredDomAnimationError('unhandledrejection', reason)
      event.preventDefault();
      return;
    }

    console.error('Unhandled promise rejection:', reason);
  })

  // 捕获全局 JavaScript 错误
  window.addEventListener('error', (event: ErrorEvent) => {
    // 过滤 Framer Motion DOM 操作错误
    if (isIgnorableDomAnimationError(event.error, event.message || '')) {
      logIgnoredDomAnimationError('window.error', event.error || event.message)
      event.preventDefault();
      return;
    }

    console.error('Global error:', event.error);
  })

  // 添加 Framer Motion 特定的错误处理（覆盖 console.error）
  const originalConsoleError = console.error
  const originalConsoleDebug = console.debug.bind(console)
  console.error = (...args) => {
    const message = args.join(' ')
    if (isIgnorableDomAnimationError(args[0], message) || message.includes('framer-motion')) {
      if (import.meta.env.DEV) {
        originalConsoleDebug('[Ignored DOM animation error]', ...args)
      }
      return
    }
    originalConsoleError.apply(console, args)
  }
}

// React 开发工具警告抑制（仅用于已知的安全警告）
export const suppressKnownWarnings = () => {
  const originalConsoleWarn = console.warn
  console.warn = (...args) => {
    const message = args.join(' ')
    
    // 抑制已知的安全警告
    if (
      message.includes('useLayoutEffect does nothing on the server') ||
      message.includes('componentWillMount has been renamed') ||
      message.includes('findDOMNode is deprecated')
    ) {
      return
    }
    
    originalConsoleWarn.apply(console, args)
  }
}
