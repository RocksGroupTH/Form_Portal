/**
 * AP-4 — which Business Central vendor card an expense line posts against, and
 * when a line is allowed to have none.
 *
 * The pure half. `./vendor-match-service.ts` wraps it with the vendor list and
 * the model call; everything here is total over plain values, so the ladder is
 * unit-tested without a database or an API key.
 *
 * ## The ladder, cheapest and most certain first
 *
 * 1. **The seller's tax id against the card's `TaxRegistrationNumber`.** An
 *    exact key, already on the line, and free. A hit here never reaches the
 *    model.
 * 2. **The distinctive words of the seller's name** (`buildVendorNameTerms`,
 *    AP-3's, reused rather than re-derived). One survivor is a match; several
 *    are what the model is asked to choose between.
 * 3. **Nothing.** Which is an answer, not a failure — see `vendorRequired`.
 *
 * **A tax id on more than one card is not a match.** One tax id genuinely maps
 * to many cards — a head office and its branches — so picking the first is a
 * guess that lands in a subledger under somebody's name. It falls through to
 * the name, which is exactly the thing that can separate them, and to `none` if
 * it cannot. AP-2's matcher reached the same rule for its own ambiguous case,
 * and reached it the hard way.
 *
 * **The model may only answer with a card the filter produced.** `pickMatchedVendor`
 * drops anything else, so an accountant is never shown a vendor they could not
 * have picked by hand — the constraint `pickSuggestedGl` already applies to the
 * G/L suggestion.
 */

import { buildVendorNameTerms, vendorMatches } from "@/lib/clr/tax-vendor-core";

/**
 * How a line's `VendorNo` came to be what it is (`AccReimburseItem.VendorMatchStatus`,
 * migration 150).
 *
 * `null` — the column's default — is a fourth state and the important one: it
 * means nobody has looked yet, which is not the same as having looked and found
 * nothing. See `vendorRequired`.
 */
export type VendorMatchStatus = "auto" | "manual" | "none";

/** A vendor card the matcher can land on — `TaxVendorCandidate`'s shape. */
export interface VendorCard {
  vendorNo: string;
  displayName: string | null;
  taxRegistrationNumber: string | null;
}

/** Only the parts of an expense line the matcher reads. */
export interface VendorMatchLine {
  vendorTaxId?: string | null;
  vendorName?: string | null;
}

export type VendorMatchPlan =
  /** Decided here. `via` says which rung, for the activity log and the screen. */
  | { kind: "matched"; vendorNo: string; via: "taxId" | "name" }
  /** Several plausible cards — the model picks one of exactly these. */
  | { kind: "ask"; candidates: VendorCard[] }
  /** No card in this company answers to this seller. */
  | { kind: "none" };

/** Digits only. The number is printed grouped and stored bare, or the reverse. */
function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/**
 * Every card carrying this tax id.
 *
 * A blank or unreadable id matches **nothing**, rather than matching the cards
 * that also have none: `TaxRegistrationNumber IS NULL` is "we never recorded
 * it", and treating that as equal to "the receipt did not print one" would pair
 * a street stall with whichever supplier BC is missing a number for.
 */
export function cardsByTaxId(cards: readonly VendorCard[], taxId: string | null | undefined): VendorCard[] {
  const want = digits(taxId);
  if (want === "") return [];
  return cards.filter((c) => digits(c.taxRegistrationNumber) === want);
}

/**
 * Every card whose number, name or tax id contains each distinctive word of the
 * seller's name.
 *
 * Empty when the name carries no distinctive word at all. `vendorMatches`
 * answers **true** for a termless query — correct for its own caller, a typed
 * filter box where an empty box shows everything — so the guard belongs here
 * rather than there: an unguarded fallthrough hands the model the company's
 * whole ledger and bills for it.
 */
export function cardsByName(cards: readonly VendorCard[], sellerName: string | null | undefined): VendorCard[] {
  const typed = (sellerName ?? "").trim();
  if (buildVendorNameTerms(typed).length === 0) return [];
  return cards.filter((c) => vendorMatches(c, typed));
}

/** The ladder, as far as it goes without a model call. */
export function planVendorMatch(line: VendorMatchLine, cards: readonly VendorCard[]): VendorMatchPlan {
  if (cards.length === 0) return { kind: "none" };

  const byTax = cardsByTaxId(cards, line.vendorTaxId);
  if (byTax.length === 1) return { kind: "matched", vendorNo: byTax[0].vendorNo, via: "taxId" };

  // Several cards share the id: narrow them by name rather than guessing, and
  // fall back to the whole company only when the id matched nothing at all.
  const pool = byTax.length > 1 ? byTax : cards;
  const byName = cardsByName(pool, line.vendorName);

  if (byName.length === 1) return { kind: "matched", vendorNo: byName[0].vendorNo, via: "name" };
  if (byName.length > 1) return { kind: "ask", candidates: byName };
  return { kind: "none" };
}

/**
 * The vendor number the model chose — but only if it is one of the candidates
 * it was given.
 *
 * A real card that was not among them is refused too: the filter is the
 * constraint, not the ledger.
 */
export function pickMatchedVendor(raw: string, candidates: readonly VendorCard[]): string | null {
  const allowed = new Set(candidates.map((c) => c.vendorNo));
  for (const token of raw.match(/[A-Za-z0-9._-]+/g) ?? []) {
    if (allowed.has(token)) return token;
  }
  return null;
}

/** Only what the requirement reads. */
export interface VendorRequirementLine {
  vatAmount?: number | null;
  vendorNo?: string | null;
  vendorMatchStatus?: VendorMatchStatus | string | null;
}

/**
 * Does this line still owe accounting a vendor?
 *
 * Two conditions, and each was a separate bug:
 *
 * - **No VAT, no vendor needed.** `Tax Vendor No.` travels on the VAT line and
 *   nowhere else, so a line with no VAT produces no VAT line at all and is
 *   complete without one. AP-3 has had exactly this rule since it shipped
 *   (`linesMissingTaxVendor`); AP-4 demanded a vendor on every line.
 * - **`none` is an answer.** A seller who is not a vendor of ours has no card
 *   to pick, which `AccReimburseItem.VendorNo`'s own docblock already called
 *   ordinary — while the queue refused to approve such a claim at all.
 *
 * **`null` is not `none`.** It means nobody has looked, and reading the two the
 * same way would unlock the checkbox on every claim the moment it arrived.
 */
export function vendorRequired(line: VendorRequirementLine): boolean {
  if (!(Number(line.vatAmount ?? 0) > 0)) return false;
  if ((line.vendorNo ?? "").trim() !== "") return false;
  return (line.vendorMatchStatus ?? null) !== "none";
}
