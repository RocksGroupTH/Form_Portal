import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listBranches } from "@/lib/clr/clear-advance-request-service";

/** GET /api/request/clear-advance/options/branches?brand=CODE — branch/BU dimension options */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const brand = req.nextUrl.searchParams.get("brand");
    const data = await listBranches(brand);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
