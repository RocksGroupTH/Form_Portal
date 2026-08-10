import { getCorePool, sql } from "@/lib/db/mssql";
import { isAdminRole } from "@/lib/roles";

/**
 * True if the user has any Intelligence access:
 *  - admin role (IT Admin / System Admin), OR
 *  - a direct IntelBrandPermission grant by email, OR
 *  - membership in an active IntelPermissionGroup that has a brand grant.
 */
export async function hasIntelAccess(email: string, role: string): Promise<boolean> {
  if (isAdminRole(role)) return true;
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  const pool = await getCorePool();
  const r = await pool.request().input("email", sql.NVarChar, e).query(`
    SELECT TOP 1 1 AS ok FROM IntelBrandPermission WHERE LOWER(UserEmail) = @email
    UNION
    SELECT TOP 1 1 AS ok
    FROM IntelBrandPermission bp
    INNER JOIN IntelPermissionGroupMember gm ON bp.GroupId = gm.GroupId
    INNER JOIN IntelPermissionGroup g ON gm.GroupId = g.Id AND g.IsActive = 1
    WHERE LOWER(gm.UserEmail) = @email
  `);
  return r.recordset.length > 0;
}
