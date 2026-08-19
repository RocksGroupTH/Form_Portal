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
  STATE_AFTER_APPROVE,
  STATUS_AT_STEP,
  STEP_ORDER,
  finalStepRefusal,
  findActiveApprover,
  isAccountStep,
  paymentDateError,
  rejectCommentOrError,
  upcomingPaymentRounds,
} from "./approval-policy";
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
  outcome: "Approved" | "Rejected",
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

  const updated = await getReimburseRequest(requestId);
  if (!updated) return;
  for (const email of await approverEmails()) {
    await notify(updated, email, "ManagerApproved", "รอฝ่ายบัญชีตรวจสอบ");
  }
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
  if (dateError) throw new Error(dateError);
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

  const updated = await getReimburseRequest(requestId);
  if (!updated) return;
  // Everyone in the pool except the person who just checked — they are the one
  // person the two-person rule will refuse at the final step.
  for (const email of await approverEmails(staffId)) {
    await notify(updated, email, "AccountChecked", "รออนุมัติขั้นสุดท้าย (บัญชี)");
  }
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

  const updated = await getReimburseRequest(requestId);
  if (!updated) return;
  await notify(updated, updated.requesterEmail, "Approved", "อนุมัติแล้ว");
  await notify(updated, updated.managerEmail, "Approved", "อนุมัติแล้ว");
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
    await claimStep(tx, requestId, step, { status: "Rejected", stepCode: null });
    await closeApprovalRow(tx, requestId, step, "Rejected", staffId, actor.email, comment, false);
    await logActivity(tx, requestId, actor.userId, "rejected", comment);
  });

  const updated = await getReimburseRequest(requestId);
  if (!updated) return;
  await notify(updated, updated.requesterEmail, "Rejected", "ไม่อนุมัติ", comment);
}
