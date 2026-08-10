"use client";

import useSWR from "swr";

/** API envelope returned by all /api/intelligence/dashboards/master/* routes. */
interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: string;
}

const fetcher = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Request failed ${res.status} for ${url}${body ? `: ${body}` : ""}`
    );
  }
  const envelope = (await res.json()) as Envelope<T>;
  if (!envelope.ok) {
    throw new Error(envelope.error ?? "API returned ok=false");
  }
  return envelope.data;
};

/**
 * SWR wrapper for Master Dashboard API routes.
 *
 * Automatically unwraps the `{ ok, data }` envelope that all
 * `/api/intelligence/dashboards/master/*` routes return.
 *
 * @param path  - absolute API path, e.g. `/api/intelligence/dashboards/master/kpi`
 * @param queryString - from `useMasterFilters().queryString`, already starts with `?`
 *                      or is an empty string when no filters are active
 */
export function useMasterData<T>(path: string, queryString: string) {
  const url = `${path}${queryString}`;
  const { data, error, isLoading } = useSWR<T>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
  return { data, error: error as Error | undefined, isLoading };
}
