/**
 * AP-1 — withdraw a request the manager has left for more than a month.
 *
 * `stale-request-policy.ts` says *which* `(status, stepCode)` tuple may be
 * touched and holds the month count. This file does the work: claim, close,
 * log, notify — once per request, in one transaction each, against **both**
 * form databases.
 *
 * ## The age test is in SQL and is not repeated here
 *
 * The whole rule — form, status, step, and the age — lives in the `WHERE` of
 * one conditional `UPDATE`, so the row is claimed by the same statement that
 * decides it qualifies. That is the repo's state-transition convention
 * (CLAUDE.md, "State transitions"), and here it is also what keeps the month
 * arithmetic single: SQL Server's `DATEADD(MONTH, -1, '2026-03-31')` clamps to
 * 28 February while JavaScript's `setMonth` overflows to 3 March, so a
 * JavaScript pre-filter would disagree with the statement on exactly the dates
 * nobody tests. The `SELECT` below is a candidate list only — every id it
 * returns is re-tested by the `UPDATE`, and one that has since been approved,
 * rejected or returned simply claims nothing.
 *
 * ## Both databases
 *
 * An AP-1 request submitted by a UAT tester lives in `Rocks_Portal_Form_UAT`
 * and a production-scoped sweep would never see it — the same reason
 * `processQueueBoth` exists. Each pool is swept in turn and its own mail is
 * queued in its own database, so the UAT drain still applies the `[UAT]`
 * prefix and the redirect.
 *
 * ## Nobody did this
 *
 * `CancelledBy`, `AccApproval.ActionedByStaffId` and `AccActivityLog.AuthorId`
 * are all left NULL. All three columns are nullable, so this needs no
 * migration, and NULL is the truthful value: there is no person to name, and
 * writing a stand-in — the requester, the manager, some service account id —
 * would put a false actor into the audit trail of a financial claim. It is the
 * precedent `perdiem-recompute.ts` set ("AuthorId NULL, deliberately: nobody
 * did this"). What identifies the event instead is the action string,
 * `auto_cancelled_stale`, and the Thai comment written onto the closed
 * approval row, which is the part the AP-1 timeline actually renders.
 */

import type { ConnectionPool } from "mssql";
import { sql } from "@/lib/acc/pool";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";
import { AUTO_CANCEL_MONTHS } from "@/lib/acc/stale-request-policy";
import { queueEmail } from "@/lib/acc/email-queue";
import { buildEmail } from "@/lib/acc/email-templates";
import { AP1_FORM_CODE, type StepCode } from "@/features/accounting/constants";
import type { AccRequest } from "@/features/accounting/types";

/**
 * The activity-log action. Distinct from the human `cancelled` that
 * `cancelByRequester` writes, and readable on its own: a query filtering the
 * log has to be able to tell "the requester withdrew it" from "the system
 * expired it" without joining anything.
 *
 * AP-1's detail page renders `AccApproval` rows, not `AccActivityLog`, so no
 * screen has a label map that a new action string could fall out of. Checked
 * rather than assumed — the only reader of an `Action` value anywhere is
 * AP-17's admin service, which filters on `perdiem_recalculated` by name.
 */
export const AUTO_CANCEL_ACTION = "auto_cancelled_stale";

/** What the closed approval row and the log line say, in the requester's language. */
const AUTO_CANCEL_NOTE =
  `ระบบยกเลิกอัตโนมัติ — ผู้จัดการไม่ได้อนุมัติหรือไม่อนุมัติภายใน ` +
  `${AUTO_CANCEL_MONTHS} เดือน นับจากวันที่ส่งคำขอ`;

export interface StaleSweepResult {
  /** How many requests this run actually cancelled, across both databases. */
  cancelled: number;
  /** How many notification mails it managed to queue. Never blocks a cancel. */
  notified: number;
}

/** A claimed row, carrying only what the notification needs. */
interface CancelledRow {
  id: number;
  requestNo: string | null;
  requesterEmail: string | null;
}

/**
 * Claim and cancel one request, or find it no longer qualifies.
 *
 * Returns the row when this call is the one that cancelled it, null otherwise.
 * Two sweeps racing — the scheduled endpoint and an opportunistic call, or two
 * Node instances — both run this; only one `UPDATE` matches, so only one
 * notification is queued.
 */
async function cancelOne(pool: ConnectionPool, id: number): Promise<CancelledRow | null> {
  const tx = pool.transaction();
  await tx.begin();
  try {
    // The whole rule, in the statement that does the write. `SubmittedAt IS NOT
    // NULL` is not redundant with the comparison beside it — a NULL compares
    // false either way, but stating it keeps the intent readable next to the
    // `Status='Submitted'` that is supposed to guarantee it.
    const upd = await tx.request()
      .input("rid", sql.Int, id)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .input("months", sql.Int, AUTO_CANCEL_MONTHS)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Cancelled', CurrentStepCode=NULL,
                CancelledBy=NULL, CancelledAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
              OUTPUT INSERTED.Id, INSERTED.RequestNo, INSERTED.RequesterEmail
              WHERE Id=@rid AND FormCode=@form
                AND Status='Submitted' AND CurrentStepCode='MANAGER'
                AND SubmittedAt IS NOT NULL
                AND SubmittedAt < DATEADD(MONTH, -@months, SYSDATETIME())`);
    if (upd.recordset.length === 0) {
      await tx.rollback();
      return null;
    }

    // Closed as 'Returned' because CK_AccApproval_Status permits only
    // Pending/Approved/Rejected/Returned — there is no 'Cancelled', and adding
    // one needs a migration on both form databases. Same choice
    // `cancelByRequester` made. ActionedByStaffId stays NULL; the comment is
    // what tells the timeline reader that no manager did this.
    await tx.request()
      .input("rid", sql.Int, id)
      .input("c", sql.NVarChar, AUTO_CANCEL_NOTE)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Returned', Comment=@c,
                ActionedByStaffId=NULL, ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND Status='Pending'`);

    await tx.request()
      .input("rid", sql.Int, id)
      .input("action", sql.NVarChar(50), AUTO_CANCEL_ACTION)
      .input("note", sql.NVarChar, AUTO_CANCEL_NOTE)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, NULL, @action, @note)`);

    await tx.commit();
    const r = upd.recordset[0] as Record<string, unknown>;
    return {
      id: r.Id as number,
      requestNo: (r.RequestNo as string) ?? null,
      requesterEmail: (r.RequesterEmail as string) ?? null,
    };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/**
 * Build the AP-1 request shape `buildEmail` is typed against, from this pool.
 *
 * `getRequest()` cannot be used: it is pinned to `getAccPool()`, which resolves
 * the *current route's* database, and this sweep walks both. Only the fields
 * the template renders are selected — the travel date comes from the first
 * travel day, which is what `attachTravelToRequest` puts on `req.travel`.
 */
async function loadForMail(pool: ConnectionPool, id: number): Promise<AccRequest | null> {
  const res = await pool.request().input("id", sql.Int, id).query(`
    SELECT r.Id, r.RequestNo, r.FormCode, r.BrandCode, r.Status, r.CurrentStepCode,
           r.StaffId, r.RequesterFullName, r.RequesterEmail, r.RequesterPosition,
           r.RequesterDepartmentName, r.ManagerStaffId, r.ManagerEmail, r.CompanyName,
           r.TotalAmount, r.PaymentDate, r.SubmittedBy, r.SubmittedAt, r.CreatedAt, r.UpdatedAt,
           (SELECT TOP 1 t.TravelDate FROM [dbo].[AccTravelExpense] t
             WHERE t.RequestId = r.Id ORDER BY t.SortOrder, t.TravelDate, t.Id) AS FirstTravelDate
      FROM [dbo].[AccRequest] r WHERE r.Id = @id`);
  if (res.recordset.length === 0) return null;
  const r = res.recordset[0] as Record<string, unknown>;
  const travelDate = r.FirstTravelDate ? ymd(r.FirstTravelDate as Date) : null;
  return {
    id: r.Id as number,
    requestNo: (r.RequestNo as string) ?? null,
    formCode: r.FormCode as string,
    brandCode: (r.BrandCode as string) ?? null,
    status: r.Status as AccRequest["status"],
    currentStepCode: (r.CurrentStepCode as StepCode) ?? null,
    staffId: (r.StaffId as number) ?? null,
    requesterFullName: (r.RequesterFullName as string) ?? null,
    requesterEmail: (r.RequesterEmail as string) ?? null,
    requesterPosition: (r.RequesterPosition as string) ?? null,
    requesterDepartmentName: (r.RequesterDepartmentName as string) ?? null,
    managerStaffId: (r.ManagerStaffId as number) ?? null,
    managerEmail: (r.ManagerEmail as string) ?? null,
    companyName: (r.CompanyName as string) ?? null,
    totalAmount: r.TotalAmount === null || r.TotalAmount === undefined ? null : Number(r.TotalAmount),
    paymentDate: r.PaymentDate ? ymd(r.PaymentDate as Date) : null,
    submittedBy: (r.SubmittedBy as number) ?? null,
    submittedAt: r.SubmittedAt ? (r.SubmittedAt as Date).toISOString() : null,
    createdAt: r.CreatedAt ? (r.CreatedAt as Date).toISOString() : "",
    updatedAt: r.UpdatedAt ? (r.UpdatedAt as Date).toISOString() : "",
    // The currency group, all null. This row is only ever built to render the
    // cancellation email, and a cancelled claim reports no rate: the mail's
    // exchange-rate line is gated on `currency`, so null is what keeps it off a
    // notice that has nothing to convert. The columns exist and are read for
    // real elsewhere — this is the one caller with nothing to say about them.
    countryCode: null,
    currency: null,
    exchangeRate: null,
    foreignAmount: null,
    rateAsOf: null,
    rateSource: null,
    travel: travelDate
      ? ({ travelDate } as AccRequest["travel"])
      : undefined,
  };
}

/** Date column → YYYY-MM-DD with local getters; the server runs Thai time. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Sweep one database.
 *
 * `max` bounds a single run so a first sweep over a long backlog cannot sit in
 * one transaction-per-row loop indefinitely; the next run takes the rest.
 */
export async function sweepStaleRequestsOn(
  pool: ConnectionPool,
  max = 50,
): Promise<StaleSweepResult> {
  const candidates = await pool.request()
    .input("max", sql.Int, max)
    .input("form", sql.NVarChar, AP1_FORM_CODE)
    .input("months", sql.Int, AUTO_CANCEL_MONTHS)
    .query(`SELECT TOP (@max) Id FROM [dbo].[AccRequest]
            WHERE FormCode=@form AND Status='Submitted' AND CurrentStepCode='MANAGER'
              AND SubmittedAt IS NOT NULL
              AND SubmittedAt < DATEADD(MONTH, -@months, SYSDATETIME())
            ORDER BY Id`);

  const rows: CancelledRow[] = [];
  for (const c of candidates.recordset as { Id: number }[]) {
    const claimed = await cancelOne(pool, c.Id);
    if (claimed) rows.push(claimed);
  }

  // Mail after the commits, never inside them. A queue insert that fails must
  // not roll back a cancel that already happened — the request is cancelled
  // either way, and a missing notification is a smaller loss than a request
  // that stays open because its mail could not be written.
  let notified = 0;
  for (const row of rows) {
    if (!row.requesterEmail) continue;
    try {
      const req = await loadForMail(pool, row.id);
      if (!req) continue;
      const mail = buildEmail("Cancelled", req, AUTO_CANCEL_NOTE);
      await queueEmail({
        requestId: row.id,
        toEmail: row.requesterEmail,
        subject: mail.subject,
        bodyHtml: mail.html,
        triggerType: "Cancelled",
      }, pool);
      notified++;
    } catch (err) {
      console.error(
        `[acc/stale-request-sweep] cancelled ${row.requestNo ?? row.id} but could not queue its notification`,
        err,
      );
    }
  }

  return { cancelled: rows.length, notified };
}

/**
 * Sweep both form databases. The entry point both callers use.
 *
 * The two halves run in parallel like `processQueueBoth`'s, and are settled
 * rather than `Promise.all`ed: one database being unreachable must not discard
 * the count from the other, which has already committed its cancellations.
 */
export async function sweepStaleRequests(max = 50): Promise<StaleSweepResult> {
  const [prod, uat] = await Promise.all([getProductionFormPool(), getUatFormPool()]);
  const settled = await Promise.allSettled([
    sweepStaleRequestsOn(prod, max),
    sweepStaleRequestsOn(uat, max),
  ]);

  let cancelled = 0;
  let notified = 0;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      cancelled += s.value.cancelled;
      notified += s.value.notified;
    } else {
      console.error("[acc/stale-request-sweep] one database failed to sweep", s.reason);
    }
  }
  return { cancelled, notified };
}
