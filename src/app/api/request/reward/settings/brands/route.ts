import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listFormBrands, setFormBrands } from "@/lib/acc/settings-service";
import { AP11_FORM_CODE } from "@/features/reward/constants";

/**
 * Which brands AP-11 is open for.
 *
 * AP-1's equivalent route hardcodes `AP1_FORM_CODE`, so AP-11 cannot borrow it —
 * hence this near-duplicate. Both call the same `listFormBrands`/`setFormBrands`
 * service, which is where the dual-write to the UAT database happens:
 * `AccFormBrand` **is** one of the 19 shared masters, unlike `AccReward`.
 *
 * Admin-only, matching AP-1: opening a form for a brand decides who may file
 * against that company's stock at all.
 */
const ADMIN_ROLES = ["IT Admin", "System Admin"] as const;

export async function GET() {
  const session = await requireRole([...ADMIN_ROLES]);
  if (session instanceof Response) return session;

  try {
    const data = await listFormBrands(AP11_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/settings/brands] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole([...ADMIN_ROLES]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    if (!Array.isArray(body?.brandCodes)) {
      return NextResponse.json(
        { ok: false, error: "brandCodes must be an array" },
        { status: 400 },
      );
    }
    await setFormBrands(AP11_FORM_CODE, body.brandCodes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reward/settings/brands] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
