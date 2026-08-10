import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { getAccPool, sql } from "@/lib/acc/pool";
import { getTravelBookingGroup } from "@/lib/acc/travel-booking/request-service";

/**
 * GET /api/request/travel-booking/requests/group/[groupKey] — every tab sharing one
 * multi-request submission's GroupKey (loading a draft group back into the form).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ groupKey: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { groupKey } = await params;
  if (!groupKey) {
    return NextResponse.json({ ok: false, error: "Invalid groupKey" }, { status: 400 });
  }

  try {
    const pool = await getAccPool();
    const own = await pool.request().input("gk", sql.NVarChar(40), groupKey)
      .query(`SELECT DISTINCT r.CreatedBy
              FROM [dbo].[AccTravelBooking] t
              INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
              WHERE t.GroupKey = @gk`);
    if (own.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const userId = Number(session.user.id);
    const isAdmin = isAdminRole(session.user.role);
    const isOwner = (own.recordset as { CreatedBy: number | null }[]).some(
      (r) => r.CreatedBy != null && r.CreatedBy === userId,
    );
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const data = await getTravelBookingGroup(groupKey);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/requests/group/[groupKey]] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
