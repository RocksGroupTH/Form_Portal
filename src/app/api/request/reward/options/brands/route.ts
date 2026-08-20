import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { AP11_FORM_CODE } from "@/features/reward/constants";

/* ── GET /api/request/reward/options/brands ── */

/**
 * Brands AP-11 is open for, from `AccFormBrand`.
 *
 * A brand with no row here offers nothing, which is the intended state until an
 * admin opens the form for that company — rewards are brand-scoped stock, so
 * "which brands may file" and "whose stock is on offer" are the same question.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await getAllowedBrands(AP11_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[api/request/reward/options/brands] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
