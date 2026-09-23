import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { listBrandAccounts, upsertBrandAccount } from "@/lib/acc/brand-account-service";
import {
  INVALID_ERP_ENVIRONMENT_ERROR,
  parseErpBcEnvironment,
} from "@/lib/acc/brand-erp-environment";

/**
 * AP-1's G/L account settings, per Business Central environment since migration 161.
 *
 * `?environment=` names which half the screen is editing. **Absent resolves the
 * request's own environment**, which is what every caller that predates the
 * PRO/UAT toggle does and what keeps them correct. An unrecognised value is a
 * 400 rather than a fallback: this route is pinned to Production in
 * `ROUTE_RULES`, so quietly defaulting would answer the Production half to a
 * screen that asked for Sandbox, with a 200 and a real list.
 */

export async function GET(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const brand = req.nextUrl.searchParams.get("brand");
    const environment = parseErpBcEnvironment(req.nextUrl.searchParams.get("environment"));
    if (environment === null)
      return NextResponse.json({ ok: false, error: INVALID_ERP_ENVIRONMENT_ERROR }, { status: 400 });

    const data = await listBrandAccounts("gl", brand, "AP-1", environment);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/gl-accounts] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    // This settings page manages AP-1's G/L accounts; pin the form so rows are
    // written and resolved under FormCode='AP-1' (AP-2 has its own settings page).
    const environment = parseErpBcEnvironment(body?.environment);
    if (environment === null)
      return NextResponse.json({ ok: false, error: INVALID_ERP_ENVIRONMENT_ERROR }, { status: 400 });

    await upsertBrandAccount("gl", { ...body, formCode: "AP-1", environment }, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/gl-accounts] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
