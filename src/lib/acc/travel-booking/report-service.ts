import { getAccPool, sql } from "@/lib/acc/pool";
import { isBaht } from "@/lib/acc/currency";
import { currencyWord, rateAsOfYmd } from "@/lib/acc/currency-display";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
import { perDiemLogFor } from "@/lib/acc/travel-booking/perdiem-country";
import {
  bookingBrandScope,
  type BookingBrandAccess,
} from "@/lib/acc/travel-booking/booking-brand-access-shared";
import { bookingBrandScopeSql } from "@/lib/acc/travel-booking/booking-approver-brands";
import { listPerDiemCountryRates } from "@/lib/acc/travel-booking/perdiem-source";
import { rateForDay, type AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";
import { enumerateTravelDates, fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { travelBookingStatusLabel } from "@/features/travel-booking/constants";
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
  /**
   * `AccRequest.CurrentStepCode` — which stage a live request sits on. Carried
   * because `status` alone cannot say: `ManagerApproved` is both Admin's
   * booking stage and accounting's sign-off, and the export prints one label.
   */
  currentStepCode: string | null;
  /** Distinct effective per-diem rate(s) actually applied over the trip, e.g. "500" or "500, 1000". */
  perDiemRate: string | null;
  perDiemDays: number;
  /** **Thai baht, always** — per diem has no currency (`EmployeeAllowanceLog` has no such column). */
  perDiemTotal: number;
  /**
   * `AccRequest.Currency` — what the **booking** figures are in, not the per
   * diem. Null and `"THB"` both mean baht.
   */
  currency: string | null;
  /** THB per 1 unit of `currency`, as stored (or as accounting corrected it). */
  exchangeRate: number | null;
  /**
   * **Which day's rate that is**, `YYYY-MM-DD` (migration 130).
   *
   * The source publishes on working days only, so a booking priced on a
   * Saturday carries Friday's rate. Null on a baht request and on everything
   * written before 130.
   */
  rateAsOf: string | null;
  /**
   * The trip's booking cost — `SUM(AccTravelBookingDetail.TotalAmount)` — **in
   * `currency`**, not baht.
   *
   * Null where the desk has recorded nothing yet, which is every trip before the
   * ADMIN step and every row written before migration 123.
   */
  bookingTotal: number | null;
  /** The same figure converted at `exchangeRate`, or null when it cannot be. */
  bookingTotalBaht: number | null;
  paymentDate: string | null;
  /** Set when EmployeeAllowanceLog shows a rate change inside [departDate, returnDate]. */
  rateChangeNote: string | null;
  /**
   * The request that already counted this trip's first day, when
   * `IsContinuation` is set — see `TravelBookingRequest.continuationFromRequestNo`.
   *
   * On the report it answers the question a zero per diem raises: a one-day
   * continuation shows 0 วัน / 0.00 บาท, and without this the row looks like a
   * mistake rather than a day counted next door.
   */
  continuationFromRequestNo: string | null;
  /** That request's id, so the report can open it rather than print a number. */
  continuationFromRequestId: number | null;
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
      r.EmployeeId, r.CountryCode, r.Status, r.CurrentStepCode, r.PaymentDate, r.SubmittedAt,
      t.ReasonId, t.ReasonName, t.ReasonCustomText, t.WorkDetail,
      t.DepartDate, t.ReturnDate,
      t.ProvinceName,
      t.AccommodationName, t.AccommodationCustomText,
      t.IsContinuation, t.PerDiemDays, t.PerDiemTotal,
      -- Per diem is baht always (EmployeeAllowanceLog has no currency column),
      -- so PerDiemTotal above needs none of this. The *booking* figures do:
      -- AccTravelBookingDetail's amounts are written in the request's own
      -- currency and AccRequest.Currency / .ExchangeRate are what say which and
      -- at what rate. Without them this report cannot tell a 500 ringgit hotel
      -- from a 500 baht one.
      r.Currency, r.ExchangeRate, r.RateAsOf,
      (SELECT SUM(bd.TotalAmount)
         FROM [dbo].[AccTravelBookingDetail] bd
        WHERE bd.TravelBookingId = t.Id) AS BookingTotal,
      -- The same sum in baht, from migration 136's STORED per-row column — not
      -- BookingTotal above multiplied by the rate. Summing baht rows is the
      -- whole reason that column is populated for baht requests too: this
      -- expression needs no currency test, so it cannot convert twice.
      (SELECT SUM(bd.TotalAmountBaht)
         FROM [dbo].[AccTravelBookingDetail] bd
        WHERE bd.TravelBookingId = t.Id) AS BookingTotalBaht,
      -- Matched the same way isContinuation was decided at save time: same
      -- group, an earlier SortOrder, a ReturnDate touching this DepartDate.
      -- Nearest earlier sibling wins.
      (SELECT TOP 1 pr.RequestNo
         FROM [dbo].[AccTravelBooking] pt
         INNER JOIN [dbo].[AccRequest] pr ON pr.Id = pt.RequestId
        WHERE pt.GroupKey = t.GroupKey
          AND pt.SortOrder < t.SortOrder
          AND pt.ReturnDate = t.DepartDate
        ORDER BY pt.SortOrder DESC, pt.Id DESC) AS ContinuationFromRequestNo,
      (SELECT TOP 1 pr.Id
         FROM [dbo].[AccTravelBooking] pt
         INNER JOIN [dbo].[AccRequest] pr ON pr.Id = pt.RequestId
        WHERE pt.GroupKey = t.GroupKey
          AND pt.SortOrder < t.SortOrder
          AND pt.ReturnDate = t.DepartDate
        ORDER BY pt.SortOrder DESC, pt.Id DESC) AS ContinuationFromRequestId,
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

/**
 * `access` is a separate required parameter and is deliberately NOT folded into
 * `TravelBookingReportFilters`. Filters arrive from the query string and are a
 * request; the scope is a decision. Merging them would put the scope one
 * `sp.getAll(...)` away from being widened by whoever builds the filters.
 */
export async function queryTravelBookingReport(
  f: TravelBookingReportFilters,
  access: BookingBrandAccess,
): Promise<TravelBookingReportRow[]> {
  const scope = bookingBrandScope(access);
  if (scope.kind === "none") return [];
  const pool = await getAccPool();
  const req = pool.request();
  const where: string[] = [];
  // Scopes both the report and its Excel export: neither route accepts an id
  // list, so they build their filters from the same named params and this one
  // predicate covers both.
  const brandFilter = bookingBrandScopeSql(scope, req, "r.BrandCode");
  if (brandFilter) where.push(brandFilter);

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
  // The by-province filter is gone with ข้อ8 (2026-09-01). Nothing writes
  // ProvinceId any more, so filtering on it would return only trips filed
  // before that day — a filter that looks like it works and silently hides
  // every new request. The column stays for history; the filter does not.
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
  // One list for the whole report, beside the per-employee batch. This column
  // re-derives the rate from scratch rather than reading what was stored, so it
  // has to be given the same input the write had — otherwise it prints the
  // employee's Thai rate against a country-rate total, and a reader dividing one
  // by the other gets a day count that contradicts the column beside it.
  const [countryRates] = await Promise.all([
    listPerDiemCountryRates(),
    ...employeeIds.map(async (id) => {
      logByEmployee.set(id, await getAllowanceLog(id));
    }),
  ]);

  return raw.map((x) => {
    const departDate = x.DepartDate ? ymd(x.DepartDate as Date) : null;
    const returnDate = x.ReturnDate ? ymd(x.ReturnDate as Date) : null;
    const log = (x.EmployeeId as string | null) ? logByEmployee.get(x.EmployeeId as string) ?? [] : [];
    const { perDiemRate, rateChangeNote } = computeReportPerDiemDisplay(
      departDate,
      returnDate,
      !!x.IsContinuation,
      perDiemLogFor(x.CountryCode as string | null, log, countryRates).log,
    );
    const bookingTotal =
      x.BookingTotal === null || x.BookingTotal === undefined
        ? null
        : Number(x.BookingTotal);

    return {
      id: x.Id as number,
      requestNo: (x.RequestNo as string) ?? null,
      brandCode: (x.BrandCode as string) ?? null,
      // Only meaningful where the flag is set; a stray sibling match on a
      // non-continuation row would read as a deduction that never happened.
      continuationFromRequestNo: x.IsContinuation
        ? ((x.ContinuationFromRequestNo as string) ?? null)
        : null,
      continuationFromRequestId: x.IsContinuation
        ? ((x.ContinuationFromRequestId as number) ?? null)
        : null,
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
      currentStepCode: (x.CurrentStepCode as string) ?? null,
      perDiemRate,
      perDiemDays: (x.PerDiemDays as number) ?? 0,
      perDiemTotal: Number(x.PerDiemTotal) || 0,
      currency: (x.Currency as string | null) ?? null,
      exchangeRate:
        x.ExchangeRate === null || x.ExchangeRate === undefined
          ? null
          : Number(x.ExchangeRate),
      rateAsOf: rateAsOfYmd((x.RateAsOf as string | Date | null) ?? null),
      bookingTotal,
      // Read, not converted. It was `amountInBaht(bookingTotal, …)` until
      // 2026-09-02 — correct, but one of three independent multiplications of
      // the same figure by the same rate. The sum now comes from the stored
      // per-row column, which `recomputeBookingBaht` keeps in step with both
      // writers of that rate, so the export, the screen and the detail page read
      // one number rather than each computing their own.
      bookingTotalBaht:
        x.BookingTotalBaht === null || x.BookingTotalBaht === undefined
          ? null
          : Number(x.BookingTotalBaht),
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
  // Six places — AccRequest.ExchangeRate is DECIMAL(18,6), and a rate truncated
  // in the export cannot be reconciled against the one the trip was converted at.
  const rateStyle = { alignment: { horizontal: "right" as const }, numFmt: "#,##0.000000" };

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
    "วันเดินทางขาไป", "วันเดินทางขากลับ", "จังหวัด/เมือง", "สถานที่พักค้างคืน",
    "สถานที่ไปปฏิบัติงาน", "วันที่อนุมัติ", "สถานะ",
    // "(บาท)" is now stated rather than assumed. Per diem has no currency —
    // EmployeeAllowanceLog has no such column — so this heading was already
    // true; saying so is what stops it being read as "in the currency the four
    // columns after it name".
    "เบี้ยเลี้ยง (เรท/วัน)", "เบี้ยเลี้ยง (จำนวนวัน)", "เบี้ยเลี้ยง (ยอดรวม, บาท)",
    "หมายเหตุ Per diem",
    // The booking cost, which *is* the figure the request's currency applies to.
    // It was in no column at all before, which is why a currency column alone
    // would have named a currency describing nothing on the sheet.
    "สกุลเงินค่าจอง", "ค่าจอง (ตามสกุลเงิน)", "อัตราอ้างอิง", "ค่าจอง (บาท)",
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
  const MONEY_COL = columns.indexOf("เบี้ยเลี้ยง (ยอดรวม, บาท)");
  const BOOKING_COL = columns.indexOf("ค่าจอง (ตามสกุลเงิน)");
  const RATE_COL = columns.indexOf("อัตราอ้างอิง");
  const BOOKING_BAHT_COL = columns.indexOf("ค่าจอง (บาท)");

  for (const r of rows) {
    aoa.push([
      r.requestNo, r.brandCode, r.staffId, r.fullName, r.position, r.departmentName,
      r.reasonName, r.workDetail,
      r.departDate ? fmtYmdDisplay(r.departDate) : null,
      r.returnDate ? fmtYmdDisplay(r.returnDate) : null,
      r.provinceName, r.accommodationName,
      r.workLocationsCsv,
      r.approvedDate ? fmtYmdDisplay(r.approvedDate) : null,
      travelBookingStatusLabel(r.status, r.currentStepCode),
      r.perDiemRate, r.perDiemDays, r.perDiemTotal,
      r.continuationFromRequestNo ? `วันแรกนับใน ${r.continuationFromRequestNo}` : null,
      // Always filled, never blank for baht: a column of blanks beside a column
      // of MYR reads as "not recorded" rather than "baht", and a filter on it
      // would silently drop every ordinary trip.
      isBaht(r.currency) ? "THB" : currencyWord(r.currency),
      r.bookingTotal,
      // Blank for baht — there is no rate, and printing 1 would invite somebody
      // to multiply by it.
      isBaht(r.currency) ? null : r.exchangeRate,
      r.bookingTotalBaht,
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
    const bookingAddr = XLSX.utils.encode_cell({ r: rr, c: BOOKING_COL });
    if (ws[bookingAddr]) ws[bookingAddr].s = moneyStyle;
    const bookingBahtAddr = XLSX.utils.encode_cell({ r: rr, c: BOOKING_BAHT_COL });
    if (ws[bookingBahtAddr]) ws[bookingBahtAddr].s = moneyStyle;
    const rateAddr = XLSX.utils.encode_cell({ r: rr, c: RATE_COL });
    if (ws[rateAddr]) ws[rateAddr].s = rateStyle;
  }
  // By heading, for the reason the style rules above give: `6` and `11` were the
  // two long free-text columns and would have widened whatever moved into those
  // positions instead.
  const WIDE = ["เหตุผลในการเดินทาง", "สถานที่พักค้างคืน"];
  ws["!cols"] = columns.map((label) => ({ wch: WIDE.indexOf(label) !== -1 ? 30 : 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
