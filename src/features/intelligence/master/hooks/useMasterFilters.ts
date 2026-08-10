"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { FilterKey, Filters, FILTER_KEYS } from "@/features/intelligence/master/types";

export function useMasterFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: Filters = useMemo(() => {
    const out: Filters = {};
    for (const key of FILTER_KEYS) {
      const vals = searchParams.getAll(key).filter((v) => v.length > 0);
      if (vals.length > 0) out[key] = vals;
    }
    return out;
  }, [searchParams]);

  // Read the *live* query string at call time rather than the captured
  // `searchParams`. App Router's router.replace updates window.location
  // synchronously (via history.replaceState) before the async RSC fetch,
  // so reading window.location.search here lets back-to-back setters from
  // separate effects merge correctly instead of racing on a stale snapshot
  // (e.g. the cold-load data-quality defaults + the ym auto-pick).
  const currentParams = useCallback(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search);
    }
    return new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  const setFilter = useCallback(
    (key: FilterKey, values: string[]) => {
      const sp = currentParams();
      sp.delete(key);
      for (const v of values) if (v.length > 0) sp.append(key, v);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, currentParams]
  );

  /** Atomic multi-key update — writes several filter keys in a single
   *  router.replace(). Use this when one user action needs to update
   *  more than one filter (e.g. selecting a branch_id should also
   *  mirror the matching branch_name). */
  const setFilters = useCallback(
    (updates: Partial<Record<FilterKey, string[]>>) => {
      const sp = currentParams();
      for (const [key, values] of Object.entries(updates)) {
        sp.delete(key);
        for (const v of values ?? []) if (v.length > 0) sp.append(key, v);
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, currentParams]
  );

  const clearAll = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    for (const [k, vals] of Object.entries(filters)) {
      if (!vals) continue;
      for (const v of vals) sp.append(k, v);
    }
    const s = sp.toString();
    return s.length > 0 ? `?${s}` : "";
  }, [filters]);

  return { filters, setFilter, setFilters, clearAll, queryString };
}
