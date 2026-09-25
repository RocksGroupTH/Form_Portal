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

/**
 * Was this request entered in a foreign currency — i.e. is there a conversion
 * worth showing? A missing currency means an old row from before the field
 * existed, which was baht.
 */
export function isForeignCurrency(currency: string | null | undefined): boolean {
  return !!currency && currency.toUpperCase() !== AP2_DEFAULT_CURRENCY;
}

/** Phase 1 business rule: an advance over this amount should go through PR/PO. */
export const AP2_PRPO_THRESHOLD = 3000;

/** Expected-clear date must be within this many days of the need-by date. */
export const AP2_MAX_CLEAR_DAYS = 30;

/**
 * The caption under AP-2's payment-date calendar, in Thai.
 *
 * Named rather than typed inline because four screens show this picker — the
 * request detail page, the approve queue, the detail panel and the ERP queue —
 * and when the weekly rule landed, the first edit reached only two of them. For
 * a day the other two listed every Friday under a caption saying only the 2nd
 * and the 4th were payable.
 *
 * It says the shift because a Thursday appearing in the list would otherwise
 * look like a bug to the accountant reading it.
 */
export const AP2_WEEKLY_PAYDAY_HINT = "วันจ่ายทุกวันศุกร์ (เลื่อนกลับถ้าตรงวันหยุด)";
