import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { AP2_FORM_CODE } from "@/features/advance/constants";

/** GET /api/request/advance/options/brands — brands enabled for AP-2 via
 *  AccFormBrand (per-form subset), same convention as AP-1/AP-3. Using the
 *  full brand master would leak brands not yet set up for AP-2 (no G/L, bank,
 *  or journal batch), which can be selected but can't post to BC. */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await getAllowedBrands(AP2_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
