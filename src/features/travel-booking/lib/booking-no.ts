/**
 * The last gate on the booking number an AP-17 row stores.
 *
 * `booking-amounts.ts` guards the four figures; this guards the fifth field,
 * which is text and therefore has a different failure mode. The column is
 * `NVARCHAR(100)` (migration 048), and `mssql` binding a longer string to
 * `sql.NVarChar(100)` **truncates it silently** rather than raising — so a
 * model that answers with a paragraph of invoice header would store its first
 * hundred characters as the booking reference and nothing would say so.
 *
 * Pure and import-free, so it is unit-tested without a database or a key.
 */

/** `AccTravelBookingDetail.BookingNo` is `NVARCHAR(100)`. */
export const MAX_BOOKING_NO_LENGTH = 100;

/**
 * A usable booking number, or null.
 *
 * Interior whitespace is collapsed rather than stripped: a supplier reference
 * genuinely reads `AGD 123 456` on some invoices, so removing the spaces would
 * change the number, while a run of newlines from a rasterised PDF is noise.
 *
 * **Over-long input is refused, not truncated.** A hundred and one characters
 * is not a booking number somebody mistyped — it is the model having answered
 * with the wrong thing entirely, and half of the wrong thing is worse than a
 * blank field the booking desk fills in from the paper in front of them.
 */
export function sanitizeBookingNo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  if (collapsed.length > MAX_BOOKING_NO_LENGTH) return null;
  return collapsed;
}
