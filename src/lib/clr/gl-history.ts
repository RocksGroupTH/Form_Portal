import { isHqBranch } from "@/lib/clr/clear-advance-gl-filter";

/**
 * What makes two expense lines "the same thing" for the purpose of reusing the
 * account somebody already chose.
 *
 * ## Why the branch part is a classification and not a branch code
 *
 * The corpus decided this. `Type-c to HDMI สีดำ` appears nine times with two
 * accounts, which reads like noise until it is grouped: HQ01 takes 610311002
 * five times, and PC1001/PC1073/PCCT01 take 610113001 (…- สาขา) four times,
 * exactly and without exception.
 *
 * Keyed on the branch CODE that is four keys with one or two uses each — fine
 * here, useless in a business with a hundred branches, where the same
 * description at the same branch twice is rare. Keyed on `isHqBranch` it is two
 * keys, each unanimous.
 *
 * And `isHqBranch` is not a rule invented for this: it is what
 * `allowedDimensionTypes` already uses to decide which accounts a line may
 * charge at all. The grouping is clean because the key is keyed on the same
 * thing the constraint is keyed on.
 */
export type GlHistoryRow = {
  description: string | null;
  branchCode: string | null;
  /** The BC company the claim's brand resolves to — accounts are company-scoped. */
  company: string;
  glAccountNo: string | null;
};

/** Trim, collapse runs of whitespace, lower-case. Thai is unaffected; `Type-C` and `type-c` are one expense. */
const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function glHistoryKey(
  description: string | null | undefined,
  company: string | null | undefined,
  branchCode: string | null | undefined,
): string {
  return [norm(description), norm(company), isHqBranch(branchCode) ? "hq" : "branch"].join("\u0000");
}

/**
 * The account this key has always meant, or nothing.
 *
 * Nothing when the history disagrees with itself (user, 2026-09-24: a key that
 * has meant two things is not a memory, it is a coin toss — ask the model) and
 * nothing when there is no history at all. The caller cannot tell those apart
 * and does not need to: both fall through to the model.
 */
export function decideRemembered(
  rows: readonly GlHistoryRow[] | null | undefined,
  key: string,
): string | null {
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    const acct = (r.glAccountNo ?? "").trim();
    if (!acct) continue;
    if (glHistoryKey(r.description, r.company, r.branchCode) !== key) continue;
    seen.add(acct);
    if (seen.size > 1) return null;
  }
  return seen.size === 1 ? Array.from(seen)[0] : null;
}
