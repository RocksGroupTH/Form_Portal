import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import {
  buildInterfaceByClaimRecord,
  filterRowsForInterfaceAccess,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import { listBrandErpInterfaceMaps } from "@/lib/acc/brand-erp-interface-map-service";
import { queryReport, type ReportFilters } from "@/lib/acc/report-service";

/**
 * GET /api/request/accounting/report
 * Returns filtered travel expense report rows.
 * Requires auth + account area access (approver or admin).
 *
 * Query params: dateBasis, from, to, brandCode, status,
 *               departmentName, staffId, vehicleName, paymentDate
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;

    const rawStaffId = sp.get("staffId");
    const staffId = rawStaffId ? Number(rawStaffId) : null;

    const filters: ReportFilters = {
      dateBasis: (sp.get("dateBasis") as ReportFilters["dateBasis"]) ?? undefined,
      from: sp.get("from") ?? null,
      to: sp.get("to") ?? null,
      brandCode: sp.get("brandCode") ?? null,
      status: sp.get("status") ?? null,
      departmentName: sp.get("departmentName") ?? null,
      staffId: staffId && !isNaN(staffId) ? staffId : null,
      vehicleName: sp.get("vehicleName") ?? null,
      paymentDate: sp.get("paymentDate") ?? null,
      view: (sp.get("view") as ReportFilters["view"]) ?? "request",
    };

    let data = await queryReport(filters);

    const access = await resolveApproverInterfaceAccess(
      session.user.email,
      session.user.role,
    );
    if (!access.allAccess) {
      const maps = await listBrandErpInterfaceMaps();
      const interfaceByClaim = buildInterfaceByClaimRecord(maps);
      data = filterRowsForInterfaceAccess(data, interfaceByClaim, access);
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/report] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
