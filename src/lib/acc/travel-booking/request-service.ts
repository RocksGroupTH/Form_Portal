import { getAccPool, sql } from "@/lib/acc/pool";
import { getDataPool } from "@/lib/db/mssql";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { pickEmployeePhotoUrl } from "@/lib/hr/photo-url";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import type { EmployeeContext } from "@/lib/hr/types";
import { deleteFile } from "@/lib/storage";
import { resolveManagerEmail } from "@/lib/acc/employee-context";
import { allocateRequestNo } from "@/lib/acc/sequence";
import { queueEmail } from "@/lib/acc/email-queue";
import { buildTravelBookingEmail } from "@/lib/acc/travel-booking/email-templates";
import { computePerDiem } from "@/lib/acc/travel-booking/perdiem";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
import {
  listAccommodations,
  listRentVehicles,
  listReasons,
  listVehicles,
} from "@/lib/acc/travel-booking/settings-service";
import { AP17_FORM_CODE, FILE_REFTYPES, RUNNING_PREFIX } from "@/features/travel-booking/constants";
import type {
  Accommodation,
  BookingDetail,
  BookingType,
  DepartureLocation,
  RentVehicle,
  SaveTravelBookingGroupInput,
  SaveTravelBookingInput,
  TravelBookingApproval,
  TravelBookingDraftSummary,
  TravelBookingFileMeta,
  TravelBookingGroup,
  TravelBookingRequest,
  TravelBookingStatus,
  TravelDirection,
  TravelReasonOption,
  VehicleOption,
  WorkLocation,
} from "@/features/travel-booking/types";

/* ─────────────────────────── helpers ─────────────────────────── */

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Time column → HH:mm using local getters (mssql returns TIME as a 1970-01-01-anchored Date). */

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
type AccTx = {
  request: () => ReturnType<AccPool["request"]>;
};

/**
 * Combine an AccRequest row + AccTravelBooking row into every TravelBookingRequest
 * field except the child collections (workLocations/departureLocations/idCardFiles/
 * bookingDetails/approvals), which callers attach separately.
 */
function mapTravelBookingRow(
  r: Record<string, unknown>,
  t: Record<string, unknown>,
): Omit<TravelBookingRequest, "workLocations" | "departureLocations" | "idCardFiles" | "bookingDetails" | "approvals"> {
  return {
    id: r.Id as number,
    requestNo: (r.RequestNo as string) ?? null,
    status: r.Status as TravelBookingStatus,

    staffId: (r.StaffId as number) ?? null,
    requesterFullName: (r.RequesterFullName as string) ?? null,
    requesterPhotoUrl: pickEmployeePhotoUrl(
      (r.HrRequesterPhotoOverrideUrl as string | null) ?? null,
      (r.HrRequesterPhotoUrl as string | null) ?? null,
    ),
    requesterEmail: (r.RequesterEmail as string) ?? null,
    requesterPosition: (r.RequesterPosition as string) ?? null,
    requesterDepartmentName: (r.RequesterDepartmentName as string) ?? null,
    phone: (t.Phone as string) ?? null,
    allowanceSnapshot: num(t.AllowanceSnapshot),

    reasonId: (t.ReasonId as number) ?? null,
    reasonName: (t.ReasonName as string) ?? null,
    reasonCustomText: (t.ReasonCustomText as string) ?? null,

    workDetail: (t.WorkDetail as string) ?? null,

    provinceId: (t.ProvinceId as number) ?? null,
    provinceName: (t.ProvinceName as string) ?? null,

    accommodationId: (t.AccommodationId as number) ?? null,
    accommodationName: (t.AccommodationName as string) ?? null,
    accommodationCustomText: (t.AccommodationCustomText as string) ?? null,
    needsRoomBooking: !!t.NeedsRoomBooking,

    departDate: t.DepartDate ? toYmd(t.DepartDate as Date) : null,
    returnDate: t.ReturnDate ? toYmd(t.ReturnDate as Date) : null,
    departTime: (t.DepartTime as string) ?? null, // time-window string, e.g. "05:00-06:00"
    returnTime: (t.ReturnTime as string) ?? null,

    goVehicleId: (t.GoVehicleId as number) ?? null,
    goVehicleName: (t.GoVehicleName as string) ?? null,
    goVehicleCustomText: (t.GoVehicleCustomText as string) ?? null,
    goNeedsDepartureLocations: !!t.GoNeedsDepartureLocations,
    goNeedsTicketBooking: !!t.GoNeedsTicketBooking,
    goNeedsDepartTime: !!t.GoNeedsDepartTime,
    goNeedsVehicleRent: !!t.GoNeedsVehicleRent,

    returnVehicleId: (t.ReturnVehicleId as number) ?? null,
    returnVehicleName: (t.ReturnVehicleName as string) ?? null,
    returnVehicleCustomText: (t.ReturnVehicleCustomText as string) ?? null,
    returnNeedsDepartureLocations: !!t.ReturnNeedsDepartureLocations,
    returnNeedsTicketBooking: !!t.ReturnNeedsTicketBooking,
    returnNeedsDepartTime: !!t.ReturnNeedsDepartTime,
    returnNeedsVehicleRent: !!t.ReturnNeedsVehicleRent,

    rentVehicleId: (t.RentVehicleId as number) ?? null,
    rentVehicleName: (t.RentVehicleName as string) ?? null,
    rentVehicleCustomText: (t.RentVehicleCustomText as string) ?? null,
    needsRentBooking: !!t.NeedsRentBooking,
    rentStartDate: t.RentStartDate ? toYmd(t.RentStartDate as Date) : null,
    rentEndDate: t.RentEndDate ? toYmd(t.RentEndDate as Date) : null,

    notes: (t.Notes as string) ?? null,

    isContinuation: !!t.IsContinuation,
    perDiemDays: (t.PerDiemDays as number) ?? 0,
    perDiemTotal: Number(t.PerDiemTotal) || 0,

    paymentDate: r.PaymentDate ? toYmd(r.PaymentDate as Date) : null,
    submittedAt: r.SubmittedAt ? (r.SubmittedAt as Date).toISOString() : null,

    groupKey: (t.GroupKey as string) ?? null,
    sortOrder: (t.SortOrder as number) ?? 0,
  };
}

function mapFileRow(x: Record<string, unknown>): TravelBookingFileMeta {
  return {
    id: x.Id as number,
    refType: x.RefType as string,
    refId: (x.RefId as number) ?? 0,
    fileName: x.FileName as string,
    fileSize: (x.FileSize as number) ?? 0,
    contentType: (x.ContentType as string) ?? "",
  };
}

async function loadWorkLocations(pool: AccPool, travelBookingId: number): Promise<WorkLocation[]> {
  const r = await pool.request().input("tbid", sql.Int, travelBookingId)
    .query(`SELECT Id, Name, SortOrder FROM [dbo].[AccTravelWorkLocation] WHERE TravelBookingId=@tbid ORDER BY SortOrder, Id`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number, name: x.Name as string, sortOrder: (x.SortOrder as number) ?? 0,
  }));
}

async function loadDepartureLocations(pool: AccPool, travelBookingId: number): Promise<DepartureLocation[]> {
  const r = await pool.request().input("tbid", sql.Int, travelBookingId)
    .query(`SELECT Id, Direction, Name, SortOrder FROM [dbo].[AccTravelDepartureLocation] WHERE TravelBookingId=@tbid ORDER BY SortOrder, Id`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    direction: x.Direction as TravelDirection,
    name: x.Name as string,
    sortOrder: (x.SortOrder as number) ?? 0,
  }));
}

async function loadIdCardFiles(pool: AccPool, requestId: number): Promise<TravelBookingFileMeta[]> {
  const r = await pool.request()
    .input("rid", sql.Int, requestId)
    .input("reftype", sql.NVarChar, FILE_REFTYPES.ID_CARD)
    .query(`SELECT Id, RefType, RefId, FileName, FileSize, ContentType
            FROM [dbo].[AccRequestFile] WHERE RequestId=@rid AND RefType=@reftype AND RefId=@rid`);
  return (r.recordset as Record<string, unknown>[]).map(mapFileRow);
}

async function loadBookingDetails(pool: AccPool, travelBookingId: number, requestId: number): Promise<BookingDetail[]> {
  const detRes = await pool.request().input("tbid", sql.Int, travelBookingId)
    .query(`SELECT Id, BookingType, BookingNo, PriceExVat FROM [dbo].[AccTravelBookingDetail] WHERE TravelBookingId=@tbid ORDER BY Id`);
  const details = detRes.recordset as Record<string, unknown>[];
  if (details.length === 0) return [];

  const fileRes = await pool.request()
    .input("rid", sql.Int, requestId)
    .input("t1", sql.NVarChar, FILE_REFTYPES.BOOKING_ROOM)
    .input("t2", sql.NVarChar, FILE_REFTYPES.BOOKING_TICKET)
    .input("t3", sql.NVarChar, FILE_REFTYPES.BOOKING_RENT)
    .query(`SELECT Id, RefType, RefId, FileName, FileSize, ContentType
            FROM [dbo].[AccRequestFile] WHERE RequestId=@rid AND RefType IN (@t1,@t2,@t3)`);
  const filesByDetail = new Map<number, TravelBookingFileMeta[]>();
  for (const f of fileRes.recordset as Record<string, unknown>[]) {
    const refId = (f.RefId as number) ?? 0;
    if (!filesByDetail.has(refId)) filesByDetail.set(refId, []);
    filesByDetail.get(refId)!.push(mapFileRow(f));
  }

  return details.map((d) => ({
    id: d.Id as number,
    bookingType: d.BookingType as BookingType,
    bookingNo: (d.BookingNo as string) ?? null,
    priceExVat: num(d.PriceExVat),
    files: filesByDetail.get(d.Id as number) ?? [],
  }));
}

async function loadApprovals(pool: AccPool, requestId: number): Promise<TravelBookingApproval[]> {
  const r = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT a.*,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_action.FirstName, N' ', e_action.LastName))), N''), e_action.FullName) AS ActionedByHrName,
              COALESCE(e_action.Email, e_action.EmailCompBr) AS ActionedByHrEmail,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_assign.FirstName, N' ', e_assign.LastName))), N''), e_assign.FullName) AS AssignedToHrName,
              COALESCE(e_assign.Email, e_assign.EmailCompBr) AS AssignedToHrEmail,
              e_assign.PhotoUrl AS AssignedToHrPhotoUrl,
              e_assign.PhotoOverrideUrl AS AssignedToHrPhotoOverrideUrl
            FROM [dbo].[AccApproval] a
            LEFT JOIN ${hrEmployeeTable()} e_action ON e_action.StaffId = a.ActionedByStaffId AND e_action.Status = N'Active'
            LEFT JOIN ${hrEmployeeTable()} e_assign ON e_assign.StaffId = a.AssignedTo AND e_assign.Status = N'Active'
            WHERE a.RequestId = @id
            ORDER BY a.StepOrder, a.Id`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    requestId: x.RequestId as number,
    stepCode: x.StepCode as TravelBookingApproval["stepCode"],
    stepOrder: x.StepOrder as number,
    assignedTo: (x.AssignedTo as number) ?? null,
    assignedEmail: (x.AssignedEmail as string) ?? null,
    status: x.Status as TravelBookingApproval["status"],
    comment: (x.Comment as string) ?? null,
    isChecked: x.IsChecked === null || x.IsChecked === undefined ? null : !!x.IsChecked,
    actionedByStaffId: (x.ActionedByStaffId as number) ?? null,
    actionedAt: x.ActionedAt ? (x.ActionedAt as Date).toISOString() : null,
    createdAt: x.CreatedAt ? (x.CreatedAt as Date).toISOString() : "",
    actionedByHrName: (x.ActionedByHrName as string) ?? null,
    actionedByHrEmail: (x.ActionedByHrEmail as string) ?? null,
    assignedToHrName: (x.AssignedToHrName as string) ?? null,
    assignedToHrEmail: (x.AssignedToHrEmail as string) ?? null,
    assignedToHrPhotoUrl: pickEmployeePhotoUrl(
      (x.AssignedToHrPhotoOverrideUrl as string | null) ?? null,
      (x.AssignedToHrPhotoUrl as string | null) ?? null,
    ),
  }));
}

/* ─────────────────────────── reads ─────────────────────────── */

/**
 * Full request: AccRequest header ⋈ AccTravelBooking detail, plus work/departure
 * locations, ID-card files, admin booking details (with their files) and approvals.
 */
export async function getTravelBookingRequest(id: number): Promise<TravelBookingRequest | null> {
  const pool = await getAccPool();
  const headRes = await pool.request()
    .input("id", sql.Int, id)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`SELECT r.*, e.PhotoUrl AS HrRequesterPhotoUrl, e.PhotoOverrideUrl AS HrRequesterPhotoOverrideUrl
            FROM [dbo].[AccRequest] r
            LEFT JOIN ${hrEmployeeTable()} e ON e.StaffId = r.StaffId AND e.Status = N'Active'
            WHERE r.Id = @id AND r.FormCode = @form`);
  if (headRes.recordset.length === 0) return null;
  const reqRow = headRes.recordset[0] as Record<string, unknown>;

  const tbRes = await pool.request().input("rid", sql.Int, id)
    .query(`SELECT * FROM [dbo].[AccTravelBooking] WHERE RequestId = @rid`);
  if (tbRes.recordset.length === 0) return null;
  const tbRow = tbRes.recordset[0] as Record<string, unknown>;
  const travelBookingId = tbRow.Id as number;

  const base = mapTravelBookingRow(reqRow, tbRow);

  const [workLocations, departureLocations, idCardFiles, bookingDetails, approvals] = await Promise.all([
    loadWorkLocations(pool, travelBookingId),
    loadDepartureLocations(pool, travelBookingId),
    loadIdCardFiles(pool, id),
    loadBookingDetails(pool, travelBookingId, id),
    loadApprovals(pool, id),
  ]);

  return { ...base, workLocations, departureLocations, idCardFiles, bookingDetails, approvals };
}

/** All tabs sharing one multi-request submission's GroupKey, ordered by SortOrder. */
export async function getTravelBookingGroup(groupKey: string): Promise<TravelBookingGroup> {
  const pool = await getAccPool();
  const res = await pool.request().input("gk", sql.NVarChar(40), groupKey)
    .query(`SELECT RequestId FROM [dbo].[AccTravelBooking] WHERE GroupKey = @gk ORDER BY SortOrder, Id`);
  const ids = (res.recordset as { RequestId: number }[]).map((r) => r.RequestId);
  const loaded = await Promise.all(ids.map((rid) => getTravelBookingRequest(rid)));
  const requests = loaded.filter((r): r is TravelBookingRequest => r !== null);
  return { groupKey, requests };
}

/**
 * Requester's own AP-17 requests (including drafts), newest first. Lightweight —
 * child collections (locations/files/bookingDetails/approvals) are not loaded.
 */
export async function listMyTravelBookings(userId: number): Promise<TravelBookingRequest[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`
      SELECT
        r.Id, r.RequestNo, r.Status, r.StaffId, r.RequesterFullName, r.RequesterEmail, r.RequesterPosition, r.RequesterDepartmentName,
        r.PaymentDate, r.SubmittedAt,
        t.Phone, t.AllowanceSnapshot, t.ReasonId, t.ReasonName, t.ReasonCustomText, t.WorkDetail,
        t.ProvinceId, t.ProvinceName, t.AccommodationId, t.AccommodationName, t.AccommodationCustomText, t.NeedsRoomBooking,
        t.DepartDate, t.ReturnDate, t.DepartTime, t.ReturnTime,
        t.GoVehicleId, t.GoVehicleName, t.GoVehicleCustomText, t.GoNeedsDepartureLocations, t.GoNeedsTicketBooking, t.GoNeedsDepartTime, t.GoNeedsVehicleRent,
        t.ReturnVehicleId, t.ReturnVehicleName, t.ReturnVehicleCustomText, t.ReturnNeedsDepartureLocations, t.ReturnNeedsTicketBooking, t.ReturnNeedsDepartTime, t.ReturnNeedsVehicleRent,
        t.RentVehicleId, t.RentVehicleName, t.RentVehicleCustomText, t.NeedsRentBooking, t.RentStartDate, t.RentEndDate,
        t.Notes, t.IsContinuation, t.PerDiemDays, t.PerDiemTotal, t.GroupKey, t.SortOrder
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
      WHERE r.FormCode = @form AND (r.SubmittedBy = @uid OR r.CreatedBy = @uid)
      ORDER BY r.CreatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => ({
    ...mapTravelBookingRow(row, row),
    workLocations: [], departureLocations: [], idCardFiles: [], bookingDetails: [], approvals: [],
  }));
}

/** Editable AP-17 draft groups for the current user, one summary row per GroupKey. */
export async function listMyTravelDrafts(
  userId: number,
  staffId: number | null,
): Promise<TravelBookingDraftSummary[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`
      SELECT t.GroupKey,
             COUNT(*) AS TabCount,
             MIN(t.DepartDate) AS DepartDate,
             MAX(t.ReturnDate) AS ReturnDate,
             MAX(r.UpdatedAt) AS UpdatedAt,
             (SELECT TOP 1 t2.ProvinceName FROM [dbo].[AccTravelBooking] t2
              WHERE t2.GroupKey = t.GroupKey ORDER BY t2.SortOrder, t2.Id) AS ProvinceName,
             (SELECT TOP 1 t2.WorkDetail FROM [dbo].[AccTravelBooking] t2
              WHERE t2.GroupKey = t.GroupKey ORDER BY t2.SortOrder, t2.Id) AS WorkDetail
      FROM [dbo].[AccTravelBooking] t
      INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
      WHERE r.FormCode = @form
        AND r.Status IN ('Draft', 'Returned')
        AND (r.CreatedBy = @uid OR r.SubmittedBy = @uid)
        AND t.GroupKey IS NOT NULL
      GROUP BY t.GroupKey
      ORDER BY MAX(r.UpdatedAt) DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => ({
    groupKey: row.GroupKey as string,
    tabCount: Number(row.TabCount) || 0,
    departDate: row.DepartDate ? toYmd(row.DepartDate as Date) : null,
    returnDate: row.ReturnDate ? toYmd(row.ReturnDate as Date) : null,
    provinceName: (row.ProvinceName as string) ?? null,
    workDetail: (row.WorkDetail as string) ?? null,
    updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
  }));
}

/* ─────────────────────────── writes (draft only — Task 5 adds validate/submit) ─────────────────────────── */

const NAME_TABLES = {
  reason: "AccTravelReason",
  accommodation: "AccTravelAccommodation",
  vehicle: "AccTravelVehicleOption",
  rentVehicle: "AccTravelRentVehicle",
} as const;

async function resolveSettingName(
  pool: AccPool,
  kind: keyof typeof NAME_TABLES,
  id: number | null,
): Promise<string | null> {
  if (!id) return null;
  const table = NAME_TABLES[kind];
  const r = await pool.request().input("id", sql.Int, id)
    .query(`SELECT TOP 1 Name FROM [dbo].[${table}] WHERE Id=@id`);
  return (r.recordset[0]?.Name as string) ?? null;
}

/** Fast_Data.dbo.TravelProvince is cross-database from the form DB — resolved via its own pool. */
async function resolveProvinceName(id: number | null): Promise<string | null> {
  if (!id) return null;
  const pool = await getDataPool();
  const r = await pool.request().input("id", sql.Int, id)
    .query(`SELECT TOP 1 NameTh FROM [dbo].[TravelProvince] WHERE Id=@id`);
  return (r.recordset[0]?.NameTh as string) ?? null;
}

interface ResolvedNames {
  reasonName: string | null;
  accommodationName: string | null;
  goVehicleName: string | null;
  returnVehicleName: string | null;
  rentVehicleName: string | null;
  provinceName: string | null;
  isContinuation: boolean;
}

/** Bind every AccTravelBooking column (except Id/RequestId/CreatedAt/UpdatedAt/PerDiem*) for insert/update. */
function bindBooking(
  req: ReturnType<AccTx["request"]>,
  tab: SaveTravelBookingInput,
  names: ResolvedNames,
  phone: string | null,
  allowance: number | null,
  groupKey: string,
  sortOrder: number,
) {
  return req
    .input("phone", sql.NVarChar, phone)
    .input("allowance", sql.Decimal(18, 2), allowance)
    .input("reasonId", sql.Int, tab.reasonId ?? null)
    .input("reasonName", sql.NVarChar, names.reasonName)
    .input("reasonCustom", sql.NVarChar(500), tab.reasonCustomText ?? null)
    .input("workDetail", sql.NVarChar(sql.MAX), tab.workDetail ?? null)
    .input("provinceId", sql.Int, tab.provinceId ?? null)
    .input("provinceName", sql.NVarChar, names.provinceName)
    .input("accommodationId", sql.Int, tab.accommodationId ?? null)
    .input("accommodationName", sql.NVarChar, names.accommodationName)
    .input("accommodationCustom", sql.NVarChar(500), tab.accommodationCustomText ?? null)
    .input("needsRoom", sql.Bit, tab.needsRoomBooking ? 1 : 0)
    .input("departDate", sql.Date, tab.departDate || null)
    .input("returnDate", sql.Date, tab.returnDate || null)
    .input("departTime", sql.NVarChar(20), tab.departTime ?? null)
    .input("returnTime", sql.NVarChar(20), tab.returnTime ?? null)
    .input("goVehicleId", sql.Int, tab.goVehicleId ?? null)
    .input("goVehicleName", sql.NVarChar, names.goVehicleName)
    .input("goVehicleCustom", sql.NVarChar(500), tab.goVehicleCustomText ?? null)
    .input("goNeedsDep", sql.Bit, tab.goNeedsDepartureLocations ? 1 : 0)
    .input("goNeedsTicket", sql.Bit, tab.goNeedsTicketBooking ? 1 : 0)
    .input("goNeedsTime", sql.Bit, tab.goNeedsDepartTime ? 1 : 0)
    .input("goNeedsRent", sql.Bit, tab.goNeedsVehicleRent ? 1 : 0)
    .input("returnVehicleId", sql.Int, tab.returnVehicleId ?? null)
    .input("returnVehicleName", sql.NVarChar, names.returnVehicleName)
    .input("returnVehicleCustom", sql.NVarChar(500), tab.returnVehicleCustomText ?? null)
    .input("returnNeedsDep", sql.Bit, tab.returnNeedsDepartureLocations ? 1 : 0)
    .input("returnNeedsTicket", sql.Bit, tab.returnNeedsTicketBooking ? 1 : 0)
    .input("returnNeedsTime", sql.Bit, tab.returnNeedsDepartTime ? 1 : 0)
    .input("returnNeedsRent", sql.Bit, tab.returnNeedsVehicleRent ? 1 : 0)
    .input("rentVehicleId", sql.Int, tab.rentVehicleId ?? null)
    .input("rentVehicleName", sql.NVarChar, names.rentVehicleName)
    .input("rentVehicleCustom", sql.NVarChar(500), tab.rentVehicleCustomText ?? null)
    .input("needsRent", sql.Bit, tab.needsRentBooking ? 1 : 0)
    .input("rentStart", sql.Date, tab.rentStartDate || null)
    .input("rentEnd", sql.Date, tab.rentEndDate || null)
    .input("notes", sql.NVarChar(sql.MAX), tab.notes ?? null)
    .input("isContinuation", sql.Bit, names.isContinuation ? 1 : 0)
    .input("groupKey", sql.NVarChar(40), groupKey)
    .input("sortOrder", sql.Int, sortOrder);
}

const BOOKING_COLUMNS = `Phone, AllowanceSnapshot, ReasonId, ReasonName, ReasonCustomText, WorkDetail,
  ProvinceId, ProvinceName, AccommodationId, AccommodationName, AccommodationCustomText, NeedsRoomBooking,
  DepartDate, ReturnDate, DepartTime, ReturnTime,
  GoVehicleId, GoVehicleName, GoVehicleCustomText, GoNeedsDepartureLocations, GoNeedsTicketBooking, GoNeedsDepartTime, GoNeedsVehicleRent,
  ReturnVehicleId, ReturnVehicleName, ReturnVehicleCustomText, ReturnNeedsDepartureLocations, ReturnNeedsTicketBooking, ReturnNeedsDepartTime, ReturnNeedsVehicleRent,
  RentVehicleId, RentVehicleName, RentVehicleCustomText, NeedsRentBooking, RentStartDate, RentEndDate,
  Notes, IsContinuation, PerDiemDays, PerDiemTotal, GroupKey, SortOrder`;
const BOOKING_VALUES = `@phone, @allowance, @reasonId, @reasonName, @reasonCustom, @workDetail,
  @provinceId, @provinceName, @accommodationId, @accommodationName, @accommodationCustom, @needsRoom,
  @departDate, @returnDate, @departTime, @returnTime,
  @goVehicleId, @goVehicleName, @goVehicleCustom, @goNeedsDep, @goNeedsTicket, @goNeedsTime, @goNeedsRent,
  @returnVehicleId, @returnVehicleName, @returnVehicleCustom, @returnNeedsDep, @returnNeedsTicket, @returnNeedsTime, @returnNeedsRent,
  @rentVehicleId, @rentVehicleName, @rentVehicleCustom, @needsRent, @rentStart, @rentEnd,
  @notes, @isContinuation, 0, 0, @groupKey, @sortOrder`;
// PerDiemDays/PerDiemTotal deliberately excluded from SET — they stay at their current value (0 until Task 5's submit).
const BOOKING_SET = `Phone=@phone, AllowanceSnapshot=@allowance, ReasonId=@reasonId, ReasonName=@reasonName, ReasonCustomText=@reasonCustom,
  WorkDetail=@workDetail, ProvinceId=@provinceId, ProvinceName=@provinceName,
  AccommodationId=@accommodationId, AccommodationName=@accommodationName, AccommodationCustomText=@accommodationCustom, NeedsRoomBooking=@needsRoom,
  DepartDate=@departDate, ReturnDate=@returnDate, DepartTime=@departTime, ReturnTime=@returnTime,
  GoVehicleId=@goVehicleId, GoVehicleName=@goVehicleName, GoVehicleCustomText=@goVehicleCustom,
  GoNeedsDepartureLocations=@goNeedsDep, GoNeedsTicketBooking=@goNeedsTicket, GoNeedsDepartTime=@goNeedsTime, GoNeedsVehicleRent=@goNeedsRent,
  ReturnVehicleId=@returnVehicleId, ReturnVehicleName=@returnVehicleName, ReturnVehicleCustomText=@returnVehicleCustom,
  ReturnNeedsDepartureLocations=@returnNeedsDep, ReturnNeedsTicketBooking=@returnNeedsTicket, ReturnNeedsDepartTime=@returnNeedsTime, ReturnNeedsVehicleRent=@returnNeedsRent,
  RentVehicleId=@rentVehicleId, RentVehicleName=@rentVehicleName, RentVehicleCustomText=@rentVehicleCustom, NeedsRentBooking=@needsRent,
  RentStartDate=@rentStart, RentEndDate=@rentEnd,
  Notes=@notes, IsContinuation=@isContinuation, GroupKey=@groupKey, SortOrder=@sortOrder, UpdatedAt=SYSDATETIME()`;

async function upsertTravelBooking(
  tx: AccTx,
  requestId: number,
  existingTravelBookingId: number | null,
  tab: SaveTravelBookingInput,
  names: ResolvedNames,
  emp: EmployeeContext,
  groupKey: string,
  sortOrder: number,
): Promise<number> {
  const phone = emp.phone ?? null;
  const allowance = emp.allowance ?? null;
  if (existingTravelBookingId) {
    const req = bindBooking(tx.request().input("tbid", sql.Int, existingTravelBookingId), tab, names, phone, allowance, groupKey, sortOrder);
    await req.query(`UPDATE [dbo].[AccTravelBooking] SET ${BOOKING_SET} WHERE Id=@tbid`);
    return existingTravelBookingId;
  }
  const req = bindBooking(tx.request().input("rid", sql.Int, requestId), tab, names, phone, allowance, groupKey, sortOrder);
  const ins = await req.query(`INSERT INTO [dbo].[AccTravelBooking] (RequestId, ${BOOKING_COLUMNS})
    OUTPUT inserted.Id AS Id VALUES (@rid, ${BOOKING_VALUES})`);
  return ins.recordset[0].Id as number;
}

/** Full replace — work locations have no downstream references, so delete + reinsert is simplest. */
async function persistWorkLocations(
  tx: AccTx,
  travelBookingId: number,
  items: { name: string; sortOrder: number }[],
): Promise<void> {
  await tx.request().input("tbid", sql.Int, travelBookingId)
    .query(`DELETE FROM [dbo].[AccTravelWorkLocation] WHERE TravelBookingId=@tbid`);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await tx.request()
      .input("tbid", sql.Int, travelBookingId)
      .input("name", sql.NVarChar(300), it.name)
      .input("sort", sql.Int, it.sortOrder ?? i)
      .query(`INSERT INTO [dbo].[AccTravelWorkLocation] (TravelBookingId, Name, SortOrder) VALUES (@tbid, @name, @sort)`);
  }
}

/** Full replace — departure locations have no downstream references. */
async function persistDepartureLocations(
  tx: AccTx,
  travelBookingId: number,
  items: { direction: TravelDirection; name: string; sortOrder: number }[],
): Promise<void> {
  await tx.request().input("tbid", sql.Int, travelBookingId)
    .query(`DELETE FROM [dbo].[AccTravelDepartureLocation] WHERE TravelBookingId=@tbid`);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await tx.request()
      .input("tbid", sql.Int, travelBookingId)
      .input("dir", sql.NVarChar(10), it.direction)
      .input("name", sql.NVarChar(300), it.name)
      .input("sort", sql.Int, it.sortOrder ?? i)
      .query(`INSERT INTO [dbo].[AccTravelDepartureLocation] (TravelBookingId, Direction, Name, SortOrder) VALUES (@tbid, @dir, @name, @sort)`);
  }
}

/**
 * Delete one tab's AccRequest + AccTravelBooking (cascades work/departure locations
 * and admin booking details via FK) + AccRequestFile/AccApproval/AccActivityLog rows.
 * Returns the StoragePath of every deleted AccRequestFile row for best-effort cleanup
 * by the caller (after the transaction commits).
 */
async function collectAndDeleteRequestArtifacts(tx: AccTx, requestId: number): Promise<string[]> {
  const filesRes = await tx.request().input("rid", sql.Int, requestId)
    .query(`SELECT StoragePath FROM [dbo].[AccRequestFile] WHERE RequestId=@rid`);
  const paths = (filesRes.recordset as { StoragePath: string }[]).map((r) => r.StoragePath);

  await tx.request().input("rid", sql.Int, requestId)
    .query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId=@rid`);
  await tx.request().input("rid", sql.Int, requestId)
    .query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@rid`);
  await tx.request().input("rid", sql.Int, requestId)
    .query(`DELETE FROM [dbo].[AccActivityLog] WHERE RequestId=@rid`);
  // AccTravelBooking cascade-deletes AccTravelWorkLocation, AccTravelDepartureLocation, AccTravelBookingDetail.
  await tx.request().input("rid", sql.Int, requestId)
    .query(`DELETE FROM [dbo].[AccTravelBooking] WHERE RequestId=@rid`);
  await tx.request().input("rid", sql.Int, requestId)
    .query(`DELETE FROM [dbo].[AccRequest] WHERE Id=@rid`);

  return paths;
}

/**
 * Create or update a GROUP of drafts (one tab = one AccRequest + AccTravelBooking,
 * all sharing GroupKey). Lenient — no strict validation (Task 5 handles submit).
 * Requester (staffId/name/position/department/phone/allowance) is re-snapshotted
 * from HR on every save. Tabs present in a previously-saved group but missing from
 * `input.tabs` are deleted (guarded by owner + Draft/Returned status).
 */
export async function saveTravelBookingDraft(
  input: SaveTravelBookingGroupInput,
  userId: number,
  loginEmail: string,
): Promise<{ groupKey: string; requestIds: number[] }> {
  if (!input.tabs || input.tabs.length === 0) {
    throw new Error("กรุณากรอกข้อมูลอย่างน้อย 1 คำขอ");
  }

  // Requester is the actor, or a same-department colleague when opening on behalf (server-authorized).
  const emp = await resolveEmployeeForActor(loginEmail, input.requesterStaffId ?? null);

  const pool = await getAccPool();

  // Resolve *Name fields + IsContinuation for every tab up front (small in-run cache
  // to dedupe repeated lookups when multiple tabs share the same reason/province/etc.).
  const settingNameCache = new Map<string, string | null>();
  async function cachedSettingName(kind: keyof typeof NAME_TABLES, id: number | null): Promise<string | null> {
    if (!id) return null;
    const key = `${kind}:${id}`;
    if (settingNameCache.has(key)) return settingNameCache.get(key)!;
    const name = await resolveSettingName(pool, kind, id);
    settingNameCache.set(key, name);
    return name;
  }
  const provinceNameCache = new Map<number, string | null>();
  async function cachedProvinceName(id: number | null): Promise<string | null> {
    if (!id) return null;
    if (provinceNameCache.has(id)) return provinceNameCache.get(id)!;
    const name = await resolveProvinceName(id);
    provinceNameCache.set(id, name);
    return name;
  }

  const resolvedTabs: { tab: SaveTravelBookingInput; names: ResolvedNames }[] = [];
  for (let i = 0; i < input.tabs.length; i++) {
    const tab = input.tabs[i];
    const [reasonName, accommodationName, goVehicleName, returnVehicleName, rentVehicleName, provinceName] =
      await Promise.all([
        cachedSettingName("reason", tab.reasonId),
        cachedSettingName("accommodation", tab.accommodationId),
        cachedSettingName("vehicle", tab.goVehicleId),
        cachedSettingName("vehicle", tab.returnVehicleId),
        cachedSettingName("rentVehicle", tab.rentVehicleId),
        cachedProvinceName(tab.provinceId),
      ]);
    const prev = i > 0 ? input.tabs[i - 1] : null;
    const isContinuation = !!(prev && tab.departDate && prev.returnDate && tab.departDate === prev.returnDate);
    resolvedTabs.push({
      tab,
      names: { reasonName, accommodationName, goVehicleName, returnVehicleName, rentVehicleName, provinceName, isContinuation },
    });
  }

  // Determine GroupKey: reuse when editing an existing draft group, else mint a new one.
  let groupKey = input.id ?? null;
  if (!groupKey) {
    const gkRes = await pool.request().query(`SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())) AS gk`);
    groupKey = gkRes.recordset[0].gk as string;
  }

  const tx = pool.transaction();
  await tx.begin();
  let removedFilePaths: string[] = [];
  const requestIds: number[] = [];
  try {
    // Existing tabs in this group (if editing) — guard ownership + status.
    const existingRes = await tx.request().input("gk", sql.NVarChar(40), groupKey)
      .query(`SELECT t.Id AS TravelBookingId, t.RequestId, r.CreatedBy, r.Status
              FROM [dbo].[AccTravelBooking] t
              INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
              WHERE t.GroupKey = @gk`);
    const existingRows = existingRes.recordset as
      { TravelBookingId: number; RequestId: number; CreatedBy: number | null; Status: string }[];

    if (input.id) {
      if (existingRows.length === 0) throw new Error("ไม่พบคำขอฉบับร่างนี้");
      for (const row of existingRows) {
        if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์แก้ไขคำขอนี้");
        if (row.Status !== "Draft" && row.Status !== "Returned") {
          throw new Error("คำขอนี้ไม่สามารถแก้ไขได้ในสถานะปัจจุบัน");
        }
      }
    }

    const existingByRequestId = new Map<number, number>(); // RequestId -> TravelBookingId
    for (const row of existingRows) existingByRequestId.set(row.RequestId, row.TravelBookingId);

    const keptRequestIds = new Set<number>();

    for (let i = 0; i < resolvedTabs.length; i++) {
      const { tab, names } = resolvedTabs[i];
      const requestId = tab.id && existingByRequestId.has(tab.id) ? tab.id : 0;
      let finalRequestId: number;

      if (requestId) {
        finalRequestId = requestId;
        await tx.request()
          .input("id", sql.Int, requestId)
          .input("empId", sql.UniqueIdentifier, emp.id)
          .input("staffId", sql.Int, emp.staffId)
          .input("fname", sql.NVarChar, emp.firstName ?? null)
          .input("lname", sql.NVarChar, emp.lastName ?? null)
          .input("full", sql.NVarChar, emp.fullName)
          .input("email", sql.NVarChar, emp.email ?? emp.emailCompBr ?? null)
          .input("pos", sql.NVarChar, emp.position ?? null)
          .input("deptId", sql.Int, emp.departmentId ?? null)
          .input("deptName", sql.NVarChar, emp.departmentName ?? null)
          .query(`UPDATE [dbo].[AccRequest] SET
                  EmployeeId=@empId, StaffId=@staffId, RequesterFirstName=@fname, RequesterLastName=@lname,
                  RequesterFullName=@full, RequesterEmail=@email, RequesterPosition=@pos,
                  RequesterDepartmentId=@deptId, RequesterDepartmentName=@deptName,
                  CurrentStepCode='MANAGER', UpdatedAt=SYSDATETIME()
                  WHERE Id=@id`);
      } else {
        const ins = await tx.request()
          .input("form", sql.NVarChar, AP17_FORM_CODE)
          .input("empId", sql.UniqueIdentifier, emp.id)
          .input("staffId", sql.Int, emp.staffId)
          .input("fname", sql.NVarChar, emp.firstName ?? null)
          .input("lname", sql.NVarChar, emp.lastName ?? null)
          .input("full", sql.NVarChar, emp.fullName)
          .input("email", sql.NVarChar, emp.email ?? emp.emailCompBr ?? null)
          .input("pos", sql.NVarChar, emp.position ?? null)
          .input("deptId", sql.Int, emp.departmentId ?? null)
          .input("deptName", sql.NVarChar, emp.departmentName ?? null)
          .input("user", sql.Int, userId || null)
          .query(`INSERT INTO [dbo].[AccRequest]
                  (FormCode, Status, CurrentStepCode, EmployeeId, StaffId, RequesterFirstName, RequesterLastName,
                   RequesterFullName, RequesterEmail, RequesterPosition, RequesterDepartmentId, RequesterDepartmentName, CreatedBy)
                  OUTPUT inserted.Id AS Id
                  VALUES (@form, 'Draft', 'MANAGER', @empId, @staffId, @fname, @lname, @full, @email, @pos, @deptId, @deptName, @user)`);
        finalRequestId = ins.recordset[0].Id as number;
      }

      const travelBookingId = await upsertTravelBooking(
        tx, finalRequestId, existingByRequestId.get(finalRequestId) ?? null,
        tab, names, emp, groupKey, i,
      );

      await persistWorkLocations(tx, travelBookingId, tab.workLocations ?? []);
      await persistDepartureLocations(tx, travelBookingId, tab.departureLocations ?? []);

      keptRequestIds.add(finalRequestId);
      requestIds.push(finalRequestId);
    }

    // Tabs that existed in the group but are no longer present in this save.
    for (const row of existingRows) {
      if (keptRequestIds.has(row.RequestId)) continue;
      const paths = await collectAndDeleteRequestArtifacts(tx, row.RequestId);
      removedFilePaths = removedFilePaths.concat(paths);
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  for (const p of removedFilePaths) {
    await deleteFile(p).catch(() => {});
  }

  return { groupKey, requestIds };
}

/**
 * Permanently delete an editable draft group (Draft or Returned tabs only) owned by
 * the user — all tabs' AccRequest/AccTravelBooking (+cascaded children)/files/approvals.
 */
export async function deleteTravelBookingDraft(groupKey: string, userId: number): Promise<void> {
  const pool = await getAccPool();
  const rowsRes = await pool.request().input("gk", sql.NVarChar(40), groupKey)
    .query(`SELECT t.RequestId, r.CreatedBy, r.Status
            FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
            WHERE t.GroupKey = @gk`);
  const rows = rowsRes.recordset as { RequestId: number; CreatedBy: number | null; Status: string }[];
  if (rows.length === 0) throw new Error("ไม่พบคำขอฉบับร่างนี้");
  for (const row of rows) {
    if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์ลบคำขอนี้");
    if (row.Status !== "Draft" && row.Status !== "Returned") {
      throw new Error("คำขอนี้ไม่สามารถลบได้ในสถานะปัจจุบัน");
    }
  }

  const tx = pool.transaction();
  await tx.begin();
  let allPaths: string[] = [];
  try {
    for (const row of rows) {
      const paths = await collectAndDeleteRequestArtifacts(tx, row.RequestId);
      allPaths = allPaths.concat(paths);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  for (const p of allPaths) {
    await deleteFile(p).catch(() => {});
  }
}

/* ─────────────────────────── validation + submit (Task 5) ─────────────────────────── */

/** Sentinel option name for AccTravelRentVehicle's default "no rental" choice (spec §2.4). */
const NO_RENT_VEHICLE_NAME = "ไม่เช่า";

/** The 4 settings tables, keyed by Id — loaded once and reused across every tab in a submit. */
export interface TravelBookingSettingsMaps {
  reasonById: Map<number, TravelReasonOption>;
  accommodationById: Map<number, Accommodation>;
  vehicleById: Map<number, VehicleOption>;
  rentVehicleById: Map<number, RentVehicle>;
}

export async function loadTravelBookingSettingsMaps(): Promise<TravelBookingSettingsMaps> {
  const [reasons, accommodations, vehicles, rentVehicles] = await Promise.all([
    listReasons(), listAccommodations(), listVehicles(), listRentVehicles(),
  ]);
  return {
    reasonById: new Map(reasons.map((r) => [r.id, r])),
    accommodationById: new Map(accommodations.map((a) => [a.id, a])),
    vehicleById: new Map(vehicles.map((v) => [v.id, v])),
    rentVehicleById: new Map(rentVehicles.map((v) => [v.id, v])),
  };
}

/**
 * Per-tab submit validation (spec §6). Checked in spec order, short-circuiting on the
 * first failing rule — matches the brief's `{ ok; error? }` shape (a single result, not
 * an accumulated list like AP-1's `validateForSubmit`). `managerStaffId` resolvability is
 * a per-employee (not per-tab) concern — checked once by the caller, `submitTravelBookingGroup`.
 */
export function validateTravelBookingTab(
  tab: TravelBookingRequest,
  settings: TravelBookingSettingsMaps,
): { ok: boolean; error?: string } {
  const fail = (error: string) => ({ ok: false, error });

  // ข้อ5 — เหตุผลการเดินทาง
  if (!tab.reasonId) return fail("กรุณาเลือกเหตุผลการเดินทาง");
  if (settings.reasonById.get(tab.reasonId)?.requiresCustomReason && !tab.reasonCustomText?.trim()) {
    return fail("กรุณาระบุเหตุผลการเดินทางเพิ่มเติม");
  }

  // ข้อ7 — รายละเอียดการไปปฏิบัติงาน
  if (!tab.workDetail?.trim()) return fail("กรุณากรอกรายละเอียดการไปปฏิบัติงาน");

  // ข้อ8 — จังหวัด
  if (!tab.provinceId) return fail("กรุณาเลือกจังหวัด");

  // ข้อ9 — สถานที่ไปปฏิบัติงาน (>=1)
  if (!(tab.workLocations ?? []).some((w) => w.name?.trim())) {
    return fail("กรุณาระบุสถานที่ไปปฏิบัติงานอย่างน้อย 1 แห่ง");
  }

  // ข้อ6 — วันเดินทาง (range)
  if (!tab.departDate || !tab.returnDate) return fail("กรุณาเลือกวันเดินทางไปและกลับ");
  if (tab.returnDate < tab.departDate) return fail("วันที่เดินทางกลับต้องไม่ก่อนวันที่เดินทางไป");

  // ข้อ11 — เวลา (required only when the matching direction flags it, 12.3)
  if (tab.goNeedsDepartTime && !tab.departTime) return fail("กรุณาระบุเวลาออกเดินทางขาไป");
  if (tab.returnNeedsDepartTime && !tab.returnTime) return fail("กรุณาระบุเวลาออกเดินทางขากลับ");

  // ข้อ10 — ที่พักค้างคืน
  if (!tab.accommodationId) return fail("กรุณาเลือกที่พักค้างคืน");
  if (settings.accommodationById.get(tab.accommodationId)?.requiresCustomReason && !tab.accommodationCustomText?.trim()) {
    return fail("กรุณาระบุที่พักค้างคืนเพิ่มเติม");
  }

  // ข้อ12 — ยานพาหนะ ขาไป / ขากลับ
  if (!tab.goVehicleId) return fail("กรุณาเลือกยานพาหนะขาไป");
  if (settings.vehicleById.get(tab.goVehicleId)?.requiresCustomReason && !tab.goVehicleCustomText?.trim()) {
    return fail("กรุณาระบุยานพาหนะขาไปเพิ่มเติม");
  }
  if (!tab.returnVehicleId) return fail("กรุณาเลือกยานพาหนะขากลับ");
  if (settings.vehicleById.get(tab.returnVehicleId)?.requiresCustomReason && !tab.returnVehicleCustomText?.trim()) {
    return fail("กรุณาระบุยานพาหนะขากลับเพิ่มเติม");
  }

  // ข้อ13 — จุดขึ้นรถ/ขึ้นเครื่อง ต่อทิศทาง เมื่อทิศทางนั้นต้องระบุ (12.1)
  if (
    tab.goNeedsDepartureLocations &&
    !(tab.departureLocations ?? []).some((d) => d.direction === "go" && d.name?.trim())
  ) {
    return fail("กรุณาระบุจุดขึ้นรถ/ขึ้นเครื่องขาไปอย่างน้อย 1 แห่ง");
  }
  if (
    tab.returnNeedsDepartureLocations &&
    !(tab.departureLocations ?? []).some((d) => d.direction === "return" && d.name?.trim())
  ) {
    return fail("กรุณาระบุจุดขึ้นรถ/ขึ้นเครื่องขากลับอย่างน้อย 1 แห่ง");
  }

  // ข้อ15/16 — เช่ายานพาหนะ เมื่อทิศทางใดทิศทางหนึ่งต้องการ (12.4)
  if (tab.goNeedsVehicleRent || tab.returnNeedsVehicleRent) {
    if (!tab.rentVehicleId) return fail("กรุณาเลือกยานพาหนะที่ต้องการเช่า");
    const rentOption = settings.rentVehicleById.get(tab.rentVehicleId);
    if (rentOption?.requiresCustomReason && !tab.rentVehicleCustomText?.trim()) {
      return fail("กรุณาระบุยานพาหนะที่ต้องการเช่าเพิ่มเติม");
    }
    if (rentOption?.name !== NO_RENT_VEHICLE_NAME) {
      if (!tab.rentStartDate || !tab.rentEndDate) return fail("กรุณาระบุวันที่เช่ายานพาหนะ");
      if (tab.rentEndDate < tab.rentStartDate) return fail("วันที่คืนรถเช่าต้องไม่ก่อนวันที่เริ่มเช่า");
      if (tab.departDate && tab.returnDate && (tab.rentStartDate < tab.departDate || tab.rentEndDate > tab.returnDate)) {
        return fail("วันที่เช่ายานพาหนะต้องอยู่ในช่วงวันเดินทาง");
      }
    }
  }

  // ข้อ17 — แนบบัตรประชาชน (>=1)
  if (!tab.idCardFiles || tab.idCardFiles.length === 0) {
    return fail("กรุณาแนบรูปบัตรประชาชนอย่างน้อย 1 ไฟล์");
  }

  return { ok: true };
}

/**
 * The requester's other travel-date ranges — excludes a given group and any rejected/cancelled
 * requests — used to block overlapping trips. Returns YYYY-MM-DD [depart, return] pairs.
 */
export async function listTravelBookingDateRanges(
  staffId: number,
  excludeGroupKey: string | null,
): Promise<{ departDate: string; returnDate: string }[]> {
  if (!staffId) return [];
  const pool = await getAccPool();
  const res = await pool.request()
    .input("staff", sql.Int, staffId)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .input("gk", sql.NVarChar(40), excludeGroupKey)
    .query(`SELECT t.DepartDate, t.ReturnDate
            FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
            WHERE r.FormCode = @form AND r.StaffId = @staff
              AND r.Status NOT IN ('Rejected', 'Cancelled')
              AND t.DepartDate IS NOT NULL AND t.ReturnDate IS NOT NULL
              AND (@gk IS NULL OR t.GroupKey <> @gk)`);
  return (res.recordset as { DepartDate: Date; ReturnDate: Date }[]).map((row) => ({
    departDate: toYmd(row.DepartDate),
    returnDate: toYmd(row.ReturnDate),
  }));
}

/** Two closed date ranges overlap by ≥2 days. Touching at a single boundary day is allowed. */
export function travelRangesConflict(a1: string, a2: string, b1: string, b2: string): boolean {
  return a1 < b2 && b1 < a2;
}

/**
 * Submit every tab (Draft/Returned) of a multi-request draft group as N independent
 * documents: validate every tab, detect continuation (SortOrder order), compute per-diem,
 * allocate one running number per tab, transition each Draft/Returned → Submitted, create
 * the MANAGER approval step, log, and queue one "Submitted" email per request to the
 * shared manager. Returns the N submitted requests (re-read after commit).
 */
export async function submitTravelBookingGroup(
  groupKey: string,
  userId: number,
  loginEmail: string,
): Promise<TravelBookingRequest[]> {
  const pool = await getAccPool();

  // Ownership + status guard (mirrors saveTravelBookingDraft/deleteTravelBookingDraft in this file).
  const ownershipRes = await pool.request().input("gk", sql.NVarChar(40), groupKey)
    .query(`SELECT t.RequestId, r.CreatedBy, r.Status
            FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
            WHERE t.GroupKey = @gk
            ORDER BY t.SortOrder, t.Id`);
  const ownershipRows = ownershipRes.recordset as { RequestId: number; CreatedBy: number | null; Status: string }[];
  if (ownershipRows.length === 0) throw new Error("ไม่พบคำขอฉบับร่างนี้");
  for (const row of ownershipRows) {
    if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์ส่งคำขอนี้");
    if (row.Status !== "Draft" && row.Status !== "Returned") {
      throw new Error("คำขอนี้ถูกส่งไปแล้ว");
    }
  }

  // Honor the requester saved on the draft (on-behalf-of) and re-authorize same-department.
  const savedStaffRes = await pool.request().input("gk", sql.NVarChar(40), groupKey)
    .query(`SELECT TOP 1 r.StaffId FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
            WHERE t.GroupKey = @gk`);
  const savedStaffId = (savedStaffRes.recordset[0]?.StaffId as number | null) ?? null;
  const emp = await resolveEmployeeForActor(loginEmail, savedStaffId);
  if (!emp.managerStaffId) throw new Error("ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR");
  const managerEmail = await resolveManagerEmail(emp.managerStaffId);
  if (!managerEmail) throw new Error("ไม่พบอีเมลผู้จัดการในระบบ HR — ไม่สามารถส่งอนุมัติได้");

  const group = await getTravelBookingGroup(groupKey);
  const tabs = group.requests; // already ordered by SortOrder, Id (getTravelBookingGroup's own query)
  if (tabs.length === 0) throw new Error("ไม่พบคำขอฉบับร่างนี้");

  const settings = await loadTravelBookingSettingsMaps();
  for (let i = 0; i < tabs.length; i++) {
    const result = validateTravelBookingTab(tabs[i], settings);
    if (!result.ok) {
      throw new Error(tabs.length > 1 ? `(คำขอที่ ${i + 1}) ${result.error}` : (result.error ?? "ข้อมูลไม่ครบถ้วน"));
    }
  }

  // No overlapping travel dates for this requester (rejected/cancelled excluded; two trips may
  // still share a single boundary day — continuation).
  const existingRanges = await listTravelBookingDateRanges(emp.staffId, groupKey);
  for (let i = 0; i < tabs.length; i++) {
    const d1 = tabs[i].departDate;
    const r1 = tabs[i].returnDate;
    if (!d1 || !r1) continue;
    for (let j = i + 1; j < tabs.length; j++) {
      const d2 = tabs[j].departDate;
      const r2 = tabs[j].returnDate;
      if (d2 && r2 && travelRangesConflict(d1, r1, d2, r2)) {
        throw new Error(`ช่วงวันเดินทางของทริปที่ ${i + 1} ซ้อนทับกับทริปที่ ${j + 1} — เลือกช่วงวันที่ไม่ให้ซ้อนกัน`);
      }
    }
    for (const ex of existingRanges) {
      if (travelRangesConflict(d1, r1, ex.departDate, ex.returnDate)) {
        throw new Error(`ช่วงวันเดินทางของทริปที่ ${i + 1} (${d1} – ${r1}) ซ้อนทับกับคำขออื่นของผู้ขอเบิกที่มีอยู่แล้ว`);
      }
    }
  }

  // Continuation detection + per-diem, over the SortOrder-ordered tabs.
  const log = await getAllowanceLog(emp.id);
  const continuationFlags: boolean[] = [];
  const perDiems: { days: number; total: number }[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const prev = i > 0 ? tabs[i - 1] : null;
    const isContinuation = !!(prev && tabs[i].departDate === prev.returnDate);
    continuationFlags.push(isContinuation);
    perDiems.push(computePerDiem(tabs[i].departDate as string, tabs[i].returnDate as string, isContinuation, log));
  }

  // Allocate one running number per tab up front (mirrors AP-1's submitRequest — allocation
  // happens outside the transaction; a rolled-back transaction burns the allocated number(s),
  // the same tradeoff AP-1 already makes rather than reusing skipped numbers).
  const requestNos: string[] = [];
  for (let i = 0; i < tabs.length; i++) {
    requestNos.push(await allocateRequestNo(RUNNING_PREFIX));
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const requestId = tab.id;
      if (requestId == null) throw new Error("ไม่พบคำขอ");
      const requestNo = requestNos[i];

      const upd = await tx.request()
        .input("id", sql.Int, requestId)
        .input("no", sql.NVarChar, requestNo)
        .input("mgrStaff", sql.Int, emp.managerStaffId)
        .input("mgrEmail", sql.NVarChar, managerEmail)
        .input("by", sql.Int, userId || null)
        // Surface the per-diem (เบี้ยเลี้ยง) total as the request's amount so it shows in list rows.
        .input("total", sql.Decimal(18, 2), perDiems[i].total)
        .query(`UPDATE [dbo].[AccRequest] SET
                RequestNo=@no, Status='Submitted', CurrentStepCode='MANAGER',
                ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, TotalAmount=@total,
                SubmittedBy=@by, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
                WHERE Id=@id AND Status IN ('Draft','Returned');
                SELECT @@ROWCOUNT AS n`);
      if ((upd.recordset[0].n as number) === 0) {
        throw new Error("คำขอนี้ถูกส่งไปแล้ว");
      }

      await tx.request()
        .input("id", sql.Int, requestId)
        .input("cont", sql.Bit, continuationFlags[i] ? 1 : 0)
        .input("days", sql.Int, perDiems[i].days)
        .input("total", sql.Decimal(18, 2), perDiems[i].total)
        .query(`UPDATE [dbo].[AccTravelBooking] SET
                IsContinuation=@cont, PerDiemDays=@days, PerDiemTotal=@total, UpdatedAt=SYSDATETIME()
                WHERE RequestId=@id`);

      // Reset any prior approval (e.g. resubmit after Return) before creating the MANAGER step.
      await tx.request().input("id", sql.Int, requestId)
        .query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@id`);
      await tx.request()
        .input("id", sql.Int, requestId)
        .input("mgrStaff", sql.Int, emp.managerStaffId)
        .input("mgrEmail", sql.NVarChar, managerEmail)
        .query(`INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedTo, AssignedEmail, Status)
                VALUES (@id, 'MANAGER', 1, @mgrStaff, @mgrEmail, 'Pending')`);

      await tx.request().input("id", sql.Int, requestId).input("by", sql.Int, userId || null)
        .input("no", sql.NVarChar, requestNo)
        .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
                VALUES (@id, @by, 'submitted', @no)`);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const submitted: TravelBookingRequest[] = [];
  for (const tab of tabs) {
    if (tab.id == null) continue;
    const updated = await getTravelBookingRequest(tab.id);
    if (updated) submitted.push(updated);
  }

  for (const req of submitted) {
    if (req.id == null) continue;
    const mail = buildTravelBookingEmail("Submitted", req);
    await queueEmail({
      requestId: req.id, toEmail: managerEmail,
      subject: mail.subject, bodyHtml: mail.html, triggerType: "Submitted",
    });
  }

  return submitted;
}
