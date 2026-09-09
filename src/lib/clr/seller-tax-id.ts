import { isOwnTaxId } from "./own-tax-ids";

/**
 * Which of the two tax ids on an invoice belongs to the seller.
 *
 * A Thai tax invoice prints the seller's and the customer's, and the reader
 * mixes up whose is whose — three runs of the same rotated scan returned Rocks
 * PC's as the seller while reading the seller's *name* correctly beside it.
 * Rewriting the prompt twice did not move it.
 *
 * What it does do reliably is read both numbers. So it is asked for both, and
 * the fact that we know our own settles the attribution: on an expense receipt
 * we are always the customer, so ours appearing as the seller means the pair
 * arrived the wrong way round, and the other one is the seller's.
 *
 * That is a recovery, not a guess — it only fires when one number is provably
 * ours and the other is a plausible tax id.
 */
export function resolveSellerTaxId(
  sellerField: string | null | undefined,
  buyerField: string | null | undefined,
): string | null {
  const seller = digits(sellerField);
  const buyer = digits(buyerField);

  if (!seller) {
    // Nothing labelled as the seller. The buyer field is not a substitute: it is
    // only ever used to detect a swap, and on its own it is most likely ours.
    return null;
  }

  if (!isOwnTaxId(seller)) return seller;

  // Ours came back as the seller — the pair is swapped if the other number is a
  // real tax id that is not also ours.
  if (buyer.length === 13 && !isOwnTaxId(buyer)) return buyer;

  // Ours in both, or nothing usable opposite it. An empty field asks to be
  // filled; our own number would be filed against the wrong company.
  return null;
}

function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "").slice(0, 13);
}

/**
 * What a seller tax-id box accepts: digits, and at most thirteen of them.
 *
 * A Thai tax id is exactly thirteen digits, so anything else in the box is a
 * typo or a paste that brought its formatting along ("0-1055-43210-12-3", a
 * trailing space, a copied line break). Filtering as it is typed means the value
 * that reaches the database is the value the RD lookup can use, rather than one
 * that silently never matches.
 *
 * The cap is not cosmetic: the lookup asks the RD only for a 13-digit number, so
 * a fourteenth digit typed by accident turns a working field into one that
 * quietly stops checking.
 */
export function normalizeTaxIdInput(raw: string): string {
  return (raw ?? "").replace(/\D/g, "").slice(0, 13);
}

/**
 * What to say under the box, or nothing.
 *
 * Empty says nothing here — a line with no VAT has no seller to identify, and
 * the places that do care about a blank already explain it in their own words.
 * A half-typed number is the case worth naming: it looks filled in, and it is
 * the state in which the registry check silently does not run.
 */
export function taxIdNotice(raw: string | null | undefined): string | null {
  const d = normalizeTaxIdInput(raw ?? "");
  if (d.length === 0 || d.length === 13) return null;
  return `ยังไม่ครบ 13 หลัก (ตอนนี้ ${d.length}) — ยังตรวจกับกรมสรรพากรไม่ได้`;
}
