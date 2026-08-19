import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listActiveRules } from "@/lib/acc/reimburse/settings-service";

/**
 * GET /api/request/reimburse/settings/rules — the acknowledgement checklist.
 *
 * `requireAuth()` only: any signed-in user may read it, because every one of
 * them has to tick every line of it before a request will submit. Editing the
 * list is a Settings concern and is not exposed here.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = await listActiveRules();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/rules] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
