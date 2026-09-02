import { STEP_LABEL } from "@/lib/adv/approval-steps";
import type { AdvanceReportRow } from "@/lib/adv/advance-report-service";

/**
 * Presentation-layer derivations for the AP-2 Control report screen
 * (docs/superpowers/specs/2026-09-02-ap2-report-redesign-design.md).
 *
 * Pure functions only, kept out of `page.tsx` so they can be unit tested
 * without pulling in React/next/navigation — and out of
 * `advance-report-service.ts`, which this redesign never touches: every
 * value here is derived from fields that service already returns.
 */

export type Row = AdvanceReportRow;

/** Labels the report service produces — matched, never re-derived, so the
 *  two stay in step. */
export const STATUS_INPROCESS = "Inprocess (อยู่ระหว่างอนุมัติ)";
export const STATUS_APPROVED = "อนุมัติแล้ว (Completed)";
export const CLEAR_STATUS_CLEARED = "เคลียร์แล้ว (Cleared)";
export const CLEAR_STATUS_RETURNED = "ส่งกลับแก้ไข";

/** Waiting on Accounting Officer is waiting to be interfaced to ERP — it is
 *  the only step between manager-approval and the ERP send (approving there
 *  is what sends it; see AdvanceDetailPanel's `atAccOfficer` gate). */
const ERP_SEND_STEP_LABEL = STEP_LABEL.ACC_OFFICER;

/** Local YYYY-MM-DD — comparing ISO date strings avoids a timezone round-trip. */
export const todayYmd = (): string => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/**
 * An advance the company is still owed a clearing for, past its due date.
 *
 * All three must hold:
 *  - the advance was **approved** — money actually went out, so a clearing is
 *    genuinely owed; a rejected or cancelled request owes nothing and must not
 *    be chased.
 *  - there is no **approved** AP-3 against it. `advanceStatus` is null when no
 *    clearing exists at all and "กำลังเคลียร์" while one is in flight — neither
 *    settles the advance.
 *  - the promised clear date has already passed.
 *
 * Relocated from page.tsx (behaviour unchanged) so it is unit-testable
 * alongside the tile counts that are built on it.
 */
export function isOverdueClearing(r: Row, today: string): boolean {
  if (r.overallStatus !== STATUS_APPROVED) return false;
  if (r.advanceStatus === CLEAR_STATUS_CLEARED) return false;
  return !!r.expectedClearDate && r.expectedClearDate < today;
}

/** The report's 11 default-visible columns (design doc §"Default columns"). */
export const DEFAULT_VISIBLE_KEYS: readonly string[] = [
  "submittedAt",
  "requestNo",
  "requesterName",
  "payeeName",
  "baseAmount",
  "expectedClearDate",
  "paymentDate",
  "clearAdvanceNo",
  "advanceStatus",
  "pendingOn",
  "overallStatus",
];

/** `payeeType` ("โอนให้") never appears as a table column any more — it left
 *  the table for a dedicated filter (design doc). Excluded from the column
 *  picker entirely, not merely hidden by default. It still stays in the
 *  Excel export (COLS is unchanged there). */
export const TABLE_EXCLUDED_KEYS: readonly string[] = ["payeeType"];

/**
 * `advanceStatus` is null when no AP-3 is linked, which used to render as a
 * blank cell — indistinguishable from missing data. Always returns one of
 * four explicit states (design doc §"Clearing status always says something").
 * This is a display decision only: the service already returns everything
 * needed to tell the four apart.
 */
export type ClearingStatus = "ยังไม่เคลียร์" | "กำลังเคลียร์" | "เคลียร์แล้ว" | "ส่งกลับแก้ไข";

export function clearingStatusLabel(advanceStatus: string | null): ClearingStatus {
  if (advanceStatus == null) return "ยังไม่เคลียร์";
  if (advanceStatus === CLEAR_STATUS_CLEARED) return "เคลียร์แล้ว";
  if (advanceStatus === CLEAR_STATUS_RETURNED) return "ส่งกลับแก้ไข";
  return "กำลังเคลียร์"; // the linked AP-3 is Submitted / ManagerApproved
}

/** Chip colour bucket for the clearing-status column — the palette used is
 *  the three-tone `--status-{ok,pending,bad}-*` set already in globals.css. */
export type StatusTone = "ok" | "pending" | "bad";

export function clearingStatusTone(status: ClearingStatus): StatusTone {
  switch (status) {
    case "เคลียร์แล้ว": return "ok";
    // A returned AP-3 needs someone to act on it — the same "needs attention"
    // register as an overdue clearing, hence `bad` rather than `pending`.
    case "ส่งกลับแก้ไข": return "bad";
    default: return "pending"; // ยังไม่เคลียร์ · กำลังเคลียร์
  }
}

/** Chip colour bucket for the overall-status column, folded to the same
 *  three-tone palette as the clearing-status chip so the two columns read
 *  consistently. */
export function overallStatusTone(overallStatus: string): StatusTone {
  if (overallStatus === STATUS_APPROVED) return "ok";
  if (overallStatus === STATUS_INPROCESS) return "pending";
  return "bad"; // Rejected / Cancelled / Returned
}

/** Still in the approval chain (Submitted, but not the final ERP-send step). */
export function isAwaitingApproval(r: Row): boolean {
  return r.overallStatus === STATUS_INPROCESS && r.pendingOn !== ERP_SEND_STEP_LABEL;
}

/** Approved through the manager chain; only the Accounting Officer's
 *  interfacing action is left. */
export function isAwaitingErp(r: Row): boolean {
  return r.overallStatus === STATUS_INPROCESS && r.pendingOn === ERP_SEND_STEP_LABEL;
}

export interface TileCounts {
  readonly awaitingApproval: number;
  readonly awaitingErp: number;
  readonly overdue: number;
}

/** The three count tiles — standing counts over the whole dataset, so each
 *  badge reads as a KPI rather than a reflection of whatever else is
 *  filtered right now (design doc §"Summary tiles that filter"). */
export function computeTileCounts(rows: readonly Row[], today: string): TileCounts {
  let awaitingApproval = 0;
  let awaitingErp = 0;
  for (const r of rows) {
    if (isAwaitingErp(r)) awaitingErp++;
    else if (isAwaitingApproval(r)) awaitingApproval++;
  }
  const overdue = rows.filter((r) => isOverdueClearing(r, today)).length;
  return { awaitingApproval, awaitingErp, overdue };
}

/** Sum of the THB-converted amount over whatever rows are passed. The fourth
 *  tile reads "of the rows currently filtered", so callers pass the filtered
 *  set, not the whole dataset. */
export function totalAmountThb(rows: readonly Row[]): number {
  return rows.reduce((sum, r) => sum + (r.baseAmount ?? 0), 0);
}
