/**
 * Process-lifetime in-memory cache for Accounting / ERP prep routes.
 * Separate from intelligence/api-cache to avoid cross-bundle export issues in Turbopack.
 */

type CacheEntry = { ts: number; data: unknown };

declare global {
  // eslint-disable-next-line no-var
  var __rocksfastAccCache: Map<string, CacheEntry> | undefined;
}

const cache: Map<string, CacheEntry> =
  globalThis.__rocksfastAccCache ?? new Map<string, CacheEntry>();
globalThis.__rocksfastAccCache = cache;

const MAX_ENTRIES = 100;

export function getAccCached<T>(key: string, ttlMs: number): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ttlMs) {
    cache.delete(key);
    return null;
  }
  return hit.data as T;
}

export function putAccCached(key: string, data: unknown): void {
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { ts: Date.now(), data });
}

export function deleteAccCached(key: string): void {
  cache.delete(key);
}

export function deleteAccCachedByPrefix(prefix: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
