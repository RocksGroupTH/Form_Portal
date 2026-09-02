import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { listBrandErpInterfaceMaps, upsertFormBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { listBrandAccounts, mergeFormBrandAccount } from "@/lib/acc/brand-account-service";
import { listBrandBranches, mergeFormBrandBranch } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches, mergeFormBrandBatch } from "@/lib/acc/brand-journal-batch-service";
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
  bankAccountNo: string | null;
  journalBatchName: string | null;
  ready: boolean;
  active: boolean;
}

export async function listAdvanceInterfaceConfigView(): Promise<AdvanceInterfaceConfigView[]> {
  const [allBrands, ctx, ifaceMaps, ap2Brands, branchRows, batchRows, bankRows] =
    await Promise.all([
      listAllBrands(),
      loadErpJournalBuildContext(AP2_FORM_CODE),
      listBrandErpInterfaceMaps(AP2_FORM_CODE),
      listFormBrands(AP2_FORM_CODE),
      listBrandBranches(null, AP2_FORM_CODE),
      listBrandJournalBatches(null, AP2_FORM_CODE),
      listBrandAccounts("bank", null, AP2_FORM_CODE),
    ]);

  const activeByCode = new Map(ap2Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
  // AP-2 self-owns its branch: show only an explicit AP-2 override, never the
  // inherited NULL-default (AP-1's shared branch). A blank means "use the
  // requester's mapped ERP dept" — see loadAdvanceErpContext.
  const ap2BranchByCode = new Map(
    branchRows
      .filter((b) => b.formCode === AP2_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b.branchCode]),
  );
  // Bank and Batch have to be read the same way, and for the same reason. The
  // shared `ctx.brandAccounts` resolves a batch through the interface company
  // (ROCKS → PCTH) and picks a brand's rows by id, so an AP-2 override loses to
  // an older NULL-default and a brand's own batch is never shown at all — the
  // screen said TRAVELING while the payload correctly sent the configured BEE.
  const ap2BatchByCode = new Map(
    batchRows
      .filter((b) => b.formCode === AP2_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b.batchName]),
  );
  const ap2BankByCode = new Map(
    bankRows
      .filter((b) => b.formCode === AP2_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b.accountNo]),
  );
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

      // An AP-2 row wins; with none, fall back to what the shared context
      // resolved so a brand that never overrode anything still reads as before.
      const bankAccountNo   = ap2BankByCode.get(code) ?? base?.bankAccountNo ?? null;
      const branchCode      = ap2BranchByCode.get(code) ?? null;
      const journalBatchName = ap2BatchByCode.get(code) ?? base?.journalBatchName ?? null;

      // Dr posts to the matched Vendor (G/L derived from posting group), so the
      // send-ready gate no longer needs a configured G/L account. Branch is also
      // optional — when unset the payload falls back to the requester's mapped
      // ERP department — so it is not part of the gate either.
      const ready = !!(
        bankAccountNo && journalBatchName && profile?.profileComplete
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
    bankAccountNo: string;
    branchCode: string | null;
    journalBatchName: string | null;
  },
  userId: number,
): Promise<void> {
  await Promise.all([
    upsertFormBrandErpInterfaceMap(brandCode, values.interfaceBrandCode, AP2_FORM_CODE, userId),
    mergeFormBrandAccount("bank", brandCode, AP2_FORM_CODE, values.bankAccountNo, null, userId),
    mergeFormBrandBranch(brandCode, AP2_FORM_CODE, values.branchCode || null, userId),
    mergeFormBrandBatch(brandCode, AP2_FORM_CODE, values.journalBatchName || null, userId),
  ]);
}
