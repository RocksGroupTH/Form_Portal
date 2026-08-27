import { NextRequest, NextResponse } from "next/server";
import { requireBookingSettingsTab } from "@/lib/acc/travel-booking/require-booking-settings-tab";
import { listFormBrands, setFormBrands } from "@/lib/acc/settings-service";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/**
 * Which brands AP-17's booking form accepts.
 *
 * AP-1's twin, pointed at a different form code. **Its own route rather than a
 * fifth `[kind]`**: that map is list/upsert/reorder over option rows, and this
 * is a set of codes toggled on and off in `AccFormBrand` — see
 * `settings-tabs.ts`.
 *
 * `AccFormBrand` holds no AP-17 row today and none is seeded, which was a
 * deliberate call: until an admin ticks at least one brand here the booking
 * form has nothing to offer and cannot be submitted. The form says so rather
 * than showing an empty picker.
 */

export async function GET() {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const data = await listFormBrands(AP17_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/travel-booking/settings/brands] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as { brandCodes?: unknown };
    await setFormBrands(AP17_FORM_CODE, body.brandCodes as string[]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/travel-booking/settings/brands] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
