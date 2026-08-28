import { NextRequest, NextResponse } from "next/server";
import { requireBookingSettingsTab } from "@/lib/acc/travel-booking/require-booking-settings-tab";
import { BrandCurrencyError, listBrandRegistry, saveBrandCurrency } from "@/lib/brand-registry";
import { parseBrandCurrencyBody } from "@/lib/acc/brand-currency-input";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/**
 * AP-17's twin of `/api/request/accounting/settings/brands/currency`, pointed at
 * a different form code and gated on AP-17's own roster.
 *
 * **The row it writes is the same row.** Country and currency live once per
 * brand in `BrandSetting` (spec §2, the user's choice), so a change made from
 * this tab changes what an **AP-1** travel claim converts at — on a roster
 * AP-1's admins do not control. Spec §9.3 took that knowingly: the gate stays
 * `requireBookingSettingsTab("brands")` and must not be tightened to
 * `requireRole`. What makes it safe enough is that it is visible — the panel
 * says the value is shared with the other form — and traceable, because
 * `saveBrandCurrency` stamps `AP-17` into every `BrandSettingLog` row it writes
 * from here.
 */
export async function GET() {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const brands = await listBrandRegistry();
    return NextResponse.json({
      ok: true,
      data: brands.map((b) => ({
        brandCode: b.code,
        brandName: b.name,
        brandLogo: b.logo,
        countryCode: b.countryCode,
        currencyCode: b.currencyCode,
        currencyEnabled: b.currencyEnabled,
      })),
    });
  } catch (err) {
    console.error("[api/request/travel-booking/settings/brands/currency] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyBody(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await saveBrandCurrency(parsed.brandCode, parsed.patch, {
      formCode: AP17_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/travel-booking/settings/brands/currency] PUT", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
