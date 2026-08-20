import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAccApprover } from "@/lib/acc/access";
import { isAdminRole } from "@/lib/roles";
import { resolveApproverSettingsTabsByEmail } from "@/lib/acc/approver-settings-tabs";

/* ── GET /api/request/accounting/access — viewer's AP-1 capabilities ──
 *
 * These flags drive which menus render. They are NOT the authorization gate:
 * every account-area route still calls `canAccessAccountArea` itself, and that
 * function deliberately keeps its admin arm.
 *
 * `account` here is the approver roster alone, so an admin who is not an
 * approver no longer sees the approval queue or the report. They keep ตั้งค่า,
 * so nobody can lock themselves out — an admin can always grant themselves.
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const admin = isAdminRole(session.user.role);
    const approver = await isAccApprover(email);
    // Admins see every tab; the grant list only governs non-admin approvers.
    //
    // The grant read is caught separately so it cannot take the rest of the
    // answer with it. An approver who holds no grants still needs `account` to
    // see the queue and the report, and failing the whole endpoint over a table
    // they do not use would deny them work they are entitled to. Unresolvable
    // grants degrade to none — the fail-closed direction for the settings half
    // — while the area half is answered from a read that succeeded.
    let settingsTabs: string[] = [];
    if (!admin) {
      try {
        settingsTabs = await resolveApproverSettingsTabsByEmail(email);
      } catch (err) {
        console.error("[accounting/access] grant read failed — reporting no grants", err);
      }
    }
    const canSettings = admin || settingsTabs.length > 0;
    return NextResponse.json({
      ok: true,
      data: { account: approver, approver, admin, settingsTabs, canSettings },
    });
  } catch (err) {
    console.error("[api/request/accounting/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
