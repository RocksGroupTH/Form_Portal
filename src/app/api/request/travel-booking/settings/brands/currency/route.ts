import { NextRequest, NextResponse } from "next/server";
import { requireBookingSettingsTab } from "@/lib/acc/travel-booking/require-booking-settings-tab";
import {
  addBrandCurrency,
  BrandCurrencyError,
  listBrandRegistry,
  setBrandCurrencyDefault,
  setBrandCurrencyEnabled,
} from "@/lib/brand-registry";
import {
  parseBrandCurrencyAdd,
  parseBrandCurrencyDefault,
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
 *
 * **It has no `DELETE` either**, and for the reason AP-1's twin gives: a
 * configured currency cannot be removed, only switched off. That matters more
 * here than there, because these rows are the *other* form's configuration too
 * — a removal made from this tab would have been unrecoverable from AP-1's.
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

/**
 * Change one configured currency: switch it on or off, or make it the brand's
 * default.
 *
 * **Two bodies on one method rather than a fifth method.** `{ id, isEnabled }`
 * and `{ id, isDefault: true }` are the same act — "this row's state changes" —
 * and the alternative was `PUT` for the default, which reads as "replace the
 * collection" and is the shape this route deliberately stopped being on
 * 2026-08-28. The presence of `isDefault` picks the branch; a body carrying
 * neither is a 400 from `parseBrandCurrencyToggle`.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireBookingSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const body = await req.json().catch(() => null);
    const context = { formCode: AP17_FORM_CODE, userId: Number(session.user.id) };

    if (body && typeof body === "object" && "isDefault" in (body as object)) {
      const asDefault = parseBrandCurrencyDefault(body);
      if (!asDefault.ok) {
        return NextResponse.json({ ok: false, error: asDefault.error }, { status: 400 });
      }
      await setBrandCurrencyDefault(asDefault.id, context);
      return NextResponse.json({ ok: true });
    }

    const parsed = parseBrandCurrencyToggle(body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await setBrandCurrencyEnabled(parsed.id, parsed.isEnabled, context);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/travel-booking/settings/brands/currency] PATCH", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
