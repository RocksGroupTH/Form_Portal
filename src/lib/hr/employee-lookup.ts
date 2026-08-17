import { sql } from "@/lib/db/mssql";
import { resolveFormAccess, resolveFormEnvironment } from "@/lib/form-environment";
import { EMPLOYEE_STATUS_ACTIVE } from "@/lib/hr/constants";
import { pickEmployeePhotoUrl } from "@/lib/hr/photo-url";
import { getHrPool } from "@/lib/hr/pool";
import { assertRequesterAllowedInUat } from "@/lib/uat-tester/guards";
import { uatManagerFor, uatManagerStaffIdsFor } from "@/lib/uat-tester/service";
import type {
  EmployeeContext,
  EmployeeLookupResult,
  EmployeeMatchMethod,
  HrBrandInfo,
  RequesterSnapshot,
} from "@/lib/hr/types";

interface EmployeeRow {
  Id: string;
  StaffId: number;
  BrandId: number;
  EmployeeType: string;
  FullName: string;
  FullNameTh: string | null;
  Nickname: string | null;
  FirstName: string | null;
  LastName: string | null;
  Email: string | null;
  EmailCompBr: string | null;
  Phone: string | null;
  Allowance: number | null;
  Position: string | null;
  DepartmentId: number | null;
  DepartmentName: string | null;
  DepartmentCode: string | null;
  SubDepartmentId: number | null;
  LocationId: number | null;
  ManagerStaffId: number | null;
  TeamMemberId: number | null;
  AdUserId: string | null;
  Status: string;
  HrBrandId: number | null;
  HrBrandCode: string | null;
  HrBrandName: string | null;
  HrBrandColor: string | null;
  CompanyName: string | null;
  CompanyAddress: string | null;
  CompanyTaxId: string | null;
  CompanyPhone: string | null;
  LogoPath: string | null;
  PhotoUrl: string | null;
  PhotoOverrideUrl: string | null;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function detectMatchMethod(row: EmployeeRow, email: string): EmployeeMatchMethod {
  const norm = normalizeEmail(email);
  if (norm && normalizeEmail(row.Email) === norm) return "email";
  return "emailCompBr";
}

function rowToBrand(row: EmployeeRow): HrBrandInfo {
  return {
    id: row.HrBrandId ?? row.BrandId,
    code: row.HrBrandCode ?? "",
    name: row.HrBrandName ?? "",
    color: row.HrBrandColor,
    companyName: row.CompanyName,
    companyAddress: row.CompanyAddress,
    companyTaxId: row.CompanyTaxId,
    companyPhone: row.CompanyPhone,
    logoPath: row.LogoPath,
  };
}

function rowToEmployee(row: EmployeeRow): EmployeeContext {
  return {
    id: row.Id,
    staffId: row.StaffId,
    brandId: row.BrandId,
    employeeType: row.EmployeeType,
    fullName: row.FullName,
    fullNameTh: row.FullNameTh,
    nickname: row.Nickname,
    firstName: row.FirstName,
    lastName: row.LastName,
    email: row.Email,
    emailCompBr: row.EmailCompBr,
    phone: row.Phone,
    allowance: row.Allowance !== null && row.Allowance !== undefined ? Number(row.Allowance) : null,
    position: row.Position,
    departmentId: row.DepartmentId,
    departmentName: row.DepartmentName,
    departmentCode: row.DepartmentCode,
    subDepartmentId: row.SubDepartmentId,
    locationId: row.LocationId,
    managerStaffId: row.ManagerStaffId,
    teamMemberId: row.TeamMemberId,
    adUserId: row.AdUserId,
    status: row.Status,
    photoUrl: pickEmployeePhotoUrl(row.PhotoOverrideUrl, row.PhotoUrl),
    brand: rowToBrand(row),
  };
}

/**
 * Find an active Employee in Rocks_Portal_HR by login email (Email or EmailCompBr).
 * No brand filter — if multiple rows match, returns the most recently updated.
 */
export async function findActiveEmployeeByEmail(
  email: string,
): Promise<EmployeeLookupResult> {
  const trimmed = (email ?? "").trim();
  if (!trimmed) {
    return { employee: null, matchMethod: null };
  }

  const pool = await getHrPool();
  const result = await pool
    .request()
    .input("status", sql.NVarChar, EMPLOYEE_STATUS_ACTIVE)
    .input("email", sql.NVarChar, trimmed)
    .query<EmployeeRow>(`
      SELECT TOP 1
        e.Id,
        e.StaffId,
        e.BrandId,
        e.EmployeeType,
        e.FullName,
        e.FullNameTh,
        e.Nickname,
        e.FirstName,
        e.LastName,
        e.Email,
        e.EmailCompBr,
        e.Phone,
        e.Allowance,
        e.Position,
        e.DepartmentId,
        d.Name AS DepartmentName,
        e.DepartmentCode,
        e.SubDepartmentId,
        e.LocationId,
        e.ManagerStaffId,
        e.TeamMemberId,
        e.AdUserId,
        e.Status,
        hb.Id AS HrBrandId,
        hb.Code AS HrBrandCode,
        hb.Name AS HrBrandName,
        hb.Color AS HrBrandColor,
        hb.CompanyName,
        hb.CompanyAddress,
        hb.CompanyTaxId,
        hb.CompanyPhone,
        hb.LogoPath,
        e.PhotoUrl,
        e.PhotoOverrideUrl
      FROM dbo.Employee e
      LEFT JOIN dbo.HrBrand hb ON hb.Id = e.BrandId
      LEFT JOIN dbo.Department d
        ON d.Id = CAST(e.DepartmentId AS nvarchar(50))
       AND (d.IsActive = 1 OR d.IsActive IS NULL)
      WHERE e.Status = @status
        AND (
          LOWER(LTRIM(RTRIM(ISNULL(e.Email, '')))) = LOWER(@email)
          OR LOWER(LTRIM(RTRIM(ISNULL(e.EmailCompBr, '')))) = LOWER(@email)
        )
      ORDER BY e.UpdatedAt DESC
    `);

  const row = result.recordset[0];
  if (!row) {
    return { employee: null, matchMethod: null };
  }

  return {
    employee: rowToEmployee(row),
    matchMethod: detectMatchMethod(row, trimmed),
  };
}

/** @deprecated Use findActiveEmployeeByEmail — kept for callers passing legacy params */
export async function findActiveEmployeeForRequest(params: {
  email?: string | null;
}): Promise<EmployeeLookupResult> {
  return findActiveEmployeeByEmail(params.email ?? "");
}

/** Build audit snapshot from employee context (for request submit). */
export function toRequesterSnapshot(employee: EmployeeContext): RequesterSnapshot {
  return {
    employeeId: employee.id,
    staffId: employee.staffId,
    hrBrandId: employee.brand.id,
    hrBrandCode: employee.brand.code,
    requesterFullName: employee.fullName,
    requesterFullNameTh: employee.fullNameTh,
    requesterEmail: employee.email ?? employee.emailCompBr,
    requesterPhone: employee.phone,
    requesterPosition: employee.position,
    requesterDepartmentId: employee.departmentId,
    requesterDepartmentName: employee.departmentName,
    requesterDepartmentCode: employee.departmentCode,
    managerStaffId: employee.managerStaffId,
    companyName: employee.brand.companyName,
    companyTaxId: employee.brand.companyTaxId,
  };
}

export interface ColleagueManager {
  staffId: number;
  fullName: string | null;
  email: string | null;
  position: string | null;
  photoUrl: string | null;
}

export interface DepartmentColleague {
  staffId: number;
  fullName: string | null;
  nickname: string | null;
  position: string | null;
  departmentId: number | null;
  departmentName: string | null;
  email: string | null;
  photoUrl: string | null;
  /** The colleague's own manager (approver when opening a request on their behalf). */
  manager: ColleagueManager | null;
}

interface ColleagueRow {
  StaffId: number;
  FullName: string | null;
  FirstName: string | null;
  LastName: string | null;
  Nickname: string | null;
  Position: string | null;
  DepartmentId: number | null;
  DepartmentName: string | null;
  Email: string | null;
  EmailCompBr: string | null;
  PhotoUrl: string | null;
  PhotoOverrideUrl: string | null;
  MgrStaffId: number | null;
  MgrFullName: string | null;
  MgrFirstName: string | null;
  MgrLastName: string | null;
  MgrEmail: string | null;
  MgrEmailCompBr: string | null;
  MgrPosition: string | null;
  MgrPhotoUrl: string | null;
  MgrPhotoOverrideUrl: string | null;
}

/** Active HR identities behind a set of manager StaffIds, keyed by StaffId. */
async function listActiveManagersByStaffIds(
  staffIds: number[],
): Promise<Map<number, ColleagueManager>> {
  const out = new Map<number, ColleagueManager>();
  if (staffIds.length === 0) return out;

  const pool = await getHrPool();
  const req = pool.request().input("status", sql.NVarChar, EMPLOYEE_STATUS_ACTIVE);
  const placeholders: string[] = [];
  staffIds.forEach((id, i) => {
    req.input(`m${i}`, sql.Int, id);
    placeholders.push(`@m${i}`);
  });

  const r = await req.query<{
    StaffId: number;
    FullName: string | null;
    FirstName: string | null;
    LastName: string | null;
    Email: string | null;
    EmailCompBr: string | null;
    Position: string | null;
    PhotoUrl: string | null;
    PhotoOverrideUrl: string | null;
  }>(`
    SELECT StaffId, FullName, FirstName, LastName, Email, EmailCompBr, Position,
           PhotoUrl, PhotoOverrideUrl
    FROM dbo.Employee
    WHERE Status = @status AND StaffId IN (${placeholders.join(", ")})
  `);

  for (const row of r.recordset) {
    out.set(row.StaffId, {
      staffId: row.StaffId,
      fullName:
        [row.FirstName, row.LastName].filter(Boolean).join(" ") || row.FullName || null,
      email: row.Email ?? row.EmailCompBr ?? null,
      position: row.Position,
      photoUrl: pickEmployeePhotoUrl(row.PhotoOverrideUrl, row.PhotoUrl),
    });
  }
  return out;
}

/**
 * Every colleague's manager replaced by their UAT manager — the person a UAT
 * submit on their behalf will actually assign.
 *
 * Two queries for the whole department, never one chain per colleague: one against
 * `UatTester` for the requester → manager pairs, one against HR for the manager
 * rows. A colleague with no usable UAT manager comes back with `manager: null`,
 * which is honest — filing for them in UAT is refused for the same reason.
 */
async function withUatColleagueManagers(
  colleagues: DepartmentColleague[],
): Promise<DepartmentColleague[]> {
  const byRequester = await uatManagerStaffIdsFor(colleagues.map((c) => c.staffId));
  if (byRequester.size === 0) return colleagues.map((c) => ({ ...c, manager: null }));

  const managers = await listActiveManagersByStaffIds(
    Array.from(new Set(Array.from(byRequester.values()))),
  );
  return colleagues.map((c) => {
    const managerStaffId = byRequester.get(c.staffId);
    return {
      ...c,
      manager: managerStaffId === undefined ? null : (managers.get(managerStaffId) ?? null),
    };
  });
}

/** Which form's picker this is, for callers whose route is not the form's own. */
export interface ColleagueScope {
  /**
   * The form the picker belongs to. Both requesters routes are classified as
   * aggregates, so without this the path resolves Production for everybody and a
   * tester is shown colleagues' real HR managers.
   */
  formCode?: string | null;
  /** The record being resumed, when there is one — same id rule as the submit. */
  requestId?: number | null;
}

/**
 * Active employees in the given department (for the on-behalf requester picker), each with
 * their own manager resolved via a self-join so selecting a colleague can show who will
 * approve their request without another round-trip.
 *
 * In UAT that self-join is the wrong answer: the submit routes to the colleague's
 * **UAT** manager, so the picker must too, or it asserts a real manager's name over
 * a request that will never reach them.
 */
export async function listDepartmentColleagues(
  departmentId: number,
  scope?: ColleagueScope,
): Promise<DepartmentColleague[]> {
  if (!departmentId) return [];
  const pool = await getHrPool();
  const result = await pool
    .request()
    .input("status", sql.NVarChar, EMPLOYEE_STATUS_ACTIVE)
    .input("dept", sql.Int, departmentId)
    .query<ColleagueRow>(`
      SELECT
        e.StaffId, e.FullName, e.FirstName, e.LastName, e.Nickname, e.Position,
        e.DepartmentId, d.Name AS DepartmentName,
        e.Email, e.EmailCompBr, e.PhotoUrl, e.PhotoOverrideUrl,
        mgr.StaffId AS MgrStaffId, mgr.FullName AS MgrFullName,
        mgr.FirstName AS MgrFirstName, mgr.LastName AS MgrLastName,
        mgr.Email AS MgrEmail, mgr.EmailCompBr AS MgrEmailCompBr, mgr.Position AS MgrPosition,
        mgr.PhotoUrl AS MgrPhotoUrl, mgr.PhotoOverrideUrl AS MgrPhotoOverrideUrl
      FROM dbo.Employee e
      LEFT JOIN dbo.Department d
        ON d.Id = CAST(e.DepartmentId AS nvarchar(50))
       AND (d.IsActive = 1 OR d.IsActive IS NULL)
      LEFT JOIN dbo.Employee mgr
        ON mgr.StaffId = e.ManagerStaffId AND mgr.Status = @status
      WHERE e.Status = @status AND e.DepartmentId = @dept
      ORDER BY e.FullName
    `);
  const colleagues: DepartmentColleague[] = result.recordset.map((row) => ({
    staffId: row.StaffId,
    fullName:
      [row.FirstName, row.LastName].filter(Boolean).join(" ") || row.FullName || null,
    nickname: row.Nickname,
    position: row.Position,
    departmentId: row.DepartmentId,
    departmentName: row.DepartmentName,
    email: row.Email ?? row.EmailCompBr ?? null,
    photoUrl: pickEmployeePhotoUrl(row.PhotoOverrideUrl, row.PhotoUrl),
    manager: row.MgrStaffId
      ? {
          staffId: row.MgrStaffId,
          fullName:
            [row.MgrFirstName, row.MgrLastName].filter(Boolean).join(" ") || row.MgrFullName || null,
          email: row.MgrEmail ?? row.MgrEmailCompBr ?? null,
          position: row.MgrPosition,
          photoUrl: pickEmployeePhotoUrl(row.MgrPhotoOverrideUrl, row.MgrPhotoUrl),
        }
      : null,
  }));

  const environment = scope?.formCode
    ? (await resolveFormAccess(scope.formCode, scope.requestId ?? null)).environment
    : await resolveFormEnvironment();
  return environment === "UAT" ? withUatColleagueManagers(colleagues) : colleagues;
}

/** Find an active Employee by HR StaffId (used to resolve an on-behalf-of colleague). */
export async function findActiveEmployeeByStaffId(
  staffId: number,
): Promise<EmployeeContext | null> {
  if (!staffId) return null;
  const pool = await getHrPool();
  const result = await pool
    .request()
    .input("status", sql.NVarChar, EMPLOYEE_STATUS_ACTIVE)
    .input("sid", sql.Int, staffId)
    .query<EmployeeRow>(`
      SELECT TOP 1
        e.Id, e.StaffId, e.BrandId, e.EmployeeType, e.FullName, e.FullNameTh, e.Nickname,
        e.FirstName, e.LastName, e.Email, e.EmailCompBr, e.Phone, e.Allowance, e.Position,
        e.DepartmentId, d.Name AS DepartmentName, e.DepartmentCode, e.SubDepartmentId,
        e.LocationId, e.ManagerStaffId, e.TeamMemberId, e.AdUserId, e.Status,
        hb.Id AS HrBrandId, hb.Code AS HrBrandCode, hb.Name AS HrBrandName, hb.Color AS HrBrandColor,
        hb.CompanyName, hb.CompanyAddress, hb.CompanyTaxId, hb.CompanyPhone, hb.LogoPath,
        e.PhotoUrl, e.PhotoOverrideUrl
      FROM dbo.Employee e
      LEFT JOIN dbo.HrBrand hb ON hb.Id = e.BrandId
      LEFT JOIN dbo.Department d
        ON d.Id = CAST(e.DepartmentId AS nvarchar(50))
       AND (d.IsActive = 1 OR d.IsActive IS NULL)
      WHERE e.Status = @status AND e.StaffId = @sid
      ORDER BY e.UpdatedAt DESC
    `);
  const row = result.recordset[0];
  return row ? rowToEmployee(row) : null;
}

/**
 * The context's manager, swapped for the requester's UAT manager when this
 * request resolves UAT.
 *
 * AP-17 does not share AP-1's resolver, so the override is duplicated rather
 * than shared — see `withUatManager` in `src/lib/acc/employee-context.ts` for
 * the same rule on the AP-1 side, and for why `resolveManagerEmail` must stay
 * untouched. Keyed on the requester this context describes and on the resolved
 * environment, never on the UAT-mode cookie.
 *
 * When there is no UAT manager the context comes back with `managerStaffId`
 * null, and `submitTravelBookingGroup` refuses. AP-17's approve/reject/return
 * routes gate on `staffId === AccRequest.ManagerStaffId` alone, so whatever
 * lands here has to be a real active HR StaffId — `uatManagerFor` guarantees
 * that or returns null.
 */
async function withUatManager(employee: EmployeeContext): Promise<EmployeeContext> {
  if ((await resolveFormEnvironment()) !== "UAT") return employee;
  const manager = await uatManagerFor(
    employee.email ?? employee.emailCompBr ?? null,
    employee.staffId ?? null,
  );
  return { ...employee, managerStaffId: manager ? manager.staffId : null };
}

/**
 * Resolve the full EmployeeContext for a save/submit. Without requesterStaffId -> the actor.
 * With requesterStaffId -> the colleague, but ONLY if Active and in the actor's department
 * (server-side authorization -- never trust the client). Returns the full context so callers
 * that need phone/allowance/brand (e.g. AP-17 snapshots) work unchanged.
 *
 * In UAT the manager is the requester's UAT manager (see `withUatManager`).
 *
 * `forWrite` opts into the UAT on-behalf refusal, and the AP-17 write choke
 * points pass it — the two that file a request, plus the id-card consent POST,
 * which persists a per-StaffId setting into the resolved form database. The rule
 * is a write rule — nothing may be *written* in UAT for somebody outside the
 * tester list — and this resolver is also the one behind four read-only GETs
 * (allowance-log, date-ranges, id-card/previous and its download).
 * Throwing there turned an expected selection into a 500 that every
 * caller swallows: the per-diem estimate silently fell back to the flat rate,
 * date-conflict locking silently switched off, and the allowance modal rendered
 * "ยังไม่มีรายการ" — an affirmative false statement about HR data. The flag lives
 * here rather than at the call sites because this is the only place the actor and
 * the requester both exist, and the guard must not fire when they are the same
 * person.
 */
export async function resolveEmployeeForActor(
  loginEmail: string,
  requesterStaffId: number | null | undefined,
  opts?: { forWrite?: boolean },
): Promise<EmployeeContext> {
  const actor = (await findActiveEmployeeByEmail(loginEmail)).employee;
  if (!actor) throw new Error("ไม่พบข้อมูลพนักงานของคุณในระบบ HR");
  if (!requesterStaffId || requesterStaffId === actor.staffId) return withUatManager(actor);
  const colleague = await findActiveEmployeeByStaffId(requesterStaffId);
  if (!colleague) throw new Error("ไม่พบข้อมูลพนักงานที่เลือก");
  if (actor.departmentId == null || colleague.departmentId !== actor.departmentId) {
    throw new Error("เลือกได้เฉพาะพนักงานในแผนกเดียวกันเท่านั้น");
  }
  if (opts?.forWrite) {
    await assertRequesterAllowedInUat(
      colleague.email ?? colleague.emailCompBr ?? null,
      colleague.staffId ?? null,
    );
  }
  return withUatManager(colleague);
}
