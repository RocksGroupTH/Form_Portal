import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listTaxVendors } from "@/lib/clr/tax-vendor-service";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { AP2_FORM_CODE } from "@/features/advance/constants";

/**
 * GET /api/request/clear-advance/tax-vendors?brand=ROCKS
 *
 * Every vendor card in that Company — the whole list the screen filters as the
 * reader types. It used to take `taxId` or `name` and search server-side, which
 * meant a button to press, a round trip per attempt, and an answer that depended
 * on which key was asked first: a card with no tax registration number (101 ADV
 * cards and 155 trade vendors in PCTH have none) came back as "not a vendor"
 * from a tax-id search that could never have found it.
 *
 * The largest company is 1,604 cards, about 93KB. Small enough to send once.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  if (!brand.trim()) {
    return NextResponse.json({ ok: false, error: "ต้องระบุแบรนด์" }, { status: 400 });
  }

  try {
    // The claim brand is what the screen knows; ErpVendors is keyed by the
    // Company the journal posts into. Resolved here rather than on the client,
    // because sending ROCKS where PCTH is meant returns an empty list that looks
    // exactly like "this company has no vendors".
    const map = await getBrandErpInterfaceMap(brand, AP2_FORM_CODE);
    const company = map?.interfaceBrandCode?.trim() || brand.trim();
    return NextResponse.json({ ok: true, data: await listTaxVendors(company) });
  } catch (e) {
    console.error("[api/request/clear-advance/tax-vendors] GET", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
