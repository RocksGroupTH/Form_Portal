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

/** `TotalAmount` etc. arrive from `mssql` typed loosely; coerce rather than trust. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Date column → YYYY-MM-DD using local getters — the server runs Thai wall time. */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Turns `queue-service.ts`'s raw recordset into `ReimburseQueueRow[]` — the
 * WHOLE mapping loop: the row-level `belongsInAccountQueue` gate and the
 * column coercion that follows it.
 *
 * Lives here rather than inline in `queue-service.ts`, mirroring
 * `accumulateErpQueueRows` in `./erp-queue-policy.ts` — read that function's
 * own section header first, since the reason is identical: `queue-service.ts`
 * imports `getAccPool`, which reaches `@/lib/db/mssql` → `@/env`, and `@/env`
 * validates the whole environment AT IMPORT, so nothing that imports that file
 * can be exercised with a plain array on a machine with no database
 * configured. The loop used to live there with no behavioural coverage at
 * all — only the source-shape regexes in `queue-service-guard.test.ts`, which
 * a review round showed cannot see every lie a caller can tell it (below).
 *
 * `formCode`, `status` AND `stepCode` are all read off each raw row
 * (`x.FormCode`, `x.Status`, `x.CurrentStepCode`) rather than assumed. A
 * review round found `queue-service.ts`'s old inline loop rebound `status` and
 * `stepCode` to the literals `"ManagerApproved"` / `"ACCOUNT"` — a rewrite
 * that reads `x.FormCode` (satisfying every source-shape check that existed at
 * the time) while making `belongsInAccountQueue`'s answer tautological for
 * every row a widened WHERE clause returns, exactly the class of hole
 * `erp-queue-policy.ts`'s own docblock records for its sibling queue.
 * `queue-service.test.ts` hands this function rows shaped exactly like that
 * exploit, mirroring `erp-queue-service.test.ts`.
 */
export function accumulateAccountQueueRows(
  recordset: readonly Record<string, unknown>[],
): ReimburseQueueRow[] {
  const rows: ReimburseQueueRow[] = [];
  for (const x of recordset) {
    const formCode = (x.FormCode as string | null) ?? "";
    const status = (x.Status as string | null) ?? "";
    const stepCode = (x.CurrentStepCode as string | null) ?? null;
    if (!belongsInAccountQueue(formCode, status, stepCode)) continue;
    rows.push({
      id: x.Id as number,
      requestNo: (x.RequestNo as string | null) ?? "",
      brandCode: (x.BrandCode as string | null) ?? "",
      requesterName: (x.RequesterFullName as string | null) ?? "",
      submittedAt: x.SubmittedAt ? (x.SubmittedAt as Date).toISOString() : null,
      totalAmount: num(x.TotalAmount),
      paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
      itemCount: num(x.ItemCount),
    });
  }
  return rows;
}
