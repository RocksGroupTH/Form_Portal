import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessRewardArea } from "@/lib/acc/reward/access";
import { listRewardReport, parseRewardReportFilters } from "@/lib/acc/reward/report-service";

/* ── GET /api/request/reward/report ── */

/**
 * One database, never merged.
 *
 * A report is a statement about one set of books, so this does not go through
 * `query-both.ts` the way `/my-request` and `/my-work` do — the same rule AP-1's
 * and AP-17's reports follow.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessRewardArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const data = await listRewardReport(parseRewardReportFilters(req.nextUrl.searchParams));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/report] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
