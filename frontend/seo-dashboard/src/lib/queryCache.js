/**
 * High-Performance Client-Side Query Cache & In-Flight Request Deduplication
 * ===========================================================================
 * Provides:
 * 1. Stale-While-Revalidate (SWR) in-memory data caching.
 * 2. In-flight promise deduplication (prevents multiple identical HTTP queries).
 * 3. Pattern-based cache invalidation on data mutations.
 * 4. Automatic memory eviction for expired entries.
 */

class QueryCache {
  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
    this.defaultTTL = 60 * 1000; // 60 seconds default TTL
  }

  /**
   * Main query caching method.
   * @param {string} key - Unique cache key (e.g. 'projects:list', 'keywords:my-slug')
   * @param {Function} fetcher - Async function that performs the network request
   * @param {Object} options - Configuration options
   * @returns {Promise<any>}
   */
  async cachedFetch(key, fetcher, options = {}) {
    const {
      ttl = this.defaultTTL,
      staleWhileRevalidate = true,
      forceRefresh = false
    } = options;

    const now = Date.now();
    const cachedEntry = this.cache.get(key);

    // 1. If not forcing refresh and valid unexpired cache exists, return immediately
    if (!forceRefresh && cachedEntry) {
      const isExpired = now > cachedEntry.expiresAt;
      if (!isExpired) {
        return cachedEntry.data;
      }

      // 2. If expired but SWR enabled, return stale data immediately and revalidate in background
      if (staleWhileRevalidate) {
        this.revalidateInBackground(key, fetcher, ttl);
        return cachedEntry.data;
      }
    }

    // 3. Deduplicate in-flight requests
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    // 4. Execute fetcher
    const fetchPromise = (async () => {
      try {
        const freshData = await fetcher();
        this.cache.set(key, {
          data: freshData,
          timestamp: Date.now(),
          expiresAt: Date.now() + ttl
        });
        return freshData;
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Triggers background revalidation without blocking caller.
   */
  async revalidateInBackground(key, fetcher, ttl) {
    if (this.pendingRequests.has(key)) return;

    const fetchPromise = (async () => {
      try {
        const freshData = await fetcher();
        this.cache.set(key, {
          data: freshData,
          timestamp: Date.now(),
          expiresAt: Date.now() + ttl
        });
        // Dispatch custom event for reactive UI updates if desired
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('query_cache_updated', { detail: { key, data: freshData } }));
        }
      } catch (err) {
        // Silent failure on background revalidation
        console.warn(`[QueryCache] Background revalidation failed for ${key}:`, err);
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, fetchPromise);
  }

  /**
   * Sets data manually into cache.
   */
  set(key, data, ttl = this.defaultTTL) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl
    });
  }

  /**
   * Retrieves data directly from cache.
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  /**
   * Invalidates cache entries by exact key or prefix pattern.
   * Example: invalidate('projects') will clear 'projects:list', 'projects:summary:x', etc.
   */
  invalidate(pattern) {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    for (const key of this.cache.keys()) {
      if (key === pattern || key.startsWith(pattern) || key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears entire cache.
   */
  clear() {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}

// Global Singleton Instance
export const queryCache = new QueryCache();

export const cachedFetch = (key, fetcher, options) => queryCache.cachedFetch(key, fetcher, options);
export const invalidateCache = (pattern) => queryCache.invalidate(pattern);
export const setCache = (key, data, ttl) => queryCache.set(key, data, ttl);
export const clearCache = () => queryCache.clear();
