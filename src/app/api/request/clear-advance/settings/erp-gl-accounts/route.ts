import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listClrErpGlOptions } from "@/lib/clr/clear-advance-admin-service";

/** GET ?brand=PCTH — active GL accounts for a brand from Rocks_ERP_Data.dbo.ErpAccounts. */
export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const brand = (req.nextUrl.searchParams.get("brand") ?? "").trim();
    if (!brand) return NextResponse.json({ ok: true, data: [] });
    const data = await listClrErpGlOptions(brand);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-gl-accounts] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงบัญชี ERP ไม่สำเร็จ" }, { status: 500 });
  }
}
