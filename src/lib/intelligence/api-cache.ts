/**
 * Process-lifetime in-memory cache for Intelligence API responses.
 * Pinned to globalThis so Next.js dev-mode HMR doesn't wipe the Map on
 * route module reload — without this, "warm" hits stay cold in dev.
 */

type CacheEntry = { ts: number; data: unknown };

declare global {
  // eslint-disable-next-line no-var
  var __rocksfastIntelCache: Map<string, CacheEntry> | undefined;
}

const cache: Map<string, CacheEntry> =
  globalThis.__rocksfastIntelCache ?? new Map<string, CacheEntry>();
globalThis.__rocksfastIntelCache = cache;

const MAX_ENTRIES = 200;

/** Build a deterministic cache key — query params sorted so order doesn't matter. */
export function makeCacheKey(route: string, searchParams: URLSearchParams): string {
  const entries: Array<[string, string]> = [];
  searchParams.forEach((v, k) => entries.push([k, v]));
  entries.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  const qs = entries.map(([k, v]) => `${k}=${v}`).join("&");
  return `${route}?${qs}`;
}

export function getCached<T>(key: string, ttlMs: number): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ttlMs) {
    cache.delete(key);
    return null;
  }
  return hit.data as T;
}

export function putCached(key: string, data: unknown): void {
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { ts: Date.now(), data });
}

export function deleteCached(key: string): void {
  cache.delete(key);
}
