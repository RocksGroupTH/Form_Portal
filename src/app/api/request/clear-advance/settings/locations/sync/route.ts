import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { syncAllBrandErpLocations, syncBrandErpLocations } from "@/lib/erp/location-sync";

/**
 * POST /api/request/clear-advance/settings/locations/sync — optional { brandCode }
 *
 * **Admin only, and deliberately not a settings-tab grant.** The whole AP-3
 * settings page is already admin-gated, but this route is reachable on its own
 * and writes `ErpLocation` and `ErpSyncLog` in `Rocks_ERP_Data` — rows that are
 * not this app's private property: Rocks Fast writes the neighbouring tables and
 * ACC Portal reads them through `Fast_Data` synonyms. It stays on `requireRole`
 * for the same reason the ERP accounts sync does, so that opening an AP-3 tab to
 * someone never becomes write access to rows two other applications depend on.
 *
 * With no brandCode every interface brand is synced, and one brand's failure does
 * not stop the rest — the response carries both the results and the errors.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json().catch(() => ({}));
    const brandCode = (body.brandCode as string | undefined)?.trim();
    const triggeredBy = Number(session.user.id);

    if (brandCode) {
      const data = await syncBrandErpLocations(brandCode, triggeredBy);
      return NextResponse.json({ ok: true, data });
    }

    const data = await syncAllBrandErpLocations(triggeredBy);
    if (data.results.length === 0 && data.errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: data.errors.map((e) => `${e.brandCode}: ${e.error}`).join("; "), data },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[api/request/clear-advance/settings/locations/sync] POST", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Sync failed" },
      { status: 400 },
    );
  }
}
