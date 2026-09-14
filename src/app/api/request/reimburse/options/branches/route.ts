import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listClrErpBranchesForCompany } from "@/lib/clr/clear-advance-admin-service";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * GET /api/request/reimburse/options/branches?brand=ROCKS
 *
 * The company's own branches — the BRANCH dimension values synced from Business
 * Central, active and unblocked — for AP-4's สาขาที่ใช้จ่าย picker.
 *
 * **The claim brand is resolved to the Interface company first**, exactly as
 * `../vendors` and `../expense-accounts` do. The dimension values are keyed on
 * the Business Central company, not on the brand a claim is filed under, so
 * passing the claim brand straight through answers an empty list for every
 * ROCKS claim — the same bug the G/L picker carried until it was fixed.
 *
 * `listClrErpBranchesForCompany` is form-agnostic and shared with AP-3.
 * `listClrErpBranchOptions` beside it is NOT: it pins `AP-3` when it resolves
 * the company, so calling that one from here would resolve AP-4's brand through
 * another form's interface map.
 *
 * `requireAuth()`: it is a company's own branch list, which the picker shows to
 * whoever is filling the form, and it takes a brand rather than a request id —
 * there is no record here to authorize.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = (req.nextUrl.searchParams.get("brand") ?? "").trim();
  if (!brand) return NextResponse.json({ ok: true, data: [] });

  try {
    const map = await getBrandErpInterfaceMap(brand, AP4_FORM_CODE);
    const company = (map?.interfaceBrandCode?.trim() || brand).toUpperCase();
    const rows = await listClrErpBranchesForCompany(company);
    return NextResponse.json({
      ok: true,
      data: rows.map((r) => ({ code: r.code, name: r.displayName })),
    });
  } catch (e) {
    console.error("[api/request/reimburse/options/branches] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
