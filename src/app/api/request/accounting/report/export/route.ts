import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { queryReport, buildReportWorkbook, type ReportFilters } from "@/lib/acc/report-service";
import {
  canActOnClaimBrand,
  INTERFACE_SCOPE_ERROR,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import {
  interfaceByClaimMapToRecord,
  loadPrepDeptContext,
} from "@/lib/acc/erp-prep-service";

/**
 * GET /api/request/accounting/report/export
 * Downloads a travel expense report as an Excel file.
 * Requires auth + account area access (approver or admin).
 *
 * Query params: ids (comma-separated, preferred), summary (filter label for workbook),
 *               or legacy single-value filters — dateBasis, from, to, brandCode, status, etc.
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

    const idsParam = sp.get("ids");
    const idList = idsParam
      ? idsParam.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0)
      : [];

    let rows: Awaited<ReturnType<typeof queryReport>>;
    const view = (sp.get("view") as ReportFilters["view"]) ?? "request";
    if (idList.length > 0) {
      const all = await queryReport({ view });
      const idSet = new Set(idList);
      rows = all.filter((r) => idSet.has(r.id));
    } else {
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
      };
      rows = await queryReport(filters);
    }

    // Scope the rows, whichever way they were selected. `ids=` is the important
    // half: it names an explicit list, so it bypassed every row filter by
    // construction — the export was a way to read any interface group's claims
    // in full, including requester names and amounts, straight out of Excel.
    const [access, deptCtx] = await Promise.all([
      resolveApproverInterfaceAccess(session.user.email, session.user.role),
      loadPrepDeptContext(),
    ]);
    if (!access.allAccess) {
      const byClaim = interfaceByClaimMapToRecord(deptCtx.interfaceByClaim);
      rows = rows.filter((r) => canActOnClaimBrand(access, byClaim, r.brandCode));
    }

    const generatedAt = new Date().toLocaleString("th-TH");
    const filterSummary = sp.get("summary") ?? undefined;

    const buf = buildReportWorkbook(rows, {
      generatedAt,
      companyName: "Rocks Group",
      filterSummary,
    });

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="travel-expense-report.xlsx"`,
      },
    });
  } catch (err) {
    console.error("[api/request/accounting/report/export] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
