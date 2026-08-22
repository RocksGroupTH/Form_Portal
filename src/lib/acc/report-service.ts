import { getAccPool, sql } from "@/lib/acc/pool";
import { queryBothPools } from "@/lib/acc/query-both";
import {
  resolveViewerEnvironmentMap,
  type FormEnvironmentValue,
} from "@/lib/form-environment";
import { keepRowsInCurrentEnvironment } from "@/lib/form-environment/current-rows";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import {
  fmtTravelSpanLabel,
  fmtTravelDatesList,
  fmtYmdDisplay,
} from "@/features/accounting/lib/format-travel-dates";
import { fmtReportVehicleNames } from "@/features/accounting/lib/travel-sections";
import * as XLSX from "xlsx-js-style";

export interface ReportFilters {
  dateBasis?: "travel" | "submit" | "payment";
  from?: string | null;
  to?: string | null;
  brandCode?: string | null;
  status?: string | null;
  departmentName?: string | null;
  staffId?: number | null;
  vehicleName?: string | null;
  paymentDate?: string | null;
  /** request = one row per request (aggregated); day = one row per travel day */
  view?: "request" | "day";
}

export interface ReportTravelVehicleLine {
  vehicleName: string;
  amount: number;
}

export interface ReportTravelDayLine {
  travelDate: string;
  totalAmount: number;
  vehicleNames: string[];
  vehicles: ReportTravelVehicleLine[];
  workDetail: string | null;
}

export interface ReportRow {
  id: number;
  requestNo: string | null;
  formCode: string;
  formName: string | null;
  staffId: number | null;
  requesterFullName: string | null;
  requesterDepartmentName: string | null;
  brandCode: string | null;
  travelDate: string | null;
  travelDateTo?: string | null;
  dayCount?: number;
  travelDates?: string[];
  travelDayLines?: ReportTravelDayLine[];
  vehicleName: string | null;
  vehicleNames?: string[];
  workDetail: string | null;
  totalDistanceKm: number | null;
  totalAmount: number | null;
  status: string;
  paymentDate: string | null;
  submittedAt: string | null;
  currentStepCode?: string | null;
  pendingStepCode?: string | null;
  pendingApproverName?: string | null;
  pendingApproverEmail?: string | null;
  managerStaffId?: number | null;
  managerEmail?: string | null;
  /** True when the signed-in user already approved the MANAGER step (My Work API). */
  viewerManagerApproved?: boolean;
  /**
   * Which database this row came from. Set by queryBothPools on the endpoints
   * that merge; absent on single-database reads. UAT rows are test data and are
   * badged as such in the UI.
   */
  environment?: "Production" | "UAT";
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FROM_JOINS = `FROM [dbo].[AccRequest] r
    LEFT JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
    LEFT JOIN [dbo].[AccFormMaster] f ON f.FormCode = r.FormCode`;

const DAY_ROW_SELECT = `r.Id, r.RequestNo, r.FormCode, f.FormNameTh, r.StaffId, r.RequesterFullName, r.RequesterDepartmentName,
  r.BrandCode, t.TravelDate, t.VehicleName, t.WorkDetail, t.TotalDistanceKm, t.TotalAmount,
  r.Status, r.PaymentDate, r.SubmittedAt`;

/** Correlated subquery: per-day amounts, vehicles, work detail for request-level rows. */
export const TRAVEL_DAYS_CSV_SELECT = `(SELECT STRING_AGG(
      CONVERT(varchar(10), te.TravelDate, 23) + N'|' +
      COALESCE(CAST(te.TotalAmount AS varchar(32)), N'0') + N'|' +
      COALESCE(dayVehicles.Names, N'') + N'|' +
      REPLACE(REPLACE(REPLACE(REPLACE(
        COALESCE(LTRIM(RTRIM(te.WorkDetail)), N''),
        N'|', N' '), N',', N' '), CHAR(13), N' '), CHAR(10), N' '),
      N','
    ) WITHIN GROUP (ORDER BY te.SortOrder, te.TravelDate, te.Id)
   FROM [dbo].[AccTravelExpense] te
   OUTER APPLY (
     SELECT SUM(CASE WHEN i.ItemType IN (N'toll', N'parking') THEN COALESCE(i.Amount, 0) ELSE 0 END) AS ExtraAmt
     FROM [dbo].[AccTravelExpenseItem] i
     WHERE i.TravelExpenseId = te.Id AND i.VehicleSectionId IS NULL
   ) rateExtras
   OUTER APPLY (
     SELECT SUM(CASE WHEN i.ItemType IN (N'fare', N'toll') THEN COALESCE(i.Amount, 0) ELSE 0 END) AS Amt
     FROM [dbo].[AccTravelExpenseItem] i
     WHERE i.TravelExpenseId = te.Id AND i.VehicleSectionId IS NULL
   ) legacyItems
   OUTER APPLY (
     SELECT STRING_AGG(VehiclePart, N';') WITHIN GROUP (ORDER BY MinOrd) AS Names
     FROM (
       SELECT
         REPLACE(REPLACE(COALESCE(VehicleName, N''), N'|', N' '), N';', N' ') + N':' +
         COALESCE(CAST(Amount AS varchar(32)), N'0') AS VehiclePart,
         MinOrd
       FROM (
         SELECT
           LTRIM(RTRIM(te.VehicleName)) AS VehicleName,
           CAST(ROUND(
             COALESCE(te.TotalDistanceKm, 0) * COALESCE(te.RatePerKm, 0) + COALESCE(rateExtras.ExtraAmt, 0),
           2) AS DECIMAL(18, 2)) AS Amount,
           0 AS MinOrd
         WHERE te.VehicleId IS NOT NULL
           AND te.IsManualEntry = 0
           AND LTRIM(RTRIM(COALESCE(te.VehicleName, N''))) <> N''

         UNION ALL

         SELECT
           LTRIM(RTRIM(s.VehicleName)),
           CAST(COALESCE(secItems.Amt, 0) AS DECIMAL(18, 2)),
           s.SortOrder * 1000 + s.Id AS MinOrd
         FROM [dbo].[AccTravelVehicleSection] s
         OUTER APPLY (
           SELECT SUM(CASE WHEN i.ItemType IN (N'fare', N'toll') THEN COALESCE(i.Amount, 0) ELSE 0 END) AS Amt
           FROM [dbo].[AccTravelExpenseItem] i
           WHERE i.VehicleSectionId = s.Id
         ) secItems
         WHERE s.TravelExpenseId = te.Id
           AND COALESCE(s.IsManualEntry, 1) = 1
           AND LTRIM(RTRIM(COALESCE(s.VehicleName, N''))) <> N''

         UNION ALL

         SELECT
           LTRIM(RTRIM(te.VehicleName)),
           CAST(COALESCE(legacyItems.Amt, te.TotalAmount, 0) AS DECIMAL(18, 2)),
           999999 AS MinOrd
         WHERE te.IsManualEntry = 1
           AND LTRIM(RTRIM(COALESCE(te.VehicleName, N''))) <> N''
           AND NOT EXISTS (
             SELECT 1 FROM [dbo].[AccTravelVehicleSection] sx WHERE sx.TravelExpenseId = te.Id
           )
       ) vrows
       WHERE VehicleName IS NOT NULL AND VehicleName <> N''
     ) parts
   ) dayVehicles
   WHERE te.RequestId = r.Id AND te.TravelDate IS NOT NULL) AS TravelDaysCsv`;

const REQUEST_ROW_SELECT = `r.Id, r.RequestNo, r.FormCode, f.FormNameTh, r.StaffId, r.RequesterFullName, r.RequesterDepartmentName,
  r.BrandCode,
  MIN(t.TravelDate) AS TravelDate,
  MAX(t.TravelDate) AS TravelDateTo,
  COUNT(t.Id) AS DayCount,
  (SELECT STRING_AGG(CONVERT(varchar(10), te.TravelDate, 23), ',')
          WITHIN GROUP (ORDER BY te.SortOrder, te.TravelDate, te.Id)
   FROM [dbo].[AccTravelExpense] te
   WHERE te.RequestId = r.Id AND te.TravelDate IS NOT NULL) AS TravelDatesCsv,
  ${TRAVEL_DAYS_CSV_SELECT},
  (SELECT STRING_AGG(VehicleName, ',') WITHIN GROUP (ORDER BY MinOrd)
   FROM (
     SELECT VehicleName, MIN(Ord) AS MinOrd
     FROM (
       SELECT LTRIM(RTRIM(te.VehicleName)) AS VehicleName,
              te.SortOrder * 100000 + te.Id AS Ord
       FROM [dbo].[AccTravelExpense] te
       WHERE te.RequestId = r.Id
         AND te.VehicleName IS NOT NULL AND LTRIM(RTRIM(te.VehicleName)) <> N''
       UNION ALL
       SELECT LTRIM(RTRIM(s.VehicleName)) AS VehicleName,
              te.SortOrder * 100000 + s.SortOrder * 1000 + s.Id AS Ord
       FROM [dbo].[AccTravelExpense] te
       INNER JOIN [dbo].[AccTravelVehicleSection] s ON s.TravelExpenseId = te.Id
       WHERE te.RequestId = r.Id
         AND s.VehicleName IS NOT NULL AND LTRIM(RTRIM(s.VehicleName)) <> N''
     ) raw
     GROUP BY VehicleName
   ) dedup) AS VehicleNamesCsv,
  (SELECT TOP 1 te.VehicleName FROM [dbo].[AccTravelExpense] te
   WHERE te.RequestId = r.Id ORDER BY te.SortOrder, te.TravelDate, te.Id) AS VehicleName,
  (SELECT TOP 1 te.WorkDetail FROM [dbo].[AccTravelExpense] te
   WHERE te.RequestId = r.Id ORDER BY te.SortOrder, te.TravelDate, te.Id) AS WorkDetail,
  SUM(t.TotalDistanceKm) AS TotalDistanceKm,
  r.TotalAmount,
  r.Status, r.PaymentDate, r.SubmittedAt, r.CurrentStepCode,
  r.ManagerStaffId, r.ManagerEmail,
  (SELECT TOP 1 a.StepCode
   FROM [dbo].[AccApproval] a
   WHERE a.RequestId = r.Id AND a.Status = N'Pending'
   ORDER BY a.StepOrder, a.Id) AS PendingStepCode,
  (SELECT TOP 1 COALESCE(
     NULLIF(LTRIM(RTRIM(CONCAT(e.FirstName, N' ', e.LastName))), N''),
     e.FullName
   )
   FROM [dbo].[AccApproval] a
   LEFT JOIN ${hrEmployeeTable()} e ON e.StaffId = a.AssignedTo AND e.Status = N'Active'
   WHERE a.RequestId = r.Id AND a.Status = N'Pending'
   ORDER BY a.StepOrder, a.Id) AS PendingApproverName,
  (SELECT TOP 1 COALESCE(NULLIF(LTRIM(RTRIM(a.AssignedEmail)), N''), r.ManagerEmail)
   FROM [dbo].[AccApproval] a
   WHERE a.RequestId = r.Id AND a.Status = N'Pending'
   ORDER BY a.StepOrder, a.Id) AS PendingApproverEmail`;

function parseCsvList(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw.split(",").filter(Boolean);
}

function parseVehicleAmountField(
  raw: string | undefined,
  dayTotal: number,
): ReportTravelVehicleLine[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: ReportTravelVehicleLine[] = [];
  let hasAmounts = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const colon = part.lastIndexOf(":");
    if (colon > 0 && /^-?\d+(\.\d+)?$/.test(part.slice(colon + 1).trim())) {
      const name = part.slice(0, colon).trim();
      const amount = Number(part.slice(colon + 1)) || 0;
      if (name) {
        out.push({ vehicleName: name, amount });
        hasAmounts = true;
      }
    } else if (part) {
      out.push({ vehicleName: part, amount: 0 });
    }
  }
  if (!hasAmounts && out.length === 1) {
    out[0].amount = dayTotal;
  } else if (!hasAmounts && out.length > 1 && dayTotal > 0) {
    const each = Math.round((dayTotal / out.length) * 100) / 100;
    let remaining = dayTotal;
    for (let i = 0; i < out.length; i++) {
      const amt = i === out.length - 1 ? remaining : each;
      out[i].amount = amt;
      remaining = Math.round((remaining - amt) * 100) / 100;
    }
  }
  return out;
}

export function parseTravelDayLines(
  raw: unknown,
): ReportTravelDayLine[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const lines: ReportTravelDayLine[] = [];
  const parts = raw.split(",");
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i].trim();
    if (!seg) continue;
    const fields = seg.split("|");
    const travelDate = fields[0]?.trim();
    if (!travelDate) continue;
    const workDetailRaw = fields[3]?.trim();
    const totalAmount = Number(fields[1]) || 0;
    const vehicles = parseVehicleAmountField(fields[2], totalAmount);
    lines.push({
      travelDate,
      totalAmount,
      vehicleNames: vehicles.map((v) => v.vehicleName),
      vehicles,
      workDetail: workDetailRaw || null,
    });
  }
  return lines.length > 0 ? lines : undefined;
}

function mapRow(
  x: Record<string, unknown>,
  view: "request" | "day",
): ReportRow {
  const travelDayLines =
    view === "request"
      ? parseTravelDayLines(x.TravelDaysCsv)
      : x.TravelDate
        ? (() => {
            const totalAmount =
              x.TotalAmount === null || x.TotalAmount === undefined
                ? 0
                : Number(x.TotalAmount);
            const vehicleName = (x.VehicleName as string)?.trim() || "";
            const vehicles = vehicleName
              ? [{ vehicleName, amount: totalAmount }]
              : [];
            return [
              {
                travelDate: ymd(x.TravelDate as Date),
                totalAmount,
                vehicleNames: vehicles.map((v) => v.vehicleName),
                vehicles,
                workDetail: (x.WorkDetail as string)?.trim() || null,
              },
            ];
          })()
        : undefined;

  return {
    id: x.Id as number,
    requestNo: (x.RequestNo as string) ?? null,
    formCode: (x.FormCode as string) ?? "",
    formName: (x.FormNameTh as string) ?? null,
    staffId: (x.StaffId as number) ?? null,
    requesterFullName: (x.RequesterFullName as string) ?? null,
    requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
    brandCode: (x.BrandCode as string) ?? null,
    travelDate: x.TravelDate ? ymd(x.TravelDate as Date) : null,
    travelDateTo:
      view === "request" && x.TravelDateTo ? ymd(x.TravelDateTo as Date) : null,
    dayCount: view === "request" ? Number(x.DayCount) || 0 : undefined,
    travelDates:
      view === "request" ? parseCsvList(x.TravelDatesCsv) : undefined,
    travelDayLines,
    vehicleName: (x.VehicleName as string) ?? null,
    vehicleNames:
      view === "request" ? parseCsvList(x.VehicleNamesCsv) : undefined,
    workDetail: (x.WorkDetail as string) ?? null,
    totalDistanceKm:
      x.TotalDistanceKm === null || x.TotalDistanceKm === undefined
        ? null
        : Number(x.TotalDistanceKm),
    totalAmount:
      x.TotalAmount === null || x.TotalAmount === undefined
        ? null
        : Number(x.TotalAmount),
    status: x.Status as string,
    paymentDate: x.PaymentDate ? ymd(x.PaymentDate as Date) : null,
    submittedAt: x.SubmittedAt ? (x.SubmittedAt as Date).toISOString() : null,
    currentStepCode: (x.CurrentStepCode as string) ?? null,
    pendingStepCode: (x.PendingStepCode as string) ?? null,
    pendingApproverName: (x.PendingApproverName as string) ?? null,
    pendingApproverEmail: (x.PendingApproverEmail as string) ?? null,
    managerStaffId: (x.ManagerStaffId as number) ?? null,
    managerEmail: (x.ManagerEmail as string) ?? null,
    viewerManagerApproved:
      x.ViewerManagerApproved != null
        ? Number(x.ViewerManagerApproved) === 1
        : undefined,
  };
}

function buildListQuery(
  view: "request" | "day",
  where: string,
  order: string,
  extraSelect = "",
): string {
  if (view === "day") {
    return `
      SELECT ${DAY_ROW_SELECT}
      ${FROM_JOINS}
      WHERE ${where}
      ORDER BY ${order}
    `;
  }
  return `
    SELECT ${REQUEST_ROW_SELECT}${extraSelect}
    ${FROM_JOINS}
    WHERE ${where}
    GROUP BY r.Id, r.RequestNo, r.FormCode, f.FormNameTh, r.StaffId, r.RequesterFullName,
      r.RequesterDepartmentName, r.BrandCode, r.TotalAmount, r.Status, r.PaymentDate, r.SubmittedAt,
      r.CurrentStepCode, r.ManagerStaffId, r.ManagerEmail
    ORDER BY ${order}
  `;
}

/**
 * Sort a merged result the way the SQL used to.
 *
 * `buildListQuery` orders by `r.SubmittedAt DESC, r.Id DESC`, but that only
 * orders within each database. Reapply it across the concatenation.
 */
function bySubmittedAtDesc(a: ReportRow, b: ReportRow): number {
  const at = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
  const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/**
 * The viewer's per-form environment map, or an empty one if Fast_Core cannot be
 * read.
 *
 * `resolveViewerEnvironmentMap` is a Fast_Core read, and it is the only reason
 * `/mine` and `/work` touch Fast_Core at all: `resolveCurrentFormAccess`
 * short-circuits on the `BOTH` classification before `getFormSwitchMap`, and
 * `queryBothPools` never goes near it. Letting a `FormEnvironment` hiccup reject
 * would turn a working merged read into a 500 on two of the app's busiest lists.
 *
 * An empty map means every form reads as Production in
 * `keepRowsInCurrentEnvironment`, so the degraded list is the ordinary user's
 * list. Failing open toward Production is the right direction — the alternative
 * is showing nothing at all, and no write happens here.
 */
async function viewerEnvironmentMapOrProduction(): Promise<
  Record<string, FormEnvironmentValue>
> {
  try {
    return await resolveViewerEnvironmentMap();
  } catch (err) {
    console.error(
      "[acc/report-service] FormEnvironment read failed — listing Production rows only",
      err,
    );
    return {};
  }
}

/** Requests the user submitted/owns (excludes drafts) — aggregated per request. */
export async function listMyRequestRows(userId: number): Promise<ReportRow[]> {
  const rows = await queryBothPools(async (pool) => {
    const res = await pool
      .request()
      .input("uid", sql.Int, userId)
      .query(
        buildListQuery(
          "request",
          `r.Status <> 'Draft' AND (r.CreatedBy = @uid OR r.SubmittedBy = @uid)`,
          "r.SubmittedAt DESC, r.Id DESC",
        ),
      );
    return (res.recordset as Record<string, unknown>[]).map((x) =>
      mapRow(x, "request"),
    );
  });
  return keepRowsInCurrentEnvironment(
    rows,
    await viewerEnvironmentMapOrProduction(),
  ).sort(bySubmittedAtDesc);
}

/** Requests the user has a part in approving (manager or account) — aggregated per request. */
export async function listMyWorkRows(
  staffId: number | null,
  email: string | null,
): Promise<ReportRow[]> {
  const viewerManagerSelect = `,
  (SELECT TOP 1 CASE WHEN a.Status = N'Approved' THEN 1 ELSE 0 END
   FROM [dbo].[AccApproval] a
   WHERE a.RequestId = r.Id AND a.StepCode = N'MANAGER'
     AND (
       (@staffId IS NOT NULL AND a.AssignedTo = @staffId)
       OR (
         @email <> N''
         AND LOWER(LTRIM(RTRIM(COALESCE(a.AssignedEmail, N''))))
           = LOWER(LTRIM(RTRIM(@email)))
       )
     )
  ) AS ViewerManagerApproved`;
  const rows = await queryBothPools(async (pool) => {
    const res = await pool
      .request()
      .input("staffId", sql.Int, staffId)
      .input("email", sql.NVarChar, email ?? "")
      .query(
        buildListQuery(
          "request",
          `r.Status <> 'Draft' AND EXISTS (
          SELECT 1 FROM [dbo].[AccApproval] a
          WHERE a.RequestId = r.Id
            AND (
              (@staffId IS NOT NULL AND a.AssignedTo = @staffId)
              OR (@email <> '' AND a.AssignedEmail = @email)
              OR (
                @staffId IS NOT NULL
                AND a.StepCode = 'ACCOUNT'
                AND a.Status = 'Pending'
                AND EXISTS (
                  SELECT 1 FROM [dbo].[AccApprover] ap
                  WHERE ap.StaffId = @staffId AND ap.IsActive = 1
                )
              )
            )
        )`,
          "r.SubmittedAt DESC, r.Id DESC",
          viewerManagerSelect,
        ),
      );
    return (res.recordset as Record<string, unknown>[]).map((x) =>
      mapRow(x, "request"),
    );
  });
  return keepRowsInCurrentEnvironment(
    rows,
    await viewerEnvironmentMapOrProduction(),
  ).sort(bySubmittedAtDesc);
}

/**
 * The AP-1 report reads one database — the one AP-1 is flagged to.
 *
 * Unlike "my requests" and "my work", which are about a person and merge, a
 * report is a statement about one set of books: a production report with test
 * rows folded in is wrong, and so is its Excel export.
 */
export async function queryReport(f: ReportFilters): Promise<ReportRow[]> {
  const view = f.view ?? "request";
  const rows = await (async () => {
    const pool = await getAccPool();
    const req = pool.request();
    // AP-1 only. Every Acc* form writes to the same AccRequest table, so
    // `Status <> 'Draft'` alone hands this query every accounting request there
    // is — and this one is travel-expense-shaped: it LEFT JOINs
    // AccTravelExpense and selects TravelDate, VehicleName and TotalDistanceKm,
    // so another form's request arrives with all of them null and renders as a
    // row of dashes. It feeds both the AP-1 report and the account approval
    // queue (`?status=ManagerApproved`), so one predicate covers both.
    //
    // `listMyRequestRows` and `listMyWorkRows` in this file deliberately do NOT
    // get this filter: they answer "what do I own / what must I act on", which
    // spans every form by design.
    req.input("formCode", sql.NVarChar, AP1_FORM_CODE);
    const where: string[] = ["r.Status <> 'Draft'", "r.FormCode = @formCode"];

    const dateCol =
      f.dateBasis === "submit"
        ? "r.SubmittedAt"
        : f.dateBasis === "payment"
          ? "r.PaymentDate"
          : "t.TravelDate";
    if (f.from) {
      req.input("from", sql.Date, f.from);
      where.push(`${dateCol} >= @from`);
    }
    if (f.to) {
      req.input("to", sql.Date, f.to);
      where.push(`${dateCol} <= @to`);
    }
    if (f.brandCode) {
      req.input("brand", sql.NVarChar, f.brandCode);
      where.push("r.BrandCode = @brand");
    }
    if (f.status) {
      req.input("status", sql.NVarChar, f.status);
      where.push("r.Status = @status");
    }
    if (f.departmentName) {
      req.input("dept", sql.NVarChar, f.departmentName);
      where.push("r.RequesterDepartmentName = @dept");
    }
    if (f.staffId) {
      req.input("staff", sql.Int, f.staffId);
      where.push("r.StaffId = @staff");
    }
    if (f.vehicleName) {
      req.input("veh", sql.NVarChar, f.vehicleName);
      where.push(`EXISTS (
      SELECT 1 FROM [dbo].[AccTravelExpense] te
      WHERE te.RequestId = r.Id AND (
        LTRIM(RTRIM(te.VehicleName)) = @veh
        OR EXISTS (
          SELECT 1 FROM [dbo].[AccTravelVehicleSection] s
          WHERE s.TravelExpenseId = te.Id AND LTRIM(RTRIM(s.VehicleName)) = @veh
        )
      )
    )`);
    }
    if (f.paymentDate) {
      req.input("pd", sql.Date, f.paymentDate);
      where.push("r.PaymentDate = @pd");
    }

    const res = await req.query(
      buildListQuery(
        view,
        where.join(" AND "),
        "r.SubmittedAt DESC, r.Id DESC",
      ),
    );

    return (res.recordset as Record<string, unknown>[]).map((x) =>
      mapRow(x, view),
    );
  })();
  return rows.sort(bySubmittedAtDesc);
}

export interface ReportMeta {
  companyName?: string;
  generatedAt: string;
  filterSummary?: string;
}

export function buildReportWorkbook(
  rows: ReportRow[],
  meta: ReportMeta,
): Buffer {
  const headerStyle = {
    font: { bold: true },
    alignment: { horizontal: "center" as const },
  };
  const moneyStyle = { alignment: { horizontal: "right" as const } };
  // Total distance (km) — always show 2 decimal places in Excel.
  const distanceStyle = {
    alignment: { horizontal: "right" as const },
    numFmt: "#,##0.00",
  };

  const aoa: (string | number | null)[][] = [];
  aoa.push([meta.companyName ?? "Rocks Group"]);
  aoa.push(["รายงานเบิกค่าเดินทาง (Travel Expense Report)"]);
  if (meta.filterSummary) aoa.push([meta.filterSummary]);
  aoa.push([`สร้างเมื่อ: ${meta.generatedAt}`]);
  aoa.push([]);

  const headerRowIndex = aoa.length;
  const columns = [
    "เลขที่",
    "รหัสพนักงาน",
    "ชื่อ-สกุล",
    "แผนก",
    "แบรนด์",
    "วันเดินทาง",
    "พาหนะ",
    "ระยะทางรวม (กม.)",
    "ยอดรวม (บาท)",
    "สถานะ",
    "วันที่จ่าย",
    "วันที่ส่ง",
  ];
  aoa.push(columns);

  for (const r of rows) {
    const travelDisplay =
      r.travelDates && r.travelDates.length > 1
        ? `${r.travelDates.length} วัน · ${fmtTravelDatesList(r.travelDates)}`
        : r.dayCount && r.dayCount > 1
          ? fmtTravelSpanLabel(r.travelDate, r.travelDateTo ?? null, r.dayCount)
          : r.travelDate
            ? fmtYmdDisplay(r.travelDate)
            : null;
    aoa.push([
      r.requestNo,
      r.staffId,
      r.requesterFullName,
      r.requesterDepartmentName,
      r.brandCode,
      travelDisplay,
      fmtReportVehicleNames(r),
      r.totalDistanceKm,
      r.totalAmount,
      r.status,
      r.paymentDate,
      r.submittedAt ? r.submittedAt.slice(0, 10) : null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    if (ws[addr]) ws[addr].s = headerStyle;
  }
  for (let rr = headerRowIndex + 1; rr <= range.e.r; rr++) {
    // Col 7 = ระยะทางรวม (กม.) → 2-decimal format; col 8 = ยอดรวม → right-aligned.
    const distAddr = XLSX.utils.encode_cell({ r: rr, c: 7 });
    if (ws[distAddr]) ws[distAddr].s = distanceStyle;
    const amtAddr = XLSX.utils.encode_cell({ r: rr, c: 8 });
    if (ws[amtAddr]) ws[amtAddr].s = moneyStyle;
  }
  ws["!cols"] = columns.map(() => ({ wch: 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
