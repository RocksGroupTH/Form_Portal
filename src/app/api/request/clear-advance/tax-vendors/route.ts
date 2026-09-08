import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { suggestTaxVendors } from "@/lib/clr/tax-vendor-service";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { AP2_FORM_CODE } from "@/features/advance/constants";

/**
 * GET /api/request/clear-advance/tax-vendors?brand=ROCKS&taxId=0107537002443
 *
 * The vendor cards in that Company carrying the tax id — candidates for the VAT
 * line's Tax Vendor No., which accounting picks from.
 *
 * An empty list is an ordinary answer, not a failure: a one-off seller is not a
 * vendor of ours and the field stays blank.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  const taxId = req.nextUrl.searchParams.get("taxId") ?? "";
  if (!brand.trim() || taxId.replace(/\D/g, "").length !== 13) {
    return NextResponse.json({ ok: false, error: "ต้องระบุแบรนด์และเลขผู้เสียภาษี 13 หลัก" }, { status: 400 });
  }

  try {
    // The claim brand is what the screen knows; ErpVendors is keyed by the
    // Company the journal posts into. Resolved here rather than on the client,
    // because sending ROCKS where PCTH is meant returns an empty list that looks
    // exactly like "this seller is not a vendor" — the same silent shape that
    // made the BU lookup read zero branches earlier today.
    const map = await getBrandErpInterfaceMap(brand, AP2_FORM_CODE);
    const company = map?.interfaceBrandCode?.trim() || brand.trim();
    return NextResponse.json({ ok: true, data: await suggestTaxVendors(company, taxId) });
  } catch (e) {
    console.error("[api/request/clear-advance/tax-vendors] GET", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
