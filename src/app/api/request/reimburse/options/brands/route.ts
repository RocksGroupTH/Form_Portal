import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * The brands an AP-4 claim may be filed against — `AccFormBrand` where
 * `FormCode = 'AP-4'` and `IsActive = 1`, enriched with the display name and
 * logo from the company brand master.
 *
 * The same endpoint AP-1 has had all along (`/api/request/accounting/options/brands`),
 * against the same function, for the same reason. Its absence is why the AP-4
 * form recorded the app-level BrandGate brand instead: with nothing to ask, the
 * form fell back to the cookie, and every request written so far therefore
 * carries a code that matches **zero** `AccFormBrand` rows. That was harmless
 * only for as long as nothing joined the two — no AP-4 report, no ERP path, and
 * no server-side validation of `BrandCode` exists yet — and it stops being
 * harmless the first time one does.
 *
 * `requireAuth()`, like AP-1's: the list is what the form draws, so every
 * requester needs it, and it says nothing that the picker itself would not.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = await getAllowedBrands(AP4_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[api/request/reimburse/options/brands] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
