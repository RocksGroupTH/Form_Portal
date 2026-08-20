import { getAccPool, sql } from "@/lib/acc/pool";
import { AP11_FORM_CODE, STATUS_LABEL_TH } from "@/features/reward/constants";
import type { RewardListRow } from "@/features/reward/types";
import * as XLSX from "xlsx-js-style";

/**
 * AP-11 reads for the Assist AP queue, the report and `/my-work`.
 *
 * The report deliberately does **not** merge Production and UAT. A report is a
 * statement about one set of books; only what a person owns or must act on
 * merges, through `src/lib/acc/query-both.ts`. That is the same rule AP-1's and
 * AP-17's reports follow.
 */

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A stored timestamp as 'YYYY-MM-DD HH:mm' for the spreadsheet.
 *
 * Local getters, never `toISOString()`: the server runs Thai time, and an ISO
 * render would shift every "รับของ" stamp back seven hours — turning a Monday
 * 13:30 collection into Monday 06:30, which is before the counter opens.
 */
function fmtStamp(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const SELECT = `
  SELECT r.Id, r.RequestNo, r.Status, r.BrandCode, r.RequesterFullName,
         r.RequesterDepartmentName, r.StaffId, r.SubmittedAt, r.UpdatedAt,
         d.RewardCode, d.RewardName, d.Qty, d.UnitActualValue, d.ReadyAt, d.ReceivedAt
    FROM [dbo].[AccRequest] r
    LEFT JOIN [dbo].[AccRewardRequest] d ON d.RequestId = r.Id
`;

function mapRow(x: Record<string, unknown>): RewardListRow {
  const qty = (x.Qty as number) ?? 0;
  const unitActual = num(x.UnitActualValue);
  return {
    id: x.Id as number,
    requestNo: (x.RequestNo as string) ?? null,
    status: x.Status as RewardListRow["status"],
    brandCode: (x.BrandCode as string) ?? null,
    requesterFullName: (x.RequesterFullName as string) ?? null,
    requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
    staffId: (x.StaffId as number) ?? null,
    rewardCode: (x.RewardCode as string) ?? null,
    rewardName: (x.RewardName as string) ?? null,
    qty,
    totalActualValue: unitActual == null ? null : Math.round(unitActual * qty * 100) / 100,
    submittedAt: iso(x.SubmittedAt),
    readyAt: iso(x.ReadyAt),
    receivedAt: iso(x.ReceivedAt),
    updatedAt: iso(x.UpdatedAt),
  };
}

export interface RewardReportFilters {
  /** 'YYYY-MM-DD' — inclusive, on SubmittedAt. */
  dateFrom?: string | null;
  dateTo?: string | null;
  statuses?: string[] | null;
  brandCode?: string | null;
  rewardId?: number | null;
  staffId?: number | null;
  /** Substring match on requester name or request number. */
  search?: string | null;
}

/**
 * Read the filters off a query string.
 *
 * Lives here rather than in the route so the report and its Excel export parse
 * identically — the export's `ids=`-style divergence is exactly how a filtered
 * view and its download end up disagreeing about what was included.
 */
export function parseRewardReportFilters(sp: URLSearchParams): RewardReportFilters {
  const rewardId = sp.get("rewardId");
  const staffId = sp.get("staffId");
  return {
    dateFrom: sp.get("from"),
    dateTo: sp.get("to"),
    statuses: sp.getAll("status"),
    brandCode: sp.get("brand"),
    rewardId: rewardId ? Number(rewardId) || null : null,
    staffId: staffId ? Number(staffId) || null : null,
    search: sp.get("q"),
  };
}

/**
 * The report.
 *
 * Drafts are excluded: an unsent draft is private working state, not a claim on
 * anything, and it carries no request number to report against.
 */
export async function listRewardReport(filters: RewardReportFilters = {}): Promise<RewardListRow[]> {
  const pool = await getAccPool();
  const req = pool.request().input("form", sql.NVarChar, AP11_FORM_CODE);
  const where: string[] = ["r.FormCode = @form", "r.Status <> 'Draft'"];

  if (filters.dateFrom) {
    req.input("from", sql.Date, filters.dateFrom);
    where.push("CAST(r.SubmittedAt AS date) >= @from");
  }
  if (filters.dateTo) {
    req.input("to", sql.Date, filters.dateTo);
    where.push("CAST(r.SubmittedAt AS date) <= @to");
  }
  if (filters.brandCode) {
    req.input("brand", sql.NVarChar, filters.brandCode);
    where.push("r.BrandCode = @brand");
  }
  if (filters.rewardId) {
    req.input("reward", sql.Int, filters.rewardId);
    where.push("d.RewardId = @reward");
  }
  if (filters.staffId) {
    req.input("staff", sql.Int, filters.staffId);
    where.push("r.StaffId = @staff");
  }
  if (filters.search?.trim()) {
    req.input("q", sql.NVarChar, `%${filters.search.trim()}%`);
    where.push("(r.RequesterFullName LIKE @q OR r.RequestNo LIKE @q OR d.RewardName LIKE @q)");
  }
  if (filters.statuses?.length) {
    // Parameterised one at a time rather than interpolated — the values come
    // from a query string, and a status list is not a safe place to concatenate.
    const names = filters.statuses.map((s, i) => {
      req.input(`st${i}`, sql.NVarChar, s);
      return `@st${i}`;
    });
    where.push(`r.Status IN (${names.join(", ")})`);
  }

  const r = await req.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY r.Id DESC`);
  return r.recordset.map((x: Record<string, unknown>) => mapRow(x));
}

/**
 * The Assist AP work queue — everything waiting on this team.
 *
 * Three stages in one list, because they are one person's job in sequence:
 * approve it, prepare it, hand it over. Ordered oldest first — a queue is worked
 * from the front.
 */
export async function listRewardQueue(): Promise<RewardListRow[]> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("form", sql.NVarChar, AP11_FORM_CODE)
    .query(
      `${SELECT} WHERE r.FormCode=@form AND r.Status IN ('ManagerApproved','Approved','Ready')
        ORDER BY r.SubmittedAt, r.Id`,
    );
  return r.recordset.map((x: Record<string, unknown>) => mapRow(x));
}

/**
 * Rows for `/my-work` — what this person must act on.
 *
 * Two claims: the assigned manager while the request sits at the MANAGER step,
 * and any active Assist AP officer while it is anywhere in their three stages.
 * `isOfficer` is resolved by the caller, which already knows the viewer's role.
 */
export async function listRewardWorkRows(
  staffId: number | null,
  isOfficer: boolean,
): Promise<RewardListRow[]> {
  if (staffId == null && !isOfficer) return [];

  const pool = await getAccPool();
  const req = pool.request().input("form", sql.NVarChar, AP11_FORM_CODE);
  const clauses: string[] = [];

  if (staffId != null) {
    req.input("staff", sql.Int, staffId);
    clauses.push("(r.ManagerStaffId = @staff AND r.Status = 'Submitted')");
  }
  if (isOfficer) {
    clauses.push("(r.Status IN ('ManagerApproved','Approved','Ready'))");
  }

  const r = await req.query(
    `${SELECT} WHERE r.FormCode=@form AND (${clauses.join(" OR ")}) ORDER BY r.SubmittedAt, r.Id`,
  );
  return r.recordset.map((x: Record<string, unknown>) => mapRow(x));
}

/* ── Excel export ── */

export interface RewardReportMeta {
  generatedAt: string;
  companyName?: string;
  /** Human-readable description of the filters, printed above the table. */
  filterSummary?: string;
}

/**
 * The report as a styled workbook.
 *
 * `xlsx-js-style`, not `xlsx` — old SheetJS CE has known vulnerabilities and the
 * repo standardised on the maintained fork.
 *
 * The value column carries the **snapshot** unit price times the quantity, not a
 * lookup against the live catalogue, so a reward repriced after the fact does
 * not silently restate months of history.
 */
export function buildRewardReportWorkbook(
  rows: RewardListRow[],
  meta: RewardReportMeta,
): Buffer {
  const headerStyle = { font: { bold: true }, alignment: { horizontal: "center" as const } };
  const moneyStyle = { alignment: { horizontal: "right" as const }, numFmt: "#,##0.00" };
  const numStyle = { alignment: { horizontal: "right" as const } };

  const aoa: (string | number | null)[][] = [];
  aoa.push([meta.companyName ?? "Rocks Group"]);
  aoa.push(["รายงานการเบิกของรางวัล (AP-11 Reward Report)"]);
  if (meta.filterSummary) aoa.push([meta.filterSummary]);
  aoa.push([`สร้างเมื่อ: ${meta.generatedAt}`]);
  aoa.push([]);

  const headerRowIndex = aoa.length;
  const columns = [
    "เลขที่คำขอ", "บริษัท", "รหัสพนักงาน", "ชื่อ-นามสกุล", "แผนก",
    "รหัสของรางวัล", "ชื่อของรางวัล", "จำนวน", "มูลค่ารวม",
    "วันที่ส่งคำขอ", "วันที่จัดของเสร็จ", "วันที่รับของ", "สถานะ",
  ];
  aoa.push(columns);

  const QTY_COL = 7;
  const MONEY_COL = 8;

  for (const r of rows) {
    aoa.push([
      r.requestNo,
      r.brandCode,
      r.staffId,
      r.requesterFullName,
      r.requesterDepartmentName,
      r.rewardCode,
      r.rewardName,
      r.qty,
      r.totalActualValue,
      fmtStamp(r.submittedAt),
      fmtStamp(r.readyAt),
      fmtStamp(r.receivedAt),
      STATUS_LABEL_TH[r.status] ?? r.status,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    if (ws[addr]) ws[addr].s = headerStyle;
  }
  for (let rr = headerRowIndex + 1; rr <= range.e.r; rr++) {
    const qtyAddr = XLSX.utils.encode_cell({ r: rr, c: QTY_COL });
    if (ws[qtyAddr]) ws[qtyAddr].s = numStyle;
    const moneyAddr = XLSX.utils.encode_cell({ r: rr, c: MONEY_COL });
    if (ws[moneyAddr]) ws[moneyAddr].s = moneyStyle;
  }
  ws["!cols"] = columns.map((_, i) => ({ wch: i === 6 ? 30 : 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
