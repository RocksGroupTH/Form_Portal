import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { buildAccActor } from "@/lib/acc/actor-context";
import { resolveReimburseTabsByEmail } from "@/lib/acc/reimburse/access-tabs";
import { resolveReimburseApprover } from "@/lib/acc/reimburse/approval-service";
import {
  decideReimburseMenuAccess,
  filterGrantableReimburseTabKeys,
  filterReimburseMenuKeys,
} from "@/lib/acc/reimburse/settings-tabs";

/* ── GET /api/request/reimburse/access — viewer's AP-4 settings capabilities ──
 *
 * Its own endpoint rather than a field on AP-1's or AP-17's, so the three forms'
 * access questions never have to be asked together.
 *
 * These flags drive which tabs and menus render. They are NOT the
 * authorization gate: every AP-4 settings route resolves the grant itself on
 * every call, through `requireReimburseSettingsTab` or `requireRole`, and the
 * two working screens the menus point at re-decide sight the same way through
 * `decideReimburseMenuAccess`.
 *
 * `AccReimburseAccess` now answers two questions, not one. Settings tabs grant
 * sight of configuration (`settingsTabs`/`canSettings`, unchanged); menu keys
 * grant sight of a working screen (`approvalQueue`/`clearance`) — AP-4's
 * counterpart to AP-17's `account` flag, kept as two separate booleans rather
 * than one because the two screens are unrelated pages. **Membership alone
 * grants none of them**: both `canSettings` and each menu boolean are false
 * until something is ticked, which is why an empty grant list leaves a
 * non-admin exactly where they were before they were added.
 *
 * The approval pool is a different question again, and since 2026-09-08 this
 * endpoint *reports* the answer without ever *deciding* on it.
 * `isReimburseApprover` is a NOTICE, not a gate: whether somebody may take the
 * ACCOUNT or ACCOUNT_FINAL step is re-decided inside the approval service where
 * the money moves (`requireApproverStaffId`), inside the transaction that
 * writes, and nothing here is consulted there. It exists because the queue's
 * guaranteed first experience is otherwise "select all → approve → N failures":
 * `AccReimburseApprover` ships empty, and a granted non-admin does not even
 * reach the helpful `NOT_ACCOUNT_APPROVER_ERROR` — `authorizeAccRequest(…,
 * "read")` refuses them first with a generic message. Saying so up front costs
 * nothing and blocks nothing; the design deliberately lets them look.
 *
 * It is `boolean | null`, and the null arm is the point: an unreadable roster
 * must not be reported as "you are not on it". The client renders the notice
 * only on a strict `false`.
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const admin = isAdminRole(session.user.role);
    // Admins see every tab and every menu; the grant list only governs
    // non-admins. Skipping the read for them also keeps the settings page
    // working for an admin while migration 120 is still landing on one of the
    // two databases.
    let granted: string[] = [];
    if (!admin) {
      try {
        granted = await resolveReimburseTabsByEmail(email);
      } catch (err) {
        // Degrade to no grants rather than failing the endpoint. This answer is
        // menu visibility only and the routes re-resolve it themselves, so the
        // fail-closed direction costs a non-admin a tab or menu they cannot use
        // anyway — and never hands one out.
        console.error("[reimburse/access] grant read failed — reporting no grants", err);
      }
    }
    // `granted` is the raw stored list — tabs and menus mixed together, since
    // that is what the table holds. Each surface narrows it with its own
    // filter: settings tabs never see a menu key and vice versa.
    const settingsTabs = filterGrantableReimburseTabKeys(granted);
    const canSettings = admin || settingsTabs.length > 0;
    // Sight of a working screen, which is a different question from sight of a
    // settings tab and is answered by a different filter. `granted` is the raw
    // stored list; `decideReimburseMenuAccess` is what decides, so an admin
    // gets both menus without a row and a stray key gets nobody anything.
    const menus = filterReimburseMenuKeys(granted);
    const approvalQueue = decideReimburseMenuAccess(admin, granted, "approvalQueue");
    const clearance = decideReimburseMenuAccess(admin, granted, "clearance");
    // Roster membership, for the queue's notice. Resolved from
    // `AccReimburseApprover` through the approval service's own
    // `resolveReimburseApprover` rather than a second query of the same table —
    // two lookups of "may this person approve" that could disagree is exactly
    // the shape this endpoint's docblock warns about.
    //
    // Asked for ADMINS TOO: the admin role passes `decideReimburseMenuAccess`,
    // so an admin reaches the queue automatically, and an admin with no
    // approver row hits the identical wall. `null` on failure — never `false`,
    // which would tell somebody they are off a roster nobody could read.
    let isReimburseApprover: boolean | null = null;
    try {
      const actor = await buildAccActor(Number(session.user.id), email);
      isReimburseApprover = (await resolveReimburseApprover(actor)) != null;
    } catch (err) {
      console.error("[reimburse/access] approver roster read failed — reporting unknown", err);
    }
    return NextResponse.json({
      ok: true,
      data: {
        admin,
        settingsTabs,
        canSettings,
        menus,
        approvalQueue,
        clearance,
        isReimburseApprover,
      },
    });
  } catch (err) {
    console.error("[api/request/reimburse/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
