"use client";

import useSWR from "swr";
import {
  getMyWorkStatusBucket,
  type MyWorkRowInput,
  type MyWorkViewerContext,
} from "@/lib/acc/approval-display";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface CatalogueForm {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
}

export interface DraftGroup {
  /** Stable key for React lists. */
  key: string;
  formCode: "AP-1" | "AP-17";
  label: string;
  href: string;
  count: number;
  /** ISO string of the most recently touched draft in this group. */
  updatedAt: string | null;
}

interface Row {
  status?: string;
  submittedAt?: string | null;
}

interface Ap1Draft {
  id: number;
  updatedAt: string;
}

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

export function useHomeData() {
  const forms = useSWR<{ ok: boolean; data?: CatalogueForm[] }>("/api/forms", fetcher);
  const mine = useSWR<{ ok: boolean; data?: Row[] }>("/api/request/accounting/requests/mine", fetcher);
  const work = useSWR<{ ok: boolean; data?: MyWorkRowInput[] }>("/api/request/accounting/work", fetcher);
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

  const drafts: DraftGroup[] = [];
  if (ap1Rows.length > 0) {
    drafts.push({
      key: "ap1",
      formCode: "AP-1",
      label: "เบิกค่าเดินทาง",
      href: "/request/travel-expense",
      count: ap1Rows.length,
      updatedAt: latest(ap1Rows),
    });
  }
  if (ap17Rows.length > 0) {
    drafts.push({
      key: "ap17",
      formCode: "AP-17",
      label: "จองที่พัก/ตั๋วโดยสาร",
      href: "/request/travel-booking",
      count: ap17Rows.length,
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
  const pendingCount = workRows.filter((r) => getMyWorkStatusBucket(r, viewer) === "pending").length;

  return {
    pendingCount,
    monthCount: (mine.data?.data ?? []).filter((r) => isThisMonth(r.submittedAt)).length,
    draftCount: ap1Rows.length + ap17Rows.length,
    drafts,
    forms: (forms.data?.data ?? []),
    isLoading:
      forms.isLoading ||
      mine.isLoading ||
      work.isLoading ||
      ap1.isLoading ||
      ap17.isLoading ||
      employee.isLoading ||
      access.isLoading,
  };
}
