import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listErpInterfaceBrands } from "@/lib/acc/erp-interface-brands";

/**
 * GET /api/brands/erp-interface — the brands a claim may be interfaced INTO.
 *
 * **This is not `/api/brands`.** That one answers "which brands may I file
 * against", reads `BrandSetting.IsEnabled`, and is what the picker and
 * `BrandGate` use. This one answers "which brands have a complete Business
 * Central profile", which is a different question with a different source —
 * see `erp-interface-brands.ts` for why keying either on the other's answer is
 * the mistake this whole change exists to stop repeating.
 *
 * It exists because the list stopped being a module constant on 2026-09-23.
 * Fourteen client components rendered `ERP_INTERFACE_BRANDS` directly, and none
 * of them can import its replacement: it reaches a pool, and `@/env` validates
 * the whole environment at import. `useErpInterfaceBrands()` is the one hook
 * they all read it through, so there is a single cache entry rather than
 * fourteen.
 *
 * **`requireAuth`, deliberately, not `requireRole`.** Some of the fourteen are
 * admin screens and some are not — AP-2's Company bar and AP-1's report
 * filters are ordinary work surfaces. What comes back is a list of company
 * codes and names that every one of those screens already renders, and the
 * settings routes behind them keep their own gates: showing a code here grants
 * nothing, exactly as `/api/brands` grants nothing.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const brands = await listErpInterfaceBrands();
    return NextResponse.json({ ok: true, data: brands });
  } catch (err) {
    console.error("[api/brands/erp-interface] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
