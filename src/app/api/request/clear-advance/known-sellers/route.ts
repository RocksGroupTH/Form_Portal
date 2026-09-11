import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listKnownSellers } from "@/lib/clr/known-seller-service";

/**
 * GET /api/request/clear-advance/known-sellers?brand=ROCKS
 *
 * tax id → seller name, from this brand's approved clearings. The receipt read
 * asks for it once and looks sellers up locally, the way it already does with
 * the vendor cards: the list is a few dozen entries, and a round trip per row
 * would be slower than the read itself.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  if (!brand.trim()) {
    return NextResponse.json({ ok: false, error: "ต้องระบุแบรนด์" }, { status: 400 });
  }

  try {
    const known = await listKnownSellers(brand);
    return NextResponse.json({ ok: true, data: Object.fromEntries(known) });
  } catch (e) {
    console.error("[api/request/clear-advance/known-sellers] GET", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
