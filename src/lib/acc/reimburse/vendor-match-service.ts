import { listTaxVendors } from "@/lib/clr/tax-vendor-service";
import { matchVendorWithAI } from "@/lib/clr/ai-receipt";
import { planVendorMatch, pickMatchedVendor } from "./vendor-match-core";
import type { VendorMatchStatus } from "./vendor-match-core";

/**
 * AP-4 — find the Business Central vendor card for every expense line that has
 * none, and record "there isn't one" where that is the answer.
 *
 * The IO half of `./vendor-match-core.ts`: one vendor list for the whole claim,
 * the ladder per line, and the model only for the lines the ladder could not
 * settle. Everything that decides anything lives in the core and is unit-tested
 * there.
 *
 * **`listTaxVendors` is AP-3's and is keyed on the Business Central COMPANY**,
 * not on the claim brand — the caller resolves the brand through
 * `AccBrandErpInterface` first, exactly as the vendor picker, the branch list
 * and the G/L list all do. Passing a claim brand straight through answers an
 * empty list for every ROCKS claim, which is the bug the G/L picker carried
 * until it was fixed.
 */

/** Only the parts of a line this reads. `id` is what the edit is keyed on. */
export interface VendorMatchTarget {
  id: number;
  vendorTaxId?: string | null;
  vendorName?: string | null;
}

/** What one run answered, and whether it could answer at all. */
export interface VendorMatchResult {
  edits: VendorMatchEdit[];
  /**
   * The company has no vendor cards — never synced, or the wrong Company
   * resolved. `edits` is empty and **nothing was decided**, which is not the
   * same as every seller being absent from the ledger.
   */
  ledgerEmpty: boolean;
}

/** One line's answer, in the shape `setReimburseItemAccounts` takes. */
export interface VendorMatchEdit {
  id: number;
  vendorNo: string | null;
  vendorMatchStatus: VendorMatchStatus;
  /** Which rung answered — for the caller's own summary, not stored. */
  via: "taxId" | "name" | "ai" | "none";
}

/**
 * Run the ladder over one claim's lines.
 *
 * **Sequential, not `Promise.all`.** The model calls are the slow part and a
 * claim with twenty unmatched lines firing twenty at once is a rate limit
 * waiting to happen — the same reason `suggest-gl` gives. Most lines never
 * reach the model at all: a tax id that matches one card is decided locally.
 *
 * **A line gets `"none"` only when the ledger was actually searched and this
 * seller is not in it.** That verdict is the point of the feature — it is what
 * releases the queue's checkbox for a seller who is not a vendor of ours — and
 * it is exactly why the two ways of "not finding one" do NOT get it: a model
 * that declined among real candidates, and a company with no cards at all.
 * Both leave the line NULL, which reads as "nobody has established this yet"
 * and keeps it in the set the button retries.
 */
export async function matchVendorsForClaim(
  company: string,
  lines: readonly VendorMatchTarget[],
): Promise<VendorMatchResult> {
  if (lines.length === 0) return { edits: [], ledgerEmpty: false };

  // One read for the whole claim. PCTH is the largest company at ~1,600 active
  // cards, which is small enough to filter in memory and far cheaper than a
  // query per line.
  const cards = await listTaxVendors(company);
  // **Nothing is written when the company has no vendor cards at all.** Every
  // line would answer "no card for this seller", which is the verdict that
  // releases the line from needing one — so an unsynced or wrongly resolved
  // Company would mark a whole claim exempt and turn the queue green. The
  // caller reports it instead; `planVendorMatch` answers `unknown` for the
  // same reason, and this is the guard that keeps that answer from being
  // written as anything.
  if (cards.length === 0) return { edits: [], ledgerEmpty: true };

  const edits: VendorMatchEdit[] = [];
  for (const line of lines) {
    const plan = planVendorMatch(line, cards);

    if (plan.kind === "matched") {
      edits.push({ id: line.id, vendorNo: plan.vendorNo, vendorMatchStatus: "auto", via: plan.via });
      continue;
    }
    if (plan.kind === "none") {
      edits.push({ id: line.id, vendorNo: null, vendorMatchStatus: "none", via: "none" });
      continue;
    }
    // Unreachable with a non-empty ledger, and left rather than folded into
    // the branch above: the two mean opposite things, and a future rung that
    // answers `unknown` for some other reason must not silently become `none`.
    if (plan.kind === "unknown") continue;

    const raw = await matchVendorWithAI(
      (line.vendorName ?? "").trim(),
      (line.vendorTaxId ?? "").trim() || null,
      plan.candidates,
    );
    const picked = pickMatchedVendor(raw, plan.candidates);
    // The model was offered two or three real cards and chose none of them, or
    // could not be reached. **No edit at all**, deliberately: `"none"` would say
    // this seller has no card, which the filter just proved false, and any other
    // verdict would take the line out of the set the button retries. Left NULL,
    // it stays "nobody has established which card this is" — a question for a
    // person, and askable again.
    if (picked) edits.push({ id: line.id, vendorNo: picked, vendorMatchStatus: "auto", via: "ai" });
  }
  return { edits, ledgerEmpty: false };
}
