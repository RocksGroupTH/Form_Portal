import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { listDetailRows, type ClrDetailRow, type ClrReportFilters } from "@/lib/clr/clear-advance-report-service";
import { detailExportOrder, totalsLabelIndex, type DetailExportKey } from "@/lib/clr/report-export-order";

/** One export column: its heading, how it reads a row, and its total if it has one. */
type Col = {
  header: string;
  value: (r: ClrDetailRow) => string | number;
  total?: () => number;
};

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

    const sum = (k: "amountBeforeVat" | "vatAmount" | "totalInclVat" | "whtAmount" | "netAmount") =>
      Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) * 100) / 100;

    /**
     * The file, described once — a heading and its column are one thing, so
     * they can only move together. (See the Control export's route.ts for the
     * full rationale; this one has no totals-row label to lose to a reordered
     * column, since only the five amount columns below carry a sum and none of
     * them is where the "Total" label sits.)
     */
    const COLS: Record<DetailExportKey, Col> = {
      requestNo:         { header: "Request no.",                value: (r) => r.requestNo ?? "" },
      requestDate:       { header: "Request date",                value: (r) => r.requestDate ?? "" },
      lineNo:            { header: "ลำดับ",                       value: (r) => r.lineNo },
      staffId:           { header: "รหัสพนักงาน",                  value: (r) => r.staffId ?? "" },
      requesterFullName: { header: "ชื่อพนักงาน",                  value: (r) => r.requesterFullName ?? "" },
      expenseOf:         { header: "เป็นค่าใช้จ่ายของ",             value: (r) => r.expenseOf ?? "" },
      branchCode:        { header: "รหัสสาขา",                    value: (r) => r.branchCode ?? "" },
      expenseDate:       { header: "วันที่",                       value: (r) => r.expenseDate ?? "" },
      docNo:             { header: "เลขที่เอกสาร",                  value: (r) => r.docNo ?? "" },
      glAccountNo:       { header: "รายการ (G/L)",                 value: (r) => r.glAccountNo ?? "" },
      glAccountName:     { header: "ชื่อบัญชี",                    value: (r) => r.glAccountName ?? "" },
      description:       { header: "รายละเอียด",                   value: (r) => r.description ?? "" },
      amountBeforeVat:   { header: "ยอดก่อน VAT",                  value: (r) => r.amountBeforeVat ?? 0, total: () => sum("amountBeforeVat") },
      vatAmount:         { header: "VAT",                         value: (r) => r.vatAmount ?? 0,       total: () => sum("vatAmount") },
      totalInclVat:      { header: "รวม",                         value: (r) => r.totalInclVat ?? 0,    total: () => sum("totalInclVat") },
      whtAmount:         { header: "หัก ณ ที่จ่าย",                 value: (r) => r.whtAmount ?? 0,       total: () => sum("whtAmount") },
      netAmount:         { header: "จ่ายสุทธิ",                    value: (r) => r.netAmount ?? 0,       total: () => sum("netAmount") },
      taxId:             { header: "เลขผู้เสียภาษี",                value: (r) => r.taxId ?? "" },
      payeeName:         { header: "ชื่อ/บริษัท",                  value: (r) => r.payeeName ?? "" },
      payeeAddress:      { header: "ที่อยู่",                       value: (r) => r.payeeAddress ?? "" },
      advanceRequestNo:  { header: "เลขที่เบิกเงินทดรองจ่าย",        value: (r) => r.advanceRequestNo ?? "" },
    };

    const screenOrder = (q.get("cols") ?? "").split(",").filter(Boolean);
    const keys = detailExportOrder(screenOrder);

    const header = keys.map((k) => COLS[k].header);
    const body = rows.map((r) => keys.map((k) => COLS[k].value(r)));
    const labelAt = totalsLabelIndex(keys, (k) => !!COLS[k].total);
    const totalRow = keys.map((k, i) => (i === labelAt ? "Total" : COLS[k].total?.() ?? ""));

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
