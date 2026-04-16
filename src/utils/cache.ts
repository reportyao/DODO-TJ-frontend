/**
 * 缓存管理工具
 * 支持 localStorage、sessionStorage 和内存缓存
 */

interface CacheOptions {
  ttl?: number // 生存时间（毫秒）
  storage?: 'local' | 'session' | 'memory'
}

class CacheManager {
  private memoryCache = new Map<string, { value: any; expiry?: number }>()

  /**
   * 设置缓存
   */
  set<T>(key: string, value: T, options: CacheOptions = {}): void {
    const { ttl, storage = 'local' } = options
    const expiry = ttl ? Date.now() + ttl : undefined

    const cacheData = {
      value,
      expiry,
      timestamp: Date.now(),
    }

    switch (storage) {
      case 'local':
        try {
          localStorage.setItem(key, JSON.stringify(cacheData))
        } catch (e) {
          console.warn('LocalStorage is full or unavailable:', e)
          this.memoryCache.set(key, { value, expiry })
        }
        break
      case 'session':
        try {
          sessionStorage.setItem(key, JSON.stringify(cacheData))
        } catch (e) {
          console.warn('SessionStorage is full or unavailable:', e)
          this.memoryCache.set(key, { value, expiry })
        }
        break
      case 'memory':
        this.memoryCache.set(key, { value, expiry })
        break
    }
  }

  /**
   * 获取缓存
   */
  get<T>(key: string, storage: 'local' | 'session' | 'memory' = 'local'): T | null {
    let cacheData: any = null

    switch (storage) {
      case 'local': {
        const localData = localStorage.getItem(key)
        cacheData = localData ? JSON.parse(localData) : null
        break
      }
      case 'session': {
        const sessionData = sessionStorage.getItem(key)
        cacheData = sessionData ? JSON.parse(sessionData) : null
        break
      }
      case 'memory':
        cacheData = this.memoryCache.get(key) || null
        break
    }

    if (!cacheData) {return null}

    // 检查是否过期
    if (cacheData.expiry && Date.now() > cacheData.expiry) {
      this.remove(key, storage)
      return null
    }

    return cacheData.value as T
  }

  /**
   * 删除缓存
   */
  remove(key: string, storage: 'local' | 'session' | 'memory' = 'local'): void {
    switch (storage) {
      case 'local':
        localStorage.removeItem(key)
        break
      case 'session':
        sessionStorage.removeItem(key)
        break
      case 'memory':
        this.memoryCache.delete(key)
        break
    }
  }

  /**
   * 清空所有缓存
   */
  clear(storage: 'local' | 'session' | 'memory' = 'local'): void {
    switch (storage) {
      case 'local':
        localStorage.clear()
        break
      case 'session':
        sessionStorage.clear()
        break
      case 'memory':
        this.memoryCache.clear()
        break
    }
  }

  /**
   * 获取缓存大小
   */
  getSize(storage: 'local' | 'session' = 'local'): number {
    let size = 0
    const store = storage === 'local' ? localStorage : sessionStorage

    for (const key in store) {
      if (Object.prototype.hasOwnProperty.call(store, key)) {
        size += store[key].length + key.length
      }
    }

    return size
  }
}

export const cacheManager = new CacheManager()

/**
 * 缓存装饰器 - 用于函数结果缓存
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  options: CacheOptions = {}
): T {
  const cache = new Map<string, { value: any; expiry?: number }>()

  return ((...args: any[]) => {
    const key = JSON.stringify(args)
    const cached = cache.get(key)

    if (cached) {
      if (!cached.expiry || Date.now() <= cached.expiry) {
        return cached.value
      }
      cache.delete(key)
    }

    const result = fn(...args)
    const expiry = options.ttl ? Date.now() + options.ttl : undefined
    cache.set(key, { value: result, expiry })

    return result
  }) as T
}
