import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  syncAllBrandDepartmentDimensions,
  syncBrandDepartmentDimension,
} from "@/lib/acc/department-map-service";

/**
 * POST /api/request/accounting/settings/departments/sync — optional { brandCode }
 *
 * **Admin only, whatever settings tabs the caller holds.** Every other route on
 * the แผนก (HR ↔ ERP) tab is opened by the `departments` grant; this one is not.
 * It pulls the DEPT dimension out of Business Central through
 * `syncBrandDimensionValues`, which opens the ERP reporting pool and writes
 * `ErpDimensionValue` and `ErpSyncLog` — a database shared with the Rocks Fast
 * sibling application. A tab grant must not become write access to another
 * app's data, so this stays on `requireRole`. Recorded in `SETTINGS_ROUTE_TABS`
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
