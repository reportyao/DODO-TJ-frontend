/**
 * DODO PWA Service Worker v10
 * 
 * 【缓存策略】
 * - HTML/JS/CSS：不缓存（避免旧版本导致白屏）
 * - 图片：Cache-First（命中直接返回，未命中再网络请求）
 * - 可缓存API：Stale-While-Revalidate（返回缓存同时后台更新）
 * - 其他请求：直接走网络，不拦截
 * 
 * 【v10 更新内容】
 * - 品牌Logo全面升级为DODO猫咪Logo
 * - 强制清除旧版本缓存（包括旧TezBarakat Logo）
 * - 更新推送通知图标为新Logo
 */

const CACHE_VERSION = 'v10';
const CACHE_NAMES = {
  IMAGES: `dodo-images-${CACHE_VERSION}`,
  API: `dodo-api-${CACHE_VERSION}`,
};

// 图片缓存上限
const IMAGE_CACHE_LIMIT = 200;

// 需要缓存的 API 端点模式
const API_CACHE_PATTERNS = [
  /\/rest\/v1\/lotteries/,
  /\/rest\/v1\/products/,
  /\/rest\/v1\/pickup_points/,
  /\/rest\/v1\/coupons/,
  /\/rest\/v1\/banners/,      // 轮播图数据（变化不频繁）
];

// 不应该缓存的 API 端点（资金和认证相关，必须实时）
const NO_CACHE_PATTERNS = [
  /\/rest\/v1\/user_sessions/,
  /\/rest\/v1\/wallet_transactions/,
  /\/rest\/v1\/wallets/,
  /\/rest\/v1\/orders/,
  /\/rest\/v1\/commissions/,
  /\/auth\//,
  /\/rpc\//,
  /\/functions\//,
];

/**
 * 安装事件：跳过等待，立即激活
 */
self.addEventListener('install', (event) => {
  console.log('[SW v10] Installing...');
  self.skipWaiting();
});

/**
 * 激活事件：清除所有旧缓存，立即接管
 */
self.addEventListener('activate', (event) => {
  console.log('[SW v10] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 删除所有不属于当前版本的缓存
          if (!Object.values(CACHE_NAMES).includes(cacheName)) {
            console.log('[SW v10] Deleting old cache:', cacheName);
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
});

/**
 * 判断是否为图片请求
 * 【v9增强】支持 Supabase Storage 的 /object/public/ 路径
 * 这些URL可能不以常见图片扩展名结尾，但确实是图片资源
 */
function isImageRequest(url) {
  // 1. 传统扩展名匹配
  const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|avif)(\?.*)?$/i;
  if (imageExtensions.test(url.pathname)) {
    return true;
  }
  
  // 2. Supabase Storage 公开图片路径匹配
  // 格式: /storage/v1/object/public/{bucket}/{path}
  if (url.pathname.includes('/storage/v1/object/public/')) {
    return true;
  }

  return false;
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
 * 
 * 【缓存键说明】
 * 对于 Supabase Storage URL，使用去掉查询参数的路径作为缓存键
 * 避免同一张图片因不同的 token 参数被重复缓存
 */
async function imageCacheStrategy(request) {
  const cache = await caches.open(CACHE_NAMES.IMAGES);
  
  // 尝试从缓存中匹配（忽略查询参数以提高命中率）
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (!response || response.status !== 200) return response;
    
    const clone = response.clone();
    // 异步写入缓存，不阻塞响应
    cache.put(request, clone).then(() => {
      // 限制图片缓存数量，淘汰最旧的
      cache.keys().then((keys) => {
        if (keys.length > IMAGE_CACHE_LIMIT) {
          // 批量删除超出部分（每次清理10个，减少频繁操作）
          const deleteCount = Math.min(keys.length - IMAGE_CACHE_LIMIT, 10);
          for (let i = 0; i < deleteCount; i++) {
            cache.delete(keys[i]);
          }
        }
      });
    });
    
    return response;
  } catch (error) {
    // 网络失败时返回占位图
    return createPlaceholderImage();
  }
}

/**
 * Stale-While-Revalidate：返回缓存同时后台更新
 * 确保用户总是能快速看到数据（即使是旧的），同时在后台静默更新
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAMES.API);
  const cached = await cache.match(request);

  // 后台更新（无论是否有缓存）
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch((error) => {
      console.warn('[SW v10] API fetch failed, using cache:', error.message);
      return cached;
    });

  // 有缓存则立即返回，否则等待网络
  return cached || fetchPromise;
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

console.log('[SW v10] Loaded successfully');
