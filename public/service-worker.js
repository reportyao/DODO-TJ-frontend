/**
 * DODO PWA Service Worker v8
 * 
 * 极简策略：
 * - 不缓存 HTML、JS、CSS（避免旧版本缓存导致白屏）
 * - 只缓存图片和 API 响应（提升体验）
 * - 安装时立即激活，激活时清除所有旧缓存
 */

const CACHE_VERSION = 'v8';
const CACHE_NAMES = {
  IMAGES: `dodo-images-${CACHE_VERSION}`,
  API: `dodo-api-${CACHE_VERSION}`,
};

// 需要缓存的 API 端点模式
const API_CACHE_PATTERNS = [
  /\/rest\/v1\/lotteries/,
  /\/rest\/v1\/products/,
  /\/rest\/v1\/pickup_points/,
  /\/rest\/v1\/coupons/,
];

// 不应该缓存的 API 端点
const NO_CACHE_PATTERNS = [
  /\/rest\/v1\/user_sessions/,
  /\/rest\/v1\/wallet_transactions/,
  /\/rest\/v1\/wallets/,
  /\/rest\/v1\/orders/,
  /\/auth\//,
  /\/rpc\//,
  /\/functions\//,
];

/**
 * 安装事件：跳过等待，立即激活
 */
self.addEventListener('install', (event) => {
  console.log('[SW v8] Installing...');
  self.skipWaiting();
});

/**
 * 激活事件：清除所有旧缓存，立即接管
 */
self.addEventListener('activate', (event) => {
  console.log('[SW v8] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 删除所有不属于当前版本的缓存
          if (!Object.values(CACHE_NAMES).includes(cacheName)) {
            console.log('[SW v8] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

/**
 * Fetch 事件：只拦截图片和可缓存的 API 请求
 * HTML、JS、CSS 全部走网络，不做任何缓存
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  // 跳过非 HTTP(S) 请求
  if (!url.protocol.startsWith('http')) return;

  // 图片：缓存优先
  if (isImageRequest(url)) {
    event.respondWith(imageCacheStrategy(request));
    return;
  }

  // 可缓存的 API：stale-while-revalidate
  if (isCacheableAPI(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 其他所有请求（HTML、JS、CSS 等）：直接走网络，不拦截
  // 这是关键：不 respondWith 就等于不拦截，浏览器正常从网络加载
});

function isImageRequest(url) {
  return (
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.gif') ||
    url.pathname.endsWith('.webp')
  );
}

function isCacheableAPI(url) {
  // 先检查是否在排除列表中
  if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    return false;
  }
  // 再检查是否匹配缓存模式
  return API_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname));
}

/**
 * 图片缓存策略：缓存优先，限制数量
 */
function imageCacheStrategy(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (!response || response.status !== 200) return response;
      const clone = response.clone();
      caches.open(CACHE_NAMES.IMAGES).then((cache) => {
        cache.put(request, clone);
        // 限制图片缓存数量
        cache.keys().then((keys) => {
          if (keys.length > 50) cache.delete(keys[0]);
        });
      });
      return response;
    }).catch(() => {
      return createPlaceholderImage();
    });
  });
}

/**
 * Stale-While-Revalidate：返回缓存同时后台更新
 */
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAMES.API).then((cache) => {
    return cache.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    });
  });
}

function createPlaceholderImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <rect width="200" height="200" fill="#e5e7eb"/>
    <text x="50%" y="50%" font-size="14" fill="#9ca3af" text-anchor="middle" dy=".3em">Image not available</text>
  </svg>`;
  return new Response(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
}

/**
 * 处理来自页面的消息
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * 推送通知
 */
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'You have a new notification',
    icon: '/dodo-logo.png',
    badge: '/dodo-logo.webp',
    tag: 'dodo-notification',
  };
  event.waitUntil(self.registration.showNotification('DODO', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

console.log('[SW v8] Loaded successfully');
