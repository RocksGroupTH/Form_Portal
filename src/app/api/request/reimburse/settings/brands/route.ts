import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listFormBrands, setFormBrands } from "@/lib/acc/settings-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * Which brands AP-4 may be claimed against — `AccFormBrand` rows with
 * `FormCode = 'AP-4'`.
 *
 * Deliberately the *same* mechanism as AP-1's `/settings/brands`, calling the
 * same `listFormBrands` / `setFormBrands`: one table, one pair of functions, one
 * dual-write. Only the form code differs. A second implementation here would be
 * a second place for the allowlist to be wrong.
 *
 * Migration 092 seeds a single `ROCKS` row. This endpoint is how that becomes
 * whatever Accounting actually wants — see `/api/request/reimburse/options/brands`
 * for the requester-facing half.
 */

/** Matches AP-1's settings routes, which are the neighbouring precedent. */
const SETTINGS_ROLES = ["IT Admin", "System Admin"] as const;

export async function GET() {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;

  try {
    const data = await listFormBrands(AP4_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/brands] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST { brandCodes: string[] } — the complete active set; anything absent is deactivated. */
export async function POST(req: NextRequest) {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as { brandCodes?: unknown };
    if (!Array.isArray(body.brandCodes)) {
      return NextResponse.json({ ok: false, error: "brandCodes required" }, { status: 400 });
    }
    const codes: string[] = [];
    for (const raw of body.brandCodes) {
      const code = String(raw ?? "").trim();
      if (code) codes.push(code);
    }
    await setFormBrands(AP4_FORM_CODE, codes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reimburse/settings/brands] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
