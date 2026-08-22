import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { listBrandAccounts, upsertBrandAccount } from "@/lib/acc/brand-account-service";

export async function GET(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const brand = req.nextUrl.searchParams.get("brand");
    const data = await listBrandAccounts("gl", brand, "AP-1");
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
    await upsertBrandAccount("gl", { ...body, formCode: "AP-1" }, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/gl-accounts] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
