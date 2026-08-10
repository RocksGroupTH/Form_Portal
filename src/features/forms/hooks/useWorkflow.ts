"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Workflow config for a form (Phase 2 — placeholder hook) */
export function useWorkflow(formId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: unknown }>(
    formId ? `/api/forms/${formId}/workflow` : null,
    fetcher,
  );
  return { workflow: data?.data ?? null, error, isLoading, mutate };
}
