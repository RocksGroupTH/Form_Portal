/**
 * AP-2 (เบิกเงินทดรองจ่าย / Advance) constants.
 *
 * Advance reuses the generic request/approval backbone of AP-1, so status and
 * step enums are imported from the accounting feature rather than redefined.
 */

export const AP2_FORM_CODE = "AP-2";

/** AccSequence prefix → running no. like "ADV26-00001". */
export const AP2_SEQUENCE_PREFIX = "ADV";

/** Phase 1 locks the currency to THB (multi-currency is Phase 2). */
export const AP2_DEFAULT_CURRENCY = "THB";

/** Phase 1 business rule: an advance over this amount should go through PR/PO. */
export const AP2_PRPO_THRESHOLD = 3000;

/** Expected-clear date must be within this many days of the need-by date. */
export const AP2_MAX_CLEAR_DAYS = 30;
