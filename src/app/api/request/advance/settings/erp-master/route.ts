import { NextRequest, NextResponse } from "next/server";
import { requireAdvClrSettingsTab } from "@/lib/adv/require-adv-clr-settings-tab";
import { listErpInterfaceBrands } from "@/lib/acc/erp-interface-brands";
import {
  listAdvErpMaster,
  listAdvErpMasterForCompanies,
} from "@/lib/adv/advance-erp-master-service";
import { resolveSettingsErpEnvironment } from "@/lib/acc/erp-environment";

/**
 * GET /api/request/advance/settings/erp-master
 *   → { ok, data: Record<Company, { gl, bank, branch, journalBatch }> } for all
 *     ERP interface companies, read from Rocks_ERP_Data's four Erp* tables.
 * GET ?company=PCTH → just that company's master ({ ok, data: {...} }).
 *
 * **Gated on `advanceErpInterface` since 2026-09-22**, when that tab became
 * grantable: this is the option list AP-2's Interface ERP tab picks from, so
 * leaving it on `requireRole` would have handed out a tab whose every dropdown
 * is empty.
 *
 * **AP-4's Interface ERP panel reads this route too, and its own grant does
 * NOT satisfy this gate.** `ReimburseErpInterfaceSettings` borrows it (see
 * that file's docblock) on the strength of AP-4's tab having been admin-only,
 * and `requireReimburseSettingsTab`'s admin arm being exactly `requireRole`.
 * That is no longer true, so a non-admin holding AP-4's `erpInterface` grant
 * reads AP-4's own configuration and gets `erpFailed` placeholders in the
 * Bank / Branch / Journal Batch pickers here — visible rather than silent,
 * because that panel already distinguishes a failed fetch from an empty one.
 * The same applies to AP-1's `/api/request/accounting/settings/erp-accounts`,
 * which supplies its Fix Dept list. Closing it means either widening these two
 * routes to AP-4's roster or minting AP-4-pathed twins, and BOTH are policy
 * about another form's access model — not something to slip in here.
 *
 * **Which Business Central these lists come FROM follows the navbar's PRO/UAT
 * switch** — the mirror half in `Rocks_ERP_Data`, split by `SourceEnvironment`
 * since migration 159. It has to, or an admin configuring the UAT half would be
 * choosing from PRODUCTION's batch names and account numbers and storing them
 * as UAT's: the wrong-company value migration 161 exists to keep out. See
 * `resolveSettingsErpEnvironment()` for why this route cannot use the ordinary
 * resolver.
 */
export async function GET(req: NextRequest) {
  const session = await requireAdvClrSettingsTab("advanceErpInterface");
  if (session instanceof Response) return session;
  try {
    const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    if (company) {
      const data = await listAdvErpMaster(company, environment);
      return NextResponse.json({ ok: true, data });
    }
    const companies = (await listErpInterfaceBrands()).map((b) => b.id);
    const data = await listAdvErpMasterForCompanies(companies, environment);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-master] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงข้อมูล ERP ไม่สำเร็จ" }, { status: 500 });
  }
}
