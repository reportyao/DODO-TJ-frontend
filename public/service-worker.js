/**
 * DODO PWA Service Worker
 * 
 * 功能：
 * 1. 离线缓存策略 (Cache-First, Network-First, Stale-While-Revalidate)
 * 2. 动态缓存管理
 * 3. 后台同步支持
 * 4. 推送通知支持
 */

const CACHE_VERSION = 'v5';
const CACHE_NAMES = {
  STATIC: `dodo-static-${CACHE_VERSION}`,
  DYNAMIC: `dodo-dynamic-${CACHE_VERSION}`,
  API: `dodo-api-${CACHE_VERSION}`,
  IMAGES: `dodo-images-${CACHE_VERSION}`,
};

// 需要立即缓存的静态资源
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/dodo-logo.png',
  '/dodo-logo.webp',
];

// 需要缓存的 API 端点模式
const API_CACHE_PATTERNS = [
  /\/rest\/v1\/lotteries/,
  /\/rest\/v1\/products/,
  /\/rest\/v1\/pickup_points/,
  /\/rest\/v1\/coupons/,
  /\/rest\/v1\/group_buys/,
];

// 不应该缓存的 API 端点
const NO_CACHE_PATTERNS = [
  /\/rest\/v1\/user_sessions/,
  /\/rest\/v1\/wallet_transactions/,
  /\/auth\//,
  /\/rpc\//,
];

/**
 * 安装事件：缓存静态资源
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAMES.STATIC).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Service Worker] Failed to cache some static assets:', err);
        // 继续执行，不中断安装
        return Promise.resolve();
      });
    }).then(() => {
      // 跳过等待，立即激活
      return self.skipWaiting();
    })
  );
});

/**
 * 激活事件：清理旧缓存
 */
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 删除不在当前版本中的缓存
          if (!Object.values(CACHE_NAMES).includes(cacheName)) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 立即控制所有客户端
      return self.clients.claim();
    })
  );
});

/**
 * 获取事件：智能缓存策略
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') {
    return;
  }

  // 跳过 Chrome 扩展和其他非 HTTP(S) 请求
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 根据请求类型选择缓存策略
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStrategy(request));
  } else if (isAPIRequest(url)) {
    event.respondWith(apiCacheStrategy(request, url));
  } else if (isImageRequest(url)) {
    event.respondWith(imageCacheStrategy(request));
  } else {
    event.respondWith(networkFirstStrategy(request));
  }
});

/**
 * 判断是否为静态资源
 */
function isStaticAsset(url) {
  return (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf') ||
    url.pathname.endsWith('.eot') ||
    url.pathname.endsWith('.svg') ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/manifest.json'
  );
}

/**
 * 判断是否为 API 请求
 */
function isAPIRequest(url) {
  return url.pathname.includes('/rest/v1/') || url.pathname.includes('/functions/');
}

/**
 * 判断是否为图片请求
 */
function isImageRequest(url) {
  return (
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.gif') ||
    url.pathname.endsWith('.webp')
  );
}

/**
 * 缓存优先策略 (Cache-First)
 * 用于：静态资源 (JS, CSS, 字体)
 */
function cacheFirstStrategy(request) {
  return caches.match(request).then((response) => {
    if (response) {
      return response;
    }

    return fetch(request).then((response) => {
      // 只缓存成功的响应
      if (!response || response.status !== 200 || response.type === 'error') {
        return response;
      }

      const responseToCache = response.clone();
      caches.open(CACHE_NAMES.STATIC).then((cache) => {
        cache.put(request, responseToCache);
      });

      return response;
    }).catch(() => {
      // 离线时返回缓存或离线页面
      return caches.match(request).then((cachedResponse) => {
        return cachedResponse || createOfflineResponse();
      });
    });
  });
}

/**
 * 网络优先策略 (Network-First)
 * 用于：HTML 页面、动态内容
 */
function networkFirstStrategy(request) {
  return fetch(request)
    .then((response) => {
      // 只缓存成功的响应
      if (!response || response.status !== 200) {
        return response;
      }

      const responseToCache = response.clone();
      caches.open(CACHE_NAMES.DYNAMIC).then((cache) => {
        cache.put(request, responseToCache);
      });

      return response;
    })
    .catch(() => {
      // 网络失败时使用缓存
      return caches.match(request).then((cachedResponse) => {
        return cachedResponse || createOfflineResponse();
      });
    });
}

/**
 * API 缓存策略 (Stale-While-Revalidate)
 * 用于：API 请求（列表、详情等）
 */
function apiCacheStrategy(request, url) {
  // 检查是否应该缓存此 API 端点
  const shouldCache = API_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname)) &&
                      !NO_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname));

  if (!shouldCache) {
    // 不缓存的 API 请求，直接网络请求
    return fetch(request).catch(() => {
      return caches.match(request).then((cachedResponse) => {
        return cachedResponse || createOfflineResponse();
      });
    });
  }

  // 返回缓存，同时在后台更新
  return caches.match(request).then((cachedResponse) => {
    const fetchPromise = fetch(request).then((response) => {
      if (!response || response.status !== 200) {
        return response;
      }

      const responseToCache = response.clone();
      caches.open(CACHE_NAMES.API).then((cache) => {
        cache.put(request, responseToCache);
      });

      return response;
    }).catch(() => {
      // 网络失败，返回缓存
      return cachedResponse || createOfflineResponse();
    });

    // 如果有缓存，立即返回；否则等待网络请求
    return cachedResponse || fetchPromise;
  });
}

/**
 * 图片缓存策略 (Cache-First with size limit)
 * 用于：图片资源
 */
function imageCacheStrategy(request) {
  return caches.match(request).then((cachedResponse) => {
    if (cachedResponse) {
      return cachedResponse;
    }

    return fetch(request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAMES.IMAGES).then((cache) => {
          cache.put(request, responseToCache);
          // 限制图片缓存大小（最多 50 张图片）
          cleanImageCache();
        });

        return response;
      })
      .catch(() => {
        // 返回占位符图片或缓存
        return caches.match(request).then((cachedResponse) => {
          return cachedResponse || createPlaceholderImage();
        });
      });
  });
}

/**
 * 清理图片缓存（保持大小在合理范围内）
 */
function cleanImageCache() {
  caches.open(CACHE_NAMES.IMAGES).then((cache) => {
    cache.keys().then((requests) => {
      if (requests.length > 50) {
        // 删除最旧的请求
        cache.delete(requests[0]);
      }
    });
  });
}

/**
 * 创建离线响应
 */
function createOfflineResponse() {
  return new Response(
    `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Offline</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
            background-color: #f9fafb;
            color: #1f2937;
          }
          .container {
            text-align: center;
            max-width: 400px;
          }
          .icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          p {
            color: #6b7280;
            margin-bottom: 20px;
            line-height: 1.6;
          }
          button {
            background-color: #2B5D3A;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            border: none;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.3s;
          }
          button:hover {
            background-color: #1f4620;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">📡</div>
          <h1>Шумо офлайн ҳастед / Вы офлайн / You're Offline</h1>
          <p>Пайвасти интернет қатъ шудааст. Баъзе имконот ҳоло дастрас нестанд.</p>
          <p style="font-size: 12px; color: #9ca3af; margin-bottom: 16px;">Похоже, вы потеряли подключение к интернету.</p>
          <button onclick="window.location.reload()">Такрор / Повторить / Retry</button>
        </div>
      </body>
    </html>
    `,
    {
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'Content-Type': 'text/html; charset=utf-8',
      }),
    }
  );
}

/**
 * 创建占位符图片
 */
function createPlaceholderImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect width="200" height="200" fill="#e5e7eb"/>
      <text x="50%" y="50%" font-size="14" fill="#9ca3af" text-anchor="middle" dy=".3em">
        Image not available
      </text>
    </svg>
  `;

  return new Response(svg, {
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'Content-Type': 'image/svg+xml; charset=utf-8',
    }),
  });
}

/**
 * 处理后台同步（用于离线时的操作）
 */
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);

  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders());
  } else if (event.tag === 'sync-notifications') {
    event.waitUntil(syncNotifications());
  }
});

/**
 * 同步待处理订单
 */
function syncPendingOrders() {
  return caches.open(CACHE_NAMES.API).then((cache) => {
    // 从本地存储获取待同步的订单
    return new Promise((resolve) => {
      // 实现待同步订单的逻辑
      resolve();
    });
  });
}

/**
 * 同步通知
 */
function syncNotifications() {
  return new Promise((resolve) => {
    // 实现通知同步的逻辑
    resolve();
  });
}

/**
 * 处理推送通知
 */
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');

  const options = {
    body: event.data ? event.data.text() : 'You have a new notification',
    icon: '/dodo-logo.png',
    badge: '/dodo-logo.webp',
    tag: 'dodo-notification',
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification('DODO', options)
  );
});

/**
 * 处理通知点击事件
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked');

  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // 如果已有窗口打开，聚焦到它
      for (let i = 0; i < clientList.length; i++) {
        if (clientList[i].url === '/' && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      // 否则打开新窗口
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

console.log('[Service Worker] Loaded successfully');
