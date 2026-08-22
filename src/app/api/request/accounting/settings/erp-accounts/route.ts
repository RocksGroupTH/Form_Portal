import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  listErpAccountOptions,
  listErpAccountsForBrands,
  type ErpAccountCategory,
} from "@/lib/erp/account-sync";
import { listErpBranchesForBrands, listErpDepartmentsForBrands } from "@/lib/erp/dimension-sync";

/** GET /api/request/accounting/settings/erp-accounts?brand=PCTH&category=GL */
export async function GET(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const brand = req.nextUrl.searchParams.get("brand");
    const category = req.nextUrl.searchParams.get("category") as ErpAccountCategory | null;

    if (brand && category) {
      const data = await listErpAccountOptions(brand, category);
      return NextResponse.json({ ok: true, data });
    }

    const codes = ERP_INTERFACE_BRANDS.map((b) => b.id);
    const [accounts, branches, departments] = await Promise.all([
      listErpAccountsForBrands(codes),
      listErpBranchesForBrands(codes),
      listErpDepartmentsForBrands(codes),
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
