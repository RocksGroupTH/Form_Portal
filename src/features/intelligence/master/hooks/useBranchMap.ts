"use client";

import { useEffect, useMemo, useState } from "react";

/** (branch_id ↔ branch_name) lookup, fetched once + cached at module
 *  level per brand so multiple components calling this hook don't refetch. */
type Pair = { id: string; name: string };

const cache = new Map<string, Pair[]>();
const inflightMap = new Map<string, Promise<Pair[]>>();

async function fetchPairs(brand: string): Promise<Pair[]> {
  if (cache.has(brand)) return cache.get(brand)!;
  if (inflightMap.has(brand)) return inflightMap.get(brand)!;
  const p = (async () => {
    try {
      const res = await fetch(`/api/intelligence/dashboards/master/branch-map?brand=${encodeURIComponent(brand)}`);
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { ok: boolean; data: Pair[] };
      if (!body.ok) throw new Error("Branch-map API returned ok=false");
      const pairs = body.data;
      cache.set(brand, pairs);
      return pairs;
    } finally {
      inflightMap.delete(brand);
    }
  })();
  inflightMap.set(brand, p);
  return p;
}

/** Returns Maps that let the FilterPanel mirror branch_id ↔ branch_name
 *  whenever the user picks one side. */
export function useBranchMap(brand: string): {
  idToNames: Map<string, string[]>;
  nameToIds: Map<string, string[]>;
  loading: boolean;
} {
  const [pairs, setPairs] = useState<Pair[] | null>(cache.get(brand) ?? null);

  useEffect(() => {
    const cached = cache.get(brand);
    if (cached) {
      setPairs(cached);
      return;
    }
    let cancelled = false;
    fetchPairs(brand)
      .then((data) => {
        if (!cancelled) setPairs(data);
      })
      .catch(() => {
        // Non-fatal — falls back to plain (unlinked) filter behaviour.
        if (!cancelled) setPairs([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand]);

  const { idToNames, nameToIds } = useMemo(() => {
    const idToNames = new Map<string, string[]>();
    const nameToIds = new Map<string, string[]>();
    for (const p of pairs ?? []) {
      const ns = idToNames.get(p.id) ?? [];
      if (!ns.includes(p.name)) ns.push(p.name);
      idToNames.set(p.id, ns);
      const ids = nameToIds.get(p.name) ?? [];
      if (!ids.includes(p.id)) ids.push(p.id);
      nameToIds.set(p.name, ids);
    }
    return { idToNames, nameToIds };
  }, [pairs]);

  return { idToNames, nameToIds, loading: pairs == null };
}
