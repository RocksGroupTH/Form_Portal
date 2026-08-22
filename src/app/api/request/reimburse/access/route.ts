import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveReimburseTabsByEmail } from "@/lib/acc/reimburse/access-tabs";

/* ── GET /api/request/reimburse/access — viewer's AP-4 settings capabilities ──
 *
 * Its own endpoint rather than a field on AP-1's or AP-17's, so the three forms'
 * access questions never have to be asked together.
 *
 * These flags drive which tabs render. They are NOT the authorization gate:
 * every AP-4 settings route resolves the grant itself on every call, through
 * `requireReimburseSettingsTab` or `requireRole`.
 *
 * Narrower than AP-17's counterpart on purpose. AP-17 also answers `account`,
 * because its roster grants sight of a booking queue and a report; AP-4 has no
 * such surfaces — its only queue is `/my-work`, which is driven by the approval
 * rows, not by a roster. So `AccReimburseAccess` means settings tabs and
 * nothing else, and **membership alone grants none of them**: `canSettings` is
 * false until at least one tab is ticked, which is why an empty grant list
 * leaves a non-admin exactly where they were before they were added.
 *
 * The approval pool is a different question and deliberately not answered here.
 * Whether somebody may take the ACCOUNT or ACCOUNT_FINAL step comes from
 * `AccReimburseApprover`, checked inside the approval service where the money
 * moves.
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const admin = isAdminRole(session.user.role);
    // Admins see every tab; the grant list only governs non-admins. Skipping the
    // read for them also keeps the settings page working for an admin while
    // migration 106 is still landing on one of the two databases.
    let settingsTabs: string[] = [];
    if (!admin) {
      try {
        settingsTabs = await resolveReimburseTabsByEmail(email);
      } catch (err) {
        // Degrade to no grants rather than failing the endpoint. This answer is
        // menu visibility only and the routes re-resolve it themselves, so the
        // fail-closed direction costs a non-admin a tab they cannot use anyway
        // — and never hands one out.
        console.error("[reimburse/access] grant read failed — reporting no grants", err);
      }
    }
    const canSettings = admin || settingsTabs.length > 0;
    return NextResponse.json({
      ok: true,
      data: { admin, settingsTabs, canSettings },
    });
  } catch (err) {
    console.error("[api/request/reimburse/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
