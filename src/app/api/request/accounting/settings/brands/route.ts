import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { listFormBrands, setFormBrands } from "@/lib/acc/settings-service";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * GET /api/request/accounting/settings/brands
 * Returns the brand list configured for the AP-1 form.
 * Requires an admin, or the `brands` settings-tab grant.
 */
export async function GET() {
  const session = await requireSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const data = await listFormBrands(AP1_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/brands] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/request/accounting/settings/brands
 * Sets the active brand codes for the AP-1 form.
 * Body: { brandCodes: string[] }
 * Requires an admin, or the `brands` settings-tab grant.
 */
export async function POST(req: NextRequest) {
  const session = await requireSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    await setFormBrands(AP1_FORM_CODE, body.brandCodes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/accounting/settings/brands] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
