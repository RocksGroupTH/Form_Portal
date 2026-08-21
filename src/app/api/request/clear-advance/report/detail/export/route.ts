import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { listDetailRows, type ClrReportFilters } from "@/lib/clr/clear-advance-report-service";

/** GET /api/request/clear-advance/report/detail/export — AP-3-Detail as Excel */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  if (!(await canAccessAccountArea(session.user.email ?? null, session.user.role))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const filters: ClrReportFilters = {
    brandCode: q.get("brand"),
    staffId: q.get("staffId") ? Number(q.get("staffId")) || null : null,
    advanceNo: q.get("advanceNo"),
    requestNo: q.get("requestNo"),
    from: q.get("from"),
    to: q.get("to"),
  };

  try {
    const rows = await listDetailRows(filters);

    const header = [
      "Request no.", "Request date", "ลำดับ", "รหัสพนักงาน", "ชื่อพนักงาน", "เป็นค่าใช้จ่ายของ",
      "รหัสสาขา", "วันที่", "เลขที่เอกสาร", "รายการ (G/L)", "ชื่อบัญชี", "รายละเอียด",
      "ยอดก่อน VAT", "VAT", "รวม", "หัก ณ ที่จ่าย", "จ่ายสุทธิ",
      "เลขผู้เสียภาษี", "ชื่อ/บริษัท", "ที่อยู่", "เลขที่เบิกเงินทดรองจ่าย",
    ];
    const body = rows.map((r) => [
      r.requestNo ?? "", r.requestDate ?? "", r.lineNo, r.staffId ?? "", r.requesterFullName ?? "",
      r.expenseOf ?? "", r.branchCode ?? "", r.expenseDate ?? "", r.docNo ?? "",
      r.glAccountNo ?? "", r.glAccountName ?? "", r.description ?? "",
      r.amountBeforeVat ?? 0, r.vatAmount ?? 0, r.totalInclVat ?? 0, r.whtAmount ?? 0, r.netAmount ?? 0,
      r.taxId ?? "", r.payeeName ?? "", r.payeeAddress ?? "", r.advanceRequestNo ?? "",
    ]);
    const sum = (k: "amountBeforeVat" | "vatAmount" | "totalInclVat" | "whtAmount" | "netAmount") =>
      Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) * 100) / 100;
    const totalRow = [
      "Total", "", "", "", "", "", "", "", "", "", "", "",
      sum("amountBeforeVat"), sum("vatAmount"), sum("totalInclVat"), sum("whtAmount"), sum("netAmount"),
      "", "", "", "",
    ];

    const ws = XLSX.utils.aoa_to_sheet([header, ...body, totalRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AP-3-Detail");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="AP-3-Detail.xlsx"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
