import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveViewerEnvironmentMap } from "@/lib/form-environment";

/**
 * GET — which environment each form writes to *for the caller*, e.g.
 * `{ "AP-17": "UAT" }`. Forms with no row are absent and mean Production.
 *
 * Now that Production and UAT run side by side the answer is per-viewer: an
 * ordinary user sees Production for everything, a tester in UAT mode sees UAT
 * for the forms open to testing. Readable by any signed-in user, unlike
 * /api/settings/form-environment: this one only says where the caller's own
 * requests land, which is what the badges on Home need so a requester can see
 * they are about to file a test request. Changing a switch stays System Admin
 * only.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await resolveViewerEnvironmentMap();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/form-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
