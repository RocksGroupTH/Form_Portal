import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  syncAllBrandDepartmentDimensions,
  syncBrandDepartmentDimension,
} from "@/lib/acc/department-map-service";

/**
 * POST /api/request/accounting/settings/departments/sync — optional { brandCode }
 *
 * **Admin only, whatever settings tabs the caller holds.** The `departments`
 * grant on the แผนก (HR ↔ ERP) tab is read-only: it opens the GET beside this
 * route and nothing else — not this sync, and not `departments/map`.
 * It pulls the DEPT dimension out of Business Central through
 * `syncBrandDimensionValues`, which opens `getErpDataPool()` and writes
 * `ErpDimensionValue` and `ErpSyncLog` in `Rocks_ERP_Data` (migrations
 * 101/102). Those are not this app's private rows: Rocks Fast writes the same
 * ones and ACC Portal reads them, both naming the tables two-part against
 * `Fast_Data`, where 102 left a permanent synonym per table. A tab grant must
 * not become write access to rows two other applications depend on, so this
 * stays on `requireRole`. Recorded in `SETTINGS_ROUTE_TABS`
 * (`@/lib/acc/settings-tabs`), and the panel hides the Sync button for a
 * non-admin rather than offering a control that is then refused.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json().catch(() => ({}));
    const brandCode = (body.brandCode as string | undefined)?.trim();

    if (brandCode) {
      const data = await syncBrandDepartmentDimension(brandCode, Number(session.user.id));
      return NextResponse.json({ ok: true, data });
    }

    const data = await syncAllBrandDepartmentDimensions(Number(session.user.id));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/.../departments/sync] POST", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
