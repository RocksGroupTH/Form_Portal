import { NextResponse } from "next/server";
import { BRANDS } from "@/lib/brand";
import { getBrandDashboardReadiness } from "@/lib/brand-config";
import { getCorePool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";

/**
 * GET /api/intelligence/permissions
 * Returns the list of brand codes the current user has access to.
 * IT Admin / System Admin get all brands automatically.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const email = session.user?.email?.toLowerCase() ?? "";
    const role = (session.user?.role ?? "Staff") as string;
    const dashboardReady = await getBrandDashboardReadiness();

    // IT Admin / System Admin = all brands
    if (isAdminRole(role)) {
      const brands = BRANDS.filter((b) => b.enabled).map((b) => b.id);
      return NextResponse.json({ ok: true, data: { brands, isAdmin: true, dashboardReady } });
    }

    const pool = await getCorePool();

    // Check direct user permissions + group-based permissions
    const result = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(`
        -- Direct user permissions
        SELECT DISTINCT BrandCode
        FROM IntelBrandPermission
        WHERE LOWER(UserEmail) = @email

        UNION

        -- Group-based permissions
        SELECT DISTINCT bp.BrandCode
        FROM IntelBrandPermission bp
        INNER JOIN IntelPermissionGroupMember gm ON bp.GroupId = gm.GroupId
        INNER JOIN IntelPermissionGroup g ON gm.GroupId = g.Id AND g.IsActive = 1
        WHERE LOWER(gm.UserEmail) = @email
      `);

    const brands = result.recordset.map((r: { BrandCode: string }) => r.BrandCode);

    return NextResponse.json({ ok: true, data: { brands, isAdmin: false, dashboardReady } });
  } catch (err) {
    console.error("[api/intelligence/permissions] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
