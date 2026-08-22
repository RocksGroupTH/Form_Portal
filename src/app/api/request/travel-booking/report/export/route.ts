import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import {
  queryTravelBookingReport,
  buildTravelBookingReportWorkbook,
  numberList,
  type TravelBookingReportFilters,
} from "@/lib/acc/travel-booking/report-service";

/**
 * GET /api/request/travel-booking/report/export
 * Downloads the AP-17 HR report as an Excel file. Requires auth + account area access.
 *
 * Query params: same filters as GET /report, plus `summary` (filter label shown in the workbook).
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
      provinceIds: numberList(sp.getAll("provinceId")),
      reasonIds: numberList(sp.getAll("reasonId")),
      statuses: sp.getAll("status"),
      departmentNames: sp.getAll("departmentName"),
      staffId: rawStaffId ? Number(rawStaffId) || null : null,
    };

    const rows = await queryTravelBookingReport(filters);

    const generatedAt = new Date().toLocaleString("th-TH");
    const filterSummary = sp.get("summary") ?? undefined;

    const buf = buildTravelBookingReportWorkbook(rows, {
      generatedAt,
      companyName: "Rocks Group",
      filterSummary,
    });

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="travel-booking-report.xlsx"`,
      },
    });
  } catch (err) {
    console.error("[api/request/travel-booking/report/export] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
