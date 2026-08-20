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

/** AP-11 draft row — `listMyRewardDrafts` in src/lib/acc/reward/request-service.ts. */
interface Ap11Draft {
  id: number;
  status?: string;
  updatedAt: string | null;
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
 * points were removed, and the feature itself has since been deleted.
 */
export function useHomeData() {
  const mine = useSWR<{ ok: boolean; data?: Row[] }>("/api/request/accounting/requests/mine", fetcher);
  const work = useSWR<{ ok: boolean; data?: MyWorkRowInput[] }>("/api/request/accounting/work", fetcher);
  const ap1 = useSWR<{ ok: boolean; data?: Ap1Draft[] }>("/api/request/accounting/requests/drafts", fetcher);
  const ap17 = useSWR<{ ok: boolean; data?: Ap17Draft[] }>("/api/request/travel-booking/requests/drafts", fetcher);
  const ap11 = useSWR<{ ok: boolean; data?: Ap11Draft[] }>("/api/request/reward/requests/drafts", fetcher);
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
  const ap11Rows = ap11.data?.data ?? [];

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
    mine.error || work.error || ap1.error || ap17.error || ap11.error || employee.error || access.error;

  return {
    pendingCount: accPendingCount,
    monthCount: (mine.data?.data ?? []).filter((r) => isThisMonth(r.submittedAt)).length,
    /**
     * Editable rows — drafts **and** returned-for-revision, across all three
     * forms. AP-11 was missing from this sum while the "ทำต่อจากที่ค้างไว้"
     * strip listed it separately; with that strip gone this stat is the only
     * thing on Home that counts them, so it has to count all of them.
     */
    resumableCount: ap1Rows.length + ap17Rows.length + ap11Rows.length,
    summaryError: Boolean(summaryError),
    isLoading:
      mine.isLoading ||
      work.isLoading ||
      ap1.isLoading ||
      ap17.isLoading ||
      ap11.isLoading ||
      employee.isLoading ||
      access.isLoading,
  };
}
