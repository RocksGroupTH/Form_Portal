import { NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { getMultiBrandDepartmentMappingPage } from "@/lib/acc/department-map-service";

/**
 * GET /api/request/accounting/settings/departments — the HR ↔ ERP mapping list.
 *
 * The read half of the `departments` grant, and the whole of it: the save
 * (`departments/map`, PUT) went back to admin-only on 2026-08-20 because it
 * writes the configuration database two sibling applications read to prepare
 * financial journal postings. A granted approver sees the mappings; an admin
 * changes them.
 */
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
