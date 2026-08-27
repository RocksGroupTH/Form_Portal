import { getAccPool, sql } from "@/lib/acc/pool";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
import { rateForDay, type AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";
import { enumerateTravelDates, fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { STATUS_LABEL_TH } from "@/features/travel-booking/constants";
import type { TravelBookingStatus } from "@/features/travel-booking/types";
import * as XLSX from "xlsx-js-style";

/**
 * AP-17 HR report (spec §9) — filters + query + Excel workbook builder.
 * Mirrors `src/lib/acc/report-service.ts` (AP-1's closest analog); AP-15's report is on
 * an unmerged branch so isn't available to copy directly.
 */

export interface TravelBookingReportFilters {
  /** travel = DepartDate · submit = AccRequest.SubmittedAt · approve = MANAGER AccApproval.ActionedAt · payment = AccRequest.PaymentDate */
  dateBasis: "travel" | "submit" | "approve" | "payment";
  from?: string | null;
  to?: string | null;
  /** Multi-value filters — empty/omitted means "no filter". */
  provinceIds?: number[] | null;
  reasonIds?: number[] | null;
  statuses?: string[] | null;
  departmentNames?: string[] | null;
  staffId?: number | null;
}

/** Repeated query params → numbers, dropping anything that isn't one. */
export function numberList(values: string[]): number[] {
  return values.map(Number).filter((n) => !Number.isNaN(n) && n !== 0);
}

export interface TravelBookingReportRow {
  id: number;
  requestNo: string | null;
  /** `AccRequest.BrandCode` — per trip, so two rows of one group can differ. */
  brandCode: string | null;
  staffId: number | null;
  fullName: string | null;
  position: string | null;
  departmentName: string | null;
  reasonName: string | null;
  workDetail: string | null;
  departDate: string | null;
  returnDate: string | null;
  provinceName: string | null;
  accommodationName: string | null;
  /** Comma-joined AccTravelWorkLocation names (สถานที่ไปปฏิบัติงาน). */
  workLocationsCsv: string | null;
  /** MANAGER-step AccApproval.ActionedAt, only when that step is Approved. */
  approvedDate: string | null;
  status: TravelBookingStatus;
  /** Distinct effective per-diem rate(s) actually applied over the trip, e.g. "500" or "500, 1000". */
  perDiemRate: string | null;
  perDiemDays: number;
  perDiemTotal: number;
  paymentDate: string | null;
  /** Set when EmployeeAllowanceLog shows a rate change inside [departDate, returnDate]. */
  rateChangeNote: string | null;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function combineNameCustom(name: string | null, custom: string | null): string | null {
  const n = name?.trim() || null;
  const c = custom?.trim() || null;
  if (n && c) return `${n} (${c})`;
  return n ?? c;
}

/** Plain Thai-locale number, no forced decimals — a per-diem *rate*, not a money total. */
function fmtRateNumber(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

/**
 * Effective rate(s) applied across the trip's counted days + a note when the
 * allowance changed mid-trip (any EmployeeAllowanceLog entry effective strictly
 * after DepartDate and on/before ReturnDate).
 */
function computeReportPerDiemDisplay(
  departDate: string | null,
  returnDate: string | null,
  isContinuation: boolean,
  log: AllowanceLogEntry[],
): { perDiemRate: string | null; rateChangeNote: string | null } {
  if (!departDate || !returnDate) return { perDiemRate: null, rateChangeNote: null };

  const allDays = enumerateTravelDates(departDate, returnDate);
  const countedDays = isContinuation ? allDays.slice(1) : allDays;
  if (countedDays.length === 0) return { perDiemRate: null, rateChangeNote: null };

  const rates = countedDays.map((d) => rateForDay(d, log));
  const distinctRates = Array.from(new Set(rates)).sort((a, b) => a - b);
  // " / " (not ", ") — a comma would be ambiguous next to th-TH's own thousands separator
  // when more than one distinct rate applies (e.g. "500 / 1,000").
  const perDiemRate = distinctRates.map(fmtRateNumber).join(" / ");

  const changeDates = log
    .filter((e) => e.effectiveDate > departDate && e.effectiveDate <= returnDate)
    .map((e) => e.effectiveDate);
  const rateChangeNote =
    changeDates.length > 0 ? `เปลี่ยนเรท ${changeDates.map(fmtYmdDisplay).join(", ")}` : null;

  return { perDiemRate, rateChangeNote };
}

/** Base CTE — every column the report needs, incl. correlated subqueries for work locations + manager-approved date. */
const BASE_CTE = `
  WITH Base AS (
    SELECT
      r.Id, r.RequestNo, r.BrandCode, r.StaffId, r.RequesterFullName, r.RequesterPosition, r.RequesterDepartmentName,
      r.EmployeeId, r.Status, r.PaymentDate, r.SubmittedAt,
      t.ReasonId, t.ReasonName, t.ReasonCustomText, t.WorkDetail,
      t.DepartDate, t.ReturnDate,
      t.ProvinceId, t.ProvinceName,
      t.AccommodationName, t.AccommodationCustomText,
      t.IsContinuation, t.PerDiemDays, t.PerDiemTotal,
      (SELECT STRING_AGG(wl.Name, N', ') WITHIN GROUP (ORDER BY wl.SortOrder, wl.Id)
       FROM [dbo].[AccTravelWorkLocation] wl
       WHERE wl.TravelBookingId = t.Id) AS WorkLocationsCsv,
      (SELECT TOP 1 a.ActionedAt
       FROM [dbo].[AccApproval] a
       WHERE a.RequestId = r.Id AND a.StepCode = N'MANAGER' AND a.Status = N'Approved'
       ORDER BY a.ActionedAt DESC) AS ApprovedDate
    FROM [dbo].[AccRequest] r
    INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
    WHERE r.FormCode = N'AP-17' AND r.Status <> N'Draft'
  )
`;

function dateBasisColumn(basis: TravelBookingReportFilters["dateBasis"]): string {
  switch (basis) {
    case "travel": return "DepartDate";
    case "approve": return "ApprovedDate";
    case "payment": return "PaymentDate";
    case "submit":
    default: return "SubmittedAt";
  }
}

export async function queryTravelBookingReport(
  f: TravelBookingReportFilters,
): Promise<TravelBookingReportRow[]> {
  const pool = await getAccPool();
  const req = pool.request();
  const where: string[] = [];

  /** `col IN (@p0, @p1, …)` — one bound parameter per value, never string-interpolated. */
  function whereIn<T>(column: string, prefix: string, values: T[] | null | undefined, type: sql.ISqlType | (() => sql.ISqlType)): void {
    if (!values || values.length === 0) return;
    const names = values.map((v, i) => {
      const name = `${prefix}${i}`;
      req.input(name, type, v);
      return `@${name}`;
    });
    where.push(`${column} IN (${names.join(", ")})`);
  }

  const dateCol = dateBasisColumn(f.dateBasis);
  if (f.from) { req.input("from", sql.Date, f.from); where.push(`${dateCol} >= @from`); }
  if (f.to) { req.input("to", sql.Date, f.to); where.push(`${dateCol} <= @to`); }
  whereIn("ProvinceId", "province", f.provinceIds, sql.Int);
  whereIn("ReasonId", "reason", f.reasonIds, sql.Int);
  whereIn("Status", "status", f.statuses, sql.NVarChar);
  whereIn("RequesterDepartmentName", "dept", f.departmentNames, sql.NVarChar);
  if (f.staffId) { req.input("staff", sql.Int, f.staffId); where.push("StaffId = @staff"); }

  const sqlText = `
    ${BASE_CTE}
    SELECT * FROM Base
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY SubmittedAt DESC, Id DESC
  `;
  const res = await req.query(sqlText);
  const raw = res.recordset as Record<string, unknown>[];

  // Batch-load one allowance-rate history per distinct employee (avoids N duplicate queries
  // for requesters who submitted more than one AP-17 request in the filtered range).
  const employeeIds = Array.from(
    new Set(raw.map((x) => x.EmployeeId as string | null).filter((id): id is string => !!id)),
  );
  const logByEmployee = new Map<string, AllowanceLogEntry[]>();
  await Promise.all(
    employeeIds.map(async (id) => {
      logByEmployee.set(id, await getAllowanceLog(id));
    }),
  );

  return raw.map((x) => {
    const departDate = x.DepartDate ? ymd(x.DepartDate as Date) : null;
    const returnDate = x.ReturnDate ? ymd(x.ReturnDate as Date) : null;
    const log = (x.EmployeeId as string | null) ? logByEmployee.get(x.EmployeeId as string) ?? [] : [];
    const { perDiemRate, rateChangeNote } = computeReportPerDiemDisplay(
      departDate,
      returnDate,
      !!x.IsContinuation,
      log,
    );

    return {
      id: x.Id as number,
      requestNo: (x.RequestNo as string) ?? null,
      brandCode: (x.BrandCode as string) ?? null,
      staffId: (x.StaffId as number) ?? null,
      fullName: (x.RequesterFullName as string) ?? null,
      position: (x.RequesterPosition as string) ?? null,
      departmentName: (x.RequesterDepartmentName as string) ?? null,
      reasonName: combineNameCustom(x.ReasonName as string, x.ReasonCustomText as string),
      workDetail: (x.WorkDetail as string) ?? null,
      departDate,
      returnDate,
      provinceName: (x.ProvinceName as string) ?? null,
      accommodationName: combineNameCustom(x.AccommodationName as string, x.AccommodationCustomText as string),
      workLocationsCsv: (x.WorkLocationsCsv as string) ?? null,
      approvedDate: x.ApprovedDate ? ymd(x.ApprovedDate as Date) : null,
      status: x.Status as TravelBookingStatus,
      perDiemRate,
      perDiemDays: (x.PerDiemDays as number) ?? 0,
      perDiemTotal: Number(x.PerDiemTotal) || 0,
      paymentDate: x.PaymentDate ? ymd(x.PaymentDate as Date) : null,
      rateChangeNote,
    };
  });
}

export interface TravelBookingReportMeta {
  companyName?: string;
  generatedAt: string;
  filterSummary?: string;
}

export function buildTravelBookingReportWorkbook(
  rows: TravelBookingReportRow[],
  meta: TravelBookingReportMeta,
): Buffer {
  const headerStyle = { font: { bold: true }, alignment: { horizontal: "center" as const } };
  const moneyStyle = { alignment: { horizontal: "right" as const }, numFmt: "#,##0.00" };
  const numStyle = { alignment: { horizontal: "right" as const } };

  const aoa: (string | number | null)[][] = [];
  aoa.push([meta.companyName ?? "Rocks Group"]);
  aoa.push(["รายงานคำขอจองที่พัก/ตั๋วโดยสาร (AP-17 Accommodation/Ticket Booking Report)"]);
  if (meta.filterSummary) aoa.push([meta.filterSummary]);
  aoa.push([`สร้างเมื่อ: ${meta.generatedAt}`]);
  aoa.push([]);

  const headerRowIndex = aoa.length;
  const columns = [
    "เลขที่คำขอ", "แบรนด์ที่เบิก", "รหัสพนักงาน", "ชื่อ-นามสกุล", "ตำแหน่ง", "แผนก",
    "เหตุผลในการเดินทาง", "รายละเอียดการไปปฏิบัติงาน",
    "วันเดินทางขาไป", "วันเดินทางขากลับ", "จังหวัด", "สถานที่พักค้างคืน",
    "สถานที่ไปปฏิบัติงาน", "วันที่อนุมัติ", "สถานะ",
    "เบี้ยเลี้ยง (เรท/วัน)", "เบี้ยเลี้ยง (จำนวนวัน)", "เบี้ยเลี้ยง (ยอดรวม)",
    "วันที่จ่าย", "หมายเหตุการเปลี่ยนเรท",
  ];
  aoa.push(columns);

  // Found by heading, not written as a number.
  //
  // These were `15` and `16` — correct until a column was inserted before them,
  // at which point the right-alignment and the money format silently move one
  // column left and land on somebody's per-diem *rate* and day count. Adding
  // "แบรนด์ที่เบิก" second is exactly that edit, so the trap is removed rather
  // than re-tuned.
  const NUM_COL = columns.indexOf("เบี้ยเลี้ยง (จำนวนวัน)");
  const MONEY_COL = columns.indexOf("เบี้ยเลี้ยง (ยอดรวม)");

  for (const r of rows) {
    aoa.push([
      r.requestNo, r.brandCode, r.staffId, r.fullName, r.position, r.departmentName,
      r.reasonName, r.workDetail,
      r.departDate ? fmtYmdDisplay(r.departDate) : null,
      r.returnDate ? fmtYmdDisplay(r.returnDate) : null,
      r.provinceName, r.accommodationName,
      r.workLocationsCsv,
      r.approvedDate ? fmtYmdDisplay(r.approvedDate) : null,
      STATUS_LABEL_TH[r.status] ?? r.status,
      r.perDiemRate, r.perDiemDays, r.perDiemTotal,
      r.paymentDate ? fmtYmdDisplay(r.paymentDate) : null,
      r.rateChangeNote,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    if (ws[addr]) ws[addr].s = headerStyle;
  }
  for (let rr = headerRowIndex + 1; rr <= range.e.r; rr++) {
    const numAddr = XLSX.utils.encode_cell({ r: rr, c: NUM_COL });
    if (ws[numAddr]) ws[numAddr].s = numStyle;
    const moneyAddr = XLSX.utils.encode_cell({ r: rr, c: MONEY_COL });
    if (ws[moneyAddr]) ws[moneyAddr].s = moneyStyle;
  }
  ws["!cols"] = columns.map((_, i) => ({ wch: i === 6 || i === 11 ? 30 : 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
