import { linesMissingGl } from "@/lib/clr/clear-advance-line-validation";

/**
 * Which lines the account step's suggest button asks the model about, and why
 * the rest are left alone.
 *
 * ## The rule this has to match
 *
 * `linesMissingGl` is what blocks the ACCOUNT step. The button exists to clear
 * that block, so its buckets together must cover exactly what that function
 * flags — no more, and crucially no less. A line the gate complains about that
 * falls out of every bucket is a line the officer is blocked on and never told
 * about: the button reports success, the gate stays red, and nothing says why.
 * `gl-suggest-targets.test.ts` pins that as a property rather than a case.
 *
 * ## Why a line without a description is counted rather than asked about
 *
 * `suggestGlAccountWithAI` is given the description and the candidate list and
 * nothing else. With no description there is nothing to go on, and the route
 * would spend a model call to be told so. It is common now rather than
 * theoretical: the "attach without the AI read" button added on 2026-09-24
 * produces no expense row at all, so the requester types one, and the
 * description is optional.
 *
 * ## Why a line without a branch is counted rather than asked about
 *
 * A blank branch does not produce an empty candidate list — it produces the
 * WRONG one. `allowedDimensionTypes` reads a blank branch as HQ, so a branch
 * line would be offered head-office accounts and `validateLineGlBranch` would
 * refuse them at save time. Suggesting an account that cannot be saved is
 * worse than suggesting none. In practice submitted lines always have a branch
 * (the submit validator requires it), so this is a guard, not a common case.
 */
export type GlSuggestPlan = {
  /** 0-based indices to ask the model about. */
  targets: number[];
  /** 0-based indices blocked on a G/L that have no description to go on. */
  noDescription: number[];
  /** 0-based indices blocked on a G/L that have no branch. */
  noBranch: number[];
};

/** The little of a line this rule reads — exported so the run that consumes
 *  the plan (`gl-suggest-run.ts`) describes its input with the same type. */
export type PlanLine = {
  glAccountNo: string | null;
  amountBeforeVat: number | null;
  description?: string | null;
  branchCode?: string | null;
};

const has = (s: string | null | undefined) => (s ?? "").trim() !== "";

export function planGlSuggestions(items: readonly PlanLine[] | null | undefined): GlSuggestPlan {
  const plan: GlSuggestPlan = { targets: [], noDescription: [], noBranch: [] };
  // The gate answers in 1-based row numbers; everything here is an index.
  const blocked = new Set(linesMissingGl(items).map((row) => row - 1));
  (items ?? []).forEach((it, i) => {
    if (!blocked.has(i)) return;
    if (!has(it.branchCode)) plan.noBranch.push(i);
    else if (!has(it.description)) plan.noDescription.push(i);
    else plan.targets.push(i);
  });
  return plan;
}
