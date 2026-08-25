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
/** `AccReimburseItem.DocumentNo` is `NVARCHAR(100)` (migration 117). */
export const MAX_DOCUMENT_NO_LENGTH = 100;
/** `AccReimburseItem.BranchName` is `NVARCHAR(200)` (migration 117). */
export const MAX_BRANCH_LENGTH = 200;
/** `AccReimburseItem.VendorName` is `NVARCHAR(300)` (migration 118). */
export const MAX_VENDOR_NAME_LENGTH = 300;
/** `AccReimburseItem.VendorAddress` is `NVARCHAR(500)` (migration 118). */
export const MAX_VENDOR_ADDRESS_LENGTH = 500;

/** A Thai tax id, and a Thai national id, are both exactly this many digits. */
const TAX_ID_DIGITS = 13;

/**
 * What the model is asked for. Every field nullable — null is a real answer.
 *
 * **`category` (รายการ) is deliberately absent.** It holds this company's own
 * internal code — "AP-4.2" — which appears on no vendor's receipt, so a model
 * asked for it could only invent one, and an invented category is a
 * miscategorised payment nobody would have reason to re-check.
 */
export interface RawReceiptFields {
  expenseDate: string | null;
  description: string | null;
  amount: number | null;
  vat: number | null;
  withholdingTax: number | null;
  /** เลขที่เอกสาร — the receipt or tax-invoice number printed on the document. */
  documentNo?: string | null;
  /** สาขา — the vendor branch, where the receipt names one. */
  branchName?: string | null;
  /** เลขประจำตัวผู้เสียภาษี of the **seller**, as printed. */
  vendorTaxId?: string | null;
  /** ชื่อ-สกุล / ชื่อบริษัท of the seller. */
  vendorName?: string | null;
  /** ที่อยู่ of the seller. */
  vendorAddress?: string | null;
}

export interface ReceiptFields {
  expenseDate: string | null;
  description: string | null;
  amount: number | null;
  vat: number | null;
  withholdingTax: number | null;
  documentNo: string | null;
  branchName: string | null;
  vendorTaxId: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
}

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

  return {
    expenseDate,
    description: text(raw.description, MAX_DESCRIPTION_LENGTH),
    amount,
    vat,
    withholdingTax,
    documentNo: text(raw.documentNo, MAX_DOCUMENT_NO_LENGTH),
    branchName: text(raw.branchName, MAX_BRANCH_LENGTH),
    vendorTaxId: taxId(raw.vendorTaxId),
    vendorName: text(raw.vendorName, MAX_VENDOR_NAME_LENGTH),
    vendorAddress: text(raw.vendorAddress, MAX_VENDOR_ADDRESS_LENGTH),
  };
}

/**
 * The seller's tax id, digits only, or null.
 *
 * **`looksLikeTaxId` is deliberately not applied here — it is inverted.** That
 * guard exists because a 13-digit run is what a Thai receipt prints and is the
 * number most likely to come back in place of a total, so the money columns
 * refuse the shape. This is the one field where the shape is the right answer,
 * and reusing the guard would null exactly the values it is meant to capture.
 *
 * Separators are stripped because documents print the id grouped
 * (`0-1055-47161-67-4`) and a stored value that varies by punctuation matches
 * nothing later. Anything that is not exactly 13 digits afterwards is refused:
 * it is then not a Thai tax id, and a wrong one on a claim is worse than a
 * blank the requester fills in.
 */
function taxId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const digits = v.replace(/\D/g, "");
  return digits.length === TAX_ID_DIGITS ? digits : null;
}

/**
 * A trimmed string bounded to what its column takes, or null.
 *
 * The cut matters: every one of these columns is a fixed-width `NVARCHAR`, and
 * a longer value is a failed INSERT at submit — long after the requester has
 * stopped looking at the form.
 */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
