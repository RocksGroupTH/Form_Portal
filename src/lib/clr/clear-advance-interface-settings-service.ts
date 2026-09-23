import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
import { listBrandErpInterfaceMaps } from "@/lib/acc/brand-erp-interface-map-service";
import { listBrandAccounts } from "@/lib/acc/brand-account-service";
import { AP2_FORM_CODE } from "@/features/advance/constants";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";
import { listClrInterfaceConfig } from "@/lib/clr/clear-advance-interface-config-service";
import {
  bankForBrand,
  deriveClrReady,
  groupClrBankAccountsByBrand,
} from "@/lib/clr/clear-advance-interface-bank-core";

/**
 * One brand's AP-3 Interface ERP view for the settings screen. The target Company
 * (and its BC profile) is inherited read-only from AP-2 (its override) or AP-1's
 * shared mapping — AP-3 only owns the Journal Batch.
 */
export interface ClrInterfaceConfigView {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  /** BC target Company (ส่งเข้าแบรนด์) — inherited from AP-2 / AP-1. */
  interfaceTarget: string;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  /** AP-3's own Journal Batch for the clearing journal. */
  journalBatchName: string | null;
  /** AP-3 GL account for VAT input (ภาษีซื้อ). */
  vatInputGlAccountNo: string | null;
  /** AP-3 GL account for WHT payable. */
  whtPayableGlAccountNo: string | null;
  /**
   * AP-3's own Bank Account (`AccBrandBankAccount`, `FormCode='AP-3'`) — never
   * falls back to the shared default, and never to AP-2's. See
   * `src/lib/clr/clear-advance-bank-account.ts` for why.
   */
  bankAccountNo: string | null;
  /** true when the brand has more than one active AP-3 bank row — fix it in the database, not by picking one. */
  bankConflict: boolean;
  /** true when the Journal Batch, the bank account, and the BC profile are all set. */
  ready: boolean;

  /** Shared AccFormBrand.IsActive (managed on the AP-2 card) — read-only here. */
  active: boolean;
}

export async function listClrInterfaceConfigView(
  /**
   * Which BC half to show or write. Omitted, the environment the request
   * resolves to — always Production for these routes, which `ROUTE_RULES`
   * pins so a config-row id is not read as an AccRequest id. The screen's
   * PRO/UAT toggle is what names the other half; the split is a COLUMN
   * precisely so it does not depend on which database a request resolves.
   */
  environment?: ErpBcEnvironment,
): Promise<ClrInterfaceConfigView[]> {
  const [allBrands, ctx, ap2Maps, clr, ap3Brands, bankRows] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext("AP-3", environment),
    listBrandErpInterfaceMaps(AP2_FORM_CODE),
    listClrInterfaceConfig(),
    listFormBrands("AP-3"),
    listBrandAccounts("bank", null, AP3_FORM_CODE, environment),
  ]);
  const bankByBrand = groupClrBankAccountsByBrand(bankRows);
  const ap2ByCode = new Map(ap2Maps.map((m) => [m.brandCode.toUpperCase(), m]));
  const activeByCode = new Map(ap3Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));

  // Same claim brands AP-2 can post: those mapped in AP-1 ∪ AP-2's overrides.
  /* Registry brands included, for the same reason AP-2's list includes them: the
     only way to create an AccFormBrand row is the toggle on this screen, so a
     brand that has none was invisible and unswitchable. It reads as off. */
  const codes = Array.from(new Set([
    ...Object.keys(ctx.interfaceByClaim),
    ...Array.from(ap2ByCode.keys()),
    ...allBrands.map((b) => b.brandCode.toUpperCase()),
  ])).sort();

  return Promise.all(
    codes.map(async (code) => {
      const master = brandByCode.get(code);
      const cfg = ap2ByCode.get(code);
      const target = (cfg?.interfaceBrandCode ?? ctx.interfaceByClaim[code] ?? code).toUpperCase();
      const profile = await resolveErpTargetProfile(target, "AP-3");
      const journalBatchName = clr[code]?.journalBatchName ?? null;
      const bank = bankForBrand(bankByBrand, code);
      return {
        brandCode: code,
        brandName: master?.brandName ?? code,
        brandLogo: master?.brandLogo ?? null,
        interfaceTarget: target,
        bcName: profile?.bcName ?? null,
        bcConnectionName: profile?.bcConnectionName ?? null,
        bcProfileComplete: profile?.profileComplete ?? false,
        environment: profile?.environment ?? null,
        journalBatchName,
        vatInputGlAccountNo: clr[code]?.vatInputGlAccountNo ?? null,
        whtPayableGlAccountNo: clr[code]?.whtPayableGlAccountNo ?? null,
        bankAccountNo: bank.bankAccountNo,
        bankConflict: bank.bankConflict,
        ready: deriveClrReady({
          journalBatchName,
          bank,
          profileComplete: profile?.profileComplete ?? false,
        }),
        active: activeByCode.get(code) ?? false,
      } satisfies ClrInterfaceConfigView;
    }),
  );
}
