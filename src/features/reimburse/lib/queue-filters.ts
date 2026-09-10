import {
  inDateRange,
  isMultiSelectActive,
  matchesMultiSelectValue,
} from "@/features/accounting/components/ApprovalQueueFilters";

/**
 * The filters over AP-4's accounting queue.
 *
 * **Five fields, not AP-1's nine.** `QueueFilters` there carries `travelFrom`,
 * `travelTo` and `vehicleNames`, which are AP-1's subject matter: a claim with
 * a trip and a vehicle. AP-4 reimburses receipts and has neither, so reusing
 * that type would mean rendering three controls that filter on columns this
 * form does not have — a control that filters nothing is worse than a missing
 * one, because somebody will set it and believe the result.
 *
 * The *matching* is reused: `inDateRange` and `matchesMultiSelectValue` are
 * imported from AP-1's module rather than rewritten, so "empty means all" and
 * the explicit none marker mean exactly the same thing on both screens. Only
 * `matchText` is local, because that one is not exported there.
 *
 * Pure and unit-tested. The component that renders these lives beside the
 * queue; this half decides what passes.
 */
export interface ReimburseQueueFilters {
  requestNo: string;
  submittedFrom: string;
  submittedTo: string;
  requesterName: string;
  departmentNames: string[];
  brandCodes: string[];
}

/** Only what the filters read — so a test does not have to build a whole queue row. */
export interface ReimburseFilterableRow {
  requestNo: string;
  submittedAt: string | null;
  requesterName: string;
  requesterDepartmentName: string | null;
  brandCode: string;
}

export const EMPTY_REIMBURSE_QUEUE_FILTERS: ReimburseQueueFilters = {
  requestNo: "",
  submittedFrom: "",
  submittedTo: "",
  requesterName: "",
  departmentNames: [],
  brandCodes: [],
};

/**
 * A case-insensitive substring, with a blank term matching everything.
 *
 * Blank has to mean "no filter" rather than "match the empty string": a term
 * of one typed space would otherwise empty the queue, which on this screen
 * reads as "nothing is pending" — the one wrong answer that looks like a
 * correct one.
 */
function matchText(term: string, value: string | null | undefined): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return (value ?? "").toLowerCase().includes(t);
}

/** Is any filter actually narrowing the list? Drives the "clear filters" affordance. */
export function hasReimburseQueueFilters(f: ReimburseQueueFilters): boolean {
  return (
    f.requestNo.trim() !== "" ||
    f.submittedFrom !== "" ||
    f.submittedTo !== "" ||
    f.requesterName.trim() !== "" ||
    isMultiSelectActive(f.departmentNames) ||
    isMultiSelectActive(f.brandCodes)
  );
}

/** Every filter must pass — they narrow, they do not widen. */
export function applyReimburseQueueFilters<T extends ReimburseFilterableRow>(
  rows: readonly T[],
  f: ReimburseQueueFilters,
): T[] {
  return rows.filter((r) => {
    if (!matchText(f.requestNo, r.requestNo)) return false;
    if (!inDateRange(r.submittedAt, f.submittedFrom, f.submittedTo)) return false;
    if (!matchText(f.requesterName, r.requesterName)) return false;
    if (!matchesMultiSelectValue(r.requesterDepartmentName, f.departmentNames)) return false;
    if (!matchesMultiSelectValue(r.brandCode, f.brandCodes)) return false;
    return true;
  });
}
