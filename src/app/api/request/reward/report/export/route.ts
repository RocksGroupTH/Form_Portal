import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessRewardArea } from "@/lib/acc/reward/access";
import {
  buildRewardReportWorkbook,
  listRewardReport,
  parseRewardReportFilters,
} from "@/lib/acc/reward/report-service";

/* ── GET /api/request/reward/report/export — the same rows, as .xlsx ── */

/**
 * Deliberately the *same* filter parser and the *same* query as the on-screen
 * report. The download must not be able to include rows the view excluded, and
 * it takes no `ids=` list for the same reason — a client-supplied id set is a
 * second, weaker path to the same data.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessRewardArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const rows = await listRewardReport(parseRewardReportFilters(sp));

    const buf = buildRewardReportWorkbook(rows, {
      generatedAt: new Date().toLocaleString("th-TH"),
      companyName: "Rocks Group",
      filterSummary: sp.get("summary") ?? undefined,
    });

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reward-report.xlsx"`,
      },
    });
  } catch (err) {
    console.error("[api/request/reward/report/export] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
