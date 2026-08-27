import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { syncAllBrandErpVendors, syncBrandErpVendors } from "@/lib/erp/vendor-sync";

/**
 * POST /api/request/advance/settings/vendors/sync — optional { brandCode }.
 * Pulls vendors + posting group from BC into Rocks_ERP_Data.ErpVendors.
 * Admin-only: writes the shared Rocks_ERP_Data master (same reasoning as the
 * accounting sync route), so it stays on requireRole regardless of tab grants.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json().catch(() => ({}));
    const brandCode = (body.brandCode as string | undefined)?.trim();

    if (brandCode) {
      const data = await syncBrandErpVendors(brandCode, Number(session.user.id));
      return NextResponse.json({ ok: true, data: { results: [data], errors: [] } });
    }

    const data = await syncAllBrandErpVendors(Number(session.user.id));
    if (data.results.length === 0 && data.errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: data.errors.map((e) => `${e.brandCode}: ${e.error}`).join("; "), data },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/vendors/sync] POST", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
