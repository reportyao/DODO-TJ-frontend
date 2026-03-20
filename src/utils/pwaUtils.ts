/**
 * PWA 工具函数
 * 
 * 功能：
 * 1. Service Worker 注册与管理
 * 2. PWA 安装提示处理
 * 3. 离线状态检测
 * 4. 缓存管理
 */

let deferredPrompt: any = null;
let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

/**
 * 注册 Service Worker
 */
export async function registerServiceWorker(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) {
      console.warn('[PWA] Service Worker not supported');
      return;
    }

    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
    });

    serviceWorkerRegistration = registration;
    console.log('[PWA] Service Worker registered successfully', registration);

    // 监听 Service Worker 更新
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // 有新版本可用
            console.log('[PWA] New Service Worker version available');
            notifyUpdateAvailable();
          }
        });
      }
    });

    // 定期检查更新
    setInterval(() => {
      registration.update();
    }, 60000); // 每分钟检查一次

  } catch (error) {
    console.error('[PWA] Failed to register Service Worker:', error);
  }
}

/**
 * 获取 Service Worker 注册实例
 */
export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
  return serviceWorkerRegistration;
}

/**
 * 卸载 Service Worker
 */
export async function unregisterServiceWorker(): Promise<void> {
  try {
    if (serviceWorkerRegistration) {
      await serviceWorkerRegistration.unregister();
      serviceWorkerRegistration = null;
      console.log('[PWA] Service Worker unregistered');
    }
  } catch (error) {
    console.error('[PWA] Failed to unregister Service Worker:', error);
  }
}

/**
 * 处理 PWA 安装提示
 */
export function setupInstallPrompt(
  onPromptReady: (canInstall: boolean) => void,
  onInstalled: () => void
): () => void {
  // 保存具名引用，以便正确移除（匿名函数无法被 removeEventListener 移除）
  const handleBeforeInstall = (e: Event) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Install prompt ready');
    onPromptReady(true);
  };

  const handleAppInstalled = () => {
    console.log('[PWA] App installed');
    deferredPrompt = null;
    onInstalled();
  };

  // 监听 beforeinstallprompt 事件
  window.addEventListener('beforeinstallprompt', handleBeforeInstall);

  // 监听应用安装完成
  window.addEventListener('appinstalled', handleAppInstalled);

  // 检查是否已安装（standalone 模式）
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('[PWA] App is already installed (standalone mode)');
    onInstalled();
  }

  // 返回清理函数，防止组件卸载后内存泄漏
  return () => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    window.removeEventListener('appinstalled', handleAppInstalled);
  };
}

/**
 * 触发 PWA 安装提示
 */
export async function triggerInstallPrompt(): Promise<boolean> {
  if (!deferredPrompt) {
    console.warn('[PWA] Install prompt not available');
    return false;
  }

  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] User choice:', outcome);

    if (outcome === 'accepted') {
      deferredPrompt = null;
      return true;
    }

    return false;
  } catch (error) {
    console.error('[PWA] Failed to trigger install prompt:', error);
    return false;
  }
}

/**
 * 检查是否可以安装
 */
export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/**
 * 检查是否已安装
 */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

/**
 * 通知用户有新版本可用
 */
function notifyUpdateAvailable(): void {
  // 发送事件，让应用层决定如何处理
  const event = new CustomEvent('pwa:update-available', {
    detail: {
      message: 'A new version of TezBarakat is available. Please refresh to update.',
    },
  });
  window.dispatchEvent(event);
}

/**
 * 强制更新应用
 */
export async function forceUpdate(): Promise<void> {
  if (serviceWorkerRegistration) {
    try {
      await serviceWorkerRegistration.unregister();
      window.location.reload();
    } catch (error) {
      console.error('[PWA] Failed to force update:', error);
      window.location.reload();
    }
  }
}

/**
 * 检测离线状态
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * 监听在线/离线状态变化
 */
export function onOnlineStatusChange(callback: (isOnline: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // 返回取消监听函数
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

/**
 * 清理缓存
 */
export async function clearCache(cacheName?: string): Promise<void> {
  try {
    if (cacheName) {
      await caches.delete(cacheName);
      console.log(`[PWA] Cache cleared: ${cacheName}`);
    } else {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      console.log('[PWA] All caches cleared');
    }
  } catch (error) {
    console.error('[PWA] Failed to clear cache:', error);
  }
}

/**
 * 获取缓存大小
 */
export async function getCacheSize(): Promise<number> {
  try {
    const cacheNames = await caches.keys();
    let totalSize = 0;

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();

      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }
    }

    return totalSize;
  } catch (error) {
    console.error('[PWA] Failed to get cache size:', error);
    return 0;
  }
}

/**
 * 请求后台同步
 */
export async function requestBackgroundSync(tag: string): Promise<void> {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).sync.register(tag);
      console.log(`[PWA] Background sync registered: ${tag}`);
    }
  } catch (error) {
    console.error('[PWA] Failed to register background sync:', error);
  }
}

/**
 * 请求通知权限
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        return true;
      }

      if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
      }

      return false;
    }

    return false;
  } catch (error) {
    console.error('[PWA] Failed to request notification permission:', error);
    return false;
  }
}

/**
 * 发送本地通知
 */
export async function sendLocalNotification(
  title: string,
  options?: NotificationOptions
): Promise<void> {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      if (serviceWorkerRegistration) {
        await serviceWorkerRegistration.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
    }
  } catch (error) {
    console.error('[PWA] Failed to send notification:', error);
  }
}

/**
 * 获取 PWA 信息
 */
export function getPWAInfo() {
  return {
    isSupported: 'serviceWorker' in navigator,
    isInstalled: isInstalled(),
    isOnline: isOnline(),
    canInstall: canInstall(),
    hasServiceWorker: serviceWorkerRegistration !== null,
  };
}

/**
 * 监听 PWA 更新事件
 */
export function onPWAUpdate(callback: (detail: any) => void): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent;
    callback(customEvent.detail);
  };

  window.addEventListener('pwa:update-available', handler);

  return () => {
    window.removeEventListener('pwa:update-available', handler);
  };
}
