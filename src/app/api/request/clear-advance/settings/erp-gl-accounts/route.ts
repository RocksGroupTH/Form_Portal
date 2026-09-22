import { NextRequest, NextResponse } from "next/server";
import { requireAdvClrSettingsTab } from "@/lib/adv/require-adv-clr-settings-tab";
import { listClrErpGlOptions } from "@/lib/clr/clear-advance-admin-service";

/**
 * GET ?brand=PCTH — active GL accounts for a brand from Rocks_ERP_Data.dbo.ErpAccounts.
 *
 * **Gated on `clearErpInterface` since 2026-09-22**: it is one of the two
 * option lists AP-3's Interface ERP tab picks from, so leaving it on
 * `requireRole` would have handed a grant holder a tab whose dropdowns are
 * empty. It READS the Business Central mirror and writes nothing — the routes
 * that WRITE `Rocks_ERP_Data` (`erp-sync`, `locations/sync`) stay admin-only.
 */
export async function GET(req: NextRequest) {
  const session = await requireAdvClrSettingsTab("clearErpInterface");
  if (session instanceof Response) return session;
  try {
    const brand = (req.nextUrl.searchParams.get("brand") ?? "").trim();
    if (!brand) return NextResponse.json({ ok: true, data: [] });
    const data = await listClrErpGlOptions(brand);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-gl-accounts] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงบัญชี ERP ไม่สำเร็จ" }, { status: 500 });
  }
}
