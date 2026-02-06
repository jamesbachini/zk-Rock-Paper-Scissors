/**
 * Request caching utility to prevent duplicate calls
 * Based on a shared studio request-cache pattern
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class RequestCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private pendingRequests: Map<string, Promise<any>> = new Map();

  /**
   * Deduplicate identical concurrent requests
   * If a request is already in flight, return the pending promise
   * Otherwise, execute the request and cache the result
   */
  async dedupe<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 5000 // Default 5 second TTL
  ): Promise<T> {
    // Check if we have a cached result that's still valid
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }

    // Check if this request is already in flight
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending;
    }

    // Execute the request
    const promise = fetcher()
      .then((data) => {
        // Cache the result
        this.cache.set(key, {
          data,
          timestamp: Date.now(),
        });

        // Remove from pending requests
        this.pendingRequests.delete(key);

        return data;
      })
      .catch((error) => {
        // Remove from pending requests on error
        this.pendingRequests.delete(key);
        throw error;
      });

    // Store the pending request
    this.pendingRequests.set(key, promise);

    return promise;
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching a pattern
   */
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}

// Export singleton instance
export const requestCache = new RequestCache();

/**
 * Create a cache key from parts
 */
export function createCacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}
