/**
 * Which AP-1 requests a manager has left long enough to be withdrawn for them.
 *
 * A claim that has sat with its manager for over 30 days is not going to be
 * approved by surprise; it is a form nobody is going to action, holding a
 * travel date that blocks the requester from claiming that day again.
 * Cancelling it releases the date and tells the requester where their claim
 * went.
 *
 * ## 30 days, not "a month" (the user, 2026-09-24)
 *
 * It was `DATEADD(MONTH, -1, …)` until then, and a calendar month is not a
 * fixed length: measured backwards from today it is 28, 29, 30 or 31 days
 * depending on the month you are standing in. So the same claim was given a
 * different amount of rope depending on when the sweep happened to look at it.
 * **A fixed 30 days is a day stricter in the long months and two or three days
 * more generous around February** — that is the whole of the behavioural
 * change, and it is the point of it: one number a person can be told.
 *
 * ## The age test lives in SQL, not here, and still deliberately
 *
 * The reason changed with the unit and is worth restating rather than
 * inheriting. It used to be month arithmetic: SQL Server's
 * `DATEADD(MONTH, -1, '2026-03-31')` clamps to 28 February while JavaScript's
 * `setMonth` overflows to 3 March, so a JavaScript pre-filter would have
 * disagreed with the statement on exactly the dates nobody tests. Days do not
 * have that problem — both languages would agree. Two reasons survive it:
 *
 * - **The clock.** `SYSDATETIME()` is the database's, which is the clock
 *   `SubmittedAt` was written with. `Date.now()` is the app server's. They are
 *   the same machine today and nothing guarantees they stay so, and a
 *   disagreement between them lands exactly where an off-by-a-day would.
 * - **The claim.** The age sits in the `WHERE` of the conditional `UPDATE` that
 *   does the cancelling, so the row is claimed by the same statement that
 *   decides it qualifies — the repo's state-transition convention (CLAUDE.md,
 *   "State transitions"). Two sweeps racing therefore cancel it once, not
 *   twice, and send one mail rather than two.
 *
 * The `SELECT` in the sweep is a candidate list only: every id it returns is
 * re-tested by that `UPDATE`, and one since approved, rejected or returned
 * simply claims nothing.
 *
 * What is pure, and tested here, is which `(status, stepCode)` tuple may be
 * touched at all.
 */

/**
 * How long a manager may leave a request before it is withdrawn for them.
 *
 * **Renamed from `AUTO_CANCEL_MONTHS` when the unit changed**, rather than
 * edited from 1 to 30 under the old name: every call site interpolates it into
 * a `DATEADD` and into Thai copy, and `DATEADD(MONTH, -30, …)` would have
 * type-checked, run, and quietly given every request two and a half years.
 * The rename turned all four sites into compile errors.
 */
export const AUTO_CANCEL_DAYS = 30;

export interface AutoCancelCandidate {
  status: string;
  stepCode: string | null;
}

/**
 * Whether this request is one the sweep may cancel, age aside.
 *
 * An **allow-list of exactly one tuple**: submitted, and still on the manager's
 * step. Everything else is somebody's live work — `ManagerApproved` is with
 * accounting, `Returned` is back with the requester and on their clock, a
 * `Draft` never started one. A status this file has never heard of is left
 * alone, which is the safe direction: failing to cancel costs somebody a
 * cleanup, and cancelling wrongly destroys a claim.
 */
export function eligibleForAutoCancel({ status, stepCode }: AutoCancelCandidate): boolean {
  return status === "Submitted" && stepCode === "MANAGER";
}
