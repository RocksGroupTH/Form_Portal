import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { listAdvanceInterfaceConfig } from "@/lib/adv/advance-interface-config-service";
import { listClrInterfaceConfig } from "@/lib/clr/clear-advance-interface-config-service";

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
  /** true when the Journal Batch is set and the BC profile is complete. */
  ready: boolean;

  /** Shared AccFormBrand.IsActive (managed on the AP-2 card) — read-only here. */
  active: boolean;
}

export async function listClrInterfaceConfigView(): Promise<ClrInterfaceConfigView[]> {
  const [allBrands, ctx, ap2, clr, ap3Brands] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext("AP-3"),
    listAdvanceInterfaceConfig(),
    listClrInterfaceConfig(),
    listFormBrands("AP-3"),
  ]);
  const activeByCode = new Map(ap3Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));

  // Same claim brands AP-2 can post: those mapped in AP-1 ∪ AP-2's overrides.
  const codes = Array.from(new Set([
    ...Object.keys(ctx.interfaceByClaim),
    ...Object.keys(ap2),
  ])).sort();

  return Promise.all(
    codes.map(async (code) => {
      const master = brandByCode.get(code);
      const cfg = ap2[code];
      const target = (cfg?.interfaceBrandCode ?? ctx.interfaceByClaim[code] ?? code).toUpperCase();
      const profile = await resolveErpTargetProfile(target, "AP-3");
      const journalBatchName = clr[code] ?? null;
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
        ready: !!(journalBatchName && profile?.profileComplete),
        active: activeByCode.get(code) ?? false,
      } satisfies ClrInterfaceConfigView;
    }),
  );
}
