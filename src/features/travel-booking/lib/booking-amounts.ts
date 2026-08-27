/**
 * The four figures an AP-17 booking row carries, and the arithmetic between them.
 *
 * A hotel or ticket invoice states a number, a price before VAT, the VAT, any
 * discount and the total charged. Accounting signs off against that paper, so
 * the row holds what the paper says — including a total that does not quite
 * reconcile, which happens with rounding, service charges, and how a supplier
 * chooses to apply a discount.
 *
 * `suggestedTotal` is therefore a **suggestion**, and `totalMismatch` a
 * **flag**, never a correction. What is stored is what the person entering it
 * saw.
 *
 * Pure and import-free so it is unit-tested without a database, and shared by
 * the panel, the save route and the AI read — one definition of "is this a
 * usable figure", asserted everywhere it matters.
 */

/**
 * The ceiling a figure is refused above.
 *
 * A model reading a Thai invoice can come back with the supplier's 13-digit tax
 * id instead of a price — the same failure `sanitizeReceiptAmount` guards
 * against on AP-1, and for the same reason: a blank editable field beats a
 * wrong figure on a document about to be signed off.
 */
export const MAX_BOOKING_AMOUNT = 10_000_000;

/** One satang — below this, a difference is rounding rather than a discrepancy. */
const TOLERANCE = 0.011;

/**
 * A usable figure, or null.
 *
 * **Zero is kept**, unlike AP-1's receipt total: "this booking carried no VAT"
 * and "this booking had no discount" are real answers a form must be able to
 * record. Absence is expressed by null, which is what the column stores when
 * nobody knows the figure.
 *
 * A negative is refused rather than negated — a discount is entered as its own
 * positive number in its own field, so a minus sign here is a misread, not a
 * shorthand to interpret.
 */
export function sanitizeBookingAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;

  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  if (n > MAX_BOOKING_AMOUNT) return null;

  // Money here is satang, so a third decimal is noise from a model or a
  // division rather than a figure anybody typed.
  return Math.round(n * 100) / 100;
}

/**
 * What the three parts add up to, or null when there is no base price.
 *
 * An unfilled VAT or discount contributes nothing rather than blocking the
 * suggestion — those two are genuinely often absent. An unfilled base price is
 * different: a lone VAT figure is not a total, and suggesting one from it would
 * be inventing the number this module exists to avoid inventing.
 */
export function suggestedTotal(
  priceExVat: number | null,
  vat: number | null,
  discount: number | null,
): number | null {
  if (priceExVat === null) return null;
  const total = priceExVat + (vat ?? 0) - (discount ?? 0);
  return Math.round(total * 100) / 100;
}

/**
 * Whether the entered total disagrees with the arithmetic by more than rounding.
 *
 * **A half-filled row is never a mismatch.** Somebody part-way through entering
 * an invoice is not contradicting themselves, and warning them mid-keystroke
 * would train them to ignore the warning by the time it means something.
 */
export function totalMismatch(
  priceExVat: number | null,
  vat: number | null,
  discount: number | null,
  total: number | null,
): boolean {
  if (total === null) return false;
  const expected = suggestedTotal(priceExVat, vat, discount);
  if (expected === null) return false;
  return Math.abs(expected - total) > TOLERANCE;
}
