import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listAllBrands } from "@/lib/acc/brand-options";

/** GET /api/request/advance/options/brands — all active brands from the company
 *  brand master (Rocks_Codex.dbo.Brand), not a per-form AccFormBrand subset. */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await listAllBrands();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
