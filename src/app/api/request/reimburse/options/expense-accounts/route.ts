import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listExpenseAccounts } from "@/lib/acc/reimburse/expense-account-service";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * GET /api/request/reimburse/options/expense-accounts?brand=PCTH — the G/L
 * accounts an AP-4 line may be booked to, for the picker in the `รายการ`
 * column.
 *
 * `requireAuth()`, like the brands endpoint beside it: the list is what the
 * form draws, so every requester needs it, and it says nothing the picker
 * itself would not. It is a company's chart of accounts, not anybody's
 * personal data, and the filtering that matters — expense and cost-of-sales,
 * postable accounts only — happens in the service.
 *
 * **`brand` is required rather than defaulted.** A claim with no brand chosen
 * yet gets an explicit 400, which the form turns into "เลือกแบรนด์ก่อน" rather
 * than an empty picker with no explanation.
 *
 * **The CLAIM brand is resolved to the Interface company before the lookup**,
 * exactly as `/api/request/reimburse/vendors` does. `ErpAccounts.BrandCode` is
 * the Business Central company, not the brand a claim is filed under — measured
 * 2026-09-10, it holds KSI, PCMY, PCTH and UNO and nothing else, while
 * `AccFormBrand` grants AP-4 `ROCKS`, which maps to PCTH. Passing the claim
 * brand straight through therefore answered an EMPTY LIST for every ROCKS
 * claim, and an empty picker looks like a company with no chart of accounts
 * rather than a lookup asking the wrong question.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/reimburse` prefix already
 * classifies as `AP-4`. The read itself is `getErpDataPool()`, one physical
 * copy with no UAT twin, so the classification changes nothing here — it is
 * recorded because the next person to add a route under this prefix will ask.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand")?.trim();
  if (!brand) {
    return NextResponse.json(
      { ok: false, error: "กรุณาเลือกแบรนด์ที่เบิกก่อน" },
      { status: 400 },
    );
  }

  try {
    // Falls back to the claim brand when nothing maps, which is what
    // AccBrandErpInterface having no row means — and matches the vendors route.
    const map = await getBrandErpInterfaceMap(brand, AP4_FORM_CODE);
    const company = map?.interfaceBrandCode?.trim() || brand;
    const data = await listExpenseAccounts(company);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("GET /api/request/reimburse/options/expense-accounts error:", e);
    return NextResponse.json({ ok: false, error: "โหลดรายการบัญชีไม่สำเร็จ" }, { status: 500 });
  }
}
