import { listAllBrands } from "@/lib/acc/brand-options";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { listAdvanceInterfaceConfig } from "@/lib/adv/advance-interface-config-service";
import { resolveFormAccess } from "@/lib/form-environment";

/**
 * One brand's AP-2 Interface ERP configuration for the settings screen.
 *
 * Target Company, G/L, Bank and Journal Batch are AP-2's own
 * (AccAdvanceInterfaceConfig), each shown falling back to AP-1's shared config
 * when AP-2 hasn't set its own. Branch is always inherited from AP-1.
 */
export interface AdvanceInterfaceConfigView {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;

  /** Effective target Company (ส่งเข้าแบรนด์) + whether it is AP-2's own override. */
  interfaceTarget: string;
  targetFromAp2: boolean;

  // ── resolved from the (effective) target — read-only ──
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;

  // ── AP-2's own (editable), shown falling back to AP-1 ──
  glAccountNo: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;

  /** true when everything needed to post this brand to BC is present. */
  ready: boolean;
}

export async function listAdvanceInterfaceConfigView(): Promise<AdvanceInterfaceConfigView[]> {
  const [allBrands, ctx, ap2, ap2Access] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext(),
    listAdvanceInterfaceConfig(),
    // The settings route is Production-pinned for DB reads, so resolve AP-2's OWN
    // form environment here — the label (and BC target profile) then matches what
    // the send actually uses: UAT mode → Sandbox, otherwise Production.
    resolveFormAccess("AP-2"),
  ]);
  const ap2Environment: ErpBcEnvironment = ap2Access.environment === "UAT" ? "Sandbox" : "Production";
  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));

  // Claim brands that can post = those mapped in AP-1 ∪ those AP-2 has overridden.
  const codes = Array.from(new Set([
    ...Object.keys(ctx.interfaceByClaim),
    ...Object.keys(ap2),
  ])).sort();

  const rows = await Promise.all(
    codes.map(async (code) => {
      const master = brandByCode.get(code);
      const base = ctx.brandAccounts[code];
      const cfg = ap2[code];

      const targetFromAp2 = !!cfg?.interfaceBrandCode;
      const target = (cfg?.interfaceBrandCode ?? ctx.interfaceByClaim[code] ?? code).toUpperCase();
      const profile = await resolveErpTargetProfile(target, ap2Environment);

      const glAccountNo = cfg?.glAccountNo ?? base?.glAccountNo ?? null;
      const bankAccountNo = cfg?.bankAccountNo ?? base?.bankAccountNo ?? null;
      const journalBatchName = cfg?.journalBatchName ?? base?.journalBatchName ?? null;
      const branchCode = cfg?.branchCode ?? base?.branchCode ?? null;

      // Description is not part of AP-2 config — the journal uses the request's purpose.
      const ready = !!(
        glAccountNo && bankAccountNo && journalBatchName
        && branchCode && profile?.profileComplete
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
      } satisfies AdvanceInterfaceConfigView;
    }),
  );
  return rows;
}
