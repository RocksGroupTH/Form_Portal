/**
 * The last gate between what Claude read off a receipt and what lands in an
 * AP-4 expense row.
 *
 * Pure and unit-tested — `@/env` validates the whole environment at import, so
 * anything reachable from a pool would drag a live configuration into the test
 * run. The route calls this; nothing else should fill a row from a model
 * answer without going through it.
 *
 * Two rules shape every branch below:
 *
 * - **A blank editable field beats a wrong figure** on a form about to be
 *   submitted for money. Every failure path returns null rather than a guess,
 *   and nothing here clamps a bad number into a plausible-looking one.
 * - **One bad field nulls only itself.** A model that reads the total but
 *   misses the date should still save the requester typing the total.
 */

import { parseYmd } from "@/features/accounting/lib/thai-calendar";
import { MAX_RECEIPT_AMOUNT } from "@/features/accounting/lib/receipt-amount";

/** `AccReimburseItem.Description` is `NVARCHAR(500)` (migration 088). */
export const MAX_DESCRIPTION_LENGTH = 500;

/** What the model is asked for. Every field nullable — null is a real answer. */
export interface RawReceiptFields {
  expenseDate: string | null;
  description: string | null;
  amount: number | null;
  vat: number | null;
  withholdingTax: number | null;
}

export type ReceiptFields = RawReceiptFields;

/**
 * True for a value with exactly 13 integer digits.
 *
 * Every Thai receipt prints a 13-digit tax id, and it is the number most
 * likely to come back in place of a total. No plausible reimbursement line is
 * 13 digits, so refusing the shape outright costs nothing real. This is the
 * same trap AP-17's ID-card check exists for — there, a 13-digit run made a
 * tax invoice verify as a national ID card.
 */
function looksLikeTaxId(n: number): boolean {
  return Number.isInteger(n) && Math.abs(n) >= 1e12 && Math.abs(n) < 1e13;
}

/** A money figure, or null. `min` is 0 for VAT and withholding, which may legitimately be zero. */
function money(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (looksLikeTaxId(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

/**
 * Sanitize one model answer against `today` (`YYYY-MM-DD`).
 *
 * `today` is passed in rather than read from the clock so the boundary is
 * testable and so the caller decides whose clock counts — the route passes the
 * server's, which is the one the row is stored against.
 */
export function sanitizeReceiptFields(raw: RawReceiptFields, today: string): ReceiptFields {
  const amount = money(raw.amount, Number.MIN_VALUE, MAX_RECEIPT_AMOUNT);

  // Both are checked against the total, so neither survives without one:
  // there is nothing to sanity-check them against, and a VAT figure alone in a
  // row with no amount helps nobody.
  const cap = amount;
  const vat = cap === null ? null : money(raw.vat, 0, cap);
  const withholdingTax = cap === null ? null : money(raw.withholdingTax, 0, cap);

  let expenseDate: string | null = null;
  if (typeof raw.expenseDate === "string" && parseYmd(raw.expenseDate)) {
    // String comparison is safe: both sides are zero-padded YYYY-MM-DD. A
    // receipt cannot be for money not yet spent, so a later date means the
    // model read an expiry or a due date instead.
    if (raw.expenseDate <= today) expenseDate = raw.expenseDate;
  }

  let description: string | null = null;
  if (typeof raw.description === "string") {
    const trimmed = raw.description.trim();
    if (trimmed) description = trimmed.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return { expenseDate, description, amount, vat, withholdingTax };
}
