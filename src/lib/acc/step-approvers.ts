/**
 * Who may approve a request that is sitting on a pool step — the pure half.
 *
 * `รออนุมัติโดย` answers "who is this with", and for a step assigned to a pool
 * that is a department: `บัญชี`, `Admin`. Useful as a column and useless as an
 * answer — the user asked on 2026-09-24 to be able to hover it and see the
 * people. Measured the same day, that is not a display problem: `AccApproval`
 * records an assignee on **every** pending `MANAGER` row (7/7 on AP-1, 2/2 on
 * AP-17) and on **none** of the pool rows (0/12 on AP-1's `ACCOUNT`, 0/1 on
 * AP-2's). The names have to come from each form's roster instead.
 *
 * This module holds the matching rule and nothing else — `step-approvers-load.ts`
 * beside it reads the five rosters, and it imports `@/env` through a pool, so
 * the rule is asserted here without one.
 *
 * ## Everything here is in CLAIM brands
 *
 * The loader converts before it answers, and that is the one thing a reader has
 * to know about the payload. The three rosters that carry a brand scope do not
 * agree on what a brand *is*: AP-17 stores the claim brands from its own
 * `AccFormBrand`, while AP-1 and AP-4 store **ERP interface targets**, which is
 * a different set with a different meaning. A tooltip comparing a target to
 * `row.brandCode` would silently list nobody for every claim brand that posts
 * into another company. So the loader expands targets into the claim brands
 * that map into them, and this file compares like with like.
 *
 * ## `null` brands means every brand, and it is NOT a default
 *
 * It is what AP-1 and AP-17 mean by an empty scope — see
 * `booking-approver-brands.ts` ("`null` or `[]` clears it — which restores
 * unrestricted access, not 'no brands'") and AP-1's own fail-open, which
 * CLAUDE.md records and deliberately did not copy into AP-4. **AP-4 means the
 * opposite**: zero ticks is zero brands, so its loader emits `[]` and this file
 * lists nobody. Both are faithfully represented rather than harmonised, because
 * the tooltip's whole job is to say what the action paths will actually do.
 */

/** One person who may act on a pool step, with the claim brands they may act on. */
export interface StepApprover {
  name: string;
  /** Claim brands. **`null` is unrestricted**, `[]` is nobody — see above. */
  brands: readonly string[] | null;
}

/**
 * One form's answer: its pool steps, and where its claim brands post.
 *
 * `postsInto` exists because of a question the first version could not answer.
 * A PCMY claim on AP-1 lists the seven people scoped to **PCTH**, and that is
 * correct — `canActOnClaimBrand` maps the claim to its ERP target before
 * comparing, so PCTH's approvers really can act on it — but on screen it reads
 * as "nobody ticked PCMY, why are these people here?", which is exactly what
 * was reported (the user, 2026-09-24). The card says `PCMY → ลงบัญชี PCTH`
 * instead of hiding the names, because hiding them would be false.
 *
 * **Only the forms whose scope is target-based carry it** — AP-1 and AP-4.
 * AP-17 scopes on claim brands directly and AP-2/AP-3 do not scope by brand at
 * all, so a "posts into" line there would explain a rule those forms do not
 * apply.
 */
export interface StepApproverForm {
  /** `stepCode → approvers`. A step with no pool is simply absent. */
  steps: Readonly<Record<string, readonly StepApprover[]>>;
  /** Claim brand → ERP interface target, **only where the two differ**. */
  postsInto: Readonly<Record<string, string>>;
}

/** `formCode → that form's answer`. */
export type StepApproverMap = Readonly<Record<string, StepApproverForm>>;

/**
 * `environment → map`.
 *
 * Keyed by environment because two of the five rosters are **not** dual-written:
 * `AccApprover`, `AccBookingApprover` and `AccReimburseApprover` are in
 * `MASTER_TABLES` and therefore identical in both databases, but
 * `AccAdvanceApprover` and `AccClearAdvanceApprover` are not and may genuinely
 * differ. Every row in these lists already carries its own `environment` — they
 * are merged from both databases by `query-both.ts` — so keying on it costs a
 * field and removes the question.
 */
export type StepApproverPayload = Readonly<Record<string, StepApproverMap>>;

/**
 * The step whose approver is a **person, not a pool**.
 *
 * Excluded by name rather than by an allow-list of pool steps: a step this file
 * has never heard of is far more likely to be another pool than another
 * individually-assigned one, and the failure directions are not symmetric.
 * Treating a new pool step as individual shows nothing, which is exactly the
 * hole this feature was opened to fill; treating a new individual step as a
 * pool shows the roster beside a name the row already gives, which is noise.
 */
const NAMED_ON_THE_ROW = "MANAGER";

export interface StepApproverQuery {
  environment?: string | null;
  formCode?: string | null;
  stepCode?: string | null;
  brandCode?: string | null;
}

/**
 * The people who may act, or `null` when this step does not have a pool to list.
 *
 * `null` and `[]` are different answers and both are useful: `null` means "ask
 * the row, it names the person" (MANAGER) or "nothing is known about this
 * step"; `[]` means the lookup succeeded and **nobody can act** — AP-4's
 * seeded `ROCKS` brand maps to no interface target, so its claims are
 * actionable by nobody until an admin fixes it, and a tooltip that said nothing
 * there would hide the one case worth shouting about.
 */
export function approverNamesFor(
  payload: StepApproverPayload | null | undefined,
  { environment, formCode, stepCode, brandCode }: StepApproverQuery,
): string[] | null {
  const step = (stepCode ?? "").trim();
  if (!step || step === NAMED_ON_THE_ROW) return null;

  const forms = payload?.[(environment ?? "").trim() || "Production"];
  const people = forms?.[(formCode ?? "").trim()]?.steps?.[step];
  if (!people) return null;

  const brand = (brandCode ?? "").trim();
  return people
    .filter((p) => {
      if (p.brands === null) return true;
      // No brand on the row: nothing to scope by, so an explicitly-scoped
      // person is still a candidate. Over-listing beats claiming nobody can act.
      if (!brand) return p.brands.length > 0;
      return p.brands.indexOf(brand) >= 0;
    })
    .map((p) => p.name);
}

/**
 * Which books this claim posts into, when that is not its own brand.
 *
 * `null` for the ordinary case — PCTH posts into PCTH, and saying so would be
 * noise on every row — and for every form that does not scope on targets.
 */
export function postsIntoFor(
  payload: StepApproverPayload | null | undefined,
  { environment, formCode, brandCode }: StepApproverQuery,
): string | null {
  const brand = (brandCode ?? "").trim();
  if (!brand) return null;
  const forms = payload?.[(environment ?? "").trim() || "Production"];
  const target = forms?.[(formCode ?? "").trim()]?.postsInto?.[brand];
  return target && target !== brand ? target : null;
}

/*
 * There was a `stepApproverTooltip` here, building the whole line as a string
 * for a native `title`. It lasted a day: the user asked for a styled box with
 * one name per line (2026-09-24), which a `title` cannot do, and
 * `ApproverHoverCard` renders the names as markup instead. Deleted rather than
 * left unused — the card carries the same Thai wording, and a second copy that
 * nothing renders is how the two come to disagree.
 *
 * **Names only is still the rule and still the user's**, asked directly the
 * same day: the route selects no email, so nothing downstream can print one.
 */
