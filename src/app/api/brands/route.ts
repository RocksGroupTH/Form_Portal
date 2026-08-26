import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listSelectableBrands } from "@/lib/brand-registry";

/**
 * GET /api/brands — the brands a user may work under.
 *
 * This is what replaced the `BRANDS` array literal for `BrandGate` and the
 * navbar switcher. Enabled brands only: a brand an admin has switched off must
 * disappear from the picker, which is the whole point of the switch.
 *
 * Deliberately **not** the same list as AP-1's แบรนด์ที่เบิกได้ tab, which shows
 * disabled brands too so an existing grant stays visible — see `listAllBrands`.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const brands = await listSelectableBrands();
    return NextResponse.json({
      ok: true,
      data: brands.map((b) => ({ id: b.code, name: b.name, logo: b.logo })),
    });
  } catch (err) {
    console.error("[api/brands] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
