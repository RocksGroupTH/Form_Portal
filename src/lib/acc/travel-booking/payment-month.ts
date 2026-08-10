/**
 * AP-17 end-of-month payout scheduling.
 *
 * Requests approved on or before the 20th of a month are paid out at the
 * end of that same month; requests approved after the 20th roll to the
 * end of the following month (gives accounting a cutoff to close payroll).
 */

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/**
 * The payout date for a request approved on `approvalDate`: the last day
 * of the approval month, or of the following month if approved after the
 * 20th.
 *
 * `new Date(y, m, 0)` gives the last day of month `m - 1` (0-indexed), so
 * passing `m + 1` (same month, 1-indexed) yields end-of-this-month, and
 * `m + 2` yields end-of-next-month. `Date` normalizes year/month overflow
 * automatically (e.g. December -> January of the next year).
 */
export function computePayoutDate(approvalDate: Date): Date {
  const y = approvalDate.getFullYear();
  const m = approvalDate.getMonth();
  const day = approvalDate.getDate();
  const monthOffset = day <= 20 ? m + 1 : m + 2;
  return new Date(y, monthOffset, 0);
}

/** Thai "เดือน ปี" label for a payout date, e.g. "กรกฎาคม 2026". */
export function formatPayoutMonth(d: Date): string {
  return `${THAI_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
