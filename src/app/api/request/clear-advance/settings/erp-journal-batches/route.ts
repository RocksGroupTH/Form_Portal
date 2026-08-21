import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listClrErpJournalBatches,
  listClrErpJournalBatchesForCompany,
} from "@/lib/clr/clear-advance-admin-service";

/** GET active General Journal Batches from Rocks_ERP_Data.dbo.ErpGeneralJournalBatch.
 *  ?company=PCTH — an already-resolved target Company (preferred; matches the
 *    Company AP-3 inherits from AP-2, so the batch list stays consistent).
 *  ?brand=ROCKS  — a claim brand, resolved to its Company via interfaceByClaim. */
export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
    if (company) {
      const data = await listClrErpJournalBatchesForCompany(company);
      return NextResponse.json({ ok: true, data });
    }
    const brand = (req.nextUrl.searchParams.get("brand") ?? "").trim();
    if (!brand) return NextResponse.json({ ok: true, data: [] });
    const data = await listClrErpJournalBatches(brand);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-journal-batches] GET", err);
    return NextResponse.json({ ok: false, error: "ดึง Journal Batch ไม่สำเร็จ" }, { status: 500 });
  }
}
