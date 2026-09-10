import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAllowedBrands, listAllBrands } from "@/lib/acc/brand-options";
import { orderBrandsForDisplay } from "@/features/reimburse/lib/brand-order";
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
    // Ordered like the settings tab that grants them, which renders the
    // company brand master. `getAllowedBrands` sorts by AccFormBrand.SortOrder,
    // and nothing in this app lets an admin set that column — it is written
    // from the position of each code in whatever array the settings POST
    // carried, i.e. the order the boxes were ticked. See `brand-order.ts`.
    //
    // Here and not in `getAllowedBrands`: AP-1, AP-2, AP-3 and AP-17 read that
    // same function, as do the ERP config services, and this is AP-4's ask.
    // A failed master read answers [], which orderBrandsForDisplay treats as
    // a no-op — the picker then falls back to the stored order rather than
    // losing a brand, so an unreachable Rocks_Codex costs ordering, not work.
    const [data, master] = await Promise.all([
      getAllowedBrands(AP4_FORM_CODE),
      listAllBrands().catch(() => []),
    ]);
    return NextResponse.json({
      ok: true,
      data: orderBrandsForDisplay(data, master.map((b) => b.brandCode)),
    });
  } catch (e) {
    console.error("[api/request/reimburse/options/brands] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
