import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listTaxVendors } from "@/lib/clr/tax-vendor-service";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * GET /api/request/reimburse/vendors?brand=ROCKS
 *
 * Every Business Central vendor card in that Company, for the `Vendor` cell on
 * คิวอนุมัติ (บัญชี). The whole list, which the screen then filters as the
 * reader types.
 *
 * `/api/request/clear-advance/tax-vendors` with `AP4_FORM_CODE` in place of
 * `AP2_FORM_CODE`, over the same `listTaxVendors`. That function is
 * form-agnostic — it takes a Company code — so nothing about it needed changing
 * for AP-4.
 *
 * **Sending the whole list is the fix, not the shortcut.** `ErpVendors.
 * DisplayName` is `Thai_CI_AS`, where SQL `LIKE` compares collation elements —
 * a Thai consonant and the mark above it are one — so a substring pattern did
 * not match the name it was taken from. JavaScript compares code units. The
 * largest company is 1,604 cards, about 93KB; see `listTaxVendors`' own note.
 *
 * **The Company is resolved here, not posted.** `ErpVendors` is keyed by
 * Company and a vendor number from one is meaningless in another. Trusting a
 * client-supplied company would let a caller list another brand's vendors, and
 * sending `ROCKS` where `PCTH` is meant returns an empty list that looks
 * exactly like "this company has no vendors".
 *
 * `requireAuth()` and no object ACL, matching AP-3's: the response is the BC
 * vendor master for a brand, not anything about a claim. There is no record
 * here to authorize — the parameter is a brand, not a request id.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  if (!brand.trim()) {
    return NextResponse.json({ ok: false, error: "ต้องระบุแบรนด์" }, { status: 400 });
  }

  try {
    const map = await getBrandErpInterfaceMap(brand, AP4_FORM_CODE);
    // Falling back to the claim brand matches AP-3. A brand with no
    // AccBrandErpInterface row is unmapped — both AP-4 queues already report
    // that as `unmappedBrandCount` and name the fix — so this answers whatever
    // that name finds, which is usually nothing, rather than inventing a
    // Company the claim does not post to.
    const company = map?.interfaceBrandCode?.trim() || brand.trim();
    return NextResponse.json({ ok: true, data: await listTaxVendors(company) });
  } catch (e) {
    console.error("[api/request/reimburse/vendors] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
