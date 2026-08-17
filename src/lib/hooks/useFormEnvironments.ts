"use client";

import useSWR from "swr";

export type FormEnvironment = "Production" | "UAT";

/** One form's resolution for the current viewer. Mirrors `EnvironmentDecision` server side. */
export interface FormAccess {
  /** Which database this form writes to for the current viewer. */
  environment: FormEnvironment;
  /** Whether the viewer may use the form at all right now. */
  available: boolean;
}

/** The viewer's own UAT-tester standing. Mirrors `ViewerUatStatus` server side. */
export interface ViewerUatStatus {
  /** Has an active row in UatTester, whether or not UAT mode is on right now. */
  isTester: boolean;
  /** Cookie on AND an active tester — the effective mode every write choke point honours. */
  uatMode: boolean;
  /** Whether any form has its UAT switch on, for anybody — not just this viewer. */
  anyUatForm: boolean;
  /** The viewer's own tester row names a manager. */
  hasUatManager: boolean;
}

export interface FormEnvironmentPayload {
  viewer: ViewerUatStatus;
  forms: Record<string, FormAccess>;
}

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
