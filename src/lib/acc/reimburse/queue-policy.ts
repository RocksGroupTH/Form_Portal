import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * Which claims the accounting queue shows.
 *
 * **Pure, in the sense that matters: this file's only import chain reaches no
 * pool and no `@/env`.** `AP4_FORM_CODE` comes from
 * `@/features/reimburse/constants`, a file that itself imports nothing (its
 * own docblock says so — "imports nothing and is the home for anything pure
 * that needs a test"), so importing one constant from it costs nothing that
 * the old "imports nothing at all" version of this file bought: `@/env`
 * validates the whole environment at import time, so anything reachable from
 * a pool would drag a live configuration into the test run, and nothing on
 * this chain is reachable from a pool. If a future edit needs a value from a
 * module that is NOT itself import-free, inline the literal instead of
 * importing it, with a comment saying why — the property worth keeping is
 * "never reaches `@/env`", not "literally zero import statements".
 *
 * **`formCode` is not decoration — it is the fix for a bug three review
 * rounds took to pin down.** The predicate used to be `(status, stepCode)`
 * only, and the SQL in `queue-service.ts` carried the `FormCode = 'AP-4'`
 * half of the rule on its own. Every attempt to guard that SQL text with a
 * regex — requiring the substring, then requiring the AND-conjunction, then
 * requiring the guarding `if (!…)` form — was defeated by a rewrite that kept
 * every pinned substring and changed what the query actually selected: an OR
 * in place of an AND, a `belongsInAccountQueue(...)` call with no `if` around
 * it, and finally a re-parenthesisation —
 * `WHERE (r.FormCode = @form AND r.Status = @status) OR r.CurrentStepCode = @step`
 * — that leaves `FormCode = @form AND` sitting there as a contiguous,
 * regex-satisfying substring while the query now means "AP-4 at the right
 * status, OR *anything at all* sitting at `CurrentStepCode = 'ACCOUNT'`" —
 * exactly where AP-1 parks its own claims (`STATUS_AT_STEP`, AP-1's
 * `approval-engine.ts`). A regex over SQL TEXT cannot verify SQL SEMANTICS,
 * and a status-and-step-only row check cannot catch any of these rewrites
 * either, because an AP-1 row genuinely IS `(ManagerApproved, ACCOUNT)` — it
 * is simply the wrong form's row. Taking `formCode` here means this function
 * re-derives the WHOLE predicate from data the database actually returned,
 * so no SQL rearrangement can satisfy it without also being correct. See
 * `queue-service-guard.test.ts`'s own docblock for how the two layers now
 * divide the work — that file is the outer, weaker one; this is the one with
 * teeth.
 *
 * The predicate is on the TUPLE, never on the status alone. `ACCOUNT` and
 * `ACCOUNT_FINAL` both sit at `ManagerApproved` (`STATUS_AT_STEP`,
 * `approval-policy.ts`), so a status-only test puts every claim in both queues.
 *
 * An allow-list: an unrecognised status, step or form is out. That is the
 * fail-safe direction, and the same choice `perDiemWritable` and
 * `perdiem-dependency.ts` made for the same reason.
 */
export function belongsInAccountQueue(
  formCode: string,
  status: string,
  stepCode: string | null,
): boolean {
  return formCode === AP4_FORM_CODE && status === "ManagerApproved" && stepCode === "ACCOUNT";
}

/** One row of the accounting queue, as the page renders it. */
export interface ReimburseQueueRow {
  id: number;
  requestNo: string;
  brandCode: string;
  requesterName: string;
  submittedAt: string | null;
  totalAmount: number;
  /** Null until the ACCOUNT step sets one — this queue is where that happens. */
  paymentDate: string | null;
  itemCount: number;
}
