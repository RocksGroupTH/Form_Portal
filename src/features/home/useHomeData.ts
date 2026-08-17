"use client";

import useSWR from "swr";
import {
  getMyWorkStatusBucket,
  type MyWorkRowInput,
  type MyWorkViewerContext,
} from "@/lib/acc/approval-display";

/**
 * Throwing fetcher — the app's API routes answer a failure with HTTP 500 *and* a
 * valid JSON body (`{ ok: false, error }`), so a plain `r.json()` fetcher resolves
 * happily and SWR's `error` stays undefined. Home then renders a confident `0`.
 * Mirrors `readApiJson` in MyRequestsPanel.tsx so a failure reaches `error`.
 */
async function fetcher(url: string) {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && json.error) || `HTTP ${res.status}`);
  }
  return json;
}

export type FormEnvironment = "Production" | "UAT";

export interface ResumableGroup {
  /** Stable key for React lists. */
  key: string;
  formCode: "AP-1" | "AP-17";
  label: string;
  href: string;
  /** Rows the user can still edit — `Draft` **and** `Returned` (see below). */
  count: number;
  /**
   * How many of `count` are `Returned` (sent back for revision) rather than
   * never-submitted drafts, or `null` when the endpoint cannot tell them apart.
   * Both drafts endpoints select `Status IN ('Draft','Returned')`, but only the
   * AP-1 mapper carries `Status` through; the AP-17 mapper groups by `GroupKey`
   * and drops it. `null` therefore means "unknown", not "zero".
   */
  returnedCount: number | null;
  /** ISO string of the most recently touched row in this group. */
  updatedAt: string | null;
}

interface Row {
  status?: string;
  submittedAt?: string | null;
}

/** AP-1 draft row — `listMyTravelDrafts` in src/lib/acc/request-service.ts. */
interface Ap1Draft {
  id: number;
  status?: string;
  updatedAt: string;
}

/** AP-17 draft group — `listMyTravelDrafts` in src/lib/acc/travel-booking/request-service.ts. */
interface Ap17Draft {
  groupKey: string;
  updatedAt: string;
}

function latest(items: Array<{ updatedAt: string }>): string | null {
  let best: string | null = null;
  for (const it of items) {
    if (it.updatedAt && (best === null || it.updatedAt > best)) best = it.updatedAt;
  }
  return best;
}

function isThisMonth(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/**
 * Home reads Accounting only. Form Builder used to contribute a form catalogue
 * and its own approval queue here; both were dropped when the feature's entry
 * points were removed, so nothing on this page fetches /api/forms any more.
 */
export function useHomeData() {
  const mine = useSWR<{ ok: boolean; data?: Row[] }>("/api/request/accounting/requests/mine", fetcher);
  const work = useSWR<{ ok: boolean; data?: MyWorkRowInput[] }>("/api/request/accounting/work", fetcher);
  // Which database each form writes to, for the badges on the form cards. Kept
  // out of `summaryError` and `isLoading` on purpose: a missing badge is not
  // worth blanking the page's numbers or holding its first paint.
  const environments = useSWR<{ ok: boolean; data?: Record<string, FormEnvironment> }>(
    "/api/form-environment",
    fetcher,
  );
  const ap1 = useSWR<{ ok: boolean; data?: Ap1Draft[] }>("/api/request/accounting/requests/drafts", fetcher);
  const ap17 = useSWR<{ ok: boolean; data?: Ap17Draft[] }>("/api/request/travel-booking/requests/drafts", fetcher);
  // Same viewer context /my-work uses to classify rows — see MyRequestsPanel.tsx:225-234.
  const employee = useSWR<{ ok: boolean; data?: { email?: string | null; employee?: { staffId?: number | null } | null } }>(
    "/api/me/employee",
    fetcher,
  );
  const access = useSWR<{ ok: boolean; data?: { approver?: boolean } }>(
    "/api/request/accounting/access",
    fetcher,
  );

  const ap1Rows = ap1.data?.data ?? [];
  const ap17Rows = ap17.data?.data ?? [];

  const resumable: ResumableGroup[] = [];
  if (ap1Rows.length > 0) {
    resumable.push({
      key: "ap1",
      formCode: "AP-1",
      label: "เบิกค่าเดินทาง",
      href: "/request/travel-expense",
      count: ap1Rows.length,
      // Same distinction AP-1's own resume dialog makes (TravelDraftPickerDialog.tsx:146).
      returnedCount: ap1Rows.filter((r) => r.status === "Returned").length,
      updatedAt: latest(ap1Rows),
    });
  }
  if (ap17Rows.length > 0) {
    resumable.push({
      key: "ap17",
      formCode: "AP-17",
      label: "จองที่พัก/ตั๋วโดยสาร",
      href: "/request/travel-booking",
      count: ap17Rows.length,
      returnedCount: null,
      updatedAt: latest(ap17Rows),
    });
  }

  // Same "pending" rule /my-work uses (src/features/accounting/components/MyRequestsPanel.tsx:253-257),
  // not raw row count — a viewer can have a role in a request without it still being pending on them.
  const viewer: MyWorkViewerContext = {
    staffId: employee.data?.data?.employee?.staffId ?? null,
    email: employee.data?.data?.email ?? null,
    isAccountApprover: Boolean(access.data?.data?.approver),
  };
  const workRows = work.data?.data ?? [];
  const accPendingCount = workRows.filter((r) => getMyWorkStatusBucket(r, viewer) === "pending").length;

  // Every fetch the greeting line and the stat strip read. `employee` / `access`
  // are in here too: without them the pending rule misclassifies rows, so a
  // number built on a failed context would be just as wrong as a missing one.
  const summaryError =
    mine.error || work.error || ap1.error || ap17.error || employee.error || access.error;

  return {
    pendingCount: accPendingCount,
    monthCount: (mine.data?.data ?? []).filter((r) => isThisMonth(r.submittedAt)).length,
    /** Editable rows — drafts **and** returned-for-revision. See `ResumableGroup.returnedCount`. */
    resumableCount: ap1Rows.length + ap17Rows.length,
    resumable,
    /** Form code → environment. A form missing from the map is Production. */
    formEnvironments: environments.data?.data ?? {},
    summaryError: Boolean(summaryError),
    isLoading:
      mine.isLoading ||
      work.isLoading ||
      ap1.isLoading ||
      ap17.isLoading ||
      employee.isLoading ||
      access.isLoading,
  };
}
