/**
 * Our own companies' tax ids — the numbers that can never be a seller's.
 *
 * A Thai tax invoice prints two: the seller's and the customer's. On an expense
 * receipt we are always the customer, so any of these appearing as the seller is
 * the reader having taken the wrong block. Tested against a real scan on
 * 2026-09-08, it did exactly that twice running — returning Rocks PC's number
 * while reading the seller's *name* correctly beside it — and rewriting the
 * prompt did not move it.
 *
 * A wrong tax id here is filed with the Revenue Department against the wrong
 * company, so this is a list rather than an instruction.
 *
 * **Do not check these against `ErpVendors`.** Rocks PC is registered there as an
 * intercompany vendor under KSI, PCMY and UNO, so a "known vendor" test would
 * confirm precisely the number this list exists to reject — while the genuine
 * seller, not being a vendor of ours, appears nowhere.
 *
 * Add a company by adding its number. Nothing else needs to change.
 */
const OWN_TAX_IDS: ReadonlySet<string> = new Set([
  "0105559040818", // บริษัท ร็อคส์ พีซี จำกัด (ROCKS PC) — user, 2026-09-08
]);

/** True when the number is one of our own companies', however it was punctuated. */
export function isOwnTaxId(taxId: string | null | undefined): boolean {
  const digits = (taxId ?? "").replace(/\D/g, "");
  return digits.length > 0 && OWN_TAX_IDS.has(digits);
}
