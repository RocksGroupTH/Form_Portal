import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { listControlRows, type ClrReportFilters } from "@/lib/clr/clear-advance-report-service";

function filtersFromQuery(req: NextRequest): ClrReportFilters {
  const q = req.nextUrl.searchParams;
  return {
    brandCode: q.get("brand"),
    status: q.get("status"),
    staffId: q.get("staffId") ? Number(q.get("staffId")) || null : null,
    advanceNo: q.get("advanceNo"),
    requestNo: q.get("requestNo"),
    from: q.get("from"),
    to: q.get("to"),
  };
}

/** GET /api/request/clear-advance/report — AP-3-Control (links to AP-2) */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  if (!(await canAccessAccountArea(session.user.email ?? null, session.user.role))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const data = await listControlRows(filtersFromQuery(req));
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
