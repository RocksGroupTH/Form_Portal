import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { getHrPool } from "@/lib/hr/pool";
import { sql } from "@/lib/db/mssql";
import {
  resolveCurrentFormAccess,
  resolveCurrentFormWritable,
  resolveFormAccess,
  resolveFormEnvironment,
  resolveFormWritable,
} from "@/lib/form-environment";
import { uatManagerFor } from "@/lib/uat-tester/service";
import {
  assertRequesterAllowedInUat,
  FORM_UNAVAILABLE_ERROR,
  UAT_MANAGER_MISSING_ERROR,
} from "@/lib/uat-tester/guards";

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
}

/**
 * Resolve the manager of the employee matched by login email (for the form).
 *
 * `formCode` is what makes the preview honest. This is a card on a form, but the
 * routes that serve it are not the form's own: `/api/me/employee` is
 * unclassified and `/api/request/accounting/requesters` is an aggregate, so both
 * resolve Production from the path no matter who is asking. Naming the form asks
 * `resolveFormAccess` instead.
 *
 * `requestId` closes the rest of the gap. The submit posts to
 * `/api/request/accounting/requests/<id>/submit`, where the id is a path segment
 * and the id rule applies; the card is drawn from a route carrying no id at all.
 * Without the id the two disagree in both directions — a tester in UAT mode
 * resuming a production claim was previewed the UAT manager and assigned the real
 * one, and with no UAT manager configured the card even blocked the resubmit of a
 * real, money-bearing Returned claim. Pass it whenever an existing record is being
 * resumed; omit it for a brand-new request, which has no record yet.
 *
 * Omit `formCode` too and the current path decides, which is correct for any
 * caller that really is on the form's own route.
 */
export async function resolveManagerInfo(
  loginEmail: string,
  formCode?: string | null,
  requestId?: number | null,
): Promise<ManagerResolution> {
  const emp = await findActiveEmployeeByEmail(loginEmail);
  if (!emp?.employee) {
    return { hasManager: false, manager: null, reason: "ไม่พบข้อมูลพนักงานของคุณในระบบ HR" };
  }

  // In UAT the card must preview the person the submit will actually assign —
  // the tester's configured UAT manager — never their real HR manager.
  const [access, writable] = formCode
    ? await Promise.all([
        resolveFormAccess(formCode, requestId),
        resolveFormWritable(formCode, requestId),
      ])
    : await Promise.all([resolveCurrentFormAccess(), resolveCurrentFormWritable()]);
  // A form the resolved environment is no longer taking work for has no manager
  // to name. Judged on writability rather than `available` so the card agrees
  // with the submit: `available` is unconditionally true once a record's id is in
  // play, and the card is a preview of a write. Saying "no UAT manager" here
  // would send the viewer to Settings → UAT Users to fix what is not the blocker.
  if (!writable) {
    return { hasManager: false, manager: null, reason: FORM_UNAVAILABLE_ERROR };
  }
  const isUat = access.environment === "UAT";
  const uatManager = isUat
    ? await uatManagerFor(loginEmail, emp.employee.staffId ?? null)
    : null;
  const managerStaffId = isUat
    ? (uatManager?.staffId ?? null)
    : (emp.employee.managerStaffId ?? null);
  if (!managerStaffId) {
    return {
      hasManager: false,
      manager: null,
      reason: isUat
        ? UAT_MANAGER_MISSING_ERROR
        : "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR",
    };
  }

  const pool = await getHrPool();
  const r = await pool.request().input("sid", sql.Int, managerStaffId).query<ManagerRow>(`
    SELECT TOP 1 StaffId, FullName, FirstName, LastName, Email, EmailCompBr, Position
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
      photoUrl: `/api/hr/photo/${row.StaffId}`,
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
 * The snapshot's manager, swapped for the requester's UAT manager when this
 * request resolves UAT.
 *
 * Keyed on the requester the snapshot describes, not on whoever is driving the
 * browser: an on-behalf request routes to the requester's manager, and in UAT
 * that has to be the requester's UAT manager. Keyed on the resolved environment,
 * not the UAT-mode cookie, so a tester's own production claim keeps its real HR
 * manager.
 *
 * No manager means no manager: the snapshot comes back with `managerStaffId`
 * null and the existing manager-less path refuses the submit. Falling back to
 * HR here would put test data in a real manager's queue.
 *
 * `resolveManagerEmail` is deliberately left alone — it maps a StaffId to an
 * email and nothing else. Overriding it too would pair the production manager's
 * `AssignedTo` with the UAT manager's `AssignedEmail`, and `canActManagerStep`
 * accepts either, so both people could act on the same row.
 */
async function withUatManager(snapshot: RequesterSnapshot): Promise<RequesterSnapshot> {
  if ((await resolveFormEnvironment()) !== "UAT") return snapshot;
  const manager = await uatManagerFor(snapshot.email, snapshot.staffId);
  return { ...snapshot, managerStaffId: manager ? manager.staffId : null };
}

/**
 * Requester snapshot for a save/submit. Without requesterStaffId -> the actor themselves.
 * With requesterStaffId -> the colleague, but ONLY if they are Active and in the actor's
 * department (server-side authorization -- never trust the client).
 *
 * In UAT the manager is the requester's UAT manager (see `withUatManager`), and
 * an on-behalf request is refused outright unless the requester is a tester too.
 *
 * The on-behalf refusal is unconditional here because both callers are writes —
 * `saveDraft` and the submit route, and nothing else. AP-17's equivalent
 * (`resolveEmployeeForActor`) also backs four read-only GETs — allowance-log,
 * date-ranges, id-card/previous and its download — so there the same guard is
 * opt-in, and its three writes (the two that file a request, plus the id-card
 * consent POST) pass `forWrite`.
 */
export async function resolveRequesterForActor(
  loginEmail: string,
  requesterStaffId: number | null | undefined,
): Promise<RequesterSnapshot> {
  const actor = await resolveRequester(loginEmail);
  if (!actor) throw new Error("ไม่พบข้อมูลพนักงานของคุณในระบบ HR");
  if (!requesterStaffId || requesterStaffId === actor.staffId) return withUatManager(actor);

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
  // Any active employee may be filed for, not only the actor's own department.
  // What remains is the check above — the row must exist and be Active — plus
  // `assertRequesterAllowedInUat` below.
  //
  // Widening this was asked for directly. It means a claim can be opened in the
  // name of anyone in the company; the approval still routes to the
  // *requester's* manager rather than the actor's, and `CreatedBy` still records
  // who filed it, so the claim is attributable in both directions.
  const colleague: RequesterSnapshot = {
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
  await assertRequesterAllowedInUat(colleague.email, colleague.staffId);
  return withUatManager(colleague);
}
