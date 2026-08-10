"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Cascade-aware distincts.
 *
 * The hook keys its cache by `(brand, col, filterHash)` where filterHash is
 * built from every other filter the caller currently has applied.
 * That means picking Branch X immediately invalidates the channel /
 * category / menu dropdown caches and re-fetches them with the
 * narrowed context, which is what makes filters "talk to each other"
 * Excel-style.
 *
 * For `col === "ym"` we deliberately ignore the passed filters so the
 * date dropdown never gets cut down — date is the dashboard's outer
 * scope and empty months are valid signal, not noise.
 */

const memCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function filterHash(filters: Record<string, string[] | undefined>): string {
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(filters)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    entries.push([k, [...v].sort().join(",")]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.length === 0
    ? "∅"
    : entries.map(([k, v]) => `${k}=${v}`).join("|");
}

async function fetchDistinct(
  brand: string,
  col: string,
  filters: Record<string, string[] | undefined>,
  cacheKey: string
): Promise<string[]> {
  if (memCache.has(cacheKey)) return memCache.get(cacheKey)!;
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const params = new URLSearchParams();
  params.set("brand", brand);
  params.set("col", col);
  for (const [k, v] of Object.entries(filters)) {
    if (!Array.isArray(v)) continue;
    for (const val of v) params.append(k, val);
  }

  const p = (async () => {
    const res = await fetch(`/api/intelligence/dashboards/master/distincts?${params.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    const body = (await res.json()) as { ok: boolean; data: string[] };
    if (!body.ok) throw new Error("Distincts API returned ok=false");
    const values: string[] = body.data;
    memCache.set(cacheKey, values);
    return values;
  })();
  inflight.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inflight.delete(cacheKey);
  }
}

export function useDistincts(
  brand: string,
  col: string,
  filters?: Record<string, string[] | undefined>
): {
  options: string[] | null;
  loading: boolean;
  error: string | null;
} {
  // ym is non-cascading — collapse its key to the empty filter set so
  // every page hits a single shared cache entry.
  const effectiveFilters = col === "ym" ? {} : filters ?? {};
  const hash = filterHash(effectiveFilters);
  const cacheKey = useMemo(() => `${brand}|${col}|${hash}`, [brand, col, hash]);

  const initial = memCache.get(cacheKey) ?? null;
  const [options, setOptions] = useState<string[] | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(initial == null);

  useEffect(() => {
    let cancelled = false;

    if (memCache.has(cacheKey)) {
      setOptions(memCache.get(cacheKey)!);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    fetchDistinct(brand, col, effectiveFilters, cacheKey)
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { options, loading, error };
}

/** Imperative prefetch — warms the empty-filter combo for each
 *  column at app startup so the first dropdown opens instantly. */
export function prefetchDistincts(brand: string, cols: string[]) {
  for (const col of cols) {
    const cacheKey = `${brand}|${col}|∅`;
    if (!memCache.has(cacheKey)) {
      void fetchDistinct(brand, col, {}, cacheKey).catch(() => {
        /* swallow — UI will retry on demand */
      });
    }
  }
}
