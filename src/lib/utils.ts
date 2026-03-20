import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 货币格式化
export function formatCurrency(currency: string, amount: number | undefined | null): string {
  const safeAmount = typeof amount === 'number' ? amount : 0;
  return `${currency} ${safeAmount.toFixed(2)}`;
}

// 日期时间格式化（显示用户本地时间）
// 使用 Intl.DateTimeFormat 确保正确显示用户所在时区的时间
export function formatDateTime(dateString: string): string {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    
    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      return '';
    }
    
    // 使用手动拼接确保跨环境输出一致的 YYYY-MM-DD HH:MM 格式
    // 自动使用用户本地时区（getFullYear/getMonth 等方法基于本地时区）
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch (error) {
    console.error('formatDateTime error:', error);
    return '';
  }
}

// 仅格式化日期（不包含时间）
export function formatDate(dateString: string): string {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return '';
    }
    
    // 使用手动拼接确保跨环境输出一致的 YYYY-MM-DD 格式
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('formatDate error:', error);
    return '';
  }
}

// 获取抽奖状态文本（支持国际化）
export function getLotteryStatusText(status: string, t?: (key: string) => string): string {
  if (t) {
    const keyMap: Record<string, string> = {
      'ACTIVE': 'lottery.statusActive',
      'UPCOMING': 'lottery.statusUpcoming',
      'COMPLETED': 'lottery.statusCompleted',
      'SOLD_OUT': 'lottery.statusSoldOut',
      'DRAWN': 'lottery.statusDrawn',
      'CANCELLED': 'lottery.statusCancelled'
    };
    const key = keyMap[status];
    return key ? t(key) : status;
  }
  // Fallback without t function (for backward compatibility)
  const statusMap: Record<string, string> = {
    'ACTIVE': 'Active',
    'UPCOMING': 'Upcoming',
    'COMPLETED': 'Completed',
    'SOLD_OUT': 'Sold Out',
    'DRAWN': 'Drawn',
    'CANCELLED': 'Cancelled'
  };
  return statusMap[status] || status;
}

// 获取抽奖状态颜色
export function getLotteryStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    'ACTIVE': 'bg-green-100 text-green-700',
    'UPCOMING': 'bg-blue-100 text-blue-700',
    'COMPLETED': 'bg-gray-100 text-gray-700',
    'SOLD_OUT': 'bg-red-100 text-red-700',
    'DRAWN': 'bg-purple-100 text-purple-700',
    'CANCELLED': 'bg-gray-100 text-gray-500'
  };
  return colorMap[status] || 'bg-gray-100 text-gray-700';
}

// 获取剩余时间
// Get time remaining as object with detailed breakdown
export function getTimeRemaining(endTime: string): {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const now = new Date().getTime();
  const end = new Date(endTime).getTime();
  const diff = end - now;

  if (diff <= 0) {
    return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { total: diff, days, hours, minutes, seconds };
}

// Get time remaining as formatted string (supports i18n)
export function getTimeRemainingText(endTime: string, t?: (key: string, opts?: any) => string): string {
  const { total, days, hours, minutes } = getTimeRemaining(endTime);
  
  if (t) {
    if (total <= 0) return t('common.ended');
    if (days > 0) return t('common.daysHours', { days, hours });
    if (hours > 0) return t('common.hoursMinutes', { hours, minutes });
    return t('common.minutesOnly', { minutes });
  }
  // Fallback without t function
  if (total <= 0) return 'Ended';
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// 获取钱包类型文本（支持国际化）
export function getWalletTypeText(type: string, t?: (key: string) => string): string {
  if (t) {
    const keyMap: Record<string, string> = {
      'BALANCE': 'wallet.balance',
      'LUCKY_COIN': 'wallet.luckyCoin'
    };
    const key = keyMap[type];
    return key ? t(key) : type;
  }
  // Fallback without t function
  const typeMap: Record<string, string> = {
    'BALANCE': 'Balance',
    'LUCKY_COIN': 'Lucky Coin'
  };
  return typeMap[type] || type;
}

// 复制到剪贴板
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // 优先使用原生 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (clipboardError) {
        console.warn('[Clipboard] Native API failed, trying fallback:', clipboardError);
      }
    }
    
    // 降级方案：使用 textarea + execCommand
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const success = document.execCommand('copy');
      textArea.remove();
      return success;
    } catch (error) {
      console.error('[Clipboard] execCommand fallback failed:', error);
      textArea.remove();
      return false;
    }
  } catch (error) {
    console.error('[Clipboard] Failed to copy:', error);
    return false;
  }
}

// 【迁移完成】通用分享函数 - 优先使用 Web Share API，回退到 WhatsApp
export async function shareContent(text: string, url?: string, title?: string): Promise<void> {
  // 优先使用 Web Share API（PWA 和移动端支持良好）
  if (navigator.share) {
    try {
      await navigator.share({
        title: title || 'TezBarakat',
        text,
        url,
      });
      return;
    } catch (e) {
      // 用户取消分享或 API 不可用，回退到 WhatsApp
      if ((e as DOMException)?.name === 'AbortError') return;
      console.warn('[Share] Web Share API failed, falling back to WhatsApp:', e);
    }
  }
  // 回退到 WhatsApp 分享
  const fullText = url ? `${text} ${url}` : text;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(fullText)}`;
  window.open(whatsappUrl, '_blank');
}

// 向后兼容：保留 shareToWhatsApp 作为别名
export const shareToWhatsApp = shareContent;

// 处理多语言 JSONB 字段，用于获取商城标题、描述等
export function getLocalizedText(
  jsonb: Record<string, string> | null | undefined | any,
  language: string,
  fallbackLanguage: string = 'zh'
): string {
  // 如果是字符串，尝试解析为 JSON
  if (typeof jsonb === 'string') {
    try {
      jsonb = JSON.parse(jsonb);
    } catch (e) {
      return '';
    }
  }
  
  if (!jsonb || typeof jsonb !== 'object' || Array.isArray(jsonb)) {
    return '';
  }
    // 尝试使用当前语言
    if (jsonb[language]) {
      return jsonb[language];
    }

    // 尝试使用主要语言（例如，没有 zh-CN 就用 zh）
    const primaryLang = language.split('-')[0] as keyof typeof jsonb;
    if (primaryLang && jsonb[primaryLang]) {
      return jsonb[primaryLang];
    }

    // 尝试使用备用语言
    if (jsonb[fallbackLanguage]) {
      return jsonb[fallbackLanguage];
    }

    // 尝试返回第一个非空的值
    const firstValue = Object.values(jsonb).find(value => typeof value === 'string' && value.trim() !== '');
    if (firstValue) {
      return firstValue as string;
    }
  
    return '';
  }

/**
 * 生成 Supabase Storage 图片变换 URL
 * 利用 Supabase 的 image transformation API 按需调整图片尺寸和质量
 * 如果 URL 不是 Supabase Storage 格式，则安全回退到原始 URL
 * @param originalUrl 原始图片 URL
 * @param options.width 目标宽度 (px)
 * @param options.quality 图片质量 (1-100，默认 75)
 * @returns 优化后的图片 URL 或原始 URL
 */
export function getOptimizedImageUrl(
  originalUrl: string | null | undefined,
  options: {
    width: number;
    height?: number;
    quality?: number;
    /** resize 模式: cover(裁切填充) | contain(完整显示) | fill(拉伸), 默认 cover */
    resize?: 'cover' | 'contain' | 'fill';
  }
): string {
  if (!originalUrl) return '';
  try {
    const url = new URL(originalUrl);
    // 仅处理 Supabase Storage 的公开对象 URL
    // 格式: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
    if (url.pathname.includes('/storage/v1/object/public/')) {
      const transformedPath = url.pathname.replace(
        '/storage/v1/object/public/',
        '/storage/v1/render/image/public/'
      );
      const newUrl = new URL(transformedPath, url.origin);
      newUrl.searchParams.set('width', options.width.toString());
      if (options.height) {
        newUrl.searchParams.set('height', options.height.toString());
      }
      newUrl.searchParams.set('quality', (options.quality || 75).toString());
      if (options.resize) {
        newUrl.searchParams.set('resize', options.resize);
      }
      return newUrl.toString();
    }
    // 非 Supabase Storage URL，安全回退
    return originalUrl;
  } catch {
    // URL 解析失败，安全回退
    return originalUrl;
  }
}
