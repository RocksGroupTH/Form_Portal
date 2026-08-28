import { NextRequest, NextResponse } from "next/server";
import { requireBookingSettingsTab } from "@/lib/acc/travel-booking/require-booking-settings-tab";
import {
  addBrandCurrency,
  BrandCurrencyError,
  listBrandRegistry,
  removeBrandCurrency,
  setBrandCurrencyEnabled,
} from "@/lib/brand-registry";
import {
  parseBrandCurrencyAdd,
  parseBrandCurrencyId,
  parseBrandCurrencyToggle,
} from "@/lib/acc/brand-currency-input";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/**
 * AP-17's twin of `/api/request/accounting/settings/brands/currency`, pointed at
 * a different form code and gated on AP-17's own roster.
 *
 * **The rows it writes are the same rows.** A brand's currencies live once, in
 * `BrandCurrency` (spec §2, the user's choice), so a change made from this tab
 * changes what an **AP-1** travel claim may be filed in — on a roster AP-1's
 * admins do not control. Spec §9.3 took that knowingly: the gate stays
 * `requireBookingSettingsTab("brands")` on every method and must not be
 * tightened to `requireRole`. What makes it safe enough is that it is visible —
 * the panel says the values are shared with the other form — and traceable,
 * because every write stamps `AP-17` into the `BrandSettingLog` row it commits
 * with.
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
        currencies: b.currencies,
      })),
    });
  } catch (err) {
    console.error("[api/request/travel-booking/settings/brands/currency] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** Add one currency to a brand. Duplicates are refused by the unique constraint. */
export async function POST(req: NextRequest) {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyAdd(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await addBrandCurrency(parsed.value, {
      formCode: AP17_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/travel-booking/settings/brands/currency] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** Switch one configured currency on or off. */
export async function PATCH(req: NextRequest) {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyToggle(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await setBrandCurrencyEnabled(parsed.id, parsed.isEnabled, {
      formCode: AP17_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/travel-booking/settings/brands/currency] PATCH", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** Remove one configured currency. `?id=` — see AP-1's twin for why not a body. */
export async function DELETE(req: NextRequest) {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyId(req.nextUrl.searchParams.get("id"));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await removeBrandCurrency(parsed.id, {
      formCode: AP17_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/travel-booking/settings/brands/currency] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
