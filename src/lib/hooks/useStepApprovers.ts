"use client";

import useSWR from "swr";
import type { StepApproverPayload } from "@/lib/acc/step-approvers";

/**
 * Who may approve a pool step, for the `รออนุมัติโดย` tooltip.
 *
 * One SWR key across both lists, so a table of fifty rows costs one request
 * rather than fifty — the rosters are per form, not per request, which is the
 * whole reason this is a separate fetch and not a column on the row.
 *
 * **Undefined on failure, never an empty payload.** `approverNamesFor` reads
 * `undefined` as "nothing is known about this step" and answers `null`, which
 * leaves the tooltip exactly as it was before this feature. An empty object
 * would instead render "ยังไม่มีผู้มีสิทธิ์อนุมัติ" on every row — a confident
 * statement that nobody can act, produced by a failed fetch.
 */
const fetcher = async (url: string): Promise<StepApproverPayload | undefined> => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) return undefined;
  return json.data as StepApproverPayload;
};

export function useStepApprovers(): StepApproverPayload | undefined {
  const { data } = useSWR<StepApproverPayload | undefined>(
    "/api/request/accounting/step-approvers",
    fetcher,
    // A roster changes a few times a year and is read by a tooltip. Revalidate
    // on focus so an admin's other tab catches up; never on an interval.
    { revalidateOnFocus: true, revalidateIfStale: true },
  );
  return data;
}
