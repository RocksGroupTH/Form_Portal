import { taxIdChecksumOk } from "@/lib/clr/seller-tax-id";

/** One spelling of one seller, and how many approved lines used it. */
export interface KnownSellerRow {
  /** Thirteen digits, already stripped of punctuation by the query. */
  tin: string;
  payeeName: string | null;
  uses: number;
}

/** Trailing and repeated spaces are not a different spelling of a name. */
function norm(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The sellers this form has cleared before, as a tax id → name lookup.
 *
 * The third place a name can come from, after the Revenue Department's register
 * and our own vendor cards, and the only one that knows the shop on the corner:
 * seven of the twelve sellers ever cleared here have no vendor card, because
 * petty cash buys from people nobody opened an account for.
 *
 * It is history, not a registry — whatever got past an approver — so two guards
 * decide what is worth remembering.
 *
 * A tax id must pass its own check digit. Without that, one number misread once
 * and approved is taught back to every future read, and the form would slowly
 * learn its own mistakes. Four of the eleven sellers in UAT fail here,
 * including both halves of an "อินฟินิตี้ / อินฟินิตี้ อินฟินิตี้" pair that is
 * plainly one company read two ways.
 *
 * And where one number has been spelled two ways, the spelling used more often
 * wins — but a tie is not an answer. Picking either would write a name onto a
 * tax filing on the strength of a coin toss, and the row is better left as the
 * reader gave it, where the person holding the receipt can see it.
 */
export function pickKnownSellers(rows: readonly KnownSellerRow[]): Map<string, string> {
  const byTin = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const name = norm(r.payeeName);
    if (!name || !taxIdChecksumOk(r.tin)) continue;
    const spellings = byTin.get(r.tin) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + Math.max(1, r.uses));
    byTin.set(r.tin, spellings);
  }

  const out = new Map<string, string>();
  byTin.forEach((spellings, tin) => {
    let best = "";
    let bestUses = 0;
    let tied = false;
    spellings.forEach((uses, name) => {
      if (uses > bestUses) { best = name; bestUses = uses; tied = false; }
      else if (uses === bestUses) tied = true;
    });
    if (best && !tied) out.set(tin, best);
  });
  return out;
}
