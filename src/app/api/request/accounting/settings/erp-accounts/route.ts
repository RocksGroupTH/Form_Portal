import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { listErpInterfaceBrands } from "@/lib/acc/erp-interface-brands";
import {
  listErpAccountOptions,
  listErpAccountsForBrands,
  type ErpAccountCategory,
} from "@/lib/erp/account-sync";
import { listErpBranchesForBrands, listErpDepartmentsForBrands } from "@/lib/erp/dimension-sync";
import {
  INVALID_ERP_ENVIRONMENT_ERROR,
  parseErpBcEnvironment,
} from "@/lib/acc/brand-erp-environment";

/** GET /api/request/accounting/settings/erp-accounts?brand=PCTH&category=GL */
/**
 * `?environment=` names which Business Central the PICKERS offer from — the
 * mirror half in `Rocks_ERP_Data`, split by `SourceEnvironment` since
 * migration 159.
 *
 * The Interface ERP settings screens pass it because their own routes are
 * pinned to Production in `ROUTE_RULES`, so without it an admin configuring
 * the UAT half would be choosing from PRODUCTION's batch names and account
 * numbers — and storing them as UAT's, which is exactly the wrong-company
 * value the split exists to keep out. Absent resolves the request's own
 * environment, which is what every other caller does.
 */
export async function GET(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const brand = req.nextUrl.searchParams.get("brand");
    const category = req.nextUrl.searchParams.get("category") as ErpAccountCategory | null;

    const environment = parseErpBcEnvironment(req.nextUrl.searchParams.get("environment"));
    if (environment === null)
      return NextResponse.json({ ok: false, error: INVALID_ERP_ENVIRONMENT_ERROR }, { status: 400 });

    if (brand && category) {
      const data = await listErpAccountOptions(brand, category, environment);
      return NextResponse.json({ ok: true, data });
    }

    const codes = (await listErpInterfaceBrands()).map((b) => b.id);
    const [accounts, branches, departments] = await Promise.all([
      listErpAccountsForBrands(codes, environment),
      listErpBranchesForBrands(codes, environment),
      listErpDepartmentsForBrands(codes, environment),
    ]);
    const data: Record<string, {
      gl: { accountNo: string; displayName: string | null; bcCategory: string | null }[];
      bank: { accountNo: string; displayName: string | null; bcCategory: string | null }[];
      journalBatch: { batchName: string; displayName: string | null; templateName: string | null }[];
      branch: { code: string; displayName: string | null; dimensionCode: string }[];
      department: { code: string; displayName: string | null; dimensionCode: string }[];
    }> = {};
    for (const code of codes) {
      const key = code.toUpperCase();
      data[key] = {
        gl: accounts[key]?.gl ?? [],
        bank: accounts[key]?.bank ?? [],
        journalBatch: accounts[key]?.journalBatch ?? [],
        branch: branches[key] ?? [],
        department: (departments[key] ?? []).map((d) => ({
          code: d.code,
          displayName: d.displayName,
          dimensionCode: d.dimensionCode,
        })),
      };
    }
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/erp-accounts] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
