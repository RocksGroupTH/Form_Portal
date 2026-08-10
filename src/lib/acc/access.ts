import { getAccPool, sql } from "@/lib/acc/pool";
import { isAdminRole } from "@/lib/roles";

export async function isAccApprover(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(`SELECT TOP 1 1 AS ok FROM [dbo].[AccApprover] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`);
  return r.recordset.length > 0;
}

export async function canAccessAccountArea(
  email: string | null | undefined,
  role: string | null | undefined,
): Promise<boolean> {
  return isAdminRole(role) || (await isAccApprover(email));
}
