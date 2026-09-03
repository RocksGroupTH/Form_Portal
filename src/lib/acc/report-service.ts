import { isBaht } from "@/lib/acc/currency";
import { exportCurrencyCells } from "@/lib/acc/export-currency-cells";
import { amountInBaht, rateAsOfYmd } from "@/lib/acc/currency-display";
import { paymentRoundsForApprovals } from "@/lib/acc/payment-calendar";
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
  /** The claim's own currency, like `ReportTravelDayLine.totalAmount`. */
  amount: number;
}

export interface ReportTravelDayLine {
  travelDate: string;
  /**
   * **The claim's own currency, which is baht on everything written since
   * migration 129** — AP-1 converts each expense line on the way in, so
   * `AccTravelExpense.TotalAmount` is a sum of baht and `row.currency` is NULL.
   *
   * It is **not** baht on a claim filed during migration 125's request-level
   * design: there AP-1 wrote the day in whatever currency the claim was entered
   * in and converted only `AccRequest.TotalAmount`, so those day figures do not
   * sum to the row's `totalAmount` and captioning one `บาท` states something
   * false. Those rows still carry `Currency` and `ExchangeRate`, and AP-17 still
   * writes both for its booking desk.
   *
   * So the conversion stays, and stays mandatory: `amountInBaht(amount,
   * row.currency, row.exchangeRate)` before printing this as baht or adding it
   * to a baht total. It takes its identity branch for a NULL currency, which is
   * every AP-1 row from here on — `displayDayAmountBaht`
   * (`features/accounting/lib/expand-travel-table-rows.ts`) is that call, made
   * once.
   */
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
  /**
   * **Thai baht, always** — in both views, whatever currency the claim was
   * entered in. Every summer, KPI and Excel cell downstream may treat it as baht
   * without asking, which is the invariant the whole currency feature rests on.
   *
   * The request view takes it straight from `AccRequest.TotalAmount`, which is
   * baht by construction. The **day** view cannot: its figure is
   * `AccTravelExpense.TotalAmount`, one row per travel day, in the claim's own
   * currency. `mapRow` therefore converts it here and puts the unconverted
   * figure in `foreignAmount`, so the two views mean the same thing and no
   * consumer has to know which one it was handed. A foreign day figure with no
   * usable rate reads null rather than being passed through unconverted.
   */
  totalAmount: number | null;
  /**
   * The currency the claim was entered in. **Null and `"THB"` both mean baht**,
   * and a baht claim leaves it null: nobody recorded a currency on it.
   *
   * It is here because `travelDayLines[].totalAmount` is **not** baht — those
   * come from `AccTravelExpense.TotalAmount`, which is in the claim's own
   * currency. A surface printing a day figure needs this to know what it is
   * printing; `amountInBaht` in `@/lib/acc/currency-display` is what converts it.
   */
  currency?: string | null;
  /** THB per 1 unit of `currency`, as stored. Null for a baht claim. */
  exchangeRate?: number | null;
  /**
   * **Which day's rate that is**, `YYYY-MM-DD` (migration 130).
   *
   * The source publishes on working days only, so a figure priced on a Saturday
   * used Friday's rate — correct, and unreconstructable afterwards without this.
   *
   * In practice it is an **AP-17** row that carries one here. These lists are
   * form-agnostic (`listMyRequestRows` filters on ownership, not `FormCode`) and
   * AP-1's three header writers clear the whole currency group, because its
   * currency lives on the expense line; so on an AP-1 row this is null beside a
   * null `currency`, and nothing renders either way.
   */
  rateAsOf?: string | null;
  /**
   * The claim's own figure, of which `totalAmount` is the conversion — the
   * request's `ForeignAmount` in the request view, this day's own figure in the
   * day view. Null for a baht claim in both.
   */
  foreignAmount?: number | null;
  /**
   * The claim's currency **as its expense lines record it** (migration 129),
   * summed — or null when the lines cannot be described by one figure.
   *
   * Deliberately separate keys from `currency`/`exchangeRate`/`foreignAmount`
   * above, which are the *header's* (migration 125) and are what the day view
   * converts with. Overwriting those with line facts would double-convert a
   * legacy claim, because `mapRow`'s day branch divides by `exchangeRate`.
   */
  lineCurrency?: string | null;
  lineForeignAmount?: number | null;
  lineExchangeRate?: number | null;
  status: string;
  paymentDate: string | null;
  submittedAt: string | null;
  currentStepCode?: string | null;
  pendingStepCode?: string | null;
  pendingApproverName?: string | null;
  pendingApproverEmail?: string | null;
  managerStaffId?: number | null;
  managerEmail?: string | null;
  /**
   * When the manager approved, as an ISO instant.
   *
   * The accounting queue shows it beside the payment round. The cut-off is noon
   * on the Monday of the round's own week, and since 2026-09-03 this app does
   * compute it — `paymentRoundsForApprovals` for the per-row suggestion and
   * `getDefaultPaymentDate` for a claim approved with nobody watching. **ACC
   * Portal still takes the next round regardless**, so the two apps now differ
   * here. The choice remains the accountant's: this is a suggestion beside an
   * editable date, not a rule that refuses.
   */
  managerApprovedAt?: string | null;
  /**
   * The round this claim is *meant* for, from the manager's clock — see
   * `payment-calendar.ts`. A suggestion shown beside the editable date; nothing
   * writes it.
   */
  suggestedPaymentDate?: string | null;
  /** HR department code (`AccRequest.RequesterDepartmentCode`), falling back to HR. */
  requesterDepartmentCode?: string | null;
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

// t.TotalAmount here is the *day's* figure, in the claim's own currency — which
// is why r.Currency travels beside it. In the request view below, r.TotalAmount
// is selected instead and is baht.
const DAY_ROW_SELECT = `r.Id, r.RequestNo, r.FormCode, f.FormNameTh, r.StaffId, r.RequesterFullName, r.RequesterDepartmentName,
  r.BrandCode, t.TravelDate, t.VehicleName, t.WorkDetail, t.TotalDistanceKm, t.TotalAmount,
  r.Currency, r.ExchangeRate, r.ForeignAmount, r.RateAsOf,
  r.Status, r.PaymentDate, r.SubmittedAt`;

/**
 * The claim's line-level currency, summed — or nothing.
 *
 * Since migration 129 AP-1 records currency per expense LINE and `FX_CLEAR`
 * nulls the header's, so `r.Currency` is NULL on every modern AP-1 claim and
 * anything reading it alone concludes "baht". These three subqueries ask the
 * lines instead.
 *
 * **It asks a different question from `summariseLineCurrency` on the client,
 * and the difference is deliberate.** That one guards a *header sitting above a
 * total*, so it refuses a mixed block: printing "20.00 MYR" above a sum that
 * includes a baht toll invites the reader to divide one by the other. A
 * spreadsheet column has no such adjacency. Its question is "was any of this
 * claim filed in a foreign currency, and how much of it" — and a claim mixing a
 * ringgit fare with a baht toll answers **MYR, 40.00**, because those lines
 * really did total 40 ringgit.
 *
 * Mixed claims are the normal case, not the exception: a Malaysian trip books
 * Grab in ringgit and pays a Thai toll in baht on the same day. Refusing to
 * describe them would have left the export saying THB for exactly the claims the
 * column exists to surface — which is the bug this replaces, with a different
 * cause and the same output.
 *
 * So: the code is the single distinct non-baht currency among the lines (the
 * claim-level design bounds it to one — `lineCurrencyOptions` offers the trip
 * country's currency and THB and nothing else), and the figure is the sum of
 * *those* lines only. Baht lines are simply not part of it; their money is in
 * `ยอดรวม (บาท)` where it belongs.
 *
 * The rate is likewise only reported when every line agrees on it. A draft
 * saved across two days, or an accounting override, legitimately gives one
 * claim two rates, and naming one of them as governing all lines would be false.
 */
const LINE_CURRENCY_SELECT = `
  (SELECT CASE WHEN COUNT(DISTINCT UPPER(LTRIM(RTRIM(li.Currency)))) = 1
                THEN MAX(UPPER(LTRIM(RTRIM(li.Currency)))) END
   FROM [dbo].[AccTravelExpenseItem] li
   JOIN [dbo].[AccTravelExpense] lt ON lt.Id = li.TravelExpenseId
   WHERE lt.RequestId = r.Id
     AND li.Currency IS NOT NULL
     AND UPPER(LTRIM(RTRIM(li.Currency))) <> N'THB') AS LineCurrency,
  (SELECT CASE WHEN COUNT(DISTINCT UPPER(LTRIM(RTRIM(li.Currency)))) = 1
                THEN SUM(li.ForeignAmount) END
   FROM [dbo].[AccTravelExpenseItem] li
   JOIN [dbo].[AccTravelExpense] lt ON lt.Id = li.TravelExpenseId
   WHERE lt.RequestId = r.Id
     AND li.Currency IS NOT NULL
     AND UPPER(LTRIM(RTRIM(li.Currency))) <> N'THB'
     AND li.ForeignAmount IS NOT NULL) AS LineForeignAmount,
  (SELECT CASE WHEN COUNT(DISTINCT li.ExchangeRate) = 1 THEN MAX(li.ExchangeRate) END
   FROM [dbo].[AccTravelExpenseItem] li
   JOIN [dbo].[AccTravelExpense] lt ON lt.Id = li.TravelExpenseId
   WHERE lt.RequestId = r.Id
     AND li.ExchangeRate IS NOT NULL
     AND UPPER(LTRIM(RTRIM(li.Currency))) <> N'THB') AS LineExchangeRate`;

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
  -- Stamped on the request at submit, but older rows predate the column
  -- (migration 047), so fall back to the employee's current department.
  COALESCE(r.RequesterDepartmentCode, (
    SELECT TOP 1 emp.DepartmentCode FROM ${hrEmployeeTable()} emp
    WHERE emp.StaffId = r.StaffId AND emp.Status = N'Active'
  )) AS RequesterDepartmentCode,
  (SELECT TOP 1 a.ActionedAt
   FROM [dbo].[AccApproval] a
   WHERE a.RequestId = r.Id AND a.StepCode = N'MANAGER' AND a.Status = N'Approved'
   ORDER BY a.ActionedAt DESC, a.Id DESC) AS ManagerApprovedAt,
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
  -- Baht is r.TotalAmount; these say what the *per-day* figures in
  -- TravelDaysCsv above are denominated in, which is not the same thing on a
  -- foreign claim. Every screen rendering that breakdown reads them.
  r.Currency, r.ExchangeRate, r.ForeignAmount, r.RateAsOf,
  ${LINE_CURRENCY_SELECT},
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
  const rawAmount =
    x.TotalAmount === null || x.TotalAmount === undefined ? null : Number(x.TotalAmount);
  const rate =
    x.ExchangeRate === null || x.ExchangeRate === undefined ? null : Number(x.ExchangeRate);
  // Only the day view needs this: there `rawAmount` is AccTravelExpense's
  // per-day figure, in the claim's own currency. In the request view it is
  // AccRequest.TotalAmount, which is already baht and must not be multiplied by
  // a rate a second time.
  const dayBaht = amountInBaht(rawAmount, x.Currency as string | null, rate);
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
    // Baht in both views — the day view's raw figure is the claim's own
    // currency, so it converts here and the unconverted figure moves to
    // `foreignAmount`. A baht claim takes the identity branch of `amountInBaht`,
    // so nothing about it moves by so much as a satang.
    totalAmount: view === "day" ? dayBaht : rawAmount,
    // `NULLIF` is not applied in SQL because a blank CHAR(3) is not a state the
    // writers can produce; `isBaht` treats "" and null alike anyway.
    currency: (x.Currency as string | null) ?? null,
    exchangeRate: rate,
    lineCurrency: (x.LineCurrency as string | null) ?? null,
    lineForeignAmount:
      x.LineForeignAmount === null || x.LineForeignAmount === undefined
        ? null
        : Number(x.LineForeignAmount),
    lineExchangeRate:
      x.LineExchangeRate === null || x.LineExchangeRate === undefined
        ? null
        : Number(x.LineExchangeRate),
    rateAsOf: rateAsOfYmd((x.RateAsOf as string | Date | null) ?? null),
    foreignAmount:
      view === "day"
        ? isBaht(x.Currency as string | null)
          ? null
          : rawAmount
        : x.ForeignAmount === null || x.ForeignAmount === undefined
          ? null
          : Number(x.ForeignAmount),
    status: x.Status as string,
    paymentDate: x.PaymentDate ? ymd(x.PaymentDate as Date) : null,
    submittedAt: x.SubmittedAt ? (x.SubmittedAt as Date).toISOString() : null,
    currentStepCode: (x.CurrentStepCode as string) ?? null,
    pendingStepCode: (x.PendingStepCode as string) ?? null,
    pendingApproverName: (x.PendingApproverName as string) ?? null,
    // A plain toISOString: the driver reads Thai wall clocks correctly since
    // useUTC: false, so the fixThaiDate ACC Portal still applies here would
    // shift it seven hours.
    managerApprovedAt: x.ManagerApprovedAt ? (x.ManagerApprovedAt as Date).toISOString() : null,
    requesterDepartmentCode: (x.RequesterDepartmentCode as string) ?? null,
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
    -- Every non-aggregated column of REQUEST_ROW_SELECT belongs here. The
    -- correlated subqueries do not: they are scalar and keyed on r.Id, which is
    -- grouped. RequesterDepartmentCode is a plain column and does.
    GROUP BY r.Id, r.RequestNo, r.FormCode, f.FormNameTh, r.StaffId, r.RequesterFullName,
      r.RequesterDepartmentName, r.RequesterDepartmentCode, r.BrandCode, r.TotalAmount,
      r.Currency, r.ExchangeRate, r.ForeignAmount, r.RateAsOf,
      r.Status, r.PaymentDate, r.SubmittedAt,
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
          `r.Status <> 'Draft' AND (
          EXISTS (
            SELECT 1 FROM [dbo].[AccApproval] a
            WHERE a.RequestId = r.Id
              AND (
                (@staffId IS NOT NULL AND a.AssignedTo = @staffId)
                OR (@email <> '' AND a.AssignedEmail = @email)
                /* AP-1's accounting queue. [dbo].[AccApprover] is AP-1's roster
                   and every Acc* form shares [dbo].[AccApproval], so without the
                   form pin an AP-1 accountant is handed every other form's
                   pending accounting step — and clicking one opened it over an
                   AP-1 URL. Only AP-1 and AP-4 write AccApproval rows at all;
                   AP-2 and AP-3 have their own tables, below. */
                OR (
                  r.FormCode = 'AP-1'
                  AND @staffId IS NOT NULL
                  AND a.StepCode = 'ACCOUNT'
                  AND a.Status = 'Pending'
                  AND EXISTS (
                    SELECT 1 FROM [dbo].[AccApprover] ap
                    WHERE ap.StaffId = @staffId AND ap.IsActive = 1
                  )
                )
                /* AP-4's, which answers to its own roster and has two accounting
                   steps rather than one. Matched on StaffId first and login
                   email second, the same two ways findActiveApprover() resolves
                   an actor — an approver with no Rocks_Portal_HR.Employee row
                   may act, so their queue has to find them too. */
                OR (
                  r.FormCode = 'AP-4'
                  AND a.StepCode IN ('ACCOUNT', 'ACCOUNT_FINAL')
                  AND a.Status = 'Pending'
                  AND EXISTS (
                    SELECT 1 FROM [dbo].[AccReimburseApprover] ra
                    WHERE ra.IsActive = 1
                      AND (
                        (@staffId IS NOT NULL AND ra.StaffId = @staffId)
                        OR (
                          @email <> N''
                          AND LOWER(LTRIM(RTRIM(COALESCE(ra.Email, N''))))
                            = LOWER(LTRIM(RTRIM(@email)))
                        )
                      )
                  )
                )
              )
          )
          OR EXISTS (
            SELECT 1 FROM [dbo].[AccClearAdvanceApproval] ca
            WHERE ca.RequestId = r.Id
              AND (
                (@staffId IS NOT NULL AND ca.AssignedStaffId = @staffId)
                OR (
                  @email <> ''
                  AND LOWER(LTRIM(RTRIM(COALESCE(ca.AssignedEmail, N'')))) = LOWER(LTRIM(RTRIM(@email)))
                )
                OR (
                  @staffId IS NOT NULL
                  AND ca.StepCode = 'ACCOUNT'
                  AND ca.Status = 'Pending'
                  AND EXISTS (
                    SELECT 1 FROM [dbo].[AccClearAdvanceApprover] ap
                    WHERE ap.StaffId = @staffId AND ap.IsActive = 1 AND ap.Role = 'ACCOUNT'
                  )
                )
              )
          )
          OR EXISTS (
            SELECT 1 FROM [dbo].[AccAdvanceApproval] aa
            WHERE aa.RequestId = r.Id
              AND (
                (@staffId IS NOT NULL AND aa.AssignedStaffId = @staffId)
                OR (
                  @email <> ''
                  AND LOWER(LTRIM(RTRIM(COALESCE(aa.AssignedEmail, N'')))) = LOWER(LTRIM(RTRIM(@email)))
                )
                OR (
                  @staffId IS NOT NULL
                  AND aa.Status = 'Pending'
                  AND aa.StepType = r.CurrentStepCode
                  AND EXISTS (
                    SELECT 1 FROM [dbo].[AccAdvanceApprover] ap
                    WHERE ap.StaffId = @staffId AND ap.IsActive = 1
                      AND ap.ApproverRole = aa.StepType
                  )
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

    const mapped = (res.recordset as Record<string, unknown>[]).map((x) => mapRow(x, view));

    // One calendar fetch for the whole result, and only when something in it
    // has a manager approval to read — the suggestion is computed from the raw
    // `Date`, not from the ISO string on the mapped row, so it stays here
    // beside the recordset rather than moving into `mapRow`.
    if (res.recordset.some((x: Record<string, unknown>) => x.ManagerApprovedAt)) {
      /* Anchored per claim rather than against today's calendar, so a row's
         suggested round does not move under an accountant who left the queue
         open over a weekend. It therefore need NOT be one of the picker's own
         dates: a claim approved 03/09 still names 11/09 on the 14th, which is
         the truth about the claim — and why `approveAccount` takes a month's
         backward window rather than only future rounds. */
      const suggested = await paymentRoundsForApprovals(
        (res.recordset as Record<string, unknown>[]).map(
          (x) => x.ManagerApprovedAt as Date | null,
        ),
      );
      mapped.forEach((row, i) => {
        row.suggestedPaymentDate = suggested[i];
      });
    }
    return mapped;
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
  // Alignment only — no numFmt, deliberately: the sheet has always shown the
  // total exactly as the database holds it and adding a format here would change
  // every historical export's appearance for no gain.
  const moneyStyle = { alignment: { horizontal: "right" as const } };
  // Total distance (km) — always show 2 decimal places in Excel.
  const distanceStyle = {
    alignment: { horizontal: "right" as const },
    numFmt: "#,##0.00",
  };
  // The reference rate. Six places, because AccRequest.ExchangeRate is
  // DECIMAL(18,6) and a rate truncated in the export cannot be reconciled
  // against the one the claim was converted at.
  const rateStyle = {
    alignment: { horizontal: "right" as const },
    numFmt: "#,##0.000000",
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
    // Stays baht and stays where it is. `ReportRow.totalAmount` is baht in both
    // views (`mapRow` converts the day view's figure), so the heading is true of
    // every row and no existing formula moves.
    "ยอดรวม (บาท)",
    // The three that make a foreign claim identifiable rather than a baht claim
    // with a surprising total. They sit immediately after the total because that
    // is the figure they qualify — and *after* it, so the two style rules below
    // keep naming columns 7 and 8.
    "สกุลเงิน",
    "ยอดตามสกุลเงิน",
    "อัตราอ้างอิง",
    "สถานะ",
    "วันที่จ่าย",
    "วันที่ส่ง",
  ];
  aoa.push(columns);

  // Found by heading rather than written as a number — the trap AP-17's export
  // already had sprung on it once. Inserting a column above silently moves a
  // numeric literal onto somebody else's data.
  const DIST_COL = columns.indexOf("ระยะทางรวม (กม.)");
  const AMOUNT_COL = columns.indexOf("ยอดรวม (บาท)");
  const FOREIGN_COL = columns.indexOf("ยอดตามสกุลเงิน");
  const RATE_COL = columns.indexOf("อัตราอ้างอิง");

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
      // Always filled, never blank for baht. A column of blanks beside a column
      // of MYR reads as "not recorded" rather than "baht", and a filter on it
      // would silently drop every ordinary claim.
      //
      // The facts come from exportCurrencyCells, which asks the LINES first.
      // Reading r.currency alone printed the literal "THB" against every
      // ringgit claim — AP-1 stopped writing the header currency when it moved
      // to the line (migration 129), so isBaht(null) was true for all of them.
      // That was the one place in the app that stated a wrong currency for a
      // figure rather than merely omitting one, and it left the app in a
      // spreadsheet with no link back to the detail page that would correct it.
      ...exportCurrencyCells(r),
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
    const distAddr = XLSX.utils.encode_cell({ r: rr, c: DIST_COL });
    if (ws[distAddr]) ws[distAddr].s = distanceStyle;
    const amtAddr = XLSX.utils.encode_cell({ r: rr, c: AMOUNT_COL });
    if (ws[amtAddr]) ws[amtAddr].s = moneyStyle;
    const foreignAddr = XLSX.utils.encode_cell({ r: rr, c: FOREIGN_COL });
    if (ws[foreignAddr]) ws[foreignAddr].s = moneyStyle;
    const rateAddr = XLSX.utils.encode_cell({ r: rr, c: RATE_COL });
    if (ws[rateAddr]) ws[rateAddr].s = rateStyle;
  }
  ws["!cols"] = columns.map(() => ({ wch: 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
