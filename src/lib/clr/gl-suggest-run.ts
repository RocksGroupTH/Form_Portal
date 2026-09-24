import type { GlCandidate } from "@/lib/clr/ai-receipt-core";
import { planGlSuggestions, type PlanLine } from "@/lib/clr/gl-suggest-targets";

/**
 * The account step's G/L suggest button, minus the route around it.
 *
 * The route itself cannot be imported by a test — it reaches `@/lib/db/mssql`
 * → `@/env`, which validates the environment at module scope and throws under
 * `tsx` with no env file. So everything the route actually decides lives here,
 * with the model call handed in as a function: what gets asked, in what order,
 * and what an answer has to be before it counts as one. The route is left with
 * auth, loading the claim, and building the candidate lists.
 *
 * ## Sequential, and not to be "optimised"
 *
 * These are model calls. A claim with twenty lines firing twenty at once is a
 * rate limit waiting to happen, and the normal case is a handful of lines, so
 * there is nothing to win. `Promise.all` here reads like an obvious improvement
 * and is the reason `gl-suggest-run.test.ts` pins the start/end order of the
 * calls rather than only their count.
 *
 * ## An answer is only an answer if the officer could have picked it
 *
 * The model is matched back against the very list the picker offers that line's
 * branch, and anything else — an invented number, a refusal, an account from
 * another branch — is counted as no answer. The officer is never shown an
 * account they could not have chosen by hand.
 *
 * ## The remembered account goes through that same check
 *
 * A line whose description has been accounted for before is filled from that
 * decision instead of a model call. It is still only an answer on the same
 * terms: `acceptedCandidate` is the single gate, and both paths call it.
 *
 * Being right once does not survive the account being deactivated, blocked, or
 * moved to another dimension type — and a remembered value skipping the check
 * "because it was valid once" fails silently and for months, since a dead
 * account reappearing on a new claim looks exactly like a live one until
 * somebody tries to post it. That is why it is one function and not two
 * `candidates.find(...)` calls that a later edit can let drift apart.
 *
 * ## One line's failure is one line's failure
 *
 * Each call is caught on its own. A model error on line three must not throw
 * away the two answers already in hand; it is counted as no answer like any
 * other silence.
 */

/** An account a line's branch may charge — the picker's own option shape. */
export type { GlCandidate };
/** The shape of a line both the plan and the run read — re-exported so a caller
 *  of this module needs only this module. */
export type { PlanLine };

/** What to fill in, by position in the claim's item list. */
export type GlSuggestion = {
  index: number;
  glAccountNo: string;
  nameTh: string | null;
  /** Where the value came from: an officer's own past decision, or the model.
   *  Carried per suggestion rather than as a pair of totals on the run, so the
   *  screen's "filled from history / filled by AI" split is counted from the
   *  array it is about to apply and cannot disagree with it. */
  source: "history" | "model";
};

/** The response payload the route returns verbatim. */
export type GlSuggestRun = {
  /** How many lines this ran over — the screen checks it before applying by index. */
  itemCount: number;
  suggestions: GlSuggestion[];
  /** Counts, not indices: the screen computes the same plan from its own grid. */
  noDescription: number;
  noBranch: number;
  /** Asked, and the model gave nothing usable. */
  noAnswer: number;
};

/** The model call, injected so the tests never make one. */
export type SuggestGlFn = (description: string, candidates: GlCandidate[]) => Promise<string>;

/** The key a branch's candidate list is stored under — see `branchesToLoad`. */
export function branchKey(branchCode: string | null | undefined): string {
  return (branchCode ?? "").trim();
}

/**
 * The distinct branches whose candidate lists the run needs, once each.
 *
 * Lines of one claim can sit in different branches and the allowed accounts
 * differ per branch, so the list cannot be built once for the claim. Building
 * it per LINE would hit the database once per line instead, for lists that are
 * usually all the same — hence: per distinct branch.
 */
export function branchesToLoad(items: readonly PlanLine[] | null | undefined): string[] {
  const { targets } = planGlSuggestions(items);
  const seen = new Set<string>();
  for (const i of targets) {
    const key = branchKey((items ?? [])[i]?.branchCode);
    if (key) seen.add(key);
  }
  return Array.from(seen);
}

/**
 * The one gate an account has to pass before it can be suggested: it must be on
 * the list the picker offers this line's branch.
 *
 * **Both paths call this, and that is the point of it existing.** The model's
 * answer and a remembered account are held to the same standard — see the
 * docblock above. Do not inline it into either branch.
 */
export function acceptedCandidate(
  candidates: readonly GlCandidate[],
  accountNo: string | null | undefined,
): GlCandidate | null {
  const no = (accountNo ?? "").trim();
  if (!no) return null;
  return candidates.find((c) => c.glAccountNo === no) ?? null;
}

export async function runGlSuggestions(
  items: readonly PlanLine[] | null | undefined,
  candidatesByBranch: ReadonlyMap<string, readonly GlCandidate[]>,
  suggest: SuggestGlFn,
  /**
   * Line index → the account this line's description has always been given
   * before, worked out by the caller from `decideRemembered`. Optional because
   * a caller with no history to offer (and every test that is about the model
   * path) should not have to say so with an empty map.
   *
   * Indices, not descriptions: the same description on two lines of one claim
   * can sit at two branches, and those are two different keys.
   */
  rememberedByIndex?: ReadonlyMap<number, string> | null,
): Promise<GlSuggestRun> {
  const lines = items ?? [];
  const plan = planGlSuggestions(lines);
  const out: GlSuggestRun = {
    itemCount: lines.length,
    suggestions: [],
    noDescription: plan.noDescription.length,
    noBranch: plan.noBranch.length,
    noAnswer: 0,
  };

  // Sequential on purpose. See the docblock: not Promise.all.
  for (const index of plan.targets) {
    const line = lines[index];
    const key = branchKey(line.branchCode);
    const candidates = candidatesByBranch.get(key);
    if (!candidates || candidates.length === 0) {
      // Loud rather than "no answer". A branch with nothing to offer is a
      // broken chart of accounts, and reporting it as the model declining
      // would hide it behind a plausible number. The route refuses with the
      // branch named before it ever gets here; this is the backstop.
      throw new Error(`ไม่มีผังบัญชีสำหรับสาขา ${key}`);
    }
    // Remembered first, and only if it still passes the gate. A line filled
    // from history costs nothing and is never asked about.
    const fromHistory = acceptedCandidate(candidates, rememberedByIndex?.get(index));
    if (fromHistory) {
      out.suggestions.push({
        index,
        glAccountNo: fromHistory.glAccountNo,
        nameTh: fromHistory.nameTh,
        source: "history",
      });
      continue;
    }

    let answer = "";
    try {
      answer = await suggest((line.description ?? "").trim(), candidates.slice());
    } catch {
      answer = "";
    }
    const hit = acceptedCandidate(candidates, answer);
    if (hit) {
      out.suggestions.push({
        index,
        glAccountNo: hit.glAccountNo,
        nameTh: hit.nameTh,
        source: "model",
      });
    } else out.noAnswer += 1;
  }

  return out;
}
