/**
 * Which AP-1 requests a manager has left long enough to be withdrawn for them.
 *
 * A claim that has sat with its manager for over a month is not going to be
 * approved by surprise; it is a form nobody is going to action, holding a
 * travel date that blocks the requester from claiming that day again.
 * Cancelling it releases the date and tells the requester where their claim
 * went.
 *
 * **The age test lives in SQL, not here, and deliberately.** The cancel is a
 * conditional `UPDATE ... WHERE SubmittedAt < DATEADD(MONTH, -1, SYSDATETIME())`,
 * which is what actually decides — so a second implementation in JavaScript
 * would be a copy that can drift, and month arithmetic is exactly where it
 * would: SQL Server's `DATEADD(MONTH, -1, '2026-03-31')` clamps to 28 February,
 * while JavaScript's `setMonth` overflows to 3 March. One expression, in the
 * statement that does the work.
 *
 * What is pure, and tested here, is which `(status, stepCode)` tuple may be
 * touched at all.
 */

/** How long a manager may leave a request before it is withdrawn for them. */
export const AUTO_CANCEL_MONTHS = 1;

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
