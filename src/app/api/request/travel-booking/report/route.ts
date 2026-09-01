import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { resolveBookingBrandAccess } from "@/lib/acc/travel-booking/booking-approver-brands";
import { queryTravelBookingReport, numberList, type TravelBookingReportFilters } from "@/lib/acc/travel-booking/report-service";

/**
 * GET /api/request/travel-booking/report
 * AP-17 HR report rows (spec §9). Requires auth + account area access (approver or admin).
 *
 * Query params: dateBasis (travel|submit|approve|payment), from, to, reasonId,
 *               status, departmentName (all comma-separated multi-value), staffId
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessBookingArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const rawStaffId = sp.get("staffId");

    const filters: TravelBookingReportFilters = {
      dateBasis: (sp.get("dateBasis") as TravelBookingReportFilters["dateBasis"]) ?? "submit",
      from: sp.get("from") ?? null,
      to: sp.get("to") ?? null,
      reasonIds: numberList(sp.getAll("reasonId")),
      statuses: sp.getAll("status"),
      departmentNames: sp.getAll("departmentName"),
      staffId: rawStaffId ? Number(rawStaffId) || null : null,
    };

    const data = await queryTravelBookingReport(
      filters,
      // The scope is resolved here and passed separately from the filters, so a
      // query-string parameter can never widen it.
      await resolveBookingBrandAccess(session.user.email, session.user.role),
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/travel-booking/report] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
