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
 * ## What is counted
 *
 * Every tile reads `/api/request/accounting/requests/mine`, **drafts included
 * since 2026-09-24**. They were excluded until then, because that query pinned
 * `Status <> 'Draft'` and the page could not show one — so คำขอทั้งหมด counted
 * only what had been filed (the user's decision that day, "เฉพาะที่ส่งแล้ว")
 * and ร่าง / ตีกลับ was counted separately, from the two drafts endpoints, and
 * had no link at all because there was nowhere honest to send it.
 *
 * The user reversed that the same day: the list now carries drafts, so one pass
 * over one list answers every tile, the ร่าง / ตีกลับ tile opens a page showing
 * exactly what it counted, and **`total` includes drafts** — which is what My
 * Requests' own ทั้งหมด box shows, so the two can no longer disagree.
 *
 * Those two drafts endpoints are still fetched, and only for the "ทำต่อจาก
 * ที่ค้างไว้" list: resuming is AP-1 and AP-17 only, so that list is genuinely
 * narrower than this count and is a list rather than a number.
 *
 * **`Returned` is in two tiles**, deliberately: it is a filed request with a
 * status of its own *and* something its owner can still edit, so it belongs to
 * `total` and to ร่าง / ตีกลับ at once. The strip is a set of answers to
 * different questions, not a partition.
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
  /** Every request this person has filed, drafts included — see the header. */
  total: number;
  /** Of those, submitted within the current calendar month. */
  month: number;
  /** Still somewhere in the approval chain: `Submitted` or `ManagerApproved`. */
  pending: number;
  /** Finished and payable. `Completed` is AP-17's spelling of the same state. */
  approved: number;
  rejected: number;
  cancelled: number;
  /**
   * Filed but sent back, or never filed at all — the ร่าง / ตีกลับ tile.
   *
   * **It is counted from the same rows as everything else**, which it was
   * not until 2026-09-24: it came from the two drafts endpoints, which
   * serve AP-1 and AP-17 alone, so an AP-3 draft was in nobody's count.
   * `listMyRequestRows` stopped excluding drafts the same day, so one pass
   * over one list now answers every tile — and the tile can link to a page
   * that shows what it counted, which was the whole reason it had no link.
   */
  unfinished: number;
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
    unfinished: 0,
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

    /* Not an `else if`: `Returned` is a status of its own on the page AND
       something its owner can still edit, so it belongs to this tile and to
       none of the four above. `Draft` reaches neither, which is why both are
       tested separately here rather than folded into the chain. */
    if (status === "Draft" || status === "Returned") counts.unfinished++;
  }

  return counts;
}
