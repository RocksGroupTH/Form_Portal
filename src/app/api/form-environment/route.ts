import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getFormEnvironmentMap } from "@/lib/form-environment/service";

/**
 * GET — which environment each form currently writes to, e.g.
 * `{ "AP-17": "UAT" }`. Forms with no row are absent and mean Production.
 *
 * Readable by any signed-in user, unlike /api/settings/form-environment: this
 * one only says where a form writes, which is what the badges on Home need so
 * a requester can see they are about to file a test request. Changing the flag
 * stays System Admin only.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await getFormEnvironmentMap();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/form-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
