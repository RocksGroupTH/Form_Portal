"use client";

import useSWR from "swr";
import type { FormAccess, FormEnvironment, FormEnvironmentPayload, ViewerUatStatus } from "@/lib/form-environment/payload-types";

// Re-exported so existing call sites (`@/lib/hooks/useFormEnvironments`) keep
// working unchanged. The shape itself lives in payload-types.ts — a
// types-only module with no server-only imports — so the route handler and
// this client hook read one declaration instead of two hand-kept copies.
export type { FormAccess, FormEnvironment, FormEnvironmentPayload, ViewerUatStatus };

const fetcher = async (url: string): Promise<FormEnvironmentPayload> => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && json.error) || `HTTP ${res.status}`);
  }
  return json.data as FormEnvironmentPayload;
};

/**
 * The one payload every environment chip and catalogue filter reads: which
 * database each form resolves to for the signed-in viewer, and the viewer's
 * own UAT-tester standing.
 *
 * `error` is surfaced rather than swallowed. Under per-viewer routing, hiding
 * a fetch failure behind an empty object would let a tester's chip claim
 * Production while the request underneath actually lands in UAT. Split the
 * two kinds of caller instead: one gating *availability* (a catalogue, a
 * filter) should treat a missing or unknown form as available — a fetch
 * failure must never hide a form that would otherwise show — while one
 * reporting *environment* (a chip) should render nothing rather than guess
 * "Production".
 *
 * One SWR key, so every chip and filter on a page shares a single request.
 * `revalidateOnFocus: false` because this now fires on every dashboard page,
 * not just one — refetching on every tab focus would make it the busiest
 * request in the app for no reason a viewer would notice.
 */
export function useFormEnvironments() {
  const { data, error, isLoading } = useSWR<FormEnvironmentPayload>(
    "/api/form-environment",
    fetcher,
    { revalidateOnFocus: false },
  );
  return { data, error, isLoading };
}

/** Just the viewer's own UAT status — the navbar switch renders from this. */
export function useViewerUat(): ViewerUatStatus | undefined {
  return useFormEnvironments().data?.viewer;
}
