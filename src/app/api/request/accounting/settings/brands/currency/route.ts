import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { BrandCurrencyError, listBrandRegistry, saveBrandCurrency } from "@/lib/brand-registry";
import { parseBrandCurrencyBody } from "@/lib/acc/brand-currency-input";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * A brand's country and claim currency, edited from AP-1's แบรนด์ที่เบิกได้ tab.
 *
 * **Its own path rather than another method on `settings/brands`**: that route
 * reads and replaces a *set of codes* in `AccFormBrand` — which brands this form
 * accepts — and this reads and writes *one brand's* row in `BrandSetting`, a
 * production-only table shared with AP-17. Two different tables, two different
 * shapes, and the panel needs both at once.
 *
 * **The gate is `requireSettingsTab("brands")`, deliberately, and must not be
 * tightened to `requireRole`.** Spec §9.3: the currency is edited wherever
 * แบรนด์ที่เบิกได้ is edited. The asymmetry that creates — the value is per
 * brand while the permission is per form — is a decision the user took
 * knowingly. It is mitigated on screen (both tabs say the value is shared) and
 * in `BrandSettingLog` (every change records which form's tab it came from),
 * because it cannot be mitigated by a constraint.
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
        countryCode: b.countryCode,
        currencyCode: b.currencyCode,
        currencyEnabled: b.currencyEnabled,
      })),
    });
  } catch (err) {
    console.error("[api/request/accounting/settings/brands/currency] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await requireSettingsTab("brands");
  if (session instanceof Response) return session;

  try {
    const parsed = parseBrandCurrencyBody(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    await saveBrandCurrency(parsed.brandCode, parsed.patch, {
      formCode: AP1_FORM_CODE,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandCurrencyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/accounting/settings/brands/currency] PUT", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
