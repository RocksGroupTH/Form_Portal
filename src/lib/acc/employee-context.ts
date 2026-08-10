import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { pickEmployeePhotoUrl } from "@/lib/hr/photo-url";
import { getHrPool } from "@/lib/hr/pool";
import { sql } from "@/lib/db/mssql";

export interface RequesterSnapshot {
  employeeId: string | null;
  staffId: number | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  position: string | null;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  managerStaffId: number | null;
  companyName: string | null;
}

export async function resolveRequester(
  loginEmail: string,
): Promise<RequesterSnapshot | null> {
  const emp = await findActiveEmployeeByEmail(loginEmail);
  if (!emp?.employee) return null;
  const e = emp.employee;
  // fullName is non-nullable on EmployeeContext; prefer firstName+lastName concat when both present
  const fullName =
    [e.firstName, e.lastName].filter(Boolean).join(" ") || e.fullName || null;
  return {
    employeeId: e.id ?? null,
    staffId: e.staffId ?? null,
    firstName: e.firstName ?? null,
    lastName: e.lastName ?? null,
    fullName,
    // email may be null; fall back to emailCompBr (brand email)
    email: e.email ?? e.emailCompBr ?? null,
    position: e.position ?? null,
    departmentId: e.departmentId ?? null,
    departmentName: e.departmentName ?? null,
    departmentCode: e.departmentCode ?? null,
    managerStaffId: e.managerStaffId ?? null,
    // companyName lives on the nested brand object, not directly on EmployeeContext
    companyName: e.brand?.companyName ?? null,
  };
}

export interface ManagerInfo {
  staffId: number;
  fullName: string | null;
  email: string | null;
  position: string | null;
  photoUrl: string | null;
}

export interface ManagerResolution {
  hasManager: boolean;
  manager: ManagerInfo | null;
  /** Why there is no manager — shown to the user so they can notify HR. */
  reason: string | null;
}

interface ManagerRow {
  StaffId: number;
  FullName: string | null;
  FirstName: string | null;
  LastName: string | null;
  Email: string | null;
  EmailCompBr: string | null;
  Position: string | null;
  PhotoUrl: string | null;
  PhotoOverrideUrl: string | null;
}

/** Resolve the manager of the employee matched by login email (for the form). */
export async function resolveManagerInfo(loginEmail: string): Promise<ManagerResolution> {
  const emp = await findActiveEmployeeByEmail(loginEmail);
  if (!emp?.employee) {
    return { hasManager: false, manager: null, reason: "ไม่พบข้อมูลพนักงานของคุณในระบบ HR" };
  }
  const managerStaffId = emp.employee.managerStaffId ?? null;
  if (!managerStaffId) {
    return {
      hasManager: false,
      manager: null,
      reason: "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR",
    };
  }

  const pool = await getHrPool();
  const r = await pool.request().input("sid", sql.Int, managerStaffId).query<ManagerRow>(`
    SELECT TOP 1 StaffId, FullName, FirstName, LastName, Email, EmailCompBr, Position, PhotoUrl, PhotoOverrideUrl
    FROM dbo.Employee WHERE StaffId = @sid AND Status = 'Active'
  `);
  const row = r.recordset[0];
  if (!row) {
    return {
      hasManager: false,
      manager: null,
      reason: `ไม่พบข้อมูลผู้จัดการ (StaffId ${managerStaffId}) ในระบบ HR`,
    };
  }

  const fullName =
    [row.FirstName, row.LastName].filter(Boolean).join(" ") || row.FullName || null;
  return {
    hasManager: true,
    reason: null,
    manager: {
      staffId: row.StaffId,
      fullName,
      email: row.Email ?? row.EmailCompBr ?? null,
      position: row.Position ?? null,
      photoUrl: pickEmployeePhotoUrl(row.PhotoOverrideUrl, row.PhotoUrl),
    },
  };
}

/** Email of the manager identified by StaffId (for approval assignment + notification). */
export async function resolveManagerEmail(
  managerStaffId: number | null,
): Promise<string | null> {
  if (!managerStaffId) return null;
  const pool = await getHrPool();
  const r = await pool
    .request()
    .input("sid", sql.Int, managerStaffId)
    .query(`
      SELECT TOP 1 COALESCE(Email, EmailCompBr) AS Email
      FROM dbo.Employee WHERE StaffId = @sid AND Status = 'Active'
    `);
  return (r.recordset[0]?.Email as string) ?? null;
}

interface EmployeeByStaffRow {
  Id: string;
  StaffId: number;
  FirstName: string | null;
  LastName: string | null;
  FullName: string | null;
  Email: string | null;
  EmailCompBr: string | null;
  Position: string | null;
  DepartmentId: number | null;
  DepartmentName: string | null;
  DepartmentCode: string | null;
  ManagerStaffId: number | null;
}

/**
 * Requester snapshot for a save/submit. Without requesterStaffId -> the actor themselves.
 * With requesterStaffId -> the colleague, but ONLY if they are Active and in the actor's
 * department (server-side authorization -- never trust the client).
 */
export async function resolveRequesterForActor(
  loginEmail: string,
  requesterStaffId: number | null | undefined,
): Promise<RequesterSnapshot> {
  const actor = await resolveRequester(loginEmail);
  if (!actor) throw new Error("ไม่พบข้อมูลพนักงานของคุณในระบบ HR");
  if (!requesterStaffId || requesterStaffId === actor.staffId) return actor;

  const pool = await getHrPool();
  const r = await pool
    .request()
    .input("sid", sql.Int, requesterStaffId)
    .query<EmployeeByStaffRow>(`
      SELECT TOP 1 e.Id, e.StaffId, e.FirstName, e.LastName, e.FullName,
             e.Email, e.EmailCompBr, e.Position,
             e.DepartmentId, d.Name AS DepartmentName, e.DepartmentCode, e.ManagerStaffId
      FROM dbo.Employee e
      LEFT JOIN dbo.Department d ON d.Id = CAST(e.DepartmentId AS nvarchar(50))
      WHERE e.StaffId = @sid AND e.Status = 'Active'
    `);
  const b = r.recordset[0];
  if (!b) throw new Error("ไม่พบข้อมูลพนักงานที่เลือก");
  if (actor.departmentId == null || b.DepartmentId !== actor.departmentId) {
    throw new Error("เลือกได้เฉพาะพนักงานในแผนกเดียวกันเท่านั้น");
  }
  return {
    employeeId: b.Id ?? null,
    staffId: b.StaffId ?? null,
    firstName: b.FirstName ?? null,
    lastName: b.LastName ?? null,
    fullName: [b.FirstName, b.LastName].filter(Boolean).join(" ") || b.FullName || null,
    email: b.Email ?? b.EmailCompBr ?? null,
    position: b.Position ?? null,
    departmentId: b.DepartmentId ?? null,
    departmentName: b.DepartmentName ?? null,
    departmentCode: b.DepartmentCode ?? null,
    managerStaffId: b.ManagerStaffId ?? null,
    companyName: actor.companyName,
  };
}
