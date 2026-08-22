import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { listBrandErpInterfaceMaps, upsertFormBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { mergeFormBrandAccount } from "@/lib/acc/brand-account-service";
import { mergeFormBrandBranch } from "@/lib/acc/brand-branch-service";
import { mergeFormBrandBatch } from "@/lib/acc/brand-journal-batch-service";
import { AP2_FORM_CODE } from "@/features/advance/constants";

export interface AdvanceInterfaceConfigView {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  targetFromAp2: boolean;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;
  glAccountNo: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;
  ready: boolean;
  active: boolean;
}

export async function listAdvanceInterfaceConfigView(): Promise<AdvanceInterfaceConfigView[]> {
  const [allBrands, ctx, ifaceMaps, ap2Brands] =
    await Promise.all([
      listAllBrands(),
      loadErpJournalBuildContext(AP2_FORM_CODE),
      listBrandErpInterfaceMaps(AP2_FORM_CODE),
      listFormBrands(AP2_FORM_CODE),
    ]);

  const activeByCode = new Map(ap2Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));
  const ifaceByCode = new Map(ifaceMaps.map((m) => [m.brandCode.toUpperCase(), m]));

  const codes: string[] = [];
  const seen = new Set<string>();
  for (const b of ap2Brands) {
    const c = b.brandCode.toUpperCase();
    if (!seen.has(c)) { seen.add(c); codes.push(c); }
  }

  const rows = await Promise.all(
    codes.map(async (code) => {
      const master = brandByCode.get(code);
      const base = ctx.brandAccounts[code];
      const ifaceRow = ifaceByCode.get(code);

      const targetFromAp2 = ifaceRow?.formCode === AP2_FORM_CODE;
      const target = (ifaceRow?.interfaceBrandCode ?? code).toUpperCase();
      const profile = await resolveErpTargetProfile(target, AP2_FORM_CODE);

      const glAccountNo     = base?.glAccountNo ?? null;
      const bankAccountNo   = base?.bankAccountNo ?? null;
      const branchCode      = base?.branchCode ?? null;
      const journalBatchName = base?.journalBatchName ?? null;

      const ready = !!(
        glAccountNo && bankAccountNo && journalBatchName &&
        branchCode && profile?.profileComplete
      );

      return {
        brandCode: code,
        brandName: master?.brandName ?? code,
        brandLogo: master?.brandLogo ?? null,
        interfaceTarget: target,
        targetFromAp2,
        bcName: profile?.bcName ?? null,
        bcConnectionName: profile?.bcConnectionName ?? null,
        bcProfileComplete: profile?.profileComplete ?? false,
        environment: profile?.environment ?? null,
        branchCode,
        glAccountNo,
        bankAccountNo,
        journalBatchName,
        ready,
        active: activeByCode.get(code) ?? false,
      } satisfies AdvanceInterfaceConfigView;
    }),
  );
  return rows;
}

/** Save AP-2's ERP interface config for one brand into the shared per-form tables. */
export async function saveAdvanceInterfacePerForm(
  brandCode: string,
  values: {
    interfaceBrandCode: string;
    glAccountNo: string;
    bankAccountNo: string;
    branchCode: string | null;
    journalBatchName: string | null;
  },
  userId: number,
): Promise<void> {
  await Promise.all([
    upsertFormBrandErpInterfaceMap(brandCode, values.interfaceBrandCode, AP2_FORM_CODE, userId),
    mergeFormBrandAccount("gl",   brandCode, AP2_FORM_CODE, values.glAccountNo, null, userId),
    mergeFormBrandAccount("bank", brandCode, AP2_FORM_CODE, values.bankAccountNo, null, userId),
    mergeFormBrandBranch(brandCode, AP2_FORM_CODE, values.branchCode || null, userId),
    mergeFormBrandBatch(brandCode, AP2_FORM_CODE, values.journalBatchName || null, userId),
  ]);
}
