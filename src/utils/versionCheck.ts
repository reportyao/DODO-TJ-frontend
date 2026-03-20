/**
 * 版本检测机制
 * 
 * 用于在应用启动时检测是否有新版本可用。
 * 
 * 工作原理：
 * 1. 应用启动时从服务器获取 /version.json（始终不缓存此文件）
 * 2. 与 localStorage 中存储的版本号对比
 * 3. 如果版本不一致，执行一次页面刷新以加载新版本的资源
 * 4. 通过刷新计数器防止无限刷新循环（最多刷新 2 次）
 * 
 * 配合 Vite 的文件名哈希机制：
 * - 所有 JS/CSS 资源文件名包含内容哈希（如 index-Vjnf1_2r.js）
 * - 当代码变更时，哈希值自动改变，浏览器会下载新文件
 * - index.html 通过 Nginx 配置短期缓存 + must-revalidate
 * - version.json 通过 Nginx 配置为不缓存
 * 
 * 因此，正常的版本更新流程为：
 * - 用户打开应用 → 浏览器验证 index.html 是否更新
 * - 如果 index.html 已更新，其中引用的新哈希文件名会自动触发下载新资源
 * - version.json 检查作为额外的保险机制，处理某些浏览器或 PWA
 *   可能缓存 index.html 的极端情况
 */

const VERSION_KEY = 'app_version';
const RELOAD_COUNT_KEY = 'version_reload_count';
const MAX_RELOAD_COUNT = 2; // 最大连续刷新次数，防止无限循环

/**
 * 从服务器获取当前版本号
 * version.json 通过 Nginx 配置为不缓存，确保每次都获取最新值
 */
async function fetchServerVersion(): Promise<string> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (response.ok) {
      const data = await response.json();
      return data.version || '0.0.0';
    }
  } catch (error) {
    console.warn('[Version] Failed to fetch version.json:', error);
  }
  return '0.0.0';
}

/**
 * 应用启动时检查版本
 * 
 * 此函数在 main.tsx 中同步调用，但内部的网络请求是异步的。
 * 如果检测到版本不一致，会触发一次页面刷新。
 * 如果网络请求失败，静默忽略，不影响应用正常启动。
 */
export function checkVersion(): void {
  // 异步检查，不阻塞应用启动
  checkServerVersion().catch((error) => {
    console.warn('[Version] Version check failed, continuing with current version:', error);
  });
}

/**
 * 核心版本检查逻辑
 */
async function checkServerVersion(): Promise<void> {
  const serverVersion = await fetchServerVersion();
  
  // 获取失败时不做任何操作
  if (serverVersion === '0.0.0') {
    return;
  }

  const storedVersion = localStorage.getItem(VERSION_KEY);

  // 首次访问：记录版本号，不刷新
  if (!storedVersion) {
    console.log('[Version] First visit, recording version:', serverVersion);
    localStorage.setItem(VERSION_KEY, serverVersion);
    localStorage.removeItem(RELOAD_COUNT_KEY);
    return;
  }

  // 版本一致：重置刷新计数器
  if (storedVersion === serverVersion) {
    localStorage.removeItem(RELOAD_COUNT_KEY);
    return;
  }

  // 版本不一致：检查刷新计数器，防止无限循环
  const reloadCount = parseInt(localStorage.getItem(RELOAD_COUNT_KEY) || '0', 10);
  
  if (reloadCount >= MAX_RELOAD_COUNT) {
    // 已经刷新过多次仍然不一致，接受当前版本，停止刷新
    console.warn(
      `[Version] Already reloaded ${reloadCount} times. ` +
      `Stored: ${storedVersion}, Server: ${serverVersion}. ` +
      `Accepting current version to prevent infinite loop.`
    );
    localStorage.setItem(VERSION_KEY, serverVersion);
    localStorage.removeItem(RELOAD_COUNT_KEY);
    return;
  }

  // 执行刷新
  console.log(
    `[Version] New version detected. ` +
    `Stored: ${storedVersion}, Server: ${serverVersion}. ` +
    `Reloading... (attempt ${reloadCount + 1}/${MAX_RELOAD_COUNT})`
  );
  localStorage.setItem(VERSION_KEY, serverVersion);
  localStorage.setItem(RELOAD_COUNT_KEY, (reloadCount + 1).toString());
  window.location.reload();
}

/**
 * 获取当前存储的版本号
 */
export function getCurrentVersion(): string {
  return localStorage.getItem(VERSION_KEY) || '0.0.0';
}

/**
 * 强制清除所有缓存并重新加载
 * 供调试或手动触发使用
 */
export function forceClearCache(): void {
  console.log('[Version] Force clearing all caches...');
  
  // 清除 localStorage 中的版本信息
  localStorage.removeItem(VERSION_KEY);
  localStorage.removeItem(RELOAD_COUNT_KEY);
  
  // 清除 Service Worker 缓存（如果有）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister();
      });
    });
  }
  
  // 清除所有 Cache Storage
  if ('caches' in window) {
    caches.keys().then((names) => {
      names.forEach((name) => {
        caches.delete(name);
      });
    });
  }
  
  // 强制刷新
  window.location.reload();
}
