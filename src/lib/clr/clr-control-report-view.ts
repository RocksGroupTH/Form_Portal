import type { ClrControlRow } from "./clear-advance-report-service";

/**
 * Presentation-layer derivations for the AP-3-Control report screen
 * (docs/superpowers/specs/2026-09-02-ap3-control-report-redesign-design.md).
 *
 * Pure functions only, kept out of `ClrControlReport.tsx` so they can be unit
 * tested without pulling in React — and out of `clear-advance-report-service.ts`,
 * which this redesign never touches: every value here is derived from fields
 * that service already returns.
 */

/**
 * The report's 10 default-visible columns (design doc §"Default columns").
 * "adjustment" is a derived column, not a raw `ClrControlRow` field — see
 * `controlAdjustment` below.
 */
export const DEFAULT_VISIBLE_KEYS: readonly string[] = [
  "submittedAt",
  "requestNo",
  "advanceRequestNo",
  "requesterFullName",
  "advanceAmount",
  "actualTotal",
  "adjustment",
  "pvDocNo",
  "pendingOn",
  "overallStatus",
];

export type AdjustmentDirection = "refund" | "extra" | "none";

export interface Adjustment {
  readonly direction: AdjustmentDirection;
  readonly amount: number;
}

/**
 * คืน/เบิกเพิ่ม — `refundToCompany` and `extraToEmployee` are the two signs of
 * the same number and, on the current data, never both non-zero at once (see
 * `clear-advance-report-service.ts`), so a single signed column reads better
 * on screen than two mostly-empty ones. Screen only — the export keeps both
 * fields as separate columns, untouched.
 */
export function controlAdjustment(
  row: Pick<ClrControlRow, "refundToCompany" | "extraToEmployee">,
): Adjustment {
  const refund = row.refundToCompany ?? 0;
  const extra = row.extraToEmployee ?? 0;
  if (refund > 0) return { direction: "refund", amount: refund };
  if (extra > 0) return { direction: "extra", amount: extra };
  return { direction: "none", amount: 0 };
}
