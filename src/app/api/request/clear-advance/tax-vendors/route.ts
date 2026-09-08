import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { suggestTaxVendors, searchTaxVendorsByName } from "@/lib/clr/tax-vendor-service";
import { buildVendorNameTerms } from "@/lib/clr/tax-vendor-core";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { AP2_FORM_CODE } from "@/features/advance/constants";

/**
 * GET /api/request/clear-advance/tax-vendors?brand=ROCKS&taxId=0107537002443
 * GET /api/request/clear-advance/tax-vendors?brand=ROCKS&name=เจเนซิส
 *
 * The vendor cards in that Company that could be this seller — candidates for
 * the VAT line's Tax Vendor No., which accounting picks from.
 *
 * Two ways in, because neither reaches everything: the tax id is the seller's
 * legal identity and answers with a single card 88% of the time, but 155 active
 * trade vendors in PCTH have no tax registration number on their card and can
 * only be found by name.
 *
 * An empty list is an ordinary answer, not a failure — the seller may simply not
 * be a vendor of ours yet.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  const taxId = req.nextUrl.searchParams.get("taxId") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const byTaxId = taxId.replace(/\D/g, "").length === 13;
  const byName = buildVendorNameTerms(name).length > 0;
  if (!brand.trim() || (!byTaxId && !byName)) {
    return NextResponse.json(
      {
        ok: false,
        // A name of nothing but "บริษัท จำกัด" lands here: it is not a search,
        // and saying so beats answering it with every company in the ledger.
        error: name.trim()
          ? "ชื่อที่ค้นไม่เจาะจงพอ — พิมพ์ชื่อเฉพาะของผู้ขาย"
          : "ต้องระบุแบรนด์ และเลขผู้เสียภาษี 13 หลัก หรือชื่อผู้ขาย",
      },
      { status: 400 },
    );
  }

  try {
    // The claim brand is what the screen knows; ErpVendors is keyed by the
    // Company the journal posts into. Resolved here rather than on the client,
    // because sending ROCKS where PCTH is meant returns an empty list that looks
    // exactly like "this seller is not a vendor" — the same silent shape that
    // made the BU lookup read zero branches earlier today.
    const map = await getBrandErpInterfaceMap(brand, AP2_FORM_CODE);
    const company = map?.interfaceBrandCode?.trim() || brand.trim();
    // The tax id wins when both arrive: it is the seller's identity, the name is
    // a way of looking for it.
    const data = byTaxId
      ? await suggestTaxVendors(company, taxId)
      : await searchTaxVendorsByName(company, name);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[api/request/clear-advance/tax-vendors] GET", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
