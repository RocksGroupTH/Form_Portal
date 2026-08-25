import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  listAdvErpMaster,
  listAdvErpMasterForCompanies,
} from "@/lib/adv/advance-erp-master-service";

/**
 * GET /api/request/advance/settings/erp-master
 *   → { ok, data: Record<Company, { gl, bank, branch, journalBatch }> } for all
 *     ERP interface companies, read from Rocks_ERP_Data's four Erp* tables.
 * GET ?company=PCTH → just that company's master ({ ok, data: {...} }).
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
    if (company) {
      const data = await listAdvErpMaster(company);
      return NextResponse.json({ ok: true, data });
    }
    const companies = ERP_INTERFACE_BRANDS.map((b) => b.id);
    const data = await listAdvErpMasterForCompanies(companies);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-master] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงข้อมูล ERP ไม่สำเร็จ" }, { status: 500 });
  }
}
