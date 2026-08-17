import { getAccPool, sql } from "@/lib/acc/pool";
import { listBrandErpInterfaceMaps } from "@/lib/acc/brand-erp-interface-map-service";
import {
  loadDepartmentErpMapsByTarget,
  loadErpDeptDisplayNamesByTargetBrand,
} from "@/lib/acc/department-map-service";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { ERP_SYNC_BRAND_CODE } from "@/lib/erp/dimension-sync";
import { getRequest } from "@/lib/acc/request-service";
import { getAccCached, putAccCached, deleteAccCachedByPrefix } from "@/lib/acc/acc-cache";
import { parseTravelDayLines, TRAVEL_DAYS_CSV_SELECT, type ReportTravelDayLine } from "@/lib/acc/report-service";
import { resolveFormEnvironment, type FormEnvironmentValue } from "@/lib/form-environment";
import type { ErpPrepStatus, ErpInterfaceStatus } from "@/features/accounting/constants";
import type { TravelExpenseItem } from "@/features/accounting/types";

const PREP_DEPT_CTX_CACHE_TTL_MS = 30_000;
const PREP_DEPT_CTX_CACHE_PREFIX = "acc:prep-dept-ctx:";

/**
 * Invariant: nothing derived from a form-pool read may live in a
 * process-global cache (`src/lib/acc/acc-cache.ts`, a `globalThis` Map) under
 * a key that omits the environment. Two viewers of one route can now resolve
 * to different databases (Production vs UAT — see
 * docs/superpowers/specs/2026-08-18-parallel-uat-design.md, "Caching"), and
 * this context is built from an `AccBrandErpInterface` read via
 * `getAccPool()`, which follows the resolved environment. A constant key
 * would let one viewer's read serve the other viewer's database.
 * `journalContextCacheKey` (erp-journal-context.ts) already follows this
 * rule; this is the same fix applied here.
 */
function prepDeptCtxCacheKey(environment: FormEnvironmentValue): string {
  return `${PREP_DEPT_CTX_CACHE_PREFIX}${environment}`;
}

/** Bust cached prep dept context after an ERP interface send or settings change. */
export function invalidatePrepDeptContextCache(): void {
  deleteAccCachedByPrefix(PREP_DEPT_CTX_CACHE_PREFIX);
}

export type { ErpPrepStatus };

export interface ErpPrepFilters {
  brandCode?: string | null;
  prepStatus?: ErpPrepStatus | null;
  paymentFrom?: string | null;
  paymentTo?: string | null;
  travelFrom?: string | null;
  travelTo?: string | null;
}

export interface ErpPrepRow {
  id: number;
  requestNo: string | null;
  staffId: number | null;
  brandCode: string | null;
  requesterFullName: string | null;
  requesterDepartmentName: string | null;
  requesterDepartmentCode: string | null;
  travelDate: string | null;
  dayCount?: number;
  travelDayLines?: ReportTravelDayLine[];
  vehicleName: string | null;
  workDetail: string | null;
  totalAmount: number | null;
  paymentDate: string | null;
  submittedAt: string | null;
  erpDeptCode: string | null;
  erpDeptDisplayName: string | null;
  prepStatus: ErpPrepStatus;
  prepIssues: string[];
  erpInterfaceStatus: ErpInterfaceStatus | null;
  erpInterfaceError: string | null;
  erpInterfaceSentAt: string | null;
}

export interface ErpPrepLineItem {
  itemType: string;
  label: string;
  amount: number;
}

export interface ErpPrepDetail extends ErpPrepRow {
  companyName: string | null;
  requesterEmail: string | null;
  requesterPosition: string | null;
  workDetail: string | null;
  vehicleName: string | null;
  totalDistanceKm: number | null;
  submittedAt: string | null;
  lineItems: ErpPrepLineItem[];
}

const ITEM_LABELS: Record<string, string> = {
  fare: "ค่าเดินทาง",
  toll: "ค่าทางด่วน",
  parking: "ค่าที่จอดรถ",
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computePrepIssues(input: {
  requestNo: string | null;
  paymentDate: string | null;
  erpDeptCode: string | null;
  totalAmount: number | null;
}): string[] {
  const issues: string[] = [];
  if (!input.requestNo) issues.push("ไม่มีเลขที่คำขอ");
  if (!input.paymentDate) issues.push("ยังไม่มีวันที่จ่าย");
  if (!input.erpDeptCode) issues.push("ยังไม่ได้ map ข้อมูล Department สำหรับ ERP");
  if (input.totalAmount == null || input.totalAmount <= 0) issues.push("ยอดรวมไม่ถูกต้อง");
  return issues;
}

function resolveErpDept(
  claimBrand: string,
  deptCode: string,
  deptMapsByTarget: Map<string, Map<string, string>>,
  erpNamesByTarget: Map<string, Map<string, string>>,
  interfaceByClaim: Map<string, string>,
): { code: string | null; displayName: string | null } {
  const brand = claimBrand.trim().toUpperCase();
  const target = interfaceByClaim.get(brand) ?? ERP_SYNC_BRAND_CODE;
  const deptMap = deptMapsByTarget.get(target);
  const key = deptCode.trim();
  const code = key && deptMap ? (deptMap.get(key) ?? null) : null;
  if (!code) return { code: null, displayName: null };
  const names = erpNamesByTarget.get(target) ?? new Map();
  return { code, displayName: names.get(code) ?? code };
}

function toPrepRow(
  raw: Record<string, unknown>,
  deptMapsByTarget: Map<string, Map<string, string>>,
  erpNamesByTarget: Map<string, Map<string, string>>,
  interfaceByClaim: Map<string, string>,
): ErpPrepRow {
  const deptCode = ((raw.RequesterDepartmentCode as string | null) ?? "").trim() || null;
  const claimBrand = ((raw.BrandCode as string) ?? "").trim();
  const { code: erpDeptCode, displayName: erpDeptDisplayName } = resolveErpDept(
    claimBrand,
    deptCode ?? "",
    deptMapsByTarget,
    erpNamesByTarget,
    interfaceByClaim,
  );
  const paymentDate = raw.PaymentDate ? ymd(raw.PaymentDate as Date) : null;
  const totalAmount =
    raw.TotalAmount === null || raw.TotalAmount === undefined
      ? null
      : Number(raw.TotalAmount);
  const travelDayLines = parseTravelDayLines(raw.TravelDaysCsv);
  const dayCount = Number(raw.DayCount) || travelDayLines?.length || 0;
  const firstDay = travelDayLines?.[0];

  const prepIssues = computePrepIssues({
    requestNo: (raw.RequestNo as string) ?? null,
    paymentDate,
    erpDeptCode,
    totalAmount,
  });

  return {
    id: raw.Id as number,
    requestNo: (raw.RequestNo as string) ?? null,
    staffId: (raw.StaffId as number) ?? null,
    brandCode: (raw.BrandCode as string) ?? null,
    requesterFullName: (raw.RequesterFullName as string) ?? null,
    requesterDepartmentName: (raw.RequesterDepartmentName as string) ?? null,
    requesterDepartmentCode: deptCode,
    travelDate: firstDay?.travelDate ?? (raw.TravelDate ? ymd(raw.TravelDate as Date) : null),
    dayCount: dayCount || undefined,
    travelDayLines,
    vehicleName: firstDay?.vehicleNames?.[0] ?? (raw.VehicleName as string) ?? null,
    workDetail: firstDay?.workDetail ?? (raw.WorkDetail as string) ?? null,
    totalAmount,
    paymentDate,
    submittedAt: raw.SubmittedAt ? (raw.SubmittedAt as Date).toISOString() : null,
    erpDeptCode,
    erpDeptDisplayName,
    prepStatus: prepIssues.length === 0 ? "ready" : "incomplete",
    prepIssues,
    erpInterfaceStatus: (raw.ErpInterfaceStatus as ErpInterfaceStatus | null) ?? null,
    erpInterfaceError: (raw.ErpInterfaceError as string | null) ?? null,
    erpInterfaceSentAt: raw.ErpInterfaceSentAt
      ? (raw.ErpInterfaceSentAt as Date).toISOString()
      : null,
  };
}

async function loadPrepDeptContextUncached(): Promise<PrepDeptContext> {
  const interfaceMaps = await listBrandErpInterfaceMaps();
  const interfaceByClaim = new Map(
    interfaceMaps.map((m) => [m.brandCode.toUpperCase(), m.interfaceBrandCode.toUpperCase()]),
  );
  const [deptMapsByTarget, erpNamesByTarget] = await Promise.all([
    loadDepartmentErpMapsByTarget(interfaceByClaim),
    loadErpDeptDisplayNamesByTargetBrand(),
  ]);
  return { deptMapsByTarget, erpNamesByTarget, interfaceByClaim };
}

export interface PrepDeptContext {
  deptMapsByTarget: Map<string, Map<string, string>>;
  erpNamesByTarget: Map<string, Map<string, string>>;
  interfaceByClaim: Map<string, string>;
}

export function interfaceByClaimMapToRecord(m: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Array.from(m.entries())) {
    out[k] = v;
  }
  return out;
}

export async function loadPrepDeptContext(): Promise<PrepDeptContext> {
  const environment = await resolveFormEnvironment();
  const cacheKey = prepDeptCtxCacheKey(environment);
  const cached = getAccCached<PrepDeptContext>(cacheKey, PREP_DEPT_CTX_CACHE_TTL_MS);
  if (cached) return cached;
  const ctx = await loadPrepDeptContextUncached();
  putAccCached(cacheKey, ctx);
  return ctx;
}

/** Approved travel-expense requests prepared for future ERP interface. */
export async function listErpPrepRows(
  f: ErpPrepFilters = {},
  options?: { deptCtx?: PrepDeptContext },
): Promise<ErpPrepRow[]> {
  const pool = await getAccPool();
  const req = pool.request();
  const where: string[] = ["r.Status = 'Approved'"];

  if (f.brandCode) {
    req.input("brand", sql.NVarChar, f.brandCode);
    where.push("r.BrandCode = @brand");
  }
  if (f.paymentFrom) {
    req.input("payFrom", sql.Date, f.paymentFrom);
    where.push("r.PaymentDate >= @payFrom");
  }
  if (f.paymentTo) {
    req.input("payTo", sql.Date, f.paymentTo);
    where.push("r.PaymentDate <= @payTo");
  }
  if (f.travelFrom) {
    req.input("trFrom", sql.Date, f.travelFrom);
    where.push(`EXISTS (
      SELECT 1 FROM [dbo].[AccTravelExpense] te
      WHERE te.RequestId = r.Id AND te.TravelDate >= @trFrom
    )`);
  }
  if (f.travelTo) {
    req.input("trTo", sql.Date, f.travelTo);
    where.push(`EXISTS (
      SELECT 1 FROM [dbo].[AccTravelExpense] te
      WHERE te.RequestId = r.Id AND te.TravelDate <= @trTo
    )`);
  }

  const deptCtxPromise = options?.deptCtx
    ? Promise.resolve(options.deptCtx)
    : loadPrepDeptContext();

  const [queryRes, deptCtx] = await Promise.all([
    req.query(`
      SELECT r.Id, r.RequestNo, r.StaffId, r.BrandCode, r.RequesterFullName,
             r.RequesterDepartmentName,
             COALESCE(r.RequesterDepartmentCode, (
               SELECT TOP 1 emp.DepartmentCode FROM ${hrEmployeeTable()} emp
               WHERE emp.StaffId = r.StaffId AND emp.Status = N'Active'
             )) AS RequesterDepartmentCode,
             r.TotalAmount, r.PaymentDate, r.SubmittedAt,
             r.ErpInterfaceStatus, r.ErpInterfaceError, r.ErpInterfaceSentAt,
             MIN(t.TravelDate) AS TravelDate,
             COUNT(t.Id) AS DayCount,
             ${TRAVEL_DAYS_CSV_SELECT},
             (SELECT TOP 1 te.VehicleName FROM [dbo].[AccTravelExpense] te
              WHERE te.RequestId = r.Id ORDER BY te.SortOrder, te.TravelDate, te.Id) AS VehicleName,
             (SELECT TOP 1 te.WorkDetail FROM [dbo].[AccTravelExpense] te
              WHERE te.RequestId = r.Id ORDER BY te.SortOrder, te.TravelDate, te.Id) AS WorkDetail
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
      WHERE ${where.join(" AND ")}
      GROUP BY r.Id, r.RequestNo, r.StaffId, r.BrandCode, r.RequesterFullName,
               r.RequesterDepartmentName, r.RequesterDepartmentCode,
               r.TotalAmount, r.PaymentDate, r.SubmittedAt,
               r.ErpInterfaceStatus, r.ErpInterfaceError, r.ErpInterfaceSentAt
      ORDER BY r.PaymentDate DESC, r.SubmittedAt DESC, r.Id DESC
    `),
    deptCtxPromise,
  ]);

  const { deptMapsByTarget, erpNamesByTarget, interfaceByClaim } = deptCtx;

  let rows = (queryRes.recordset as Record<string, unknown>[]).map((raw) =>
    toPrepRow(raw, deptMapsByTarget, erpNamesByTarget, interfaceByClaim),
  );

  if (f.prepStatus) {
    rows = rows.filter((r) => r.prepStatus === f.prepStatus);
  }

  return rows;
}

function buildLineItems(items: TravelExpenseItem[]): ErpPrepLineItem[] {
  const order = ["fare", "toll", "parking"];
  return order
    .map((type) => {
      const sum = items
        .filter((i) => i.itemType === type)
        .reduce((s, i) => s + (Number(i.amount) || 0), 0);
      if (sum <= 0) return null;
      return {
        itemType: type,
        label: ITEM_LABELS[type] ?? type,
        amount: sum,
      };
    })
    .filter((x): x is ErpPrepLineItem => x != null);
}

/** Full prep detail for the accounting preview panel. */
export async function getErpPrepDetail(id: number): Promise<ErpPrepDetail | null> {
  const [deptCtx, accReq] = await Promise.all([
    loadPrepDeptContext(),
    getRequest(id),
  ]);
  if (!accReq || accReq.status !== "Approved") return null;

  const { deptMapsByTarget, erpNamesByTarget, interfaceByClaim } = deptCtx;

  const pool = await getAccPool();
  const head = await pool.request().input("id", sql.Int, id)
    .query(`SELECT r.BrandCode, r.ErpInterfaceStatus, r.ErpInterfaceError, r.ErpInterfaceSentAt,
                   COALESCE(r.RequesterDepartmentCode, (
                     SELECT TOP 1 emp.DepartmentCode FROM ${hrEmployeeTable()} emp
                     WHERE emp.StaffId = r.StaffId AND emp.Status = N'Active'
                   )) AS RequesterDepartmentCode
            FROM [dbo].[AccRequest] r WHERE r.Id = @id`);
  const headRow = head.recordset[0] as Record<string, unknown> | undefined;
  const deptCode = ((headRow?.RequesterDepartmentCode as string | null) ?? "").trim() || null;
  const claimBrand = ((headRow?.BrandCode as string) ?? "").trim();
  const { code: erpDeptCode, displayName: erpDeptDisplayName } = resolveErpDept(
    claimBrand,
    deptCode ?? "",
    deptMapsByTarget,
    erpNamesByTarget,
    interfaceByClaim,
  );

  const paymentDate = accReq.paymentDate;
  const totalAmount = accReq.totalAmount;
  const prepIssues = computePrepIssues({
    requestNo: accReq.requestNo,
    paymentDate,
    erpDeptCode,
    totalAmount,
  });

  return {
    id: accReq.id,
    requestNo: accReq.requestNo,
    staffId: accReq.staffId,
    brandCode: accReq.brandCode,
    requesterFullName: accReq.requesterFullName,
    requesterDepartmentName: accReq.requesterDepartmentName,
    requesterDepartmentCode: deptCode,
    travelDate: accReq.travel?.travelDate ?? null,
    totalAmount,
    paymentDate,
    erpDeptCode,
    erpDeptDisplayName,
    prepStatus: prepIssues.length === 0 ? "ready" : "incomplete",
    prepIssues,
    erpInterfaceStatus: (headRow?.ErpInterfaceStatus as ErpInterfaceStatus | null) ?? null,
    erpInterfaceError: (headRow?.ErpInterfaceError as string | null) ?? null,
    erpInterfaceSentAt: headRow?.ErpInterfaceSentAt
      ? (headRow.ErpInterfaceSentAt as Date).toISOString()
      : null,
    companyName: accReq.companyName,
    requesterEmail: accReq.requesterEmail,
    requesterPosition: accReq.requesterPosition,
    workDetail: accReq.travel?.workDetail ?? null,
    vehicleName: accReq.travel?.vehicleName ?? null,
    totalDistanceKm: accReq.travel?.totalDistanceKm ?? null,
    submittedAt: accReq.submittedAt,
    lineItems: buildLineItems(accReq.travel?.items ?? []),
  };
}
