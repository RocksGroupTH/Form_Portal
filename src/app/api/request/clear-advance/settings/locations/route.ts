import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getLastLocationSync, listBrandLocations } from "@/lib/erp/location-admin";
import { summarizeBuSpread } from "@/lib/erp/location-admin-core";

/**
 * GET /api/request/clear-advance/settings/locations?brand=PCTH
 *
 * The rows, their BU spread and the last sync in one answer, so the tab renders
 * fully without a second round trip.
 *
 * Admin only. `ErpLocation` lives in `Rocks_ERP_Data` beside rows Rocks Fast
 * writes and ACC Portal reads, so even the read stays on the same footing as the
 * sync it sits next to.
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const brand = req.nextUrl.searchParams.get("brand")?.trim() ?? "";
    if (!brand) {
      return NextResponse.json({ ok: false, error: "ต้องระบุแบรนด์" }, { status: 400 });
    }

    const rows = await listBrandLocations(brand);
    const lastSync = await getLastLocationSync(brand);
    return NextResponse.json({
      ok: true,
      data: { rows, buSpread: summarizeBuSpread(rows), lastSync },
    });
  } catch (e) {
    console.error("[api/request/clear-advance/settings/locations] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
