/**
 * Database- and request-scoped half of the Accounting request ACL.
 *
 * The policy itself is in `./request-acl-policy`, which imports nothing so it
 * can be unit-tested; `@/env` validates the whole environment at import time,
 * so anything reachable from a pool would drag a live configuration into the
 * test run. This module is the part that needs one.
 */

import { getAccPool, sql } from "@/lib/acc/pool";
import { canAccessAccountArea } from "@/lib/acc/access";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { getActiveUatTesterFor } from "@/lib/uat-tester/service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";
import { findActiveApprover } from "@/lib/acc/reimburse/approval-policy";
import { listReimburseApprovers } from "@/lib/acc/reimburse/settings-service";
import {
  decideRequestMutate,
  decideRequestRead,
  type AccAclViewer,
  type AccRequestAclRow,
} from "./request-acl-policy";

export * from "./request-acl-policy";

/* ── Wrappers that touch the database ── */

/**
 * Read the ACL columns for one request, optionally pinned to a form.
 *
 * `formCode` is worth passing: it stops an AP-17 route from authorizing against
 * an AP-1 row that happens to share the id, which matters because the two forms
 * live in the same `AccRequest` table.
 */
export async function loadAccRequestAcl(
  requestId: number,
  formCode?: string,
): Promise<AccRequestAclRow | null> {
  if (!Number.isInteger(requestId) || requestId <= 0) return null;

  const pool = await getAccPool();
  const req = pool.request().input("id", sql.Int, requestId);
  let where = "Id = @id";
  if (formCode) {
    req.input("form", sql.NVarChar, formCode);
    where += " AND FormCode = @form";
  }

  const res = await req.query(`
    SELECT Id, FormCode, Status, CreatedBy, SubmittedBy, StaffId, ManagerStaffId
    FROM [dbo].[AccRequest]
    WHERE ${where}
  `);
  const row = res.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: Number(row.Id),
    formCode: String(row.FormCode ?? ""),
    status: String(row.Status ?? ""),
    createdBy: (row.CreatedBy as number | null) ?? null,
    submittedBy: (row.SubmittedBy as number | null) ?? null,
    staffId: (row.StaffId as number | null) ?? null,
    managerStaffId: (row.ManagerStaffId as number | null) ?? null,
  };
}

/**
 * Assemble the viewer once per route.
 *
 * `staffId` is passed in rather than looked up here: the callers that need it
 * have already built an actor (`buildAccActor`) or an employee context, and a
 * second HR round-trip per request is measurable on the detail pages.
 *
 * `formCode` names the form of the row being decided, and it changes one thing:
 * which approver roster counts as the accounting area. `canAccessAccountArea`
 * asks `AccApprover`, which is **AP-1's** list — AP-4 deliberately owns its own
 * pool (`AccReimburseApprover`, spec decision 3) so that editing one form's
 * approvers cannot silently change the other's. Without this, an AP-4 approver
 * who is not also an AP-1 approver could not open, let alone action, the
 * requests they are the configured approver for. The widening is one-way: an
 * AP-4 approver gains nothing on an AP-1 or AP-17 row, because the extra lookup
 * only runs when the row itself is AP-4.
 */
export async function buildAccAclViewer(input: {
  userId: number;
  email: string | null;
  staffId: number | null;
  role: string | null;
  formCode?: string | null;
}): Promise<AccAclViewer> {
  const environment = await resolveFormEnvironment();
  const [isSharedAccountArea, tester, reimburseApprover] = await Promise.all([
    canAccessAccountArea(input.email, input.role),
    environment === "UAT"
      ? getActiveUatTesterFor(input.email, input.staffId)
      : Promise.resolve(null),
    input.formCode === AP4_FORM_CODE
      ? listReimburseApprovers().then((roster) =>
          findActiveApprover(roster, input.staffId, input.email),
        )
      : Promise.resolve(null),
  ]);

  return {
    userId: input.userId,
    email: input.email,
    staffId: input.staffId,
    role: input.role,
    isAccountArea: isSharedAccountArea || reimburseApprover != null,
    environment,
    isActiveUatTester: tester != null,
  };
}

/**
 * The whole check, for a route that has a session and a request id.
 *
 * Returns the row and the viewer on success, or the `NextResponse` to return on
 * refusal — the same shape `requireAuth()` uses, so a handler stays two lines:
 *
 * ```ts
 * const gate = await authorizeAccRequest(session, id, "read");
 * if (gate instanceof Response) return gate;
 * ```
 *
 * A missing request answers 404 before the policy runs, and the policy's own
 * UAT refusal is a 404 too, so the two are indistinguishable from outside.
 */
export async function authorizeAccRequest(
  session: { user: { id?: string | null; email?: string | null; role?: string | null } },
  requestId: number,
  mode: "read" | "mutate",
  formCode?: string,
): Promise<{ row: AccRequestAclRow; viewer: AccAclViewer } | Response> {
  const { NextResponse } = await import("next/server");
  const notFound = NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const row = await loadAccRequestAcl(requestId, formCode);
  if (!row) return notFound;

  const { buildAccActor } = await import("@/lib/acc/actor-context");
  const email = session.user.email ?? null;
  const actor = await buildAccActor(Number(session.user.id), email);
  const viewer = await buildAccAclViewer({
    userId: Number(session.user.id),
    email,
    staffId: actor.staffId,
    role: session.user.role ?? null,
    // The row's own form, not the caller's `formCode` hint — the hint is
    // optional and its absence must not change who the accounting area is.
    formCode: row.formCode,
  });

  const verdict = mode === "read" ? decideRequestRead(row, viewer) : decideRequestMutate(row, viewer);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, error: verdict.error }, { status: verdict.status });
  }
  return { row, viewer };
}
