import { NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { getMultiBrandDepartmentMappingPage } from "@/lib/acc/department-map-service";

/** GET /api/request/accounting/settings/departments */
export async function GET() {
  const session = await requireSettingsTab("departments");
  if (session instanceof Response) return session;

  try {
    const data = await getMultiBrandDepartmentMappingPage();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/.../departments] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
