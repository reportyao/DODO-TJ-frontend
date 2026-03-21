/**
 * 错误监控服务
 * 用于捕获和上报前端错误到Supabase
 */

import { supabase } from '../lib/supabase';

// 错误类型枚举
export enum ErrorType {
  JS_ERROR = 'JS_ERROR',
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNHANDLED_REJECTION = 'UNHANDLED_REJECTION',
}

// 用户操作记录
interface UserAction {
  type: string;
  target?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

// 错误日志数据结构
interface ErrorLogData {
  error_type: ErrorType;
  error_message: string;
  error_stack?: string;
  user_id?: string;
  phone_number?: string;
  page_url?: string;
  page_route?: string;
  component_name?: string;
  action_type?: string;
  action_data?: Record<string, unknown>;
  user_actions?: UserAction[];
  user_agent?: string;
  device_type?: string;
  device_model?: string;
  os_name?: string;
  os_version?: string;
  browser_name?: string;
  browser_version?: string;
  screen_width?: number;
  screen_height?: number;
  network_type?: string;
  app_version?: string;
  is_telegram_mini_app?: boolean;
  telegram_platform?: string;
  api_endpoint?: string;
  api_method?: string;
  api_status_code?: number;
  api_response_body?: string;
}

// 用户操作历史（最多保留20条）
const userActionsHistory: UserAction[] = [];
const MAX_ACTIONS_HISTORY = 20;

// 解析User-Agent获取设备信息
function parseUserAgent(ua: string): {
  deviceType: string;
  deviceModel: string;
  osName: string;
  osVersion: string;
  browserName: string;
  browserVersion: string;
} {
  const result = {
    deviceType: 'desktop',
    deviceModel: 'Unknown',
    osName: 'Unknown',
    osVersion: '',
    browserName: 'Unknown',
    browserVersion: '',
  };

  // 检测设备类型
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) {
    result.deviceType = /iPad|Tablet/i.test(ua) ? 'tablet' : 'mobile';
  }

  // 检测设备型号
  const devicePatterns = [
    { pattern: /iPhone/, model: 'iPhone' },
    { pattern: /iPad/, model: 'iPad' },
    { pattern: /Samsung\s*([\w-]+)/i, model: 'Samsung' },
    { pattern: /Xiaomi\s*([\w-]+)/i, model: 'Xiaomi' },
    { pattern: /Huawei\s*([\w-]+)/i, model: 'Huawei' },
    { pattern: /OPPO\s*([\w-]+)/i, model: 'OPPO' },
    { pattern: /vivo\s*([\w-]+)/i, model: 'vivo' },
    { pattern: /Redmi\s*([\w-]+)/i, model: 'Redmi' },
    { pattern: /OnePlus\s*([\w-]+)/i, model: 'OnePlus' },
    { pattern: /Pixel\s*([\w-]+)/i, model: 'Google Pixel' },
  ];

  for (const { pattern, model } of devicePatterns) {
    const match = ua.match(pattern);
    if (match) {
      result.deviceModel = match[1] ? `${model} ${match[1]}` : model;
      break;
    }
  }

  // 检测操作系统
  if (/Windows NT (\d+\.\d+)/i.test(ua)) {
    result.osName = 'Windows';
    const match = ua.match(/Windows NT (\d+\.\d+)/i);
    if (match) {
      const ntVersion = match[1];
      const versionMap: Record<string, string> = {
        '10.0': '10/11',
        '6.3': '8.1',
        '6.2': '8',
        '6.1': '7',
      };
      result.osVersion = versionMap[ntVersion] || ntVersion;
    }
  } else if (/Mac OS X (\d+[._]\d+)/i.test(ua)) {
    result.osName = 'macOS';
    const match = ua.match(/Mac OS X (\d+[._]\d+)/i);
    if (match) result.osVersion = match[1].replace('_', '.');
  } else if (/Android (\d+(\.\d+)?)/i.test(ua)) {
    result.osName = 'Android';
    const match = ua.match(/Android (\d+(\.\d+)?)/i);
    if (match) result.osVersion = match[1];
  } else if (/iPhone OS (\d+_\d+)/i.test(ua) || /iPad.*OS (\d+_\d+)/i.test(ua)) {
    result.osName = 'iOS';
    const match = ua.match(/(?:iPhone|iPad).*OS (\d+_\d+)/i);
    if (match) result.osVersion = match[1].replace('_', '.');
  } else if (/Linux/i.test(ua)) {
    result.osName = 'Linux';
  }

  // 检测浏览器
  const browserPatterns = [
    { pattern: /Edg\/(\d+(\.\d+)?)/i, name: 'Edge' },
    { pattern: /Chrome\/(\d+(\.\d+)?)/i, name: 'Chrome' },
    { pattern: /Firefox\/(\d+(\.\d+)?)/i, name: 'Firefox' },
    { pattern: /Safari\/(\d+(\.\d+)?)/i, name: 'Safari' },
    { pattern: /OPR\/(\d+(\.\d+)?)/i, name: 'Opera' },
  ];

  for (const { pattern, name } of browserPatterns) {
    const match = ua.match(pattern);
    if (match) {
      result.browserName = name;
      result.browserVersion = match[1];
      break;
    }
  }

  return result;
}

// 获取网络类型
function getNetworkType(): string {
  const connection = (navigator as any).connection || 
                     (navigator as any).mozConnection || 
                     (navigator as any).webkitConnection;
  if (connection) {
    return connection.effectiveType || connection.type || 'unknown';
  }
  return 'unknown';
}

// 【迁移修复】获取平台信息
function getPlatformInfo(): {
  isPWA: boolean;
  platformType?: string;
  phoneNumber?: string;
} {
  const result = {
    isPWA: false,
    platformType: undefined as string | undefined,
    phoneNumber: undefined as string | undefined,
  };

  try {
    // 检查是否为 PWA 模式
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    result.isPWA = isStandalone;
    result.platformType = isStandalone ? 'pwa' : 'browser';

    // 尝试从缓存用户数据获取手机号
    const storedUser = localStorage.getItem('custom_user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      result.phoneNumber = parsedUser.phone_number;
    }

    // 检测 PWA 环境
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true) {
      result.platformType = 'pwa_standalone';
    } else {
      result.platformType = 'browser';
    }
  } catch (e) {
    // 忽略错误
  }

  return result;
}

// 获取当前用户ID
function getCurrentUserId(): string | undefined {
  try {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      return user.id;
    }
  } catch (e) {
    // 忽略错误
  }
  return undefined;
}

// 脱敏处理敏感数据
function sanitizeData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  
  if (typeof data === 'string') {
    // 脱敏可能的敏感信息
    return data
      .replace(/password["\s:=]+["']?[^"'\s,}]+/gi, 'password: [REDACTED]')
      .replace(/token["\s:=]+["']?[^"'\s,}]+/gi, 'token: [REDACTED]')
      .replace(/key["\s:=]+["']?[^"'\s,}]+/gi, 'key: [REDACTED]')
      .replace(/secret["\s:=]+["']?[^"'\s,}]+/gi, 'secret: [REDACTED]');
  }
  
  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }
  
  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || lowerKey.includes('token') || 
          lowerKey.includes('secret') || lowerKey.includes('key')) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeData(value);
      }
    }
    return sanitized;
  }
  
  return data;
}

// 错误监控服务类
class ErrorMonitorService {
  private isInitialized = false;
  private appVersion = '1.0.0';

  // 初始化错误监控
  init(appVersion?: string) {
    if (this.isInitialized) return;
    
    if (appVersion) {
      this.appVersion = appVersion;
    }

    // 监听全局JS错误
    window.addEventListener('error', (event) => {
      this.captureError({
        error_type: ErrorType.JS_ERROR,
        error_message: event.message,
        error_stack: event.error?.stack,
        component_name: event.filename,
      });
    });

    // 监听未处理的Promise拒绝
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason;
      this.captureError({
        error_type: ErrorType.UNHANDLED_REJECTION,
        error_message: error?.message || String(error),
        error_stack: error?.stack,
      });
    });

    // 监听用户点击操作
    document.addEventListener('click', (event) => {
      try {
        const target = event.target;
        
        // 防御性检查：event.target 可能是 Text 节点、Comment 节点或其他非 Element 类型
        if (!target || !(target instanceof Element)) {
          return;
        }
        
        // 安全获取 className 字符串
        // - HTMLElement.className 返回 string
        // - SVGElement.className 返回 SVGAnimatedString 对象（有 baseVal 属性）
        // - 其他情况可能返回 undefined
        let classNameStr = '';
        try {
          const cn = target.className;
          if (typeof cn === 'string') {
            classNameStr = cn;
          } else if (cn && typeof cn === 'object' && 'baseVal' in cn) {
            classNameStr = (cn as SVGAnimatedString).baseVal || '';
          }
        } catch {
          // 某些浏览器环境下访问 className 可能抛出异常，安全忽略
          classNameStr = '';
        }
        
        const tagName = target.tagName || 'UNKNOWN';
        const idStr = target.id ? `#${target.id}` : '';
        const classStr = classNameStr ? `.${classNameStr.split(' ').filter(Boolean).join('.')}` : '';
        
        this.recordUserAction({
          type: 'click',
          target: `${tagName}${idStr}${classStr}`,
          timestamp: Date.now(),
        });
      } catch {
        // 错误监控本身不应抛出异常影响用户体验
      }
    }, true);

    // 监听路由变化
    window.addEventListener('popstate', () => {
      this.recordUserAction({
        type: 'navigation',
        target: window.location.pathname,
        timestamp: Date.now(),
      });
    });

    this.isInitialized = true;
    console.log('[ErrorMonitor] 错误监控服务已初始化');
  }

  // 记录用户操作
  recordUserAction(action: UserAction) {
    userActionsHistory.push(action);
    if (userActionsHistory.length > MAX_ACTIONS_HISTORY) {
      userActionsHistory.shift();
    }
  }

  // 捕获并上报错误
  async captureError(errorData: Partial<ErrorLogData>) {
    try {
      const ua = navigator.userAgent;
      const deviceInfo = parseUserAgent(ua);
      const platformInfo = getPlatformInfo();

      const logData: ErrorLogData = {
        error_type: errorData.error_type || ErrorType.JS_ERROR,
        error_message: errorData.error_message || 'Unknown error',
        error_stack: errorData.error_stack,
        user_id: getCurrentUserId(),
        phone_number: platformInfo.phoneNumber,
        page_url: window.location.href,
        page_route: window.location.pathname,
        component_name: errorData.component_name,
        action_type: errorData.action_type,
        action_data: errorData.action_data ? sanitizeData(errorData.action_data) as Record<string, unknown> : undefined,
        user_actions: [...userActionsHistory],
        user_agent: ua,
        device_type: deviceInfo.deviceType,
        device_model: deviceInfo.deviceModel,
        os_name: deviceInfo.osName,
        os_version: deviceInfo.osVersion,
        browser_name: deviceInfo.browserName,
        browser_version: deviceInfo.browserVersion,
        screen_width: window.screen.width,
        screen_height: window.screen.height,
        network_type: getNetworkType(),
        app_version: this.appVersion,
        is_telegram_mini_app: platformInfo.isPWA || false,
        telegram_platform: platformInfo.platformType || 'web',
        api_endpoint: errorData.api_endpoint,
        api_method: errorData.api_method,
        api_status_code: errorData.api_status_code,
        api_response_body: errorData.api_response_body ? 
          String(errorData.api_response_body).substring(0, 1000) : undefined,
      };

      // 异步上报，不阻塞用户操作
      // 使用 any 类型绕过类型检查，因为 error_logs 表是新增的
      await (supabase as any).from('error_logs').insert([logData]);
      
      console.log('[ErrorMonitor] 错误已上报:', logData.error_message);
    } catch (e) {
      // 上报失败时不抛出错误，避免影响用户体验
      console.error('[ErrorMonitor] 错误上报失败:', e);
    }
  }

  // 手动上报API错误
  captureApiError(
    endpoint: string,
    method: string,
    statusCode: number,
    errorMessage: string,
    responseBody?: string
  ) {
    this.captureError({
      error_type: ErrorType.API_ERROR,
      error_message: errorMessage,
      api_endpoint: endpoint,
      api_method: method,
      api_status_code: statusCode,
      api_response_body: responseBody,
    });
  }

  // 手动上报网络错误
  captureNetworkError(endpoint: string, method: string, errorMessage: string) {
    this.captureError({
      error_type: ErrorType.NETWORK_ERROR,
      error_message: errorMessage,
      api_endpoint: endpoint,
      api_method: method,
    });
  }

  // 手动上报自定义错误
  captureCustomError(
    message: string,
    componentName?: string,
    actionType?: string,
    actionData?: Record<string, unknown>
  ) {
    this.captureError({
      error_type: ErrorType.JS_ERROR,
      error_message: message,
      component_name: componentName,
      action_type: actionType,
      action_data: actionData,
    });
  }
}

// 导出单例
export const errorMonitor = new ErrorMonitorService();
