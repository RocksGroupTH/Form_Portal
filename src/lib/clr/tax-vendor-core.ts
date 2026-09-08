/**
 * Rules for the VAT line's Tax Vendor No. — the pure half.
 *
 * Two jobs live here because they are two halves of one requirement: accounting
 * must be able to *find* the seller's vendor card, and must not be able to
 * approve a VAT line without one.
 */

import type { ClearAdvanceItem } from "@/features/clear-advance/types";

/**
 * The words in a company name that identify nobody.
 *
 * An invoice prints "บริษัท เจเนซิส ซัพพลาย เชน จำกัด" and the vendor card may
 * hold any of that, all of it, or the middle only. Matching on the boilerplate
 * would return every limited company in the ledger, so it is dropped and the
 * distinctive words are matched instead.
 */
const NOISE = new Set([
  "บริษัท", "บจก", "บมจ", "จำกัด", "มหาชน",
  "ห้างหุ้นส่วนจำกัด", "ห้างหุ้นส่วนสามัญ", "ห้างหุ้นส่วน", "หจก",
  "co", "ltd", "company", "limited", "public", "plc",
  "corp", "corporation", "inc", "partnership", "part",
]);

/** How many words are ANDed together. Enough to be specific, few enough that one
 *  differently-spelled word in BC does not eliminate the right card. */
const MAX_TERMS = 3;

/**
 * The words to search a vendor name by, most distinctive first.
 *
 * Empty when the input carries no distinctive word at all — "บริษัท" alone is
 * not a search, and answering it with every company would be worse than saying
 * so.
 */
export function buildVendorNameTerms(raw: string | null | undefined): string[] {
  const cleaned = (raw ?? "")
    // Punctuation separates words on an invoice; it rarely survives into BC the
    // same way, so it becomes a space rather than part of a term.
    .replace(/[(),.\-–—/\\'"“”‘’[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of cleaned.split(" ")) {
    const w = word.trim();
    if (w.length < 2) continue;
    const key = w.toLowerCase();
    if (NOISE.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(w);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** A term as a LIKE pattern. `%`, `_` and `[` are literal in a company name. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_[]/g, (c) => `\\${c}`)}%`;
}

/**
 * The 1-based positions of expense lines that carry VAT but no vendor.
 *
 * Tax Vendor No. travels on the VAT line and nowhere else, so only a line with
 * VAT can be missing one. A line without VAT produces no VAT line at all and is
 * complete without a vendor.
 */
export function linesMissingTaxVendor(
  items: Pick<ClearAdvanceItem, "vatAmount" | "taxVendorNo">[] | null | undefined,
): number[] {
  const out: number[] = [];
  (items ?? []).forEach((it, i) => {
    const vat = Number(it.vatAmount ?? 0);
    if (!(vat > 0)) return;
    if (!(it.taxVendorNo ?? "").trim()) out.push(i + 1);
  });
  return out;
}
