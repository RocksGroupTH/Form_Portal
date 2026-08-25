import { getAccPool, sql } from "@/lib/acc/pool";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import type { ClrStepCode } from "@/features/clear-advance/constants";

/** Configured ACCOUNT/HEAD approver for AP-3 (Manager comes from HR, not this table). */
export interface ClrApprover {
  id: number;
  role: "ACCOUNT" | "HEAD";
  email: string;
  staffId: number | null;
  displayName: string | null;
  isActive: boolean;
}

/** The approver role that owns a given step. MANAGER is resolved from HR, not here. */
export function roleForStep(step: ClrStepCode): "ACCOUNT" | "HEAD" | null {
  if (step === "ACCOUNT") return "ACCOUNT";
  if (step === "HEAD") return "HEAD";
  return null;
}

/** List AP-3 approvers for a role (active only by default). */
export async function listClrApprovers(
  role: "ACCOUNT" | "HEAD",
  activeOnly = true,
): Promise<ClrApprover[]> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("role", sql.NVarChar, role)
    .query(`SELECT Id, Role, Email, StaffId, DisplayName, IsActive
            FROM [dbo].[AccClearAdvanceApprover]
            WHERE Role = @role ${activeOnly ? "AND IsActive = 1" : ""}
            ORDER BY DisplayName, Email`);
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    id: r.Id as number,
    role: r.Role as ClrApprover["role"],
    email: r.Email as string,
    staffId: (r.StaffId as number) ?? null,
    displayName: (r.DisplayName as string) ?? null,
    isActive: !!r.IsActive,
  }));
}

/** True if the email is an active AP-3 approver for the given role. */
export async function isClrApprover(
  email: string | null,
  role: "ACCOUNT" | "HEAD",
): Promise<boolean> {
  if (!email?.trim()) return false;
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("role", sql.NVarChar, role)
    .input("email", sql.NVarChar, email.trim())
    .query(`SELECT TOP 1 Id FROM [dbo].[AccClearAdvanceApprover]
            WHERE Role = @role AND IsActive = 1 AND LOWER(Email) = LOWER(@email)`);
  return res.recordset.length > 0;
}

/* ─────────────────────────── settings CRUD ─────────────────────────── */

/** All AP-3 approvers (both roles, incl. inactive) for the settings page. */
export async function listAllClrApprovers(): Promise<ClrApprover[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .query(`SELECT Id, Role, Email, StaffId, DisplayName, IsActive
            FROM [dbo].[AccClearAdvanceApprover]
            ORDER BY Role, DisplayName, Email`);
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    id: r.Id as number,
    role: r.Role as ClrApprover["role"],
    email: r.Email as string,
    staffId: (r.StaffId as number) ?? null,
    displayName: (r.DisplayName as string) ?? null,
    isActive: !!r.IsActive,
  }));
}

/** Create or update an AP-3 approver. StaffId/DisplayName auto-filled from HR by email. */
export async function upsertClrApprover(
  input: { id?: number; role: "ACCOUNT" | "HEAD"; email: string; isActive?: boolean },
  userId: number,
): Promise<void> {
  const email = input.email.trim();
  if (!email) throw new Error("กรุณากรอกอีเมล");
  if (input.role !== "ACCOUNT" && input.role !== "HEAD") throw new Error("บทบาทไม่ถูกต้อง");

  // Enrich from HR (best-effort) so the approval actor + display resolve.
  let staffId: number | null = null;
  let displayName: string | null = null;
  try {
    const { employee } = await findActiveEmployeeByEmail(email);
    staffId = employee?.staffId ?? null;
    displayName = employee?.fullName ?? null;
  } catch { /* HR lookup is best-effort */ }

  const pool = await getAccPool();
  const active = input.isActive === false ? 0 : 1;
  if (input.id) {
    await pool.request()
      .input("id", sql.Int, input.id)
      .input("role", sql.NVarChar, input.role)
      .input("email", sql.NVarChar, email)
      .input("staffId", sql.Int, staffId)
      .input("name", sql.NVarChar, displayName)
      .input("active", sql.Bit, active)
      .query(`UPDATE [dbo].[AccClearAdvanceApprover]
              SET Role=@role, Email=@email, StaffId=@staffId, DisplayName=@name,
                  IsActive=@active, UpdatedAt=SYSDATETIME()
              WHERE Id=@id`);
  } else {
    // Guard the (Role, Email) unique index with a friendly message.
    const dupe = await pool.request()
      .input("role", sql.NVarChar, input.role).input("email", sql.NVarChar, email)
      .query(`SELECT TOP 1 Id FROM [dbo].[AccClearAdvanceApprover] WHERE Role=@role AND LOWER(Email)=LOWER(@email)`);
    if (dupe.recordset.length > 0) throw new Error("อีเมลนี้ถูกเพิ่มในบทบาทนี้แล้ว");
    await pool.request()
      .input("role", sql.NVarChar, input.role)
      .input("email", sql.NVarChar, email)
      .input("staffId", sql.Int, staffId)
      .input("name", sql.NVarChar, displayName)
      .input("active", sql.Bit, active)
      .input("by", sql.Int, userId || null)
      .query(`INSERT INTO [dbo].[AccClearAdvanceApprover] (Role, Email, StaffId, DisplayName, IsActive, CreatedBy)
              VALUES (@role, @email, @staffId, @name, @active, @by)`);
  }
}

/** Delete an AP-3 approver. */
export async function deleteClrApprover(id: number): Promise<void> {
  const pool = await getAccPool();
  await pool.request().input("id", sql.Int, id)
    .query(`DELETE FROM [dbo].[AccClearAdvanceApprover] WHERE Id=@id`);
}
