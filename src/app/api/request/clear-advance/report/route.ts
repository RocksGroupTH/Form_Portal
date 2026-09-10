import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { listControlRows, type ClrReportFilters } from "@/lib/clr/clear-advance-report-service";
import { mergeControlRows, stackedAxisCombos } from "@/lib/clr/clr-control-report-view";

/** The filters every stacked (brand, status) combo query shares unchanged. */
function commonFiltersFromQuery(req: NextRequest): Omit<ClrReportFilters, "brandCode" | "status"> {
  const q = req.nextUrl.searchParams;
  return {
    staffId: q.get("staffId") ? Number(q.get("staffId")) || null : null,
    advanceNo: q.get("advanceNo"),
    requestNo: q.get("requestNo"),
    from: q.get("from"),
    to: q.get("to"),
  };
}

/**
 * GET /api/request/clear-advance/report — AP-3-Control (links to AP-2).
 *
 * `brand` and `status` arrive as CSV — the screen lets each column take
 * several picks at once (design doc §"Stacked filters"). `listControlRows`
 * (in `clear-advance-report-service.ts`, deliberately untouched by this
 * redesign) only understands one value of each per call, so every
 * (brand, status) combination is queried and the results merged/deduped —
 * see `stackedAxisCombos` / `mergeControlRows` for the OR-within/AND-across
 * semantics this gives. With 0 or 1 pick per axis (the common case) this is
 * exactly the single query it always was.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  if (!(await canAccessAccountArea(session.user.email ?? null, session.user.role))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const q = req.nextUrl.searchParams;
    const common = commonFiltersFromQuery(req);
    const combos = stackedAxisCombos(q.get("brand"), q.get("status"));
    const resultSets = await Promise.all(
      combos.map((c) => listControlRows({ ...common, brandCode: c.brand, status: c.status })),
    );
    const data = mergeControlRows(resultSets);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
