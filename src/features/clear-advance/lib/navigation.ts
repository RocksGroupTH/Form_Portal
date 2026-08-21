/**
 * AP-3 (Clear Advance / เคลียร์คืนเงินทดรองจ่าย) route helpers.
 *
 * Modeled on the advance/accounting navigation idioms so callers never build
 * these paths by hand.
 */

const CLEAR_ADVANCE_BASE = "/request/clear-advance";

/** Fill / resume page. Pass an id to edit an existing draft. */
export function clearAdvanceFormHref(id?: number | null): string {
  return id != null ? `${CLEAR_ADVANCE_BASE}?id=${id}` : CLEAR_ADVANCE_BASE;
}

/** Fill page forced into "new request" mode (skips the draft picker). */
export function clearAdvanceNewHref(): string {
  return `${CLEAR_ADVANCE_BASE}?new=1`;
}

/** Read-only detail page for a saved request. */
export function clearAdvanceDetailHref(id: number): string {
  return `${CLEAR_ADVANCE_BASE}/${id}`;
}

/** Where a back-action from the AP-3 report pages returns to — the AP-3 admin hub. */
export function clearAdvanceBackHref(): string {
  return "/request/clear-advance/admin";
}
