import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { listControlRows, type ClrControlRow, type ClrReportFilters } from "@/lib/clr/clear-advance-report-service";
import { STATUS_LABEL_TH } from "@/features/accounting/constants";
import { reportPv } from "@/lib/clr/clr-report-pv";
import { controlExportOrder, type ControlExportKey } from "@/lib/clr/report-export-order";

/** ISO datetime → "DD/MM/YYYY HH:mm" (local getters; strings are already the right instant). */
function fmtDt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** YYYY-MM-DD → DD/MM/YYYY. */
function fmtD(ymd: string | null): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}
function withDate(name: string | null, iso: string | null): string {
  if (!name) return "";
  const dt = fmtDt(iso);
  return dt ? `${name} (${dt})` : name;
}

/** One export column: its heading, how it reads a row, and its total if it has one. */
type Col = {
  header: string;
  value: (r: ClrControlRow) => string | number;
  total?: () => number;
};

/** GET /api/request/clear-advance/report/export — AP-3-Control as Excel (same filters). */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  if (!(await canAccessAccountArea(session.user.email ?? null, session.user.role))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const filters: ClrReportFilters = {
    brandCode: q.get("brand"),
    status: q.get("status"),
    staffId: q.get("staffId") ? Number(q.get("staffId")) || null : null,
    advanceNo: q.get("advanceNo"),
    requestNo: q.get("requestNo"),
    from: q.get("from"),
    to: q.get("to"),
  };

  try {
    const rows = await listControlRows(filters);

    const sum = (k: "advanceAmount" | "actualTotal" | "refundToCompany" | "extraToEmployee") =>
      Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) * 100) / 100;

    /**
     * The file, described once.
     *
     * This used to be three positional arrays — a header, a row per record, and
     * a totals row — that had to agree with each other by counting. The totals
     * row in particular put its sums at fixed indices (6, 8, 9, 10) and blanks
     * everywhere else, so the moment the header was allowed to move, every sum
     * would have stayed put and appeared under whatever heading happened to
     * land above it. The file would still open, every cell would still hold a
     * number, and nothing in the system would have noticed: nothing checks that
     * a spreadsheet means what it says. A heading and its column are one thing
     * here, so they can only move together.
     */
    const COLS: Record<ControlExportKey, Col> = {
      submittedAt:             { header: "วันที่ส่ง",             value: (r) => fmtDt(r.submittedAt) },
      requestNo:               { header: "เลขที่เคลียร์ (ADC)",    value: (r) => r.requestNo ?? "" },
      staffId:                 { header: "รหัสพนักงาน",           value: (r) => r.staffId ?? "" },
      advanceRequestNo:        { header: "เลขที่ Advance (AP-2)",  value: (r) => r.advanceRequestNo ?? "" },
      requesterFullName:       { header: "ชื่อ",                  value: (r) => r.requesterFullName ?? "" },
      requesterDepartmentName: { header: "แผนก",                  value: (r) => r.requesterDepartmentName ?? "" },
      advanceAmount:           { header: "วงเงินที่ได้รับ",        value: (r) => r.advanceAmount ?? 0,   total: () => sum("advanceAmount") },
      expenseOf:               { header: "เป็นค่าใช้จ่ายของ",      value: (r) => r.expenseOf ?? "" },
      actualTotal:             { header: "รวมใช้จริง",            value: (r) => r.actualTotal ?? 0,     total: () => sum("actualTotal") },
      refundToCompany:         { header: "โอนคืนบริษัท",          value: (r) => r.refundToCompany ?? 0, total: () => sum("refundToCompany") },
      extraToEmployee:         { header: "เบิกเพิ่ม",              value: (r) => r.extraToEmployee ?? 0, total: () => sum("extraToEmployee") },
      pvDocNo:                 { header: "PV",                   value: (r) => reportPv(r).text ?? "" },
      paymentDate:             { header: "Payment Date",         value: (r) => fmtD(r.paymentDate) },
      managerApproved:         { header: "ผู้จัดการอนุมัติ",       value: (r) => withDate(r.managerApprovedName, r.managerApprovedAt) },
      accountActioned:         { header: "บัญชี Action",          value: (r) => withDate(r.accountActionedName, r.accountActionedAt) },
      pendingOn:               { header: "รออนุมัติที่",           value: (r) => r.pendingOn ?? "" },
      overallStatus:           { header: "สถานะ",                 value: (r) => STATUS_LABEL_TH[r.overallStatus as keyof typeof STATUS_LABEL_TH] ?? r.overallStatus },
    };

    const screenOrder = (q.get("cols") ?? "").split(",").filter(Boolean);
    const keys = controlExportOrder(screenOrder);

    const header = keys.map((k) => COLS[k].header);
    const body = rows.map((r) => keys.map((k) => COLS[k].value(r)));
    // "รวมทั้งหมด" sits in the first cell whatever that column now is, the way it
    // always sat in the first cell; every other cell is its own column's total or
    // blank, so the sums travel with their headings.
    const totalRow = keys.map((k, i) => (i === 0 ? "รวมทั้งหมด" : COLS[k].total?.() ?? ""));

    const ws = XLSX.utils.aoa_to_sheet([header, ...body, totalRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AP-3-Control");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="AP-3-Control.xlsx"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
