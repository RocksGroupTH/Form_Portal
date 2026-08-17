import { getAccPool, sql } from "@/lib/acc/pool";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { allocateRequestNo } from "@/lib/acc/sequence";
import { deleteFile } from "@/lib/storage";
import { computeTotalAmount, computeTotalDistance, computeRequestTotalAmount, computeRequestTotalDistance, allDayItems } from "@/lib/acc/calc";
import {
  normalizeTravelDay,
  normalizeTravelDays as normalizeTravelDaySections,
  hasRateVehicle,
} from "@/features/accounting/lib/travel-sections";
import {
  parseRouteWaypoints,
  serializeRouteWaypoints,
} from "@/features/accounting/lib/route-waypoints";
import { resolveManagerEmail, resolveRequesterForActor, type RequesterSnapshot } from "@/lib/acc/employee-context";
import {
  assertFormWritable,
  isUatRequest,
  UAT_MANAGER_MISSING_ERROR,
} from "@/lib/uat-tester/guards";
import { queueEmail } from "@/lib/acc/email-queue";
import { buildEmail } from "@/lib/acc/email-templates";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import type {
  AccApproval,
  AccFileMeta,
  AccRequest,
  TravelDraftSummary,
  TravelExpenseDetail,
  TravelExpenseItem,
  TravelVehicleSection,
} from "@/features/accounting/types";

export interface SaveInput {
  id?: number;
  brandCode: string | null;
  /** Preferred — multiple travel days per request. */
  travelDays?: TravelExpenseDetail[];
  /** @deprecated Single day — wrapped as one-element travelDays. */
  travel?: TravelExpenseDetail;
  /** Optional: open on behalf of a same-department colleague (their HR StaffId). */
  requesterStaffId?: number | null;
}

/* ─────────────────────────── helpers ─────────────────────────── */

function emptyTravel(): TravelExpenseDetail {
  return {
    sortOrder: 0,
    travelDate: null, workDetail: null, vehicleId: null, vehicleName: null,
    ratePerKm: null, isManualEntry: false, direction: null,
    onwardOrigin: null, onwardOriginLat: null, onwardOriginLng: null,
    onwardDestination: null, onwardDestLat: null, onwardDestLng: null, onwardDistanceKm: null,
    onwardWaypoints: null,
    returnOrigin: null, returnOriginLat: null, returnOriginLng: null,
    returnDestination: null, returnDestLat: null, returnDestLng: null, returnDistanceKm: null,
    returnWaypoints: null,
    totalDistanceKm: null, totalAmount: null, sections: [], items: [],
  };
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function mapRequestRow(r: Record<string, unknown>): AccRequest {
  return {
    id: r.Id as number,
    requestNo: (r.RequestNo as string) ?? null,
    formCode: r.FormCode as string,
    brandCode: (r.BrandCode as string) ?? null,
    status: r.Status as AccRequest["status"],
    currentStepCode: (r.CurrentStepCode as AccRequest["currentStepCode"]) ?? null,
    staffId: (r.StaffId as number) ?? null,
    requesterFullName: (r.RequesterFullName as string) ?? null,
    requesterEmail: (r.RequesterEmail as string) ?? null,
    requesterPosition: (r.RequesterPosition as string) ?? null,
    requesterDepartmentName: (r.RequesterDepartmentName as string) ?? null,
    managerStaffId: (r.ManagerStaffId as number) ?? null,
    managerEmail: (r.ManagerEmail as string) ?? null,
    companyName: (r.CompanyName as string) ?? null,
    totalAmount: num(r.TotalAmount),
    paymentDate: r.PaymentDate ? toYmd(r.PaymentDate as Date) : null,
    submittedBy: (r.SubmittedBy as number) ?? null,
    submittedAt: r.SubmittedAt ? (r.SubmittedAt as Date).toISOString() : null,
    createdAt: r.CreatedAt ? (r.CreatedAt as Date).toISOString() : "",
    updatedAt: r.UpdatedAt ? (r.UpdatedAt as Date).toISOString() : "",
  };
}

/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Normalize save payload to a non-empty travelDays array. */
export function normalizeTravelDays(input: Pick<SaveInput, "travelDays" | "travel">): TravelExpenseDetail[] {
  let days: TravelExpenseDetail[];
  if (input.travelDays && input.travelDays.length > 0) {
    days = input.travelDays.map((d, i) => ({ ...emptyTravel(), ...d, sortOrder: d.sortOrder ?? i }));
  } else if (input.travel) {
    days = [{ ...emptyTravel(), ...input.travel, sortOrder: input.travel.sortOrder ?? 0 }];
  } else {
    days = [{ ...emptyTravel(), travelDate: null }];
  }
  return normalizeTravelDaySections(days);
}

function mapTravelRow(
  t: Record<string, unknown>,
  items: TravelExpenseItem[],
): TravelExpenseDetail {
  return {
    id: t.Id as number,
    sortOrder: (t.SortOrder as number) ?? 0,
    travelDate: t.TravelDate ? toYmd(t.TravelDate as Date) : null,
    workDetail: (t.WorkDetail as string) ?? null,
    vehicleId: (t.VehicleId as number) ?? null,
    vehicleName: (t.VehicleName as string) ?? null,
    ratePerKm: num(t.RatePerKm),
    isManualEntry: !!t.IsManualEntry,
    direction: (t.Direction as TravelExpenseDetail["direction"]) ?? null,
    onwardOrigin: (t.OnwardOrigin as string) ?? null,
    onwardOriginLat: num(t.OnwardOriginLat), onwardOriginLng: num(t.OnwardOriginLng),
    onwardDestination: (t.OnwardDestination as string) ?? null,
    onwardDestLat: num(t.OnwardDestLat), onwardDestLng: num(t.OnwardDestLng),
    onwardDistanceKm: num(t.OnwardDistanceKm),
    onwardWaypoints: parseRouteWaypoints(t.OnwardWaypoints),
    returnOrigin: (t.ReturnOrigin as string) ?? null,
    returnOriginLat: num(t.ReturnOriginLat), returnOriginLng: num(t.ReturnOriginLng),
    returnDestination: (t.ReturnDestination as string) ?? null,
    returnDestLat: num(t.ReturnDestLat), returnDestLng: num(t.ReturnDestLng),
    returnDistanceKm: num(t.ReturnDistanceKm),
    returnWaypoints: parseRouteWaypoints(t.ReturnWaypoints),
    totalDistanceKm: num(t.TotalDistanceKm),
    totalAmount: num(t.TotalAmount),
    sections: [],
    items,
  };
}

function mapItemRow(x: Record<string, unknown>, filesByItem: Map<number, AccFileMeta[]>): TravelExpenseItem {
  return {
    id: x.Id as number,
    itemType: x.ItemType as TravelExpenseItem["itemType"],
    amount: Number(x.Amount) || 0,
    sortOrder: x.SortOrder as number,
    vehicleSectionId: (x.VehicleSectionId as number) ?? null,
    files: filesByItem.get(x.Id as number) ?? [],
  };
}

async function loadTravelDays(pool: Awaited<ReturnType<typeof getAccPool>>, requestId: number): Promise<TravelExpenseDetail[]> {
  const tRes = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT * FROM [dbo].[AccTravelExpense] WHERE RequestId = @id ORDER BY SortOrder, TravelDate, Id`);
  if (tRes.recordset.length === 0) return [];

  const travelIds = (tRes.recordset as Record<string, unknown>[]).map((r) => r.Id as number);

  const filesRes = await pool.request().input("rid", sql.Int, requestId)
    .query(`SELECT Id, RefId, FileName, FileSize, ContentType, StoragePath
            FROM [dbo].[AccRequestFile] WHERE RequestId = @rid AND RefType = 'travel_item'`);
  const filesByItem = new Map<number, AccFileMeta[]>();
  for (const f of filesRes.recordset as Record<string, unknown>[]) {
    const refId = f.RefId as number;
    const meta: AccFileMeta = {
      id: f.Id as number, fileName: f.FileName as string,
      fileSize: (f.FileSize as number) ?? null, contentType: (f.ContentType as string) ?? null,
      url: `/api/request/accounting/files/${f.Id as number}`,
    };
    if (!filesByItem.has(refId)) filesByItem.set(refId, []);
    filesByItem.get(refId)!.push(meta);
  }

  const sectionsByTravel = new Map<number, TravelVehicleSection[]>();
  try {
    const secRes = await pool.request().input("rid", sql.Int, requestId)
      .query(`SELECT s.* FROM [dbo].[AccTravelVehicleSection] s
              INNER JOIN [dbo].[AccTravelExpense] t ON t.Id = s.TravelExpenseId
              WHERE t.RequestId = @rid
              ORDER BY s.TravelExpenseId, s.SortOrder, s.Id`);
    for (const row of secRes.recordset as Record<string, unknown>[]) {
      const teid = row.TravelExpenseId as number;
      const sec: TravelVehicleSection = {
        id: row.Id as number,
        sortOrder: (row.SortOrder as number) ?? 0,
        vehicleId: (row.VehicleId as number) ?? null,
        vehicleName: (row.VehicleName as string) ?? null,
        ratePerKm: num(row.RatePerKm),
        isManualEntry: !!row.IsManualEntry,
        items: [],
      };
      if (!sectionsByTravel.has(teid)) sectionsByTravel.set(teid, []);
      sectionsByTravel.get(teid)!.push(sec);
    }
  } catch {
    // Table may not exist before migration 026 — legacy single-vehicle rows still load.
  }

  const itemsByTravel = new Map<number, TravelExpenseItem[]>();
  if (travelIds.length > 0) {
    const idList = travelIds.join(",");
    let legacyItems = false;
    try {
      const itemsRes = await pool.request().query(
        `SELECT Id, TravelExpenseId, ItemType, Amount, SortOrder, VehicleSectionId
         FROM [dbo].[AccTravelExpenseItem]
         WHERE TravelExpenseId IN (${idList})
         ORDER BY TravelExpenseId, SortOrder, Id`,
      );
      for (const x of itemsRes.recordset as Record<string, unknown>[]) {
        const teid = x.TravelExpenseId as number;
        const item = mapItemRow(x, filesByItem);
        if (!itemsByTravel.has(teid)) itemsByTravel.set(teid, []);
        itemsByTravel.get(teid)!.push(item);
      }
    } catch {
      legacyItems = true;
    }
    if (legacyItems) {
      const itemsRes = await pool.request().query(
        `SELECT Id, TravelExpenseId, ItemType, Amount, SortOrder
         FROM [dbo].[AccTravelExpenseItem]
         WHERE TravelExpenseId IN (${idList})
         ORDER BY TravelExpenseId, SortOrder, Id`,
      );
      for (const x of itemsRes.recordset as Record<string, unknown>[]) {
        const teid = x.TravelExpenseId as number;
        const item = mapItemRow({ ...x, VehicleSectionId: null }, filesByItem);
        if (!itemsByTravel.has(teid)) itemsByTravel.set(teid, []);
        itemsByTravel.get(teid)!.push(item);
      }
    }
  }

  const days: TravelExpenseDetail[] = [];
  for (const row of tRes.recordset as Record<string, unknown>[]) {
    const travelExpenseId = row.Id as number;
    const allItems = itemsByTravel.get(travelExpenseId) ?? [];
    const sections = sectionsByTravel.get(travelExpenseId) ?? [];
    const dayItems: TravelExpenseItem[] = [];
    for (const it of allItems) {
      if (it.vehicleSectionId) {
        const sec = sections.find((s) => s.id === it.vehicleSectionId);
        if (sec) sec.items.push(it);
      } else {
        dayItems.push(it);
      }
    }
    const day = mapTravelRow(row, dayItems);
    day.sections = sections;
    days.push(normalizeTravelDay(day));
  }
  return days;
}

function attachTravelToRequest(req: AccRequest, days: TravelExpenseDetail[]): void {
  req.travelDays = days;
  req.travel = days[0];
}

/* ─────────────────────────── reads ─────────────────────────── */

/** Full request: header + travel detail + items (with files) + approvals. */
export async function getRequest(id: number): Promise<AccRequest | null> {
  const pool = await getAccPool();
  const head = await pool.request().input("id", sql.Int, id)
    .query(`SELECT * FROM [dbo].[AccRequest] WHERE Id = @id`);
  if (head.recordset.length === 0) return null;
  const req = mapRequestRow(head.recordset[0] as Record<string, unknown>);

  const days = await loadTravelDays(pool, id);
  if (days.length > 0) attachTravelToRequest(req, days);

  const aRes = await pool.request().input("id", sql.Int, id)
    .query(`SELECT a.*,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_action.FirstName, N' ', e_action.LastName))), N''), e_action.FullName) AS ActionedByHrName,
              COALESCE(e_action.Email, e_action.EmailCompBr) AS ActionedByHrEmail,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_assign.FirstName, N' ', e_assign.LastName))), N''), e_assign.FullName) AS AssignedToHrName,
              COALESCE(e_assign.Email, e_assign.EmailCompBr) AS AssignedToHrEmail
            FROM [dbo].[AccApproval] a
            LEFT JOIN ${hrEmployeeTable()} e_action ON e_action.StaffId = a.ActionedByStaffId AND e_action.Status = N'Active'
            LEFT JOIN ${hrEmployeeTable()} e_assign ON e_assign.StaffId = a.AssignedTo AND e_assign.Status = N'Active'
            WHERE a.RequestId = @id
            ORDER BY a.StepOrder, a.Id`);
  req.approvals = (aRes.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number, requestId: x.RequestId as number,
    stepCode: x.StepCode as AccApproval["stepCode"], stepOrder: x.StepOrder as number,
    assignedTo: (x.AssignedTo as number) ?? null, assignedEmail: (x.AssignedEmail as string) ?? null,
    status: x.Status as AccApproval["status"], comment: (x.Comment as string) ?? null,
    isChecked: x.IsChecked === null || x.IsChecked === undefined ? null : !!x.IsChecked,
    actionedByStaffId: (x.ActionedByStaffId as number) ?? null,
    actionedAt: x.ActionedAt ? (x.ActionedAt as Date).toISOString() : null,
    createdAt: x.CreatedAt ? (x.CreatedAt as Date).toISOString() : "",
    actionedByHrName: (x.ActionedByHrName as string) ?? null,
    actionedByHrEmail: (x.ActionedByHrEmail as string) ?? null,
    assignedToHrName: (x.AssignedToHrName as string) ?? null,
    assignedToHrEmail: (x.AssignedToHrEmail as string) ?? null,
  }));

  return req;
}

/** Requester's own requests (including drafts), newest first. */
export async function listMyRequests(submittedByOrCreator: number): Promise<AccRequest[]> {
  const pool = await getAccPool();
  const res = await pool.request().input("uid", sql.Int, submittedByOrCreator)
    .query(`SELECT * FROM [dbo].[AccRequest]
            WHERE SubmittedBy = @uid OR CreatedBy = @uid
            ORDER BY CreatedAt DESC`);
  return (res.recordset as Record<string, unknown>[]).map(mapRequestRow);
}

/** Editable travel-expense drafts for the current user (by CreatedBy or SubmittedBy — the creator, not the on-behalf requester). */
export async function listMyTravelDrafts(
  userId: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility; drafts now key on creator only
  staffId: number | null,
): Promise<TravelDraftSummary[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP1_FORM_CODE)
    .query(`
      SELECT r.Id, r.BrandCode, r.Status, r.UpdatedAt, r.TotalAmount,
             MIN(t.TravelDate) AS TravelDate,
             MAX(t.TravelDate) AS TravelDateTo,
             COUNT(t.Id) AS DayCount,
             (SELECT TOP 1 te.WorkDetail FROM [dbo].[AccTravelExpense] te
              WHERE te.RequestId = r.Id ORDER BY te.SortOrder, te.TravelDate, te.Id) AS WorkDetail
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
      WHERE r.FormCode = @form
        AND r.Status IN ('Draft', 'Returned')
        AND (r.CreatedBy = @uid OR r.SubmittedBy = @uid)
      GROUP BY r.Id, r.BrandCode, r.Status, r.UpdatedAt, r.TotalAmount
      ORDER BY r.UpdatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => ({
    id: row.Id as number,
    brandCode: (row.BrandCode as string) ?? null,
    status: row.Status as TravelDraftSummary["status"],
    travelDate: row.TravelDate ? toYmd(row.TravelDate as Date) : null,
    travelDateTo: row.TravelDateTo ? toYmd(row.TravelDateTo as Date) : null,
    dayCount: Number(row.DayCount) || 0,
    workDetail: (row.WorkDetail as string) ?? null,
    totalAmount: num(row.TotalAmount),
    updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
  }));
}

/* ─────────────────────────── validation ─────────────────────────── */

/** True if this StaffId may claim the same travel date across different brands. */
export async function isSameDayMultiBrandStaff(staffId: number): Promise<boolean> {
  const pool = await getAccPool();
  const r = await pool.request()
    .input("staff", sql.Int, staffId)
    .query(`SELECT TOP 1 1 FROM [dbo].[AccSameDayBrandStaff] WHERE StaffId = @staff AND IsActive = 1`);
  return r.recordset.length > 0;
}

/**
 * Travel-date duplicate check. Normally blocks same StaffId + same date
 * (status != Rejected, different request). For allowlisted staff with a brand,
 * blocks only when the brand also matches (same date, different brand is allowed).
 */
export async function isDuplicateTravelDate(
  staffId: number, travelDate: string, excludeRequestId: number | null,
  brandCode?: string | null,
): Promise<boolean> {
  const pool = await getAccPool();
  const allowMultiBrand = !!brandCode && (await isSameDayMultiBrandStaff(staffId));
  const r = await pool.request()
    .input("staff", sql.Int, staffId)
    .input("date", sql.Date, travelDate)
    .input("exclude", sql.Int, excludeRequestId ?? 0)
    .input("brand", sql.NVarChar(20), brandCode ?? null)
    .query(`
      SELECT TOP 1 1 AS dup FROM [dbo].[AccRequest] r
      JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
      WHERE r.StaffId = @staff AND t.TravelDate = @date
        AND r.Status <> 'Rejected' AND r.Id <> @exclude
        ${allowMultiBrand ? "AND r.BrandCode = @brand" : ""}
    `);
  return r.recordset.length > 0;
}

/** Travel dates already used in another non-rejected request for this user/staff. */
export async function listBlockedTravelDates(
  userId: number,
  staffId: number | null,
  excludeRequestId: number | null,
  brandCode?: string | null,
): Promise<string[]> {
  const pool = await getAccPool();
  const allowMultiBrand =
    !!brandCode && staffId != null && (await isSameDayMultiBrandStaff(staffId));
  const res = await pool.request()
    .input("uid", sql.Int, userId)
    .input("staff", sql.Int, staffId ?? null)
    .input("exclude", sql.Int, excludeRequestId ?? 0)
    .input("brand", sql.NVarChar(20), brandCode ?? null)
    .query(`
      SELECT DISTINCT t.TravelDate
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
      WHERE r.Status <> N'Rejected'
        AND r.Id <> @exclude
        AND t.TravelDate IS NOT NULL
        AND (
          r.CreatedBy = @uid
          OR r.SubmittedBy = @uid
          OR (@staff IS NOT NULL AND r.StaffId = @staff)
        )
        ${allowMultiBrand ? "AND r.BrandCode = @brand" : ""}
      ORDER BY t.TravelDate
    `);
  const out: string[] = [];
  for (let i = 0; i < res.recordset.length; i++) {
    const row = res.recordset[i] as { TravelDate: Date };
    out.push(toYmd(row.TravelDate));
  }
  return out;
}

export async function validateForSubmit(
  input: SaveInput,
  staffId: number | null,
  managerStaffId: number | null,
): Promise<string[]> {
  const errs: string[] = [];
  const days = normalizeTravelDays(input);
  const dayLabel = (i: number) => (days.length > 1 ? ` (วันที่ ${i + 1})` : "");

  // In UAT a missing manager is a UAT-list problem, not an HR one — pointing at
  // HR would invite somebody to attach a real manager to test data.
  const uat = await isUatRequest();
  if (!managerStaffId) {
    errs.push(uat ? UAT_MANAGER_MISSING_ERROR : "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR");
  } else {
    const mgrEmail = await resolveManagerEmail(managerStaffId);
    if (!mgrEmail) {
      errs.push(uat ? UAT_MANAGER_MISSING_ERROR : "ไม่พบอีเมลผู้จัดการในระบบ HR — ไม่สามารถส่งอนุมัติได้");
    }
  }
  if (!input.brandCode) errs.push("กรุณาเลือกแบรนด์ที่ต้องการเบิก");

  const datesInRequest = days.map((d) => d.travelDate).filter(Boolean) as string[];
  if (new Set(datesInRequest).size !== datesInRequest.length) {
    errs.push("วันที่เดินทางซ้ำกันภายในคำขอเดียวกัน");
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1);

  for (let i = 0; i < days.length; i++) {
    const t = days[i];
    const lbl = dayLabel(i);
    if (!t.travelDate) {
      errs.push(`กรุณาเลือกวันที่เดินทาง${lbl}`);
    } else {
      const td = new Date(t.travelDate + "T00:00:00");
      if (td > today) errs.push(`วันที่เดินทางต้องไม่เป็นอนาคต${lbl}`);
      if (td < monthAgo) errs.push(`วันที่เดินทางย้อนหลังได้ไม่เกิน 1 เดือน${lbl}`);
      if (staffId && (await isDuplicateTravelDate(staffId, t.travelDate, input.id ?? null, input.brandCode ?? null)))
        errs.push(`วันที่เดินทางซ้ำกับคำขอก่อนหน้า${lbl}`);
    }
    if (!t.workDetail?.trim()) errs.push(`กรุณากรอกรายละเอียดการไปปฏิบัติงาน${lbl}`);
    const day = normalizeTravelDay(t);
    const hasVehicle =
      hasRateVehicle(day) ||
      (day.sections?.length ?? 0) > 0 ||
      !!(day.vehicleId && day.isManualEntry);
    if (!hasVehicle) errs.push(`กรุณาเลือกพาหนะ${lbl}`);
    if (allDayItems(day).some((it) => Number(it.amount) > 0 && !(it.files && it.files.length > 0))) {
      errs.push(`กรุณาแนบรูปใบเสร็จสำหรับรายการค่าใช้จ่ายที่กรอกจำนวนเงิน${lbl}`);
    }
    if (hasRateVehicle(day)) {
      if (!day.direction) errs.push(`กรุณาเลือกทิศทางการเดินทาง${lbl}`);
      if (day.direction !== "return" && !day.onwardDistanceKm) errs.push(`กรุณาระบุระยะทางขาไป${lbl}`);
      if (day.direction !== "onward" && !day.returnDistanceKm) errs.push(`กรุณาระบุระยะทางขากลับ${lbl}`);
    }
    for (const sec of day.sections ?? []) {
      if (!sec.items.some((it) => it.itemType === "fare" && it.amount > 0)) {
        errs.push(`กรุณากรอกค่าเดินทาง (${sec.vehicleName ?? "พาหนะ"})${lbl}`);
      }
    }
    if (
      !hasRateVehicle(day) &&
      day.isManualEntry &&
      (!day.sections || day.sections.length === 0) &&
      !day.items.some((it) => it.itemType === "fare" && it.amount > 0)
    ) {
      errs.push(`กรุณากรอกค่าเดินทาง${lbl}`);
    }
  }
  return errs;
}

/* ─────────────────────────── writes ─────────────────────────── */

/** Bind every AccTravelExpense column on a request for insert/update. */
function bindTravel(req: ReturnType<Awaited<ReturnType<typeof getAccPool>>["request"]>, t: TravelExpenseDetail) {
  const day = normalizeTravelDay(t);
  return req
    .input("sortOrder", sql.Int, day.sortOrder ?? 0)
    .input("travelDate", sql.Date, day.travelDate || null)
    .input("workDetail", sql.NVarChar, day.workDetail ?? null)
    .input("vehicleId", sql.Int, day.vehicleId ?? null)
    .input("vehicleName", sql.NVarChar, day.vehicleName ?? null)
    .input("ratePerKm", sql.Decimal(18, 2), day.ratePerKm ?? null)
    .input("isManual", sql.Bit, day.isManualEntry ? 1 : 0)
    .input("direction", sql.NVarChar, day.direction ?? null)
    .input("oOrigin", sql.NVarChar, day.onwardOrigin ?? null)
    .input("oOriginLat", sql.Decimal(10, 7), day.onwardOriginLat ?? null)
    .input("oOriginLng", sql.Decimal(10, 7), day.onwardOriginLng ?? null)
    .input("oDest", sql.NVarChar, day.onwardDestination ?? null)
    .input("oDestLat", sql.Decimal(10, 7), day.onwardDestLat ?? null)
    .input("oDestLng", sql.Decimal(10, 7), day.onwardDestLng ?? null)
    .input("oDist", sql.Decimal(18, 2), day.onwardDistanceKm ?? null)
    .input("oWaypoints", sql.NVarChar(sql.MAX), serializeRouteWaypoints(day.onwardWaypoints))
    .input("rOrigin", sql.NVarChar, day.returnOrigin ?? null)
    .input("rOriginLat", sql.Decimal(10, 7), day.returnOriginLat ?? null)
    .input("rOriginLng", sql.Decimal(10, 7), day.returnOriginLng ?? null)
    .input("rDest", sql.NVarChar, day.returnDestination ?? null)
    .input("rDestLat", sql.Decimal(10, 7), day.returnDestLat ?? null)
    .input("rDestLng", sql.Decimal(10, 7), day.returnDestLng ?? null)
    .input("rDist", sql.Decimal(18, 2), day.returnDistanceKm ?? null)
    .input("rWaypoints", sql.NVarChar(sql.MAX), serializeRouteWaypoints(day.returnWaypoints))
    .input("totalDist", sql.Decimal(18, 2), computeTotalDistance(day))
    .input("totalAmt", sql.Decimal(18, 2), computeTotalAmount(day));
}

const TRAVEL_COLUMNS = `TravelDate, WorkDetail, VehicleId, VehicleName, RatePerKm, IsManualEntry, Direction,
  OnwardOrigin, OnwardOriginLat, OnwardOriginLng, OnwardDestination, OnwardDestLat, OnwardDestLng, OnwardDistanceKm, OnwardWaypoints,
  ReturnOrigin, ReturnOriginLat, ReturnOriginLng, ReturnDestination, ReturnDestLat, ReturnDestLng, ReturnDistanceKm, ReturnWaypoints,
  TotalDistanceKm, TotalAmount`;
const TRAVEL_VALUES = `@travelDate, @workDetail, @vehicleId, @vehicleName, @ratePerKm, @isManual, @direction,
  @oOrigin, @oOriginLat, @oOriginLng, @oDest, @oDestLat, @oDestLng, @oDist, @oWaypoints,
  @rOrigin, @rOriginLat, @rOriginLng, @rDest, @rDestLat, @rDestLng, @rDist, @rWaypoints,
  @totalDist, @totalAmt`;
const TRAVEL_SET = `SortOrder=@sortOrder, TravelDate=@travelDate, WorkDetail=@workDetail, VehicleId=@vehicleId, VehicleName=@vehicleName,
  RatePerKm=@ratePerKm, IsManualEntry=@isManual, Direction=@direction,
  OnwardOrigin=@oOrigin, OnwardOriginLat=@oOriginLat, OnwardOriginLng=@oOriginLng,
  OnwardDestination=@oDest, OnwardDestLat=@oDestLat, OnwardDestLng=@oDestLng, OnwardDistanceKm=@oDist, OnwardWaypoints=@oWaypoints,
  ReturnOrigin=@rOrigin, ReturnOriginLat=@rOriginLat, ReturnOriginLng=@rOriginLng,
  ReturnDestination=@rDest, ReturnDestLat=@rDestLat, ReturnDestLng=@rDestLng, ReturnDistanceKm=@rDist, ReturnWaypoints=@rWaypoints,
  TotalDistanceKm=@totalDist, TotalAmount=@totalAmt`;

type AccTx = {
  request: () => ReturnType<Awaited<ReturnType<typeof getAccPool>>["request"]>;
};

async function persistTravelItems(
  tx: AccTx,
  requestId: number,
  travelExpenseId: number,
  items: TravelExpenseItem[],
  vehicleSectionId: number | null,
): Promise<void> {
  const existingItemsRes = await tx.request()
    .input("teid", sql.Int, travelExpenseId)
    .input("sid", sql.Int, vehicleSectionId)
    .query(`SELECT Id FROM [dbo].[AccTravelExpenseItem]
            WHERE TravelExpenseId = @teid
              AND ((@sid IS NULL AND VehicleSectionId IS NULL) OR VehicleSectionId = @sid)`);
  const existingIds = new Set<number>(
    (existingItemsRes.recordset as { Id: number }[]).map((r) => r.Id),
  );
  const keptIds = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.id && existingIds.has(it.id)) {
      keptIds.add(it.id);
      await tx.request()
        .input("id", sql.Int, it.id)
        .input("type", sql.NVarChar, it.itemType)
        .input("amount", sql.Decimal(18, 2), it.amount || 0)
        .input("sort", sql.Int, it.sortOrder ?? i)
        .input("sid", sql.Int, vehicleSectionId)
        .query(`UPDATE [dbo].[AccTravelExpenseItem]
                SET ItemType=@type, Amount=@amount, SortOrder=@sort, VehicleSectionId=@sid
                WHERE Id=@id`);
    } else {
      await tx.request()
        .input("teid", sql.Int, travelExpenseId)
        .input("type", sql.NVarChar, it.itemType)
        .input("amount", sql.Decimal(18, 2), it.amount || 0)
        .input("sort", sql.Int, it.sortOrder ?? i)
        .input("sid", sql.Int, vehicleSectionId)
        .query(`INSERT INTO [dbo].[AccTravelExpenseItem] (TravelExpenseId, ItemType, Amount, SortOrder, VehicleSectionId)
                VALUES (@teid, @type, @amount, @sort, @sid)`);
    }
  }
  for (const oldId of Array.from(existingIds)) {
    if (keptIds.has(oldId)) continue;
    await tx.request().input("rid", sql.Int, requestId).input("oldId", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId=@rid AND RefType='travel_item' AND RefId=@oldId`);
    await tx.request().input("oldId", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem] WHERE Id=@oldId`);
  }
}

async function persistTravelSections(
  tx: AccTx,
  requestId: number,
  travelExpenseId: number,
  sections: TravelVehicleSection[],
): Promise<void> {
  let existingIds = new Set<number>();
  try {
    const existingRes = await tx.request().input("teid", sql.Int, travelExpenseId)
      .query(`SELECT Id FROM [dbo].[AccTravelVehicleSection] WHERE TravelExpenseId = @teid`);
    existingIds = new Set<number>(
      (existingRes.recordset as { Id: number }[]).map((r) => r.Id),
    );
  } catch {
    return;
  }

  const keptIds = new Set<number>();
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.id && existingIds.has(sec.id)) {
      keptIds.add(sec.id);
      await tx.request()
        .input("id", sql.Int, sec.id)
        .input("sort", sql.Int, sec.sortOrder ?? i)
        .input("vid", sql.Int, sec.vehicleId ?? null)
        .input("vname", sql.NVarChar, sec.vehicleName ?? null)
        .input("rate", sql.Decimal(18, 2), sec.ratePerKm ?? null)
        .input("manual", sql.Bit, sec.isManualEntry ? 1 : 0)
        .query(`UPDATE [dbo].[AccTravelVehicleSection]
                SET SortOrder=@sort, VehicleId=@vid, VehicleName=@vname, RatePerKm=@rate, IsManualEntry=@manual
                WHERE Id=@id`);
      await persistTravelItems(tx, requestId, travelExpenseId, sec.items ?? [], sec.id);
    } else {
      const ins = await tx.request()
        .input("teid", sql.Int, travelExpenseId)
        .input("sort", sql.Int, sec.sortOrder ?? i)
        .input("vid", sql.Int, sec.vehicleId ?? null)
        .input("vname", sql.NVarChar, sec.vehicleName ?? null)
        .input("rate", sql.Decimal(18, 2), sec.ratePerKm ?? null)
        .input("manual", sql.Bit, sec.isManualEntry ? 1 : 0)
        .query(`INSERT INTO [dbo].[AccTravelVehicleSection]
                (TravelExpenseId, SortOrder, VehicleId, VehicleName, RatePerKm, IsManualEntry)
                OUTPUT inserted.Id AS Id
                VALUES (@teid, @sort, @vid, @vname, @rate, @manual)`);
      const sectionId = ins.recordset[0].Id as number;
      keptIds.add(sectionId);
      await persistTravelItems(tx, requestId, travelExpenseId, sec.items ?? [], sectionId);
    }
  }

  for (const oldId of Array.from(existingIds)) {
    if (keptIds.has(oldId)) continue;
    await tx.request().input("rid", sql.Int, requestId).input("sid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccRequestFile]
              WHERE RequestId=@rid AND RefType='travel_item'
                AND RefId IN (SELECT Id FROM [dbo].[AccTravelExpenseItem] WHERE VehicleSectionId=@sid)`);
    await tx.request().input("sid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelVehicleSection] WHERE Id=@sid`);
  }
}

async function persistTravelDays(
  tx: AccTx,
  requestId: number,
  days: TravelExpenseDetail[],
): Promise<void> {
  const existingRes = await tx.request().input("rid", sql.Int, requestId)
    .query(`SELECT Id FROM [dbo].[AccTravelExpense] WHERE RequestId = @rid`);
  const existingIds = new Set<number>(
    (existingRes.recordset as { Id: number }[]).map((r) => r.Id),
  );
  const keptIds = new Set<number>();

  for (let i = 0; i < days.length; i++) {
    const day: TravelExpenseDetail = normalizeTravelDay({ ...days[i], sortOrder: days[i].sortOrder ?? i });
    if (day.id && existingIds.has(day.id)) {
      keptIds.add(day.id);
      const r = bindTravel(tx.request().input("teid", sql.Int, day.id), day);
      await r.query(`UPDATE [dbo].[AccTravelExpense] SET ${TRAVEL_SET} WHERE Id=@teid`);
      await persistTravelItems(tx, requestId, day.id, day.items, null);
      await persistTravelSections(tx, requestId, day.id, day.sections ?? []);
    } else {
      const r = bindTravel(tx.request().input("rid", sql.Int, requestId), day);
      const insT = await r.query(`INSERT INTO [dbo].[AccTravelExpense] (RequestId, SortOrder, ${TRAVEL_COLUMNS})
        OUTPUT inserted.Id AS Id VALUES (@rid, @sortOrder, ${TRAVEL_VALUES})`);
      const travelExpenseId = insT.recordset[0].Id as number;
      keptIds.add(travelExpenseId);
      await persistTravelItems(tx, requestId, travelExpenseId, day.items, null);
      await persistTravelSections(tx, requestId, travelExpenseId, day.sections ?? []);
    }
  }

  for (const oldId of Array.from(existingIds)) {
    if (keptIds.has(oldId)) continue;
    await tx.request().input("rid", sql.Int, requestId).input("teid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccRequestFile]
              WHERE RequestId=@rid AND RefType='travel_item'
                AND RefId IN (SELECT Id FROM [dbo].[AccTravelExpenseItem] WHERE TravelExpenseId=@teid)`);
    await tx.request().input("teid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem] WHERE TravelExpenseId=@teid`);
    await tx.request().input("teid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelExpense] WHERE Id=@teid`);
  }

  const requestTotal = computeRequestTotalAmount(days);
  await tx.request()
    .input("rid", sql.Int, requestId)
    .input("total", sql.Decimal(18, 2), requestTotal)
    .query(`UPDATE [dbo].[AccRequest] SET TotalAmount=@total, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
}

/**
 * Create or update a draft (lenient — no strict validation).
 * Persists header (Status stays Draft unless already submitted), travel detail (upsert),
 * and replaces non-file expense item rows. Returns the request id.
 */
export async function saveDraft(
  input: SaveInput,
  userId: number,
  loginEmail: string,
): Promise<number> {
  await assertFormWritable();
  const pool = await getAccPool();
  const days = normalizeTravelDays(input);
  const requester = await resolveRequesterForActor(loginEmail, input.requesterStaffId ?? null);
  const tx = pool.transaction();
  await tx.begin();
  try {
    let requestId = input.id ?? 0;

    if (!requestId) {
      const ins = await tx.request()
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("user", sql.Int, userId || null)
        .input("form", sql.NVarChar, AP1_FORM_CODE)
        .input("empId", sql.UniqueIdentifier, requester.employeeId)
        .input("staffId", sql.Int, requester.staffId)
        .input("rFirst", sql.NVarChar, requester.firstName)
        .input("rLast", sql.NVarChar, requester.lastName)
        .input("rFull", sql.NVarChar, requester.fullName)
        .input("rEmail", sql.NVarChar, requester.email)
        .input("rPos", sql.NVarChar, requester.position)
        .input("rDeptId", sql.Int, requester.departmentId)
        .input("rDeptName", sql.NVarChar, requester.departmentName)
        .input("rDeptCode", sql.NVarChar, requester.departmentCode)
        .input("mgrStaff", sql.Int, requester.managerStaffId)
        .query(`INSERT INTO [dbo].[AccRequest]
                  (FormCode, BrandCode, Status, CreatedBy,
                   EmployeeId, StaffId, RequesterFirstName, RequesterLastName, RequesterFullName,
                   RequesterEmail, RequesterPosition, RequesterDepartmentId, RequesterDepartmentName,
                   RequesterDepartmentCode, ManagerStaffId)
                OUTPUT inserted.Id AS Id
                VALUES (@form, @brand, 'Draft', @user,
                   @empId, @staffId, @rFirst, @rLast, @rFull,
                   @rEmail, @rPos, @rDeptId, @rDeptName, @rDeptCode, @mgrStaff)`);
      requestId = ins.recordset[0].Id as number;
    } else {
      const own = await tx.request().input("id", sql.Int, requestId)
        .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id`);
      if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
      const ownerRow = own.recordset[0] as { CreatedBy: number | null; Status: string };
      if (ownerRow.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์แก้ไขคำขอนี้");
      if (ownerRow.Status !== "Draft" && ownerRow.Status !== "Returned") {
        throw new Error("คำขอนี้ไม่สามารถแก้ไขได้ในสถานะปัจจุบัน");
      }
      await tx.request()
        .input("id", sql.Int, requestId)
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("empId", sql.UniqueIdentifier, requester.employeeId)
        .input("staffId", sql.Int, requester.staffId)
        .input("rFirst", sql.NVarChar, requester.firstName)
        .input("rLast", sql.NVarChar, requester.lastName)
        .input("rFull", sql.NVarChar, requester.fullName)
        .input("rEmail", sql.NVarChar, requester.email)
        .input("rPos", sql.NVarChar, requester.position)
        .input("rDeptId", sql.Int, requester.departmentId)
        .input("rDeptName", sql.NVarChar, requester.departmentName)
        .input("rDeptCode", sql.NVarChar, requester.departmentCode)
        .input("mgrStaff", sql.Int, requester.managerStaffId)
        .query(`UPDATE [dbo].[AccRequest] SET BrandCode=@brand,
                  EmployeeId=@empId, StaffId=@staffId,
                  RequesterFirstName=@rFirst, RequesterLastName=@rLast, RequesterFullName=@rFull,
                  RequesterEmail=@rEmail, RequesterPosition=@rPos,
                  RequesterDepartmentId=@rDeptId, RequesterDepartmentName=@rDeptName,
                  RequesterDepartmentCode=@rDeptCode, ManagerStaffId=@mgrStaff,
                  UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    }

    await persistTravelDays(tx, requestId, days);

    await tx.commit();
    return requestId;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/**
 * Permanently delete an editable draft (Draft or Returned) owned by the user,
 * along with its travel detail, expense items, attachment rows, approvals and
 * activity log. Ownership + status guarded. One transaction.
 */
export async function deleteDraft(id: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const own = await tx.request().input("id", sql.Int, id)
      .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id`);
    if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
    const row = own.recordset[0] as { CreatedBy: number | null; Status: string };
    if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์ลบคำขอนี้");
    if (row.Status !== "Draft" && row.Status !== "Returned") {
      throw new Error("คำขอนี้ไม่สามารถลบได้ในสถานะปัจจุบัน");
    }

    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem]
              WHERE TravelExpenseId IN (SELECT Id FROM [dbo].[AccTravelExpense] WHERE RequestId=@id)`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccTravelExpense] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccActivityLog] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccRequest] WHERE Id=@id`);

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/**
 * Delete a single expense item (and its attachment files) from an editable draft
 * immediately — no save step required. Recomputes the stored totals afterward.
 * Ownership + status guarded.
 */
export async function deleteItem(requestId: number, itemId: number, userId: number): Promise<void> {
  const pool = await getAccPool();

  const own = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id`);
  if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
  const row = own.recordset[0] as { CreatedBy: number | null; Status: string };
  if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์แก้ไขคำขอนี้");
  if (row.Status !== "Draft" && row.Status !== "Returned") {
    throw new Error("ลบรายการได้เฉพาะคำขอที่เป็นฉบับร่างเท่านั้น");
  }

  // Collect attachment storage paths for this item before deleting the rows.
  const filesRes = await pool.request()
    .input("rid", sql.Int, requestId)
    .input("refId", sql.Int, itemId)
    .query(`SELECT StoragePath FROM [dbo].[AccRequestFile]
            WHERE RequestId=@rid AND RefType='travel_item' AND RefId=@refId`);
  const storagePaths = (filesRes.recordset as { StoragePath: string }[]).map((r) => r.StoragePath);

  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input("rid", sql.Int, requestId).input("refId", sql.Int, itemId)
      .query(`DELETE FROM [dbo].[AccRequestFile]
              WHERE RequestId=@rid AND RefType='travel_item' AND RefId=@refId`);
    await tx.request().input("rid", sql.Int, requestId).input("itemId", sql.Int, itemId)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem]
              WHERE Id=@itemId AND TravelExpenseId IN (SELECT Id FROM [dbo].[AccTravelExpense] WHERE RequestId=@rid)`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  // Best-effort: remove the files from storage.
  for (const p of storagePaths) {
    await deleteFile(p).catch(() => {});
  }

  // Recompute stored totals so drafts (and the draft picker) stay accurate.
  const updated = await getRequest(requestId);
  if (updated?.travelDays?.length) {
    for (const day of updated.travelDays) {
      if (!day.id) continue;
      const total = computeTotalAmount(day);
      const dist = computeTotalDistance(day);
      await pool.request()
        .input("teid", sql.Int, day.id)
        .input("total", sql.Decimal(18, 2), total)
        .input("dist", sql.Decimal(18, 2), dist)
        .query(`UPDATE [dbo].[AccTravelExpense] SET TotalAmount=@total, TotalDistanceKm=@dist WHERE Id=@teid`);
    }
    const requestTotal = computeRequestTotalAmount(updated.travelDays);
    await pool.request().input("rid", sql.Int, requestId)
      .input("total", sql.Decimal(18, 2), requestTotal)
      .query(`UPDATE [dbo].[AccRequest] SET TotalAmount=@total, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
  }
}

/**
 * Submit a request: re-validate, allocate RequestNo, snapshot requester + manager,
 * set totals, create the MANAGER approval, queue the manager email. One transaction.
 */
export async function submitRequest(
  id: number, requester: RequesterSnapshot, userId: number,
): Promise<AccRequest> {
  await assertFormWritable();
  // Persist latest edits first (lenient), then validate.
  const current = await getRequest(id);
  if (!current) throw new Error("ไม่พบคำขอ");
  if (current.status !== "Draft" && current.status !== "Returned") {
    throw new Error("คำขอนี้ถูกส่งไปแล้ว");
  }
  const travelDays = current.travelDays?.length
    ? current.travelDays
    : current.travel
      ? [current.travel]
      : [emptyTravel()];
  const errors = await validateForSubmit(
    { id, brandCode: current.brandCode, travelDays },
    requester.staffId,
    requester.managerStaffId ?? null,
  );
  if (errors.length) throw new Error(errors.join("\n"));

  const managerEmail = await resolveManagerEmail(requester.managerStaffId);
  if (!managerEmail) {
    throw new Error(
      (await isUatRequest())
        ? UAT_MANAGER_MISSING_ERROR
        : "ไม่พบอีเมลผู้จัดการ (ManagerStaffId) — ไม่สามารถส่งอนุมัติได้",
    );
  }

  const requestNo = await allocateRequestNo("TOF");
  const totalAmount = computeRequestTotalAmount(travelDays);

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request()
      .input("id", sql.Int, id)
      .input("no", sql.NVarChar, requestNo)
      .input("empId", sql.UniqueIdentifier, requester.employeeId ?? null)
      .input("staffId", sql.Int, requester.staffId ?? null)
      .input("fname", sql.NVarChar, requester.firstName ?? null)
      .input("lname", sql.NVarChar, requester.lastName ?? null)
      .input("full", sql.NVarChar, requester.fullName ?? null)
      .input("email", sql.NVarChar, requester.email ?? null)
      .input("pos", sql.NVarChar, requester.position ?? null)
      .input("deptId", sql.Int, requester.departmentId ?? null)
      .input("deptName", sql.NVarChar, requester.departmentName ?? null)
      .input("deptCode", sql.NVarChar, requester.departmentCode ?? null)
      .input("mgrStaff", sql.Int, requester.managerStaffId ?? null)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .input("company", sql.NVarChar, requester.companyName ?? null)
      .input("total", sql.Decimal(18, 2), totalAmount)
      .input("by", sql.Int, userId || null)
      .query(`UPDATE [dbo].[AccRequest] SET
        RequestNo=@no, Status='Submitted', CurrentStepCode='MANAGER',
        EmployeeId=@empId, StaffId=@staffId, RequesterFirstName=@fname, RequesterLastName=@lname,
        RequesterFullName=@full, RequesterEmail=@email, RequesterPosition=@pos,
        RequesterDepartmentId=@deptId, RequesterDepartmentName=@deptName, RequesterDepartmentCode=@deptCode,
        ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, CompanyName=@company,
        TotalAmount=@total, SubmittedBy=@by, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
        WHERE Id=@id`);

    // Reset any prior approvals (e.g. resubmit after Return), then create MANAGER step.
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@id`);
    await tx.request()
      .input("id", sql.Int, id)
      .input("mgrStaff", sql.Int, requester.managerStaffId ?? null)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .query(`INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedTo, AssignedEmail, Status)
              VALUES (@id, 'MANAGER', 1, @mgrStaff, @mgrEmail, 'Pending')`);

    await tx.request().input("id", sql.Int, id).input("by", sql.Int, userId || null)
      .input("no", sql.NVarChar, requestNo)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@id, @by, 'submitted', @no)`);

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  const updated = await getRequest(id);
  if (updated) {
    const mail = buildEmail("Submitted", updated);
    await queueEmail({
      requestId: id, toEmail: managerEmail,
      subject: mail.subject, bodyHtml: mail.html, triggerType: "Submitted",
    });
  }
  return updated!;
}
