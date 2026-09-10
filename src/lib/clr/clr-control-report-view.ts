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

/* ─────────────── stacked filters (brand × status) ─────────────── */

/**
 * Split a CSV filter value into its distinct picks. Same state shape AP-2's
 * report page uses for its stacked filters (`filters[key]` as a CSV string),
 * so the two reports behave identically rather than merely look alike
 * (design doc §"Stacked filters").
 */
export function csvValues(raw: string | null | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One (brand, status) pair to query `listControlRows` with. `null` means "any value on this axis". */
export interface StackedCombo {
  readonly brand: string | null;
  readonly status: string | null;
}

/**
 * Cross product of the brand and status picks. `listControlRows` (untouched
 * by this redesign) only understands one brand and one status at a time, so
 * "OR within a column, AND across columns" is built by querying every
 * (brand, status) pair and merging the results with `mergeControlRows`: a
 * row appears iff *some* pair matches it — i.e. iff its brand is one of the
 * brand picks AND its status is one of the status picks.
 *
 * An empty axis means "any value on that axis" and contributes a single
 * `null` slot, not zero combos — zero combos on an unfiltered axis would
 * silently drop every row instead of leaving that axis unfiltered.
 */
export function stackedAxisCombos(
  brandCsv: string | null | undefined,
  statusCsv: string | null | undefined,
): readonly StackedCombo[] {
  const brands = csvValues(brandCsv);
  const statuses = csvValues(statusCsv);
  const brandAxis: readonly (string | null)[] = brands.length ? brands : [null];
  const statusAxis: readonly (string | null)[] = statuses.length ? statuses : [null];

  const combos: StackedCombo[] = [];
  for (const brand of brandAxis) {
    for (const status of statusAxis) {
      combos.push({ brand, status });
    }
  }
  return combos;
}

/**
 * Merge the per-combo `listControlRows` results into one deduped list,
 * restoring `listControlRows`' own ordering (`SubmittedAt DESC, Id DESC`) — a
 * row that matched more than one combo (e.g. both statuses were picked) must
 * appear once, not once per combo.
 */
export function mergeControlRows(resultSets: readonly (readonly ClrControlRow[])[]): ClrControlRow[] {
  const merged = new Map<number, ClrControlRow>();
  for (const rows of resultSets) {
    for (const row of rows) merged.set(row.id, row);
  }
  return Array.from(merged.values()).sort((a, b) => {
    const bySubmitted = (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "");
    return bySubmitted !== 0 ? bySubmitted : b.id - a.id;
  });
}

/**
 * The export route (`report/export/route.ts`, deliberately untouched — design
 * doc §"Out of scope") only understands one exact-match value per filter.
 * Exactly one pick on a stacked axis still exports correctly as that value;
 * two or more picks have no single value to hand it, and forwarding the raw
 * CSV would exact-match nothing in SQL and silently export an empty file.
 * Dropping the axis instead (returning `undefined`, which `buildQuery` omits)
 * exports a superset of what is on screen for that axis — a visible, honest
 * difference rather than a silent, empty one.
 */
export function singleStackedValue(csv: string | null | undefined): string | undefined {
  const values = csvValues(csv);
  return values.length === 1 ? values[0] : undefined;
}
