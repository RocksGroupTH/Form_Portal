/**
 * Which claims the accounting queue shows.
 *
 * Pure and import-free so it is unit-tested with no database — `@/env`
 * validates the whole environment at import time, so anything reachable from a
 * pool drags a live configuration into the test run.
 *
 * The predicate is on the TUPLE, never on the status alone. `ACCOUNT` and
 * `ACCOUNT_FINAL` both sit at `ManagerApproved` (`STATUS_AT_STEP`,
 * `approval-policy.ts`), so a status-only test puts every claim in both queues.
 *
 * An allow-list: an unrecognised status is out. That is the fail-safe
 * direction, and the same choice `perDiemWritable` and
 * `perdiem-dependency.ts` made for the same reason.
 */
export function belongsInAccountQueue(status: string, stepCode: string | null): boolean {
  return status === "ManagerApproved" && stepCode === "ACCOUNT";
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
