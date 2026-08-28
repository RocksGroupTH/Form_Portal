import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
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
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * The currencies each brand may be claimed in, edited from AP-1's
 * แบรนด์ที่เบิกได้ tab.
 *
 * **Its own path rather than another method on `settings/brands`**: that route
 * reads and replaces a *set of codes* in `AccFormBrand` — which brands this form
 * accepts — and this reads and writes rows in `BrandCurrency`, a production-only
 * table shared with AP-17. Two different tables, two different shapes, and the
 * panel needs both at once.
 *
 * **Four methods because a brand carries several currencies.** `PUT` replaced
 * one triple on `BrandSetting`; a list needs adding to, switching and removing
 * from, and each of those is one row. `DELETE` takes `?id=` rather than a body:
 * a request body on DELETE is legal but not carried by every intermediary, and
 * an id is the whole payload.
 *
 * **The gate is `requireSettingsTab("brands")` on every method, deliberately,
 * and must not be tightened to `requireRole`.** Spec §9.3: the currency is
 * edited wherever แบรนด์ที่เบิกได้ is edited. The asymmetry that creates — the
 * values are per brand while the permission is per form — is a decision the user
 * took knowingly. It is mitigated on screen (both tabs say the values are
 * shared) and in `BrandSettingLog` (every change records which form's tab it
 * came from), because it cannot be mitigated by a constraint.
 */
export async function GET() {
  const session = await requireSettingsTab("brands");
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
    console.error("[api/request/accounting/settings/brands/currency] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** Add one currency to a brand. Duplicates are refused by the unique constraint. */
export async function POST(req: NextRequest) {
  const session = await requireSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyAdd(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await addBrandCurrency(parsed.value, {
      formCode: AP1_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/accounting/settings/brands/currency] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** Switch one configured currency on or off. */
export async function PATCH(req: NextRequest) {
  const session = await requireSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyToggle(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await setBrandCurrencyEnabled(parsed.id, parsed.isEnabled, {
      formCode: AP1_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/accounting/settings/brands/currency] PATCH", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** Remove one configured currency. `?id=` — see the note at the top of this file. */
export async function DELETE(req: NextRequest) {
  const session = await requireSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyId(req.nextUrl.searchParams.get("id"));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await removeBrandCurrency(parsed.id, {
      formCode: AP1_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/accounting/settings/brands/currency] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
