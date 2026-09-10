import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveReimburseRouteActor } from "@/lib/acc/reimburse/route-actor";
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
 * action by the approval service against `AccReimburseApprover` AND
 * `AccReimburseApproverBrand` (`resolveReimburseApprover` /
 * `requireApproverScopeFor`, `approval-service.ts`), inside the same
 * transaction that writes.
 *
 * **Sight is now scoped too, since migration 144 (2026-09-10).** Until then a
 * viewer with the menu tick and no approver row saw every row here and got a
 * 403 from every action — recorded as "correct, not a bug to special-case",
 * because `AccReimburseAccess` exists precisely so "may edit the payment
 * rules" and "may approve a payment" are not the same tick (see
 * `settings-tabs.ts`'s own docblock). That reasoning is unchanged for
 * MEMBERSHIP — it still is correct that the menu tick alone does not make
 * someone an approver. What changed is that `listReimburseAccountQueue` now
 * filters by the caller's own brand scope (`loadApproverScopeByStaffId`), and
 * a caller with no active `AccReimburseApprover` row at all gets `null` back,
 * which the accumulator (`queue-policy.ts`) reads as ZERO rows rather than
 * every row — the same "an admin with no roster row sees nothing" rule
 * `listMyWorkRows`' AP-4 arm applies. A menu-only viewer with no approver row
 * therefore now sees an empty queue rather than every claim; the 403-on-every-
 * action half of the old sentence is unaffected — see
 * `resolveReimburseRouteActor` (`@/lib/acc/reimburse/route-actor`) below for
 * how the queue's scope and this notice share one lookup.
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
async function resolveIsReimburseApprover(actor: {
  userId: number;
  email: string | null;
  staffId: number | null;
}): Promise<boolean | null> {
  try {
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

    // Resolved once — see resolveReimburseRouteActor's own docblock for why
    // the queue's brand-scope filter and the isReimburseApprover notice must
    // share this one lookup rather than each building their own.
    const actor = await resolveReimburseRouteActor(
      Number(session.user.id),
      email,
      "reimburse/approvals",
    );
    const [queue, options, isReimburseApprover] = await Promise.all([
      listReimburseAccountQueue(actor.staffId, actor.email),
      getReimbursePaymentOptions(),
      resolveIsReimburseApprover(actor),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        rows: queue.rows,
        // I1 (2026-09-10): what `ReimburseApprovalQueue.tsx` needs to tell
        // "nothing pending", "everything pending is outside your scope" and
        // "some claims are stuck on an unmapped brand" apart on screen —
        // three situations that used to render one identical empty state.
        // See `ReimburseAccountQueueResult`'s own docblock (`queue-service.ts`).
        scope: queue.scope,
        unmappedBrandCount: queue.unmappedBrandCount,
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
