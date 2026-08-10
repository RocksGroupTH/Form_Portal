import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { ensureMaterialized, type ReportType } from "@/features/intelligence/materialize";

const VALID_REPORTS: ReportType[] = ["daily-sales", "sales-item", "tender", "vat", "waste"];

/* POST /api/intelligence/etl/materialize
 * Body: { report?: ReportType, brand?: string, from: string, to: string }
 * If report is omitted, materializes all 5 reports.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const body = await req.json();
    const { report, brand = "UNO", from, to } = body as {
      report?: ReportType;
      brand?: string;
      from?: string;
      to?: string;
    };

    if (!from || !to) {
      return NextResponse.json({ ok: false, error: "from and to are required" }, { status: 400 });
    }

    const reports = report ? [report] : VALID_REPORTS;
    const results: Record<string, string> = {};

    for (const r of reports) {
      if (!VALID_REPORTS.includes(r)) {
        results[r] = "skipped (invalid)";
        continue;
      }
      try {
        await ensureMaterialized(r, brand, from, to);
        results[r] = "ok";
      } catch (err) {
        results[r] = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return NextResponse.json({ ok: true, data: results });
  } catch (err) {
    console.error("[api/intelligence/etl/materialize] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
