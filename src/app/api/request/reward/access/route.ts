import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessRewardArea, isRewardOfficer } from "@/lib/acc/reward/access";

/* ── GET /api/request/reward/access — what may this viewer see? ── */

/**
 * Drives which AP-11 surfaces render for this person, mirroring
 * `/api/request/accounting/access`.
 *
 * `officer` and `rewardArea` differ for an admin: an IT/System Admin reaches the
 * queue and the catalogue without being on the roster, and the UI says so rather
 * than implying they were added to it.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const role = session.user.role ?? null;
    const [officer, rewardArea] = await Promise.all([
      isRewardOfficer(email),
      canAccessRewardArea(email, role),
    ]);
    return NextResponse.json({ ok: true, data: { officer, rewardArea } });
  } catch (err) {
    console.error("[api/request/reward/access] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
