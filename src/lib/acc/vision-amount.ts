/**
 * The baht bound, applied to a figure a document read returned in some other
 * currency.
 *
 * `MAX_RECEIPT_AMOUNT` (1,000,000฿) and `MAX_BOOKING_AMOUNT` (10,000,000฿) are
 * **baht** ceilings — they exist because a model reading a Thai invoice comes
 * back with the supplier's 13-digit tax id instead of a price. Applied to a raw
 * foreign figure they measure the wrong thing, and in the direction that loses
 * real money: a rate below 1 makes the foreign number the larger one, so a
 * ₩5,000,000 hotel bill (about 125,000฿) is nulled as a misread while a
 * legitimate figure disappears from the field with no explanation.
 *
 * ── Why this takes the sanitiser as an argument ──
 *
 * `sanitizeReceiptAmount` and `sanitizeBookingAmount` are deliberately **left
 * unchanged**: the second alone has nine non-test call sites — the browser's
 * typed-entry validation, the admin save service, `booking-dirty.ts` — and
 * every one of them deals in the claim's own currency, so changing what it
 * means changes all nine. They also disagree about zero on purpose (AP-1
 * refuses it, AP-17 keeps it, because "no VAT" is a real answer). Passing one
 * in rather than re-deriving a ceiling here is what keeps a single definition
 * of "is this a usable figure" — this only moves *which figure* is measured.
 *
 * Imports `@/lib/acc/currency` and nothing else, so it is unit-tested without a
 * key, a network or a database.
 */

import { toBaht } from "@/lib/acc/currency";

/** The model answers a number, but a string is cheap to accept and free to refuse. */
function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A figure in the document's own currency, admitted only if its **baht
 * equivalent** passes the gate — or null.
 *
 * What comes back is the *foreign* figure, not the converted one: AP-1 stores
 * per-day amounts and AP-17 stores its four booking figures in the claim's own
 * currency, and the single conversion happens once, on the request header.
 * Converting here would put a baht number into a field captioned `MYR`.
 *
 * **A missing rate returns null.** `resolveRate` answering null means nobody
 * knows what this figure is worth, so nothing can be said about whether it is
 * inside the ceiling — and the rule everywhere else in this feature is that an
 * unknown conversion is a refusal, never a fallback to the unconverted number.
 * The field opens blank and the person types what the paper says, which is
 * where a failed read leaves them anyway.
 */
export function admitReadAmount(
  raw: unknown,
  rate: number | null,
  bahtGate: (value: unknown) => number | null,
): number | null {
  const n = toNumber(raw);
  if (n === null) return null;

  const baht = toBaht(n, rate);
  if (baht === null) return null;
  if (bahtGate(baht) === null) return null;

  // Satang, on the figure that will actually be shown. Money here is two
  // decimals; a third is noise from a model or a division.
  return Math.round(n * 100) / 100;
}
