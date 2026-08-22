import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { listAdvanceInterfaceConfig } from "@/lib/adv/advance-interface-config-service";
import { AP2_FORM_CODE } from "@/features/advance/constants";
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

  /** AccFormBrand.IsActive — whether the brand is selectable in the request forms. */
  active: boolean;
}

export async function listAdvanceInterfaceConfigView(): Promise<AdvanceInterfaceConfigView[]> {
  const [allBrands, ctx, ap2, ap2Access, ap2Brands] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext("AP-2"),
    listAdvanceInterfaceConfig(),
    // The settings route is Production-pinned for DB reads, so resolve AP-2's OWN
    // form environment here — the label (and BC target profile) then matches what
    // the send actually uses: UAT mode → Sandbox, otherwise Production.
    resolveFormAccess("AP-2"),
    // The card list is AP-2's OWN brand set (AccFormBrand FormCode='AP-2'),
    // not AP-1's — same convention as the AP-2 request-form brand picker.
    listFormBrands(AP2_FORM_CODE), // ALL rows incl. inactive → disabled cards stay visible
  ]);
  const activeByCode = new Map(ap2Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
  const ap2Environment: ErpBcEnvironment = ap2Access.environment === "UAT" ? "Sandbox" : "Production";
  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));

  // Cards = AP-2's own enabled brands (in their AccFormBrand SortOrder) ∪ any
  // brand that already has an AP-2 interface config row (so none is orphaned).
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const b of ap2Brands) {
    const c = b.brandCode.toUpperCase();
    if (!seen.has(c)) { seen.add(c); codes.push(c); }
  }
  for (const c of Object.keys(ap2)) {
    const up = c.toUpperCase();
    if (!seen.has(up)) { seen.add(up); codes.push(up); }
  }

  const rows = await Promise.all(
    codes.map(async (code) => {
      const master = brandByCode.get(code);
      const base = ctx.brandAccounts[code];
      const cfg = ap2[code];

      const targetFromAp2 = !!cfg?.interfaceBrandCode;
      const target = (cfg?.interfaceBrandCode ?? ctx.interfaceByClaim[code] ?? code).toUpperCase();
      const profile = await resolveErpTargetProfile(target, "AP-2");

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
        active: activeByCode.get(code) ?? false,
      } satisfies AdvanceInterfaceConfigView;
    }),
  );
  return rows;
}
