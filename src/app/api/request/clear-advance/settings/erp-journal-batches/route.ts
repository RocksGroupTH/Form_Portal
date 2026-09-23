import { NextRequest, NextResponse } from "next/server";
import { requireAdvClrSettingsTab } from "@/lib/adv/require-adv-clr-settings-tab";
import { resolveSettingsErpEnvironment } from "@/lib/acc/erp-environment";
import {
  listClrErpJournalBatches,
  listClrErpJournalBatchesForCompany,
} from "@/lib/clr/clear-advance-admin-service";

/** Gated on `clearErpInterface` since 2026-09-22 — the other option list AP-3's
 *  Interface ERP tab picks from, for the reason `erp-gl-accounts` gives. It
 *  READS the Business Central mirror and writes nothing.
 *
 *  GET active General Journal Batches from Rocks_ERP_Data.dbo.ErpGeneralJournalBatch.
 *  ?company=PCTH — an already-resolved target Company (preferred; matches the
 *    Company AP-3 inherits from AP-2, so the batch list stays consistent).
 *  ?brand=ROCKS  — a claim brand, resolved to its Company via interfaceByClaim. */
export async function GET(req: NextRequest) {
  const session = await requireAdvClrSettingsTab("clearErpInterface");
  if (session instanceof Response) return session;
  try {
    const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    if (company) {
      const data = await listClrErpJournalBatchesForCompany(company, environment);
      return NextResponse.json({ ok: true, data });
    }
    const brand = (req.nextUrl.searchParams.get("brand") ?? "").trim();
    if (!brand) return NextResponse.json({ ok: true, data: [] });
    const data = await listClrErpJournalBatches(brand, environment);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-journal-batches] GET", err);
    return NextResponse.json({ ok: false, error: "ดึง Journal Batch ไม่สำเร็จ" }, { status: 500 });
  }
}
