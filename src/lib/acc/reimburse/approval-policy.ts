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
/**
 * Every return carries what has to change — the same control, applied to the
 * action whose entire purpose is telling the requester what to fix.
 *
 * A message of its own rather than sharing the rejection's: the two dialogs ask
 * for different things, and "กรุณาระบุเหตุผลที่ไม่อนุมัติ" on a return names an
 * outcome that is not happening. The wording is AP-1's — `returnForEdit`
 * refuses an empty comment with exactly this.
 */
export const RETURN_COMMENT_REQUIRED = "กรุณาระบุสิ่งที่ต้องแก้ไข";


/** Not on `AccReimburseApprover`, or on it but deactivated. */
export const NOT_ACCOUNT_APPROVER_ERROR =
  "ไม่มีสิทธิ์ — คุณไม่ได้อยู่ในรายชื่อผู้อนุมัติฝ่ายบัญชีของแบบฟอร์ม AP-4";

/** The request moved between the page load and the click. Reload, do not retry. */
export const NOT_AT_STEP_ERROR =
  "คำขอนี้ไม่ได้อยู่ในขั้นตอนที่ดำเนินการได้แล้ว — กรุณาโหลดหน้านี้ใหม่";

/**
 * The body carried no usable step token. A malformed request, not a stale one —
 * so it is 400 and says something different from `NOT_AT_STEP_ERROR`, which
 * tells the user to reload and would be a lie here.
 */
export const STEP_TOKEN_REQUIRED =
  "คำขอไม่ถูกต้อง — ไม่ได้ระบุขั้นตอนที่ต้องการดำเนินการ";

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
  /**
   * The requester's own withdrawal window (spec §5.3), or null for a viewer who
   * did not file this request.
   *
   * Answered here rather than worked out in the browser because the deadline is
   * a statement about the **server's** clock, and because AP-1's detail page
   * does the opposite — `Date.now() - new Date(submittedAt) <= 24 * 3600 * 1000`
   * is a second copy of the rule, evaluated against whatever time the viewer's
   * machine believes it is. `reason` is populated only when `allowed` is false
   * and there is something useful to say.
   */
  selfCancel: ReimburseSelfCancelInfo | null;
}

/** What the page needs to draw the withdrawal bar, and nothing more. */
export interface ReimburseSelfCancelInfo {
  allowed: boolean;
  /** ISO, serialised like every other timestamp the API returns. Null when never submitted. */
  until: string | null;
  reason: string | null;
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

/**
 * Whether the step the client acted on is still the step the record is at.
 *
 * This is **not** trusting a client-named step: the route still dispatches on
 * the record's own `CurrentStepCode`, and `claimStep` still claims it inside the
 * transaction. What the posted value adds is the one thing neither of those can
 * supply — `claimStep` claims the state the record *is in*, never the state the
 * actor *saw*, so a durable staleness is invisible to it.
 *
 * The failure it closes: AP-4's manager approval mails the whole active approver
 * pool, so two approvers holding the same request open at `ACCOUNT` is the
 * designed flow, and the detail page fetches on mount and on demand only — no
 * polling, no focus revalidation. B performs the accounting check; the record
 * moves to `ACCOUNT_FINAL`. A's tab still shows the check bar. A clicks it,
 * confirms a payment date, and the route dispatches on the *current* step —
 * taking the final approval that authorises payment. A is entitled to it and the
 * audit row names A truthfully; what is missing is A's consent to that step. A's
 * payment date is discarded unread and the toast tells A they recorded a check.
 *
 * Answered as an optimistic-concurrency token: 409 on mismatch, before anything
 * is dispatched and before anything is written.
 */
export function stepTokenRefusal(
  postedStep: unknown,
  currentStep: unknown,
): { error: string; status: 400 | 409 } | null {
  if (!isReimburseStepCode(postedStep)) {
    return { error: STEP_TOKEN_REQUIRED, status: 400 };
  }
  if (postedStep !== currentStep) {
    return { error: NOT_AT_STEP_ERROR, status: 409 };
  }
  return null;
}

/** A trimmed, non-empty comment, or the given message refusing it. Never both. */
function commentOrError(
  raw: unknown,
  missing: string,
): { comment: string; error: null } | { comment: null; error: string } {
  const comment = typeof raw === "string" ? raw.trim() : "";
  if (!comment) return { comment: null, error: missing };
  return { comment, error: null };
}

/** The rejection reason, or the message refusing an absent one. Never both. */
export function rejectCommentOrError(
  raw: unknown,
): { comment: string; error: null } | { comment: null; error: string } {
  return commentOrError(raw, REJECT_COMMENT_REQUIRED);
}

/**
 * What the requester has to change, or the message refusing an absent one.
 *
 * Same shape and same control as `rejectCommentOrError`, for a stronger reason:
 * a rejection at least tells the requester the claim is over, while a return
 * with no note puts the request back in their hands saying nothing about why it
 * came back — and a return exists only to say that.
 */
export function returnCommentOrError(
  raw: unknown,
): { comment: string; error: null } | { comment: null; error: string } {
  return commentOrError(raw, RETURN_COMMENT_REQUIRED);
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
/* ─────────────────────────── the requester's own cancel ─────────────────────────── */

/**
 * How long after submitting a requester may still take their own claim back
 * (spec §5.3), matching AP-1's `cancelByRequester`.
 *
 * Declared once, and both halves of the rule read it: the Thai message below
 * interpolates it, and `claimSelfCancel` passes it to `DATEADD(HOUR, -@hours,
 * SYSDATETIME())`. Changing the window here changes what the database enforces
 * and what the page says, together.
 */
export const SELF_CANCEL_WINDOW_HOURS = 24;

/** Somebody else's claim. Only the person who filed it may withdraw it. */
export const CANCEL_NOT_REQUESTER_ERROR = "ยกเลิกได้เฉพาะผู้ที่ยื่นคำขอนี้เท่านั้น";

/**
 * The manager has already acted, or the request was never waiting for them.
 * Names the remedy, because at this point there is one and it is not waiting:
 * an approver can still send the request back for edit.
 */
export const CANCEL_NOT_PENDING_MANAGER_ERROR =
  "ยกเลิกไม่ได้ — คำขอนี้ไม่ได้อยู่ระหว่างรอผู้จัดการอนุมัติแล้ว หากต้องการแก้ไข กรุณาขอให้ผู้อนุมัติส่งกลับแก้ไข";

/**
 * Inside the chain, past the window. A different remedy from the one above —
 * here the manager still holds the request and can return it — so a different
 * message, and neither of them is the bare "ยกเลิกไม่ได้" that leaves the
 * requester unable to tell waiting from asking.
 */
export const CANCEL_WINDOW_EXPIRED_ERROR =
  `ยกเลิกไม่ได้ — เกิน ${SELF_CANCEL_WINDOW_HOURS} ชั่วโมงนับจากเวลาที่ส่งคำขอ ` +
  "กรุณาขอให้ผู้จัดการส่งกลับแก้ไขหรือไม่อนุมัติ";

export type SelfCancelRefusalReason = "not_requester" | "not_pending_manager" | "window_expired";

/**
 * Everything the self-cancel rule is decided on. Every field is read from the
 * database, `now` included — see below.
 */
export interface SelfCancelState {
  /** `AccRequest.CreatedBy` is this actor. AP-4 has no on-behalf submission. */
  isRequester: boolean;
  status: string | null | undefined;
  currentStepCode: string | null | undefined;
  submittedAt: Date | string | null | undefined;
  /**
   * `SYSDATETIME()`, read in the same query as `submittedAt` — **not**
   * `new Date()`.
   *
   * `SubmittedAt` is written by `SYSDATETIME()` and comes back through the
   * driver's own date handling; a `Date.now()` taken in this process is a
   * different clock read through none of it, and the two are comparable only by
   * accident of configuration. Taking both from the same `SELECT` makes the
   * subtraction below exact whatever that handling does, because whatever it
   * does it does to both.
   */
  now: Date;
}

/** A `Date` from either of the two shapes a timestamp reaches this module in, or null. */
function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * The instant the self-cancel window shuts, or null when there is no submit to
 * measure from.
 *
 * The one piece of arithmetic in the rule, so the page can print the deadline
 * without owning a second copy of it — `approval-context` computes this and the
 * detail page renders what it is given.
 */
export function selfCancelDeadline(submittedAt: Date | string | null | undefined): Date | null {
  const from = asDate(submittedAt);
  if (!from) return null;
  return new Date(from.getTime() + SELF_CANCEL_WINDOW_HOURS * 3600 * 1000);
}

/**
 * Why this actor may not withdraw this request, or null when they may.
 *
 * Three reasons, told apart on purpose: one of them is fixed by nothing, one by
 * asking an approver, and one by neither. The claim in `approval-service.ts`
 * enforces the same three conditions in a single conditional `UPDATE` — this is
 * what turns the resulting zero row count into a sentence.
 *
 * The window is inclusive at its far end: exactly `SELF_CANCEL_WINDOW_HOURS`
 * after the submit is still inside it, one millisecond later is not.
 */
export function selfCancelRefusal(
  state: SelfCancelState,
): { reason: SelfCancelRefusalReason; error: string } | null {
  if (!state.isRequester) {
    return { reason: "not_requester", error: CANCEL_NOT_REQUESTER_ERROR };
  }
  if (state.status !== "Submitted" || state.currentStepCode !== "MANAGER") {
    return { reason: "not_pending_manager", error: CANCEL_NOT_PENDING_MANAGER_ERROR };
  }
  const deadline = selfCancelDeadline(state.submittedAt);
  // No `SubmittedAt` on a request that says it is `Submitted` is a broken row,
  // not an open window: refuse rather than treat "cannot tell" as "in time".
  if (!deadline || state.now.getTime() > deadline.getTime()) {
    return { reason: "window_expired", error: CANCEL_WINDOW_EXPIRED_ERROR };
  }
  return null;
}

