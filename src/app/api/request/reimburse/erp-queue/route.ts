import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveReimburseRouteActor } from "@/lib/acc/reimburse/route-actor";
import { resolveReimburseTabsByEmail } from "@/lib/acc/reimburse/access-tabs";
import { decideReimburseMenuAccess } from "@/lib/acc/reimburse/settings-tabs";
import { listReimburseErpQueue } from "@/lib/acc/reimburse/erp-queue-service";

/**
 * GET /api/request/reimburse/erp-queue — every APPROVED AP-4 claim `staffId`/
 * `email` may act on, with its current Business Central posting status
 * (always unset today — nothing sends yet) and whether its lines are ready to
 * post.
 *
 * **The gate is the same `approvalQueue` menu key `/api/request/reimburse/
 * approvals` uses, not a new one.** A person who may work the accounting
 * queue may see what is waiting to post next — the two are the same viewer at
 * a different point in the same claim's life, not two audiences. There is
 * deliberately no separate `erpQueue` menu key: `REIMBURSE_MENU_KEYS`
 * (`settings-tabs.ts`) is the only vocabulary `AccReimburseAccessTab.TabKey`
 * carries beside the grantable settings tabs, and adding a key nobody asked
 * to grant separately would just be a second tick that always agrees with the
 * first.
 *
 * This is READ-ONLY — there is no action here to re-decide per row the way
 * `approvals/route.ts` re-decides an approve/return/return against
 * `AccReimburseApprover`, so unlike that route this one carries no
 * `isReimburseApprover` notice. Nothing on this screen can fail with "you are
 * not on the roster" because nothing on this screen can be clicked.
 *
 * **Sight IS scoped, since migration 144 (2026-09-10) — see the identical
 * note on `approvals/route.ts`.** `listReimburseErpQueue` filters by the
 * caller's own brand scope; a viewer with no active `AccReimburseApprover` row
 * sees an empty list rather than every approved claim.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const admin = isAdminRole(session.user.role);
    // Same shape as `approvals/route.ts`: the grant read is inside the `try`
    // (a throw outside it would escape with no `{ ok: false }` envelope) and
    // skipped for admins (`decideReimburseMenuAccess` passes an admin on the
    // `isAdmin` arm alone, so the read cannot change their answer, and
    // skipping it keeps the queue open to an admin while migration 120 is
    // still landing on one of the two form databases).
    const email = session.user.email ?? null;
    const granted = admin ? [] : await resolveReimburseTabsByEmail(email);
    if (!decideReimburseMenuAccess(admin, granted, "approvalQueue")) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    // Shared with `approvals/route.ts` — see `resolveReimburseRouteActor`'s
    // own docblock (`@/lib/acc/reimburse/route-actor`) for why the two routes
    // must resolve this identically rather than each building it inline: they
    // used to disagree about which `email` value to pass on to
    // `loadApproverScopeByStaffId` (trimmed vs. raw).
    const actor = await resolveReimburseRouteActor(
      Number(session.user.id),
      email,
      "reimburse/erp-queue",
    );

    const rows = await listReimburseErpQueue(actor.staffId, actor.email);
    return NextResponse.json({ ok: true, data: rows });
  } catch (err) {
    console.error("[api/request/reimburse/erp-queue] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
