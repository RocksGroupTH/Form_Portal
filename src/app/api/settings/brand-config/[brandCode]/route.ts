import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { updateBrandConfig, type BrandConfigInput } from "@/lib/brand-config";
import { listBrandRegistry } from "@/lib/brand-registry";

type RouteParams = { params: Promise<{ brandCode: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { brandCode } = await params;
    const code = decodeURIComponent(brandCode).trim().toUpperCase();
    /* **The company brand master decides what a brand is, not `BRANDS`.**
       This read `BRANDS.some((b) => b.id === code && b.enabled)` — the four
       hardcoded in `@/lib/brand` — while the page listing the brands, and
       the three sibling routes beside this one (`enabled`, and the logo
       POST/DELETE), all resolve them from `listBrandRegistry()`. So Settings
       → Brand Configuration offered every active brand, opened a dialog for
       any of them, and then answered **"Invalid brand"** on Save for the
       three the literal does not name. Measured 2026-09-23: the master holds
       seven active brands and the literal four, so ROCKS, PLM and SMR could
       be configured on screen and never saved.

       `brand.ts`'s own docblock had said so since `BrandSetting` shipped —
       *"This is no longer the list of brands … a brand in the picker need not
       be here"* — and this was the last route that had not been moved across.
       The literal now has **no importer left outside `erp-interface-brands`**,
       which is a different question and says so itself.

       Trimmed and percent-decoded like the siblings: this arrives as a path
       segment, and the untrimmed `.toUpperCase()` alone refused a code with
       a trailing space rather than matching it. */
    const brands = await listBrandRegistry();
    if (!code || !brands.some((b) => b.code === code)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }

    const body = (await req.json()) as BrandConfigInput;
    const userId = Number(session.user?.id ?? 0);
    const config = await updateBrandConfig(code, body, userId);
    if (!config) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: config });
  } catch (err) {
    console.error("[api/settings/brand-config/[brandCode]] PATCH", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
