/**
 * AP-4 — the decisions the three approvals are made of, and the Thai messages
 * that name them.
 *
 * Deliberately free of any import that reaches a pool: `@/lib/acc/pool` reaches
 * `src/lib/db/mssql.ts`, which reads `@/env` at module scope, so a test that
 * imported `approval-service.ts` for one predicate would fail on "Invalid
 * environment variables" before the first assertion. `./payment-calendar` and
 * `./two-person` are safe to import for the same reason they are testable
 * themselves — neither touches the database at module scope. Everything here is
 * a total function over plain values; `approval-service.ts` is the half that
 * needs a transaction. Same split as `./item-money.ts`; see its header.
 */
import { paymentRoundsInMonth } from "./payment-calendar";
import { canActFinalStep, FINAL_SAME_PERSON_ERROR } from "./two-person";
import type { ReimburseStatus, ReimburseStepCode } from "@/features/reimburse/constants";
import type { ReimburseApproval, ReimburseApprover } from "@/features/reimburse/types";

/* ─────────────────────────── messages ─────────────────────────── */

/** Every rejection carries a reason. The UI disables the button; this is the control. */
export const REJECT_COMMENT_REQUIRED = "กรุณาระบุเหตุผลที่ไม่อนุมัติ";

/** Not on `AccReimburseApprover`, or on it but deactivated. */
export const NOT_ACCOUNT_APPROVER_ERROR =
  "ไม่มีสิทธิ์ — คุณไม่ได้อยู่ในรายชื่อผู้อนุมัติฝ่ายบัญชีของแบบฟอร์ม AP-4";

/** The request moved between the page load and the click. Reload, do not retry. */
export const NOT_AT_STEP_ERROR =
  "คำขอนี้ไม่ได้อยู่ในขั้นตอนที่ดำเนินการได้แล้ว — กรุณาโหลดหน้านี้ใหม่";

export const PAYMENT_DATE_REQUIRED = "กรุณาเลือกวันที่จ่าย";

/** A date the picker would never have offered — see `getReimbursePaymentDates`. */
export const PAYMENT_DATE_NOT_A_ROUND =
  "วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 1 และ 3 ของเดือน)";

/**
 * The `ACCOUNT` row carries no `ActionedByStaffId`, so who took step 2 cannot be
 * established. Distinct from `FINAL_SAME_PERSON_ERROR`, which is a statement
 * about a known person: saying "you are the same person as" when nobody is
 * recorded would be a guess presented as a fact.
 */
export const ACCOUNT_ACTOR_UNKNOWN_ERROR =
  "ไม่พบผู้ตรวจสอบของขั้นบัญชี — ไม่สามารถอนุมัติขั้นสุดท้ายได้ กรุณาติดต่อผู้ดูแลระบบ";

/* ─────────────────────────── what the page is told ─────────────────────────── */

/**
 * What `/api/request/reimburse/requests/[id]/approval-context` answers: whether
 * this viewer may action the step that is pending, and what the accounting check
 * may choose from.
 *
 * It lives here rather than in `@/features/reimburse/types` so the route and the
 * client component can share one declaration — that file is frozen, and this
 * module is already the one that owns the shapes both halves reason about. The
 * component must import it **as a type only**: `./payment-calendar` reaches the
 * holiday lookup through a dynamic import, and a runtime import would drag
 * `@/lib/db/mssql` (and `@/env` with it) into the browser bundle.
 *
 * None of it is a permission. The approve and reject routes recompute every one
 * of these answers server-side before they write; this only decides what is
 * drawn.
 */
export interface ReimburseApprovalContext {
  /** The step awaiting action, or null when the request is finished. */
  step: ReimburseStepCode | null;
  canAct: boolean;
  /** Why not — populated only where silence would read as a bug (see `finalStepRefusal`). */
  reason: string | null;
  /** True when the manager-step dev bypass, not assignment, is what grants it. */
  viaManagerDevBypass: boolean;
  /** Holiday-shifted rounds for the accounting check; empty on the other steps. */
  paymentDates: string[];
  defaultPaymentDate: string | null;
}

/* ─────────────────────────── the state machine ─────────────────────────── */

/** `StepOrder` each step's `AccApproval` row is written at (spec §3.2). */
export const STEP_ORDER: Record<ReimburseStepCode, number> = {
  MANAGER: 1,
  ACCOUNT: 2,
  ACCOUNT_FINAL: 3,
};

/**
 * The `AccRequest.Status` a request must already hold for `step` to be its
 * pending one — the other half of the conditional `UPDATE` that claims a
 * transition, `CurrentStepCode` being the first.
 *
 * `ACCOUNT` and `ACCOUNT_FINAL` share `ManagerApproved` on purpose: AP-4 adds a
 * third *place to be*, not a third status, so `CK_AccRequest_Status` is left
 * alone (spec §3.2.1). `CurrentStepCode` is what tells the two apart, which is
 * why every claim here names both columns and never the status by itself.
 */
export const STATUS_AT_STEP: Record<ReimburseStepCode, ReimburseStatus> = {
  MANAGER: "Submitted",
  ACCOUNT: "ManagerApproved",
  ACCOUNT_FINAL: "ManagerApproved",
};

/** Where an approval at `step` leaves the request (spec §3.2.1). */
export const STATE_AFTER_APPROVE: Record<
  ReimburseStepCode,
  { status: ReimburseStatus; nextStep: ReimburseStepCode | null }
> = {
  MANAGER: { status: "ManagerApproved", nextStep: "ACCOUNT" },
  ACCOUNT: { status: "ManagerApproved", nextStep: "ACCOUNT_FINAL" },
  ACCOUNT_FINAL: { status: "Approved", nextStep: null },
};

export function isReimburseStepCode(value: unknown): value is ReimburseStepCode {
  return value === "MANAGER" || value === "ACCOUNT" || value === "ACCOUNT_FINAL";
}

/** True for the two steps `AccReimburseApprover` answers for (spec §3.2 rows 2 and 3). */
export function isAccountStep(step: ReimburseStepCode): boolean {
  return step === "ACCOUNT" || step === "ACCOUNT_FINAL";
}

/* ─────────────────────────── who may act ─────────────────────────── */

/**
 * The active `AccReimburseApprover` row this actor acts as, or null.
 *
 * StaffId first, login email second: the roster is keyed on StaffId (UNIQUE) and
 * that is the identity the two-person rule compares, but an approver with no
 * `Rocks_Portal_HR.Employee` row of their own would otherwise be unable to act
 * at all — the same fallback `buildAccActor` makes for AP-1. Inactive rows are
 * filtered before either match, so a soft-deleted approver is refused rather
 * than matched and then re-checked.
 *
 * The **row's** StaffId is what the caller should record, not the actor's: when
 * the match came from the email the actor had no StaffId to record, and when it
 * came from the StaffId the two are equal anyway.
 */
export function findActiveApprover(
  roster: readonly ReimburseApprover[],
  actorStaffId: number | null | undefined,
  actorEmail: string | null | undefined,
): ReimburseApprover | null {
  const active = roster.filter((a) => a.isActive);

  if (actorStaffId != null) {
    for (const a of active) {
      if (a.staffId === actorStaffId) return a;
    }
  }

  const email = typeof actorEmail === "string" ? actorEmail.trim().toLowerCase() : "";
  if (!email) return null;
  for (const a of active) {
    if ((a.email ?? "").trim().toLowerCase() === email) return a;
  }
  return null;
}

/**
 * Who took the accounting check, read off the `ACCOUNT` approval row — the
 * input the two-person rule is decided on (spec §3.3).
 *
 * Only an `Approved` row answers. A `Pending` one has no actor yet, and a
 * `Rejected` one ended the request, so neither can be step 2 of a chain that
 * reached step 3.
 */
export function accountCheckActorStaffId(
  approvals: readonly ReimburseApproval[] | null | undefined,
): number | null {
  if (!approvals) return null;
  for (const a of approvals) {
    if (a.stepCode === "ACCOUNT" && a.status === "Approved") {
      return a.actionedByStaffId ?? null;
    }
  }
  return null;
}

/**
 * Why this candidate may not take the final step, or null when they may.
 *
 * `canActFinalStep` is asked first and its answer is final; this only chooses
 * which of two messages explains a refusal. Putting a truthiness test in front
 * of it would deny a legitimate different-person approval whenever either
 * StaffId is 0 — the comparison there is `== null` precisely so that 0 counts as
 * a present id.
 */
export function finalStepRefusal(
  candidateStaffId: number | null | undefined,
  accountStepActorStaffId: number | null | undefined,
): string | null {
  if (canActFinalStep(candidateStaffId, accountStepActorStaffId)) return null;
  if (candidateStaffId == null || accountStepActorStaffId == null) {
    return ACCOUNT_ACTOR_UNKNOWN_ERROR;
  }
  return FINAL_SAME_PERSON_ERROR;
}

/* ─────────────────────────── inputs off the wire ─────────────────────────── */

/** The rejection reason, or the message refusing an absent one. Never both. */
export function rejectCommentOrError(
  raw: unknown,
): { comment: string; error: null } | { comment: null; error: string } {
  const comment = typeof raw === "string" ? raw.trim() : "";
  if (!comment) return { comment: null, error: REJECT_COMMENT_REQUIRED };
  return { comment, error: null };
}

/** `YYYY-MM-DD`, and a real calendar day — `2026-02-31` is neither. */
export function isYmd(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month0 < 0 || month0 > 11 || day < 1 || day > 31) return false;
  const d = new Date(year, month0, day);
  return d.getFullYear() === year && d.getMonth() === month0 && d.getDate() === day;
}

/**
 * Which of `validDates` a posted payment date is, or the message refusing it.
 *
 * The picker is not the authority — this is (spec §3.4, "The picker accepts
 * nothing else"). `validDates` must be the output of `getReimbursePaymentDates`,
 * which is already holiday-shifted, so an exact string match is the whole test.
 */
export function paymentDateError(raw: unknown, validDates: readonly string[]): string | null {
  if (!isYmd(raw)) return PAYMENT_DATE_REQUIRED;
  return validDates.indexOf(raw) >= 0 ? null : PAYMENT_DATE_NOT_A_ROUND;
}

/* ─────────────────────────── the default round ─────────────────────────── */

/**
 * Every unshifted 1st/3rd-Friday round from `from`'s month through `months`
 * later, **sorted ascending**.
 *
 * The sort is not decoration. `defaultPaymentRound` walks the array and returns
 * the first round still in time, which is only the *earliest* such round if the
 * array is in ascending order — a documented assumption that function does not
 * enforce (raised in Task 2's review and carried forward deliberately). The loop
 * below happens to build them in order today; the sort is what makes that a
 * guarantee rather than an accident of two nested loops.
 *
 * Unshifted on purpose: holiday shifting happens *after* a round is chosen, so
 * a shifted date never changes which round the cut-off math is talking about.
 */
export function upcomingPaymentRounds(from: Date, months = 4): Date[] {
  const out: Date[] = [];
  for (let m = 0; m <= months; m++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + m, 1);
    for (const round of paymentRoundsInMonth(anchor.getFullYear(), anchor.getMonth())) {
      out.push(round);
    }
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}
