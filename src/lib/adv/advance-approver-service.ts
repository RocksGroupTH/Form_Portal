import { getAccPool, sql } from "@/lib/adv/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { hrEmployeeTable } from "@/lib/hr/constants";

/**
 * AP-2's accounting-approver list (AccAdvanceApprover) — separate from AP-1 so
 * edits here never touch another form. Two levels, no line-manager step:
 *   HEAD_ACC    → Head Accounting (first approval; maps to the MANAGER step row)
 *   ACC_OFFICER → Accounting Officer (final; maps to the ACCOUNT step row, picks
 *                 the payment date and checks)
 */

export type AdvanceApproverRole = "HEAD_ACC" | "ACC_OFFICER" | "DIRECTOR";

export const ADVANCE_APPROVER_ROLES: readonly AdvanceApproverRole[] = ["HEAD_ACC", "ACC_OFFICER", "DIRECTOR"];

export function isAdvanceApproverRole(v: unknown): v is AdvanceApproverRole {
  return v === "HEAD_ACC" || v === "ACC_OFFICER" || v === "DIRECTOR";
}

export interface AdvanceApprover {
  id: number;
  staffId: number | null;
  email: string;
  displayName: string | null;
  approverRole: AdvanceApproverRole;
  isActive: boolean;
  photoUrl: string | null;
}

/** All approvers (including inactive) for the settings list. */
export async function listAdvanceApprovers(): Promise<AdvanceApprover[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, ApproverRole, IsActive, PhotoUrl
    FROM [dbo].[AccAdvanceApprover] ORDER BY ApproverRole, DisplayName, Email`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    staffId: (x.StaffId as number) ?? null,
    email: x.Email as string,
    displayName: (x.DisplayName as string) ?? null,
    approverRole: (x.ApproverRole as AdvanceApproverRole) ?? "ACC_OFFICER",
    isActive: !!x.IsActive,
    photoUrl: (x.PhotoUrl as string) ?? null,
  }));
}

/** Active approver emails for one level — used for step notifications. */
export async function listApproverEmailsByRole(role: AdvanceApproverRole): Promise<string[]> {
  const pool = await getAccPool();
  const r = await pool.request().input("role", sql.NVarChar, role).query(`
    SELECT Email FROM [dbo].[AccAdvanceApprover]
    WHERE IsActive = 1 AND ApproverRole = @role ORDER BY DisplayName, Email`);
  return (r.recordset as { Email: string | null }[])
    .map((x) => x.Email)
    .filter((e): e is string => !!e && e.trim() !== "");
}

export interface ApproverDisplay {
  staffId: number | null;
  email: string;
  displayName: string | null;
  position: string | null;
  photoUrl: string | null;
}

/** Active approvers at one level, with display info (for the request form). */
export async function listActiveApproversByRole(role: AdvanceApproverRole): Promise<ApproverDisplay[]> {
  const pool = await getAccPool();
  const r = await pool.request().input("role", sql.NVarChar, role).query(`
    SELECT a.StaffId, a.Email, a.DisplayName, a.PhotoUrl, e.Position
    FROM [dbo].[AccAdvanceApprover] a
    LEFT JOIN ${hrEmployeeTable()} e ON e.StaffId = a.StaffId AND e.Status = N'Active'
    WHERE a.IsActive = 1 AND a.ApproverRole = @role ORDER BY a.DisplayName, a.Email`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    staffId: (x.StaffId as number) ?? null,
    email: x.Email as string,
    displayName: (x.DisplayName as string) ?? null,
    position: (x.Position as string) ?? null,
    photoUrl: (x.PhotoUrl as string) ?? null,
  }));
}

/** Is this email an active approver at the given level? (authorization) */
export async function isAdvanceApprover(
  email: string | null | undefined,
  role: AdvanceApproverRole,
): Promise<boolean> {
  if (!email || !email.trim()) return false;
  const pool = await getAccPool();
  const r = await pool.request()
    .input("email", sql.NVarChar, email.trim())
    .input("role", sql.NVarChar, role)
    .query(`SELECT TOP 1 1 AS ok FROM [dbo].[AccAdvanceApprover]
            WHERE IsActive = 1 AND ApproverRole = @role AND LOWER(Email) = LOWER(@email)`);
  return r.recordset.length > 0;
}

/**
 * Add or update an approver. Keyed on Id when given, else on Email (idempotent
 * add). COALESCE preserves omitted fields so an active-toggle can send just
 * { id, isActive }.
 */
export async function upsertAdvanceApprover(
  a: {
    id?: number;
    staffId?: number | null;
    email?: string;
    displayName?: string | null;
    approverRole?: AdvanceApproverRole;
    isActive?: boolean;
    photoUrl?: string | null;
  },
  userId: number,
): Promise<void> {
  // Config table — dual-write so Production and UAT stay aligned (like AP-1).
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("staff", sql.Int, a.staffId ?? null)
      .input("email", sql.NVarChar, a.email ?? null)
      .input("name", sql.NVarChar, a.displayName ?? null)
      .input("role", sql.NVarChar, a.approverRole ?? null)
      .input("photo", sql.NVarChar, a.photoUrl ?? null)
      .input("active", sql.Bit, a.isActive === undefined ? null : a.isActive ? 1 : 0)
      .input("user", sql.Int, userId || null);
    if (a.id) {
      req.input("id", sql.Int, a.id);
      await req.query(`UPDATE [dbo].[AccAdvanceApprover] SET
        StaffId = COALESCE(@staff, StaffId),
        Email = COALESCE(@email, Email),
        DisplayName = COALESCE(@name, DisplayName),
        ApproverRole = COALESCE(@role, ApproverRole),
        PhotoUrl = COALESCE(@photo, PhotoUrl),
        IsActive = COALESCE(@active, IsActive),
        UpdatedAt = SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`MERGE [dbo].[AccAdvanceApprover] AS t
        USING (SELECT @email AS Email, COALESCE(@role,'ACC_OFFICER') AS ApproverRole) AS s
          ON t.Email=s.Email AND t.ApproverRole=s.ApproverRole
        WHEN MATCHED THEN UPDATE SET StaffId=COALESCE(@staff,t.StaffId), DisplayName=COALESCE(@name,t.DisplayName),
          PhotoUrl=COALESCE(@photo,t.PhotoUrl), IsActive=COALESCE(@active,t.IsActive), UpdatedAt=SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (StaffId,Email,DisplayName,ApproverRole,PhotoUrl,IsActive,CreatedBy)
        VALUES (@staff,@email,@name,s.ApproverRole,@photo,COALESCE(@active,1),@user);`);
    }
  });
}

/** Hard-remove an approver row. */
export async function deleteAdvanceApprover(id: number): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccAdvanceApprover] WHERE Id=@id`);
  });
}
