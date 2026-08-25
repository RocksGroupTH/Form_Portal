import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { listControlRows, type ClrReportFilters } from "@/lib/clr/clear-advance-report-service";
import { STATUS_LABEL_TH } from "@/features/accounting/constants";

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

    const header = [
      "วันที่ส่ง", "เลขที่เคลียร์ (ADC)", "รหัสพนักงาน", "เลขที่ Advance (AP-2)", "ชื่อ", "แผนก",
      "วงเงินที่ได้รับ", "เป็นค่าใช้จ่ายของ", "รวมใช้จริง", "โอนคืนบริษัท", "เบิกเพิ่ม",
      "PV", "Payment Date", "ผู้จัดการอนุมัติ", "บัญชี Action", "หัวหน้าบัญชีอนุมัติ",
      "รออนุมัติที่", "สถานะ",
    ];
    const body = rows.map((r) => [
      fmtDt(r.submittedAt), r.requestNo ?? "", r.staffId ?? "", r.advanceRequestNo ?? "",
      r.requesterFullName ?? "", r.requesterDepartmentName ?? "",
      r.advanceAmount ?? 0, r.expenseOf ?? "", r.actualTotal ?? 0, r.refundToCompany ?? 0, r.extraToEmployee ?? 0,
      r.pvDocNo ?? "", fmtD(r.paymentDate),
      withDate(r.managerApprovedName, r.managerApprovedAt),
      withDate(r.accountActionedName, r.accountActionedAt),
      withDate(r.headApprovedName, r.headApprovedAt),
      r.pendingOn ?? "",
      STATUS_LABEL_TH[r.overallStatus as keyof typeof STATUS_LABEL_TH] ?? r.overallStatus,
    ]);
    const sum = (k: "advanceAmount" | "actualTotal" | "refundToCompany" | "extraToEmployee") =>
      Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) * 100) / 100;
    const totalRow = [
      "รวมทั้งหมด", "", "", "", "", "",
      sum("advanceAmount"), "", sum("actualTotal"), sum("refundToCompany"), sum("extraToEmployee"),
      "", "", "", "", "", "", "",
    ];

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
