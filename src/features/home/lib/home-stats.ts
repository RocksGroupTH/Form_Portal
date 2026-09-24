/**
 * Home's stat strip — what each tile counts, as one pure function.
 *
 * It lives apart from `useHomeData` so the counting rule can be unit-tested:
 * that hook is `"use client"` and reaches SWR, and the numbers on the front
 * page are the kind that are wrong in silence, because nothing on screen says
 * what a tile was measuring.
 *
 * ## One vocabulary, shared with My Requests
 *
 * Every status tile counts with the **same predicate the My Requests filter
 * uses** — `isPendingApprovalStatus` and the plain equalities beside it in
 * `MINE_STATUS_FILTER_GROUPS`. That is not tidiness: the tiles link to that
 * page with the matching filter pre-applied, so a tile saying 3 that opens a
 * list of 5 would be a front page contradicting the page it sent you to. If a
 * status is ever reclassified, both move together or the link starts lying.
 *
 * ## What is counted, and what cannot be
 *
 * The rows come from `/api/request/accounting/requests/mine`, whose SQL pins
 * `r.Status <> 'Draft'` — so **a never-submitted draft is in none of these
 * counts**, `total` included. That is the user's decision (2026-09-24, "เฉพาะ
 * ที่ส่งแล้ว") and it is also the only self-consistent one available here:
 * drafts are fetched from two other endpoints, are grouped rather than listed
 * on AP-17, and cannot be shown on My Requests at all. They have their own
 * tile, ร่าง / ตีกลับ, counted by the hook from those endpoints.
 *
 * **`Returned` is in both**, and deliberately: it is a filed request with a
 * status of its own on My Requests, *and* something its owner can still edit,
 * so it belongs to `total` and to ร่าง / ตีกลับ at once. The strip is a set of
 * answers to different questions, not a partition.
 *
 * ## Time
 *
 * Only `month` is time-scoped; every other tile counts all of them (the user,
 * same date). "คำขอเดือนนี้" is the one tile whose whole subject is the period,
 * and it measures `submittedAt` — the same field `inDateRange` filters on over
 * there, so its link lands on exactly the rows it counted.
 */
import { isCompletedStatus, isPendingApprovalStatus } from "@/features/accounting/constants";

/** The only two fields any of this reads. Structural, so `ReportRow` satisfies it. */
export interface HomeStatRow {
  status?: string;
  submittedAt?: string | null;
}

export interface HomeStatCounts {
  /** Every request this person has filed, drafts excluded — see the header. */
  total: number;
  /** Of those, submitted within the current calendar month. */
  month: number;
  /** Still somewhere in the approval chain: `Submitted` or `ManagerApproved`. */
  pending: number;
  /** Finished and payable. `Completed` is AP-17's spelling of the same state. */
  approved: number;
  rejected: number;
  cancelled: number;
}

/**
 * Local calendar getters throughout, never `toISOString()`.
 *
 * Every timestamp in these databases is a **Thai wall clock** and the driver
 * runs with `useUTC: false`, so a row written at 23:30 on the 31st is the 31st.
 * Converting to UTC first would move it into the next month for seven hours of
 * every day — and only for rows filed in the evening, which is precisely the
 * kind of wrongness nobody reports. See CLAUDE.md's "Dates".
 */
function sameMonth(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * First and last day of `now`'s month, `YYYY-MM-DD`, for the เดือนนี้ tile's
 * link.
 *
 * `new Date(y, m + 1, 0)` is the last day of month `m` — December rolls to
 * January of the next year on its own, which is why the month is not clamped
 * by hand.
 */
export function monthRange(now: Date): { from: string; to: string } {
  return {
    from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

/**
 * `now` is passed rather than read so one render measures every tile against
 * one clock, and so the month boundary is testable at all.
 */
export function countHomeStats(rows: readonly HomeStatRow[], now: Date): HomeStatCounts {
  const counts: HomeStatCounts = {
    total: rows.length,
    month: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    const status = row.status ?? "";
    if (sameMonth(row.submittedAt, now)) counts.month++;
    if (isPendingApprovalStatus(status)) counts.pending++;
    // Both spellings, because AP-17 writes `Completed` — and the อนุมัติแล้ว
    // filter this tile links to was widened in the same change, so the two
    // still answer the same question. See `isCompletedStatus`.
    else if (isCompletedStatus(status)) counts.approved++;
    else if (status === "Rejected") counts.rejected++;
    else if (status === "Cancelled") counts.cancelled++;
  }

  return counts;
}
