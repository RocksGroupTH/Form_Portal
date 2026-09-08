import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { buildAccActor } from "@/lib/acc/actor-context";
import { resolveReimburseTabsByEmail } from "@/lib/acc/reimburse/access-tabs";
import { decideReimburseMenuAccess } from "@/lib/acc/reimburse/settings-tabs";
import { listReimburseAccountQueue } from "@/lib/acc/reimburse/queue-service";
import {
  getReimbursePaymentOptions,
  resolveReimburseApprover,
} from "@/lib/acc/reimburse/approval-service";

/**
 * GET /api/request/reimburse/approvals — the accounting queue AP-4's ACCOUNT
 * step is worked from: every claim at `(ManagerApproved, ACCOUNT)`, plus the
 * payment-date rounds the queue's date control opens on.
 *
 * **This gate is sight of the screen, not authority to act.** `approvalQueue`
 * decides whether this viewer may open the page at all —
 * `decideReimburseMenuAccess`, backed by `AccReimburseAccess` /
 * `AccReimburseAccessTab`. Whether a *row* may be acted on is re-decided per
 * action by the approval service against `AccReimburseApprover`
 * (`resolveReimburseApprover`, `approval-service.ts`), inside the same
 * transaction that writes. A viewer with the menu tick and no approver row
 * therefore sees every row here and gets a 403 from every action — that is
 * correct, not a bug to special-case: `AccReimburseAccess` exists precisely so
 * "may edit the payment rules" and "may approve a payment" are not the same
 * tick (see `settings-tabs.ts`'s own docblock).
 *
 * **`isReimburseApprover` rides along on this same response, since
 * 2026-09-09.** It briefly lived on `GET /api/request/reimburse/access`
 * (2026-09-08) — the endpoint `useReimburseAccess()` backs, which the
 * `/request` hub and the AP-4 settings page also read — so every visit to
 * either paid a `Rocks_Portal_HR` lookup (`buildAccActor` →
 * `findActiveEmployeeByEmail`) plus a roster read that only this page's
 * notice used, and a degraded HR connection held that whole response (this
 * route's own `approvalQueue` gate included) for the driver's 15s default
 * timeout — `src/lib/db/mssql.ts` sets none. Moved here, where the only
 * caller is the page that needs it and the viewer is already being resolved
 * for the `approvalQueue` gate above. It is a NOTICE, not a gate: whether
 * somebody may actually take the ACCOUNT or ACCOUNT_FINAL step is re-decided
 * inside the approval service (`requireApproverStaffId`), inside the
 * transaction that writes, and nothing here is consulted there. `boolean |
 * null` — `null` when the roster could not be read, which must never be
 * reported as "you are not on it".
 */

/**
 * Roster membership, for the notice — never a gate (see the docblock above).
 * Asked for ADMINS TOO: the admin role already passes `decideReimburseMenuAccess`
 * above, so an admin reaches the queue automatically, and an admin with no
 * approver row hits the identical wall. Failure degrades to `null`, never
 * `false` — telling somebody they are off a roster nobody could read would be
 * a wrong statement, where saying nothing is merely a missing one.
 */
async function resolveIsReimburseApprover(
  userId: number,
  email: string | null,
): Promise<boolean | null> {
  try {
    const actor = await buildAccActor(userId, email);
    return (await resolveReimburseApprover(actor)) != null;
  } catch (err) {
    console.error("[reimburse/approvals] approver roster read failed — reporting unknown", err);
    return null;
  }
}

export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const admin = isAdminRole(session.user.role);
    // The grant read is inside the `try` and skipped for admins, following
    // `/api/request/reimburse/access`.
    //
    // *Skipped* because `decideReimburseMenuAccess` passes an admin on the
    // `isAdmin` arm alone, so the read cannot change their answer — and
    // skipping it keeps the queue open to an admin while migration 120 is
    // still landing on one of the two form databases.
    //
    // *Inside the try* because `resolveReimburseTabsByEmail` opens a pool: a
    // throw outside it escapes the handler with no `{ ok: false }` envelope,
    // and the page's fetcher reads `json.error`. Note the one place this
    // differs from the access endpoint, deliberately: that one catches a
    // failed grant read and carries on reporting no grants, because it answers
    // menu *visibility* which every route re-resolves anyway. This read IS the
    // gate, so an unreadable grant list must be a 500 rather than a queue.
    const email = session.user.email ?? null;
    const granted = admin ? [] : await resolveReimburseTabsByEmail(email);
    if (!decideReimburseMenuAccess(admin, granted, "approvalQueue")) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const [rows, options, isReimburseApprover] = await Promise.all([
      listReimburseAccountQueue(),
      getReimbursePaymentOptions(),
      resolveIsReimburseApprover(Number(session.user.id), email),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        rows,
        paymentOptions: options.dates,
        suggested: options.defaultDate,
        isReimburseApprover,
      },
    });
  } catch (err) {
    console.error("[api/request/reimburse/approvals] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
