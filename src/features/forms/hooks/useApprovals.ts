"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Current user's pending approvals (Phase 2 — placeholder hook) */
export function useMyApprovals() {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: unknown[] }>(
    "/api/forms/approvals",
    fetcher,
  );
  return { approvals: data?.data ?? [], error, isLoading, mutate };
}
