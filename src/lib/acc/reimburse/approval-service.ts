/**
 * AP-4 — the three approvals: the line manager, the accounting check that fixes
 * the payment date, and the final accounting approval by a second person.
 *
 * Modelled on `src/lib/acc/approval-engine.ts` (AP-1), and the same three
 * properties are load-bearing here:
 *
 * 1. **Every transition is claimed, never read-then-written.** Each action opens
 *    with one conditional `UPDATE … WHERE Id=@id AND FormCode='AP-4' AND
 *    CurrentStepCode=<expected> AND Status=<expected>` and checks the row count.
 *    Two approvers clicking at the same instant produce one action and one 409:
 *    the second `UPDATE` matches nothing, because the first already moved the
 *    step. Nothing is written and no mail is queued on the losing path.
 * 2. **The claim names `CurrentStepCode` as well as `Status`.** AP-4's two
 *    accounting steps both sit at `ManagerApproved` (spec §3.2.1 — a third place
 *    to be, not a third status), so a claim on the status alone would let the
 *    final approval be taken while the check is still pending.
 * 3. **Mail is queued after the commit, never inside it.** A rolled-back
 *    transaction that had already inserted an `AccEmailQueue` row would still
 *    have told somebody the request had moved.
 *
 * The decisions themselves — who may act, what a valid payment date is, which
 * status belongs to which step — are in `./approval-policy.ts`, which imports
 * nothing that reaches a pool and is unit-tested. This module is the half that
 * needs a transaction.
 *
 * Authorization is enforced **here**, not only in the routes: the routes check
 * the manager step (they hold the `Host` the dev bypass reads), and everything
 * else — the approver pool, the two-person rule, the payment date — is asserted
 * inside the same transaction that writes, so no caller can reach a weaker rule
 * by taking a different path.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { getHolidaySet, shiftPaymentDay, ymd } from "@/lib/acc/payment-calendar";
import { queueEmail } from "@/lib/acc/email-queue";
import { esc } from "@/lib/acc/email-templates";
import { AccConflictError, AccForbiddenError } from "@/lib/acc/request-errors";
import { env } from "@/env";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";
import { defaultPaymentRound, getReimbursePaymentDates } from "./payment-calendar";
import { getReimburseRequest } from "./request-service";
import { listReimburseApprovers } from "./settings-service";
import {
  NOT_ACCOUNT_APPROVER_ERROR,
  NOT_AT_STEP_ERROR,
  PAYMENT_DATE_NOT_A_ROUND,
  SELF_CANCEL_WINDOW_HOURS,
  STATE_AFTER_APPROVE,
  STATUS_AT_STEP,
  STEP_ORDER,
  finalStepRefusal,
  findActiveApprover,
  isAccountStep,
  paymentDateError,
  rejectCommentOrError,
  returnCommentOrError,
  selfCancelDeadline,
  selfCancelRefusal,
  upcomingPaymentRounds,
} from "./approval-policy";
import type { ReimburseSelfCancelInfo, SelfCancelState } from "./approval-policy";
import type { ReimburseStepCode } from "@/features/reimburse/constants";
import type { ReimburseApprover, ReimburseDetail } from "@/features/reimburse/types";

/* ─────────────────────────── the actor ─────────────────────────── */

/**
 * Who is acting. Same three fields as AP-1's `Actor` and built by the same
 * `buildAccActor`, minus `onBehalfOfManagerStaffId`: AP-4 follows AP-1 rather
 * than AP-17 on the manager step, so there is no admin-on-behalf path to record.
 */
export interface ReimburseActor {
  userId: number;
  email: string | null;
  staffId: number | null;
}

/** The active `AccReimburseApprover` row this actor acts as, or null. */
export async function resolveReimburseApprover(
  actor: ReimburseActor,
): Promise<ReimburseApprover | null> {
  const roster = await listReimburseApprovers();
  return findActiveApprover(roster, actor.staffId, actor.email);
}

/**
 * The StaffId to record for an accounting action, or a 403.
 *
 * The roster row's StaffId, not the actor's: they are equal when the match came
 * from the StaffId, and when it came from the login email the actor had no
 * StaffId of their own to record. Recording the roster's keeps the value the
 * two-person rule compares consistent across steps 2 and 3.
 */
async function requireApproverStaffId(actor: ReimburseActor): Promise<number> {
  const approver = await resolveReimburseApprover(actor);
  if (!approver) throw new AccForbiddenError(NOT_ACCOUNT_APPROVER_ERROR);
  return approver.staffId;
}

/** AP-1's rule, restated for AP-4: an approval row must name a real person. */
function requireActorStaffId(actor: ReimburseActor): number {
  if (actor.staffId == null) {
    throw new Error("ไม่พบ StaffId ในระบบ HR — ไม่สามารถดำเนินการได้");
  }
  return actor.staffId;
}

/* ─────────────────────────── the payment rounds ─────────────────────────── */

/**
 * The dates the accounting check may choose from, and the one it opens on.
 *
 * `dates` are holiday-shifted and ascending — what the picker offers and what
 * `paymentDateError` validates against. `defaultDate` is the round
 * `defaultPaymentRound` picks for `from` (spec §3.4: the first round whose own
 * week's Monday noon has not passed), mapped through the same shift so the
 * default is always one of `dates` rather than a date beside one.
 *
 * The rounds are shifted here rather than being taken from `dates` by position:
 * `getReimbursePaymentDates` drops a round whose shifted date has already
 * passed, so the two lists do not line up index for index.
 */
export async function getReimbursePaymentOptions(
  from: Date = new Date(),
  months = 4,
): Promise<{ dates: string[]; defaultDate: string | null }> {
  const dates = await getReimbursePaymentDates(from, months);
  if (dates.length === 0) return { dates, defaultDate: null };

  const round = defaultPaymentRound(from, upcomingPaymentRounds(from, months));
  if (!round) return { dates, defaultDate: null };

  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(from.getFullYear(), from.getMonth() + months + 1, 0);
  const holidays = await getHolidaySet(start, end);
  const shifted = ymd(shiftPaymentDay(round, holidays));

  // Only offer it if it survived the same filter `dates` went through.
  return { dates, defaultDate: dates.indexOf(shifted) >= 0 ? shifted : null };
}

/* ─────────────────────────── mail ─────────────────────────── */

function row(label: string, value: unknown): string {
  return `<tr><td style="padding:4px 8px;color:#666">${esc(label)}</td><td style="padding:4px 8px">${esc(value)}</td></tr>`;
}

/**
 * One small template for every AP-4 transition.
 *
 * Not `@/lib/acc/email-templates`'s `buildEmail`, for the reason
 * `request-service.ts` gives at its own builder: that function is typed against
 * AP-1's request shape and reads `req.travel`. Its `esc()` is reused here, so
 * the XSS-safety is shared even though the layout is not.
 */
function buildReimburseEmail(
  req: ReimburseDetail,
  headline: string,
  note?: string | null,
): { subject: string; html: string } {
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/reimburse/${req.id}`;
  const subject = `${headline} — ขอเบิกเงินคืนพนักงาน ${req.requestNo ?? ""}`.trim();
  const rows = [
    row("เลขที่", req.requestNo ?? "-"),
    row("ผู้ขอ", req.requesterFullName ?? "-"),
    row("แบรนด์", req.brandCode ?? "-"),
    row("ยอดรวม (บาท)", req.totalAmount ?? "-"),
    req.paymentDate ? row("วันที่จ่าย", req.paymentDate) : "",
  ].join("");
  const noteHtml = note?.trim()
    ? `<p style="margin:12px 0;padding:10px;background:#f5f5f5;border-left:4px solid #999;white-space:pre-wrap">${esc(note.trim())}</p>`
    : "";
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#A3121B">${esc(subject)}</h2>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${noteHtml}
    <p style="margin-top:16px"><a href="${esc(url)}"
      style="background:#A3121B;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดเอกสาร</a></p>
  </div>`;
  return { subject, html };
}

/**
 * Queue one message. Never inside a transaction — see the file header.
 *
 * `queueEmail` writes to `AccEmailQueue` in whichever database this form
 * resolved to, and the drain applies the UAT redirect and the tester exemption;
 * nothing here needs to know how (CLAUDE.md, "Parallel Production and UAT").
 */
async function notify(
  req: ReimburseDetail,
  toEmail: string | null | undefined,
  trigger: string,
  headline: string,
  note?: string | null,
): Promise<void> {
  if (!toEmail?.trim()) return;
  const mail = buildReimburseEmail(req, headline, note);
  await queueEmail({
    requestId: req.id,
    toEmail: toEmail.trim(),
    subject: mail.subject,
    bodyHtml: mail.html,
    triggerType: trigger,
  });
}

/**
 * A queued notification that can never fail the action that queued it.
 *
 * These calls sit after the commit. Left unguarded, a failed `AccEmailQueue`
 * write propagates out of an approval that has already happened:
 * `statusForAccError` maps the unrecognised error to 400 — the client's
 * retryable phase — and the retry then gets the 409 the claim rightly answers
 * with, so the user is told their approval failed and then told it is stale.
 * Per call rather than per action, so one unreachable recipient does not cost
 * the others their mail.
 */
async function notifyQuietly(
  req: ReimburseDetail,
  toEmail: string | null | undefined,
  trigger: string,
  headline: string,
  note?: string | null,
): Promise<void> {
  try {
    await notify(req, toEmail, trigger, headline, note);
  } catch (e) {
    console.error(
      `[acc/reimburse/approval] queueing "${trigger}" mail for request ${req.id} failed`,
      e,
    );
  }
}

/**
 * Everything after the commit, with the same guarantee: the reads it needs
 * (`getReimburseRequest`, the approver roster) are post-commit too, and a
 * failure in one of those must not report the committed approval as failed
 * either.
 */
async function afterCommit(
  requestId: number,
  fn: (req: ReimburseDetail) => Promise<void>,
): Promise<void> {
  try {
    const updated = await getReimburseRequest(requestId);
    if (!updated) return;
    await fn(updated);
  } catch (e) {
    console.error(
      `[acc/reimburse/approval] post-commit notification for request ${requestId} failed`,
      e,
    );
  }
}

/** Every active approver's address, optionally minus the person who just acted. */
async function approverEmails(exceptStaffId?: number | null): Promise<string[]> {
  const roster = await listReimburseApprovers();
  const out: string[] = [];
  for (const a of roster) {
    if (!a.isActive) continue;
    if (exceptStaffId != null && a.staffId === exceptStaffId) continue;
    if (a.email?.trim()) out.push(a.email.trim());
  }
  return out;
}

/* ─────────────────────────── shared transaction shape ─────────────────────────── */

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
type AccTx = ReturnType<AccPool["transaction"]>;

async function inTransaction<T>(fn: (tx: AccTx) => Promise<T>): Promise<T> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/**
 * Claim the request at `step`, moving it to `nextStatus` / `nextStep`.
 *
 * The whole concurrency story is this one statement. `FormCode` is in the
 * predicate as well as the step and status: `AccRequest` holds every form, and
 * an AP-1 id reaching here must move nothing.
 */
async function claimStep(
  tx: AccTx,
  requestId: number,
  step: ReimburseStepCode,
  next: { status: string; stepCode: ReimburseStepCode | null; paymentDate?: string | null },
): Promise<void> {
  const req = tx
    .request()
    .input("id", sql.Int, requestId)
    .input("form", sql.NVarChar, AP4_FORM_CODE)
    .input("step", sql.NVarChar, step)
    .input("status", sql.NVarChar, STATUS_AT_STEP[step])
    .input("nextStatus", sql.NVarChar, next.status)
    .input("nextStep", sql.NVarChar, next.stepCode);

  let paymentSet = "";
  if (next.paymentDate !== undefined) {
    req.input("pd", sql.Date, next.paymentDate);
    paymentSet = ", PaymentDate=@pd";
  }

  const res = await req.query(
    `UPDATE [dbo].[AccRequest]
     SET Status=@nextStatus, CurrentStepCode=@nextStep${paymentSet}, UpdatedAt=SYSDATETIME()
     WHERE Id=@id AND FormCode=@form AND CurrentStepCode=@step AND Status=@status`,
  );
  if (res.rowsAffected[0] !== 1) throw new AccConflictError(NOT_AT_STEP_ERROR);
}

/**
 * Close the pending `AccApproval` row for `step`.
 *
 * Also claimed. The request-level claim above already serialises the action, so
 * a zero here means the two tables disagree — an approval recorded against no
 * row, or a second row for the same step — and rolling back is the only honest
 * answer.
 */
async function closeApprovalRow(
  tx: AccTx,
  requestId: number,
  step: ReimburseStepCode,
  outcome: "Approved" | "Rejected" | "Returned",
  actorStaffId: number,
  actorEmail: string | null,
  comment: string | null,
  isChecked: boolean,
): Promise<void> {
  const res = await tx
    .request()
    .input("rid", sql.Int, requestId)
    .input("step", sql.NVarChar, step)
    .input("outcome", sql.NVarChar, outcome)
    .input("staff", sql.Int, actorStaffId)
    .input("email", sql.NVarChar, actorEmail)
    .input("comment", sql.NVarChar(2000), comment)
    .input("checked", sql.Bit, isChecked ? 1 : null)
    .query(
      `UPDATE [dbo].[AccApproval]
       SET Status=@outcome,
           Comment=CASE WHEN @comment IS NOT NULL THEN @comment ELSE Comment END,
           IsChecked=CASE WHEN @checked IS NOT NULL THEN @checked ELSE IsChecked END,
           ActionedByStaffId=@staff,
           AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END,
           ActionedAt=SYSDATETIME()
       WHERE RequestId=@rid AND StepCode=@step AND Status='Pending'`,
    );
  if (res.rowsAffected[0] !== 1) throw new AccConflictError(NOT_AT_STEP_ERROR);
}

/** Open the next step's row. One row per step, unassigned — any active approver may take it. */
async function openApprovalRow(
  tx: AccTx,
  requestId: number,
  step: ReimburseStepCode,
): Promise<void> {
  await tx
    .request()
    .input("rid", sql.Int, requestId)
    .input("step", sql.NVarChar, step)
    .input("order", sql.Int, STEP_ORDER[step])
    .query(
      `INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedEmail, Status)
       VALUES (@rid, @step, @order, NULL, 'Pending')`,
    );
}

async function logActivity(
  tx: AccTx,
  requestId: number,
  authorId: number,
  action: string,
  note?: string | null,
): Promise<void> {
  await tx
    .request()
    .input("rid", sql.Int, requestId)
    .input("by", sql.Int, authorId || null)
    .input("action", sql.NVarChar(50), action)
    .input("note", sql.NVarChar(2000), note ?? null)
    .query(
      `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
       VALUES (@rid, @by, @action, @note)`,
    );
}

/* ─────────────────────────── step 1 — the manager ─────────────────────────── */

/**
 * The line manager approves: `Submitted`/`MANAGER` → `ManagerApproved`/`ACCOUNT`,
 * and the `ACCOUNT` row opens at `StepOrder` 2.
 *
 * The caller has already established that this actor is the assigned manager
 * (`canActManagerApi`) — that check needs the request's `Host` for the dev
 * bypass, which a service has no access to. What is asserted here is the state.
 */
export async function approveReimburseManager(
  requestId: number,
  actor: ReimburseActor,
): Promise<void> {
  const staffId = requireActorStaffId(actor);
  const after = STATE_AFTER_APPROVE.MANAGER;

  await inTransaction(async (tx) => {
    await claimStep(tx, requestId, "MANAGER", { status: after.status, stepCode: after.nextStep });
    await closeApprovalRow(tx, requestId, "MANAGER", "Approved", staffId, actor.email, null, false);
    await openApprovalRow(tx, requestId, "ACCOUNT");
    await logActivity(tx, requestId, actor.userId, "manager_approved");
  });

  await afterCommit(requestId, async (updated) => {
    for (const email of await approverEmails()) {
      await notifyQuietly(updated, email, "ManagerApproved", "รอฝ่ายบัญชีตรวจสอบ");
    }
  });
}

/* ─────────────────────────── step 2 — the accounting check ─────────────────────────── */

/**
 * Accounting checks the claim and fixes the payment date:
 * `ManagerApproved`/`ACCOUNT` → `ManagerApproved`/`ACCOUNT_FINAL`, and the
 * `ACCOUNT_FINAL` row opens at `StepOrder` 3.
 *
 * The status deliberately does not move — see `STATUS_AT_STEP`.
 *
 * `paymentDate` is validated against `getReimbursePaymentDates` before anything
 * is written: the picker offers only valid rounds, but the picker is a
 * suggestion the client can ignore and this is the authority. `IsChecked` is set
 * on the row rather than being demanded as a separate flag the way AP-1 does —
 * for AP-4 the check *is* this action, so a second boolean saying it happened
 * could only ever disagree with the row it sits on.
 */
export async function approveReimburseAccountCheck(
  requestId: number,
  actor: ReimburseActor,
  paymentDate: unknown,
): Promise<void> {
  const staffId = await requireApproverStaffId(actor);

  const validDates = await getReimbursePaymentDates();
  const dateError = paymentDateError(paymentDate, validDates);
  if (dateError) {
    // The round list is a moving target: `getReimbursePaymentDates` drops a
    // round once its own cut-off has passed, so a dialog left open across
    // midnight offers a date that is no longer offered. That is staleness — the
    // same date can never become valid again — and 400 is the client's
    // retryable phase, which would invite a retry that cannot succeed. A missing
    // or malformed date is a genuine bad request and keeps its 400.
    if (dateError === PAYMENT_DATE_NOT_A_ROUND) throw new AccConflictError(dateError);
    throw new Error(dateError);
  }
  const chosen = paymentDate as string;

  const after = STATE_AFTER_APPROVE.ACCOUNT;
  await inTransaction(async (tx) => {
    await claimStep(tx, requestId, "ACCOUNT", {
      status: after.status,
      stepCode: after.nextStep,
      paymentDate: chosen,
    });
    await closeApprovalRow(tx, requestId, "ACCOUNT", "Approved", staffId, actor.email, null, true);
    await openApprovalRow(tx, requestId, "ACCOUNT_FINAL");
    await logActivity(tx, requestId, actor.userId, "account_checked", chosen);
  });

  await afterCommit(requestId, async (updated) => {
    // Everyone in the pool except the person who just checked — they are the one
    // person the two-person rule will refuse at the final step.
    for (const email of await approverEmails(staffId)) {
      await notifyQuietly(updated, email, "AccountChecked", "รออนุมัติขั้นสุดท้าย (บัญชี)");
    }
  });
}

/* ─────────────────────────── step 3 — the final approval ─────────────────────────── */

/**
 * The second accountant approves: `ManagerApproved`/`ACCOUNT_FINAL` →
 * `Approved`/`NULL`. This is the transition that decides the company pays.
 *
 * The two-person rule is evaluated **inside the transaction**, against the
 * `ACCOUNT` row's `ActionedByStaffId` read there, and before the claim — so a
 * refusal has written nothing, and the value it compares cannot have been
 * changed by a concurrent action between the read and the write.
 */
export async function approveReimburseFinal(
  requestId: number,
  actor: ReimburseActor,
): Promise<void> {
  const staffId = await requireApproverStaffId(actor);
  const after = STATE_AFTER_APPROVE.ACCOUNT_FINAL;

  await inTransaction(async (tx) => {
    await assertMayTakeFinalStep(tx, requestId, staffId);
    await claimStep(tx, requestId, "ACCOUNT_FINAL", {
      status: after.status,
      stepCode: after.nextStep,
    });
    await closeApprovalRow(
      tx, requestId, "ACCOUNT_FINAL", "Approved", staffId, actor.email, null, false,
    );
    await logActivity(tx, requestId, actor.userId, "account_final_approved");
  });

  await afterCommit(requestId, async (updated) => {
    await notifyQuietly(updated, updated.requesterEmail, "Approved", "อนุมัติแล้ว");
    await notifyQuietly(updated, updated.managerEmail, "Approved", "อนุมัติแล้ว");
  });
}

/**
 * Throws `AccForbiddenError` naming the reason when this actor may not take
 * step 3.
 *
 * The step-2 actor is read from the approved `ACCOUNT` row — the same fact
 * `accountCheckActorStaffId` reads off a loaded request for the UI, restated as
 * a predicate the database evaluates so the authoritative copy is the one inside
 * this transaction. `?? null` rather than `|| null`: StaffId 0 is a present id
 * (see `canActFinalStep`).
 */
async function assertMayTakeFinalStep(
  tx: AccTx,
  requestId: number,
  candidateStaffId: number,
): Promise<void> {
  const res = await tx
    .request()
    .input("rid", sql.Int, requestId)
    .query(
      `SELECT TOP 1 ActionedByStaffId
       FROM [dbo].[AccApproval]
       WHERE RequestId=@rid AND StepCode='ACCOUNT' AND Status='Approved'
       ORDER BY Id`,
    );
  const row = res.recordset[0] as { ActionedByStaffId: number | null } | undefined;
  const step2Actor = row ? (row.ActionedByStaffId ?? null) : null;

  const refusal = finalStepRefusal(candidateStaffId, step2Actor);
  if (refusal) throw new AccForbiddenError(refusal);
}

/* ─────────────────────────── rejection, at any step ─────────────────────────── */

/**
 * Reject at whichever step is pending: `Rejected`, `CurrentStepCode` cleared,
 * the reason stored on the approval row and shown on the timeline (spec §3.2.1).
 *
 * The reason is required and refused **here**. The dialog disables its button on
 * an empty box; that is a courtesy, not a control, and a request rejected with
 * no reason leaves the requester with nothing to fix.
 *
 * Step 3 applies the two-person rule to a rejection as well as an approval —
 * spec §3.2 gives the same "any active approver except the actor of step 2" to
 * both actions on that row. Rejecting somebody else's check is an action on the
 * books in exactly the way approving it is.
 */
export async function rejectReimburse(
  requestId: number,
  actor: ReimburseActor,
  step: ReimburseStepCode,
  rawComment: unknown,
): Promise<void> {
  const { comment, error } = rejectCommentOrError(rawComment);
  if (error) throw new Error(error);

  const staffId = isAccountStep(step)
    ? await requireApproverStaffId(actor)
    : requireActorStaffId(actor);

  await inTransaction(async (tx) => {
    if (step === "ACCOUNT_FINAL") await assertMayTakeFinalStep(tx, requestId, staffId);
    // `paymentDate: null`, not omitted: `claimStep` writes the column only when
    // the key is present, and a step-3 rejection would otherwise keep the date
    // step 2 fixed — the rejection mail and the detail page both print
    // "วันที่จ่าย" underneath the refusal.
    await claimStep(tx, requestId, step, { status: "Rejected", stepCode: null, paymentDate: null });
    await closeApprovalRow(tx, requestId, step, "Rejected", staffId, actor.email, comment, false);
    await logActivity(tx, requestId, actor.userId, "rejected", comment);
  });

  await afterCommit(requestId, async (updated) => {
    await notifyQuietly(updated, updated.requesterEmail, "Rejected", "ไม่อนุมัติ", comment);
  });
}

/* ─────────────────────────── returning for edit, at any step ─────────────────────────── */

/**
 * Send the claim back to the requester: `Returned`, `CurrentStepCode` cleared,
 * what has to change stored on the approval row and shown on the timeline.
 *
 * This is the correction path, and until it existed AP-4 had none. A submitted
 * claim could only be approved or rejected, and a rejection is terminal —
 * `decideRequestMutate` allows `Draft`/`Returned` only — so the sole way to fix
 * a typo was to re-key every line, re-upload every receipt and consume a second
 * `RBM` number, leaving the rejected one in My Requests for good. Everything on
 * the far side of `Returned` was already built and unreachable: the resume
 * prompt, the "· ส่งกลับแก้ไข" label, the drafts query's `Status IN ('Draft',
 * 'Returned')`, and `submitReimburseRequest`'s branch that keeps the existing
 * `RequestNo` on a resubmit.
 *
 * Modelled on `rejectReimburse` rather than AP-1's `returnForEdit`, which is
 * pinned to `AP1_FORM_CODE` and offers the manager step only. Three differences
 * from a rejection, and no others:
 *
 *  - the request lands on `Returned`, so the requester may edit and resubmit it;
 *  - the approval row closes `Returned`, which is what the timeline draws;
 *  - the note is refused by `returnCommentOrError`, whose message asks for what
 *    to change rather than for a reason to refuse.
 *
 * Available at **all three** steps. Spec §3.2.1 gives returning to the manager;
 * an accounting checker or the final approver finding the same fixable mistake
 * would otherwise have to reject a claim that is merely wrong rather than
 * refused — which is the state this function exists to stop being the only one.
 *
 * The two-person rule applies to a return at `ACCOUNT_FINAL` exactly as it does
 * to a rejection there. Not because returning authorises a payment — nothing
 * downstream of it does, since a resubmit deletes every approval row and walks
 * the chain again — but because the step-3 row is one the step-2 actor is
 * refused, and `approval-context` already draws no action bar for them. A server
 * path accepting what the page declines to offer is the weaker of two rules
 * winning, which is how the by-id endpoints came to be unauthorized in the first
 * place.
 */
export async function returnReimburse(
  requestId: number,
  actor: ReimburseActor,
  step: ReimburseStepCode,
  rawComment: unknown,
): Promise<void> {
  const { comment, error } = returnCommentOrError(rawComment);
  if (error) throw new Error(error);

  const staffId = isAccountStep(step)
    ? await requireApproverStaffId(actor)
    : requireActorStaffId(actor);

  await inTransaction(async (tx) => {
    if (step === "ACCOUNT_FINAL") await assertMayTakeFinalStep(tx, requestId, staffId);
    // `paymentDate: null` for the reason the step-3 rejection gives: a return
    // from `ACCOUNT_FINAL` would otherwise keep the date step 2 fixed, and the
    // requester would open a request they have to edit with a payment date
    // printed on it.
    await claimStep(tx, requestId, step, { status: "Returned", stepCode: null, paymentDate: null });
    await closeApprovalRow(tx, requestId, step, "Returned", staffId, actor.email, comment, false);
    await logActivity(tx, requestId, actor.userId, "returned", comment);
  });

  await afterCommit(requestId, async (updated) => {
    await notifyQuietly(updated, updated.requesterEmail, "Returned", "ส่งกลับแก้ไข", comment);
  });
}

/* ─────────────────────────── the requester's own cancel ─────────────────────────── */

/**
 * The facts the self-cancel rule is decided on, read in one statement — the
 * server's clock among them.
 *
 * `SYSDATETIME()` travels back in the same recordset as `SubmittedAt`, so the
 * two are one clock read through one driver conversion; see
 * `SelfCancelState.now`. Null when the id is not an AP-4 request.
 */
async function readSelfCancelState(
  requestId: number,
  userId: number,
): Promise<SelfCancelState | null> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("id", sql.Int, requestId)
    .input("form", sql.NVarChar, AP4_FORM_CODE)
    .query(
      `SELECT CreatedBy, Status, CurrentStepCode, SubmittedAt, SYSDATETIME() AS ServerNow
       FROM [dbo].[AccRequest]
       WHERE Id=@id AND FormCode=@form`,
    );
  const row = res.recordset[0] as
    | {
        CreatedBy: number | null;
        Status: string | null;
        CurrentStepCode: string | null;
        SubmittedAt: Date | null;
        ServerNow: Date;
      }
    | undefined;
  if (!row) return null;

  return {
    // AP-4 has no on-behalf submission, so the creator is the requester. `> 0`
    // because a session with no usable internal id stamps 0, and 0 must not
    // match a row whose `CreatedBy` failed to write either.
    isRequester: userId > 0 && row.CreatedBy === userId,
    status: row.Status,
    currentStepCode: row.CurrentStepCode,
    submittedAt: row.SubmittedAt,
    now: row.ServerNow,
  };
}

/**
 * What the detail page needs to draw the withdrawal bar, or null for anyone who
 * did not file this request.
 *
 * The page is handed the verdict and the deadline rather than the ingredients:
 * the window is measured on the server's clock, and AP-1's page evaluating
 * `Date.now() - new Date(submittedAt)` in the browser is the second copy of the
 * rule this deliberately does not make.
 */
export async function getReimburseSelfCancelInfo(
  requestId: number,
  userId: number,
): Promise<ReimburseSelfCancelInfo | null> {
  const state = await readSelfCancelState(requestId, userId);
  if (!state || !state.isRequester) return null;

  const refusal = selfCancelRefusal(state);
  const until = selfCancelDeadline(state.submittedAt);
  return {
    allowed: refusal == null,
    until: until ? until.toISOString() : null,
    reason: refusal?.error ?? null,
  };
}

/**
 * Claim the request for withdrawal.
 *
 * `claimStep`'s three predicates (`FormCode`, `CurrentStepCode`, `Status`) plus
 * the two only this action has: the creator, and the window — the same
 * inequality `selfCancelRefusal` applies, evaluated by the database against its
 * own `SYSDATETIME()` so that the check which *decides* and the check which
 * *holds* cannot be separated by the round trip between them. `>=` because the
 * window is inclusive at its far end, as the pure rule is.
 *
 * Not an extra parameter on `claimStep`: this one sets `CancelledBy` /
 * `CancelledAt` as well, and widening the shared helper to carry another
 * action's predicates is how a claim quietly stops asserting what its callers
 * think it does. `STATUS_AT_STEP.MANAGER` rather than a literal `'Submitted'`,
 * so the two claims cannot drift apart over what that step's status is.
 */
async function claimSelfCancel(tx: AccTx, requestId: number, userId: number): Promise<void> {
  const res = await tx
    .request()
    .input("id", sql.Int, requestId)
    .input("form", sql.NVarChar, AP4_FORM_CODE)
    .input("uid", sql.Int, userId)
    .input("status", sql.NVarChar, STATUS_AT_STEP.MANAGER)
    .input("hours", sql.Int, SELF_CANCEL_WINDOW_HOURS)
    .query(
      `UPDATE [dbo].[AccRequest]
       SET Status='Cancelled', CurrentStepCode=NULL, PaymentDate=NULL,
           CancelledBy=@uid, CancelledAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
       WHERE Id=@id AND FormCode=@form AND CreatedBy=@uid
         AND Status=@status AND CurrentStepCode='MANAGER'
         AND SubmittedAt IS NOT NULL
         AND SubmittedAt >= DATEADD(HOUR, -@hours, SYSDATETIME())`,
    );
  if (res.rowsAffected[0] !== 1) throw new AccConflictError(NOT_AT_STEP_ERROR);
}

/**
 * The requester withdraws their own claim: `Cancelled`, `CurrentStepCode`
 * cleared, within `SELF_CANCEL_WINDOW_HOURS` of the submit and only while the
 * manager still holds it (spec §5.3).
 *
 * Modelled on AP-1's `cancelByRequester` — same timestamp, same window, same
 * "before the manager acts" — but written here, because that engine is pinned
 * to `AP1_FORM_CODE` and moves nothing an AP-4 id names.
 *
 * Two passes over the same rule, deliberately. `selfCancelRefusal` runs first
 * and names *which* of the three conditions failed, because "ยกเลิกไม่ได้" on
 * its own does not tell the requester whether to wait, to ask the manager, or
 * that the request was never theirs. The claim then re-asserts all three inside
 * the transaction, so a manager approving between the two answers 409 rather
 * than cancelling a request that has already moved. The first pass writes
 * nothing; on the refusal path nothing is touched at all.
 */
export async function cancelReimburseByRequester(
  requestId: number,
  actor: ReimburseActor,
): Promise<void> {
  const state = await readSelfCancelState(requestId, actor.userId);
  if (!state) throw new AccConflictError(NOT_AT_STEP_ERROR);

  const refusal = selfCancelRefusal(state);
  if (refusal) {
    throw refusal.reason === "not_requester"
      ? new AccForbiddenError(refusal.error)
      : new AccConflictError(refusal.error);
  }

  const staffId = actor.staffId;

  await inTransaction(async (tx) => {
    await claimSelfCancel(tx, requestId, actor.userId);
    // `Returned` because `CK_AccApproval_Status` permits only
    // Pending/Approved/Rejected/Returned — an approval row has no `Cancelled`,
    // and adding one would need a migration applied to both databases before
    // this could ship. AP-1's cancel closes its pending rows the same way. The
    // request's own status is what says it was withdrawn, the activity row
    // below records it by name, and the timeline reads the request status so it
    // does not call this a return.
    await closeApprovalRow(
      tx, requestId, "MANAGER", "Returned", staffId ?? 0, actor.email, null, false,
    );
    await logActivity(tx, requestId, actor.userId, "cancelled");
  });

  await afterCommit(requestId, async (updated) => {
    // The manager is the one person holding a queue item that has just gone away.
    await notifyQuietly(updated, updated.managerEmail, "Cancelled", "ผู้ขอยกเลิกคำขอ");
  });
}
