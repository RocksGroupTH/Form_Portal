import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listGlAccounts } from "@/lib/clr/clear-advance-request-service";

/** GET /api/request/clear-advance/options/gl-accounts — AP-3.2 G/L category master */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await listGlAccounts();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
