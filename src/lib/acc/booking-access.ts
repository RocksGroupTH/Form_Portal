import { getAccPool, sql } from "@/lib/acc/pool";
import { isAdminRole } from "@/lib/roles";

/**
 * AP-17's server-side gate, the counterpart to `canAccessAccountArea` for AP-1.
 *
 * Kept separate on purpose: `canAccessAccountArea` reads AP-1's `AccApprover`
 * and is wired into the shared object ACL and every ERP route, so widening it
 * to know about bookings would change AP-1's authorization too.
 */
export async function isBookingApprover(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT TOP 1 1 AS ok FROM [dbo].[AccBookingApprover]
       WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  return r.recordset.length > 0;
}

export async function canAccessBookingArea(
  email: string | null | undefined,
  role: string | null | undefined,
): Promise<boolean> {
  return isAdminRole(role) || (await isBookingApprover(email));
}
