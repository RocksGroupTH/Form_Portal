import { getAccPool, sql } from "@/lib/adv/pool";

/**
 * AP-2's accounting-approver list (AccAdvanceApprover) — separate from AP-1 so
 * edits here never touch another form. Governs the ACCOUNT approval step.
 */

export interface AdvanceApprover {
  id: number;
  staffId: number | null;
  email: string;
  displayName: string | null;
  isActive: boolean;
  photoUrl: string | null;
}

/** All approvers (including inactive) for the settings list. */
export async function listAdvanceApprovers(): Promise<AdvanceApprover[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive, PhotoUrl
    FROM [dbo].[AccAdvanceApprover] ORDER BY DisplayName, Email`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    staffId: (x.StaffId as number) ?? null,
    email: x.Email as string,
    displayName: (x.DisplayName as string) ?? null,
    isActive: !!x.IsActive,
    photoUrl: (x.PhotoUrl as string) ?? null,
  }));
}

/**
 * Add or update an approver. Keyed on Id when given, else on Email (idempotent
 * add). COALESCE preserves omitted fields so an active-toggle can send just
 * { id, isActive } without nulling Email.
 */
export async function upsertAdvanceApprover(
  a: {
    id?: number;
    staffId?: number | null;
    email?: string;
    displayName?: string | null;
    isActive?: boolean;
    photoUrl?: string | null;
  },
  userId: number,
): Promise<void> {
  const pool = await getAccPool();
  const req = pool
    .request()
    .input("staff", sql.Int, a.staffId ?? null)
    .input("email", sql.NVarChar, a.email ?? null)
    .input("name", sql.NVarChar, a.displayName ?? null)
    .input("photo", sql.NVarChar, a.photoUrl ?? null)
    .input("active", sql.Bit, a.isActive === undefined ? null : a.isActive ? 1 : 0)
    .input("user", sql.Int, userId || null);
  if (a.id) {
    req.input("id", sql.Int, a.id);
    await req.query(`UPDATE [dbo].[AccAdvanceApprover] SET
      StaffId = COALESCE(@staff, StaffId),
      Email = COALESCE(@email, Email),
      DisplayName = COALESCE(@name, DisplayName),
      PhotoUrl = COALESCE(@photo, PhotoUrl),
      IsActive = COALESCE(@active, IsActive),
      UpdatedAt = SYSDATETIME() WHERE Id=@id`);
  } else {
    await req.query(`MERGE [dbo].[AccAdvanceApprover] AS t USING (SELECT @email AS Email) AS s ON t.Email=s.Email
      WHEN MATCHED THEN UPDATE SET StaffId=COALESCE(@staff,t.StaffId), DisplayName=COALESCE(@name,t.DisplayName),
        PhotoUrl=COALESCE(@photo,t.PhotoUrl), IsActive=COALESCE(@active,t.IsActive), UpdatedAt=SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (StaffId,Email,DisplayName,PhotoUrl,IsActive,CreatedBy)
      VALUES (@staff,@email,@name,@photo,COALESCE(@active,1),@user);`);
  }
}

/** Hard-remove an approver row. */
export async function deleteAdvanceApprover(id: number): Promise<void> {
  const pool = await getAccPool();
  await pool.request().input("id", sql.Int, id)
    .query(`DELETE FROM [dbo].[AccAdvanceApprover] WHERE Id=@id`);
}
