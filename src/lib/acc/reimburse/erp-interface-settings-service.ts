import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import {
  listBrandErpInterfaceMaps,
  upsertFormBrandErpInterfaceMap,
} from "@/lib/acc/brand-erp-interface-map-service";
import { listBrandAccounts, mergeFormBrandAccount } from "@/lib/acc/brand-account-service";
import { listBrandBranches, mergeFormBrandBranch } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches, mergeFormBrandBatch } from "@/lib/acc/brand-journal-batch-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * AP-4's own Business Central posting configuration — the journal batch, bank
 * account and branch code a reimbursement claim resolves to, per claimable
 * brand.
 *
 * This is `src/lib/adv/advance-interface-settings-service.ts` (AP-2's
 * equivalent) mirrored for AP-4, and its shape is copied deliberately, not
 * reinvented — read that file's comments before changing this one. Two
 * things carry over unchanged:
 *
 * - **No G/L account field.** AP-2 dropped it because Business Central
 *   resolves the debit account from the matched vendor's posting group, not
 *   from a configured G/L. AP-4 has no send path yet at all (CLAUDE.md: "AP-4
 *   never reaches Business Central, deliberately") — this service is
 *   preparatory configuration for whenever that changes, not a live posting
 *   path — but there is no reason to expect AP-4's eventual payload to need a
 *   G/L account that AP-2's does not, so the field is left out here too
 *   rather than added speculatively.
 * - **The display read bypasses `ctx.brandAccounts` for journal batch, bank
 *   account and branch code**, reading `listBrandJournalBatches` /
 *   `listBrandAccounts("bank", ...)` / `listBrandBranches` directly instead.
 *   `loadErpJournalBuildContext`'s `resolveJournalBatchName` looks up a
 *   journal batch by the *interface* brand a claim brand maps to (ROCKS →
 *   PCTH), not by the claim brand itself — correct for AP-1's shared
 *   defaults, but wrong for AP-4's own per-form override, which
 *   `mergeFormBrandBatch` stores keyed on the *claim* brand. Reading through
 *   the shared context here would show one figure while an override saved
 *   underneath it took effect — the exact AP-2 failure ("the screen displayed
 *   TRAVELING while the payload correctly sent BEE") this service exists not
 *   to repeat.
 */

export interface ReimburseErpInterfaceRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  /** The Brand Config target this claim brand's journal posts against. */
  interfaceTarget: string;
  /** True when `interfaceTarget` is AP-4's own override, not the shared default. */
  targetFromReimburse: boolean;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;
  /** Bank account + journal batch configured, and the BC target profile complete. */
  ready: boolean;
  /** `AccFormBrand.IsActive` for this brand under AP-4 — a deactivated brand still shows its saved configuration. */
  active: boolean;
}

/**
 * One row per brand `AccFormBrand` has ever granted to AP-4, active or not —
 * `listFormBrands("AP-4")`, never `BRANDS` and never a request body. A
 * deactivated brand keeps its row so an admin re-enabling it does not find
 * its configuration gone.
 */
export async function loadReimburseErpInterfaceSettings(): Promise<ReimburseErpInterfaceRow[]> {
  const [allBrands, ctx, ifaceMaps, reimburseBrands, branchRows, batchRows, bankRows] =
    await Promise.all([
      listAllBrands(),
      loadErpJournalBuildContext(AP4_FORM_CODE),
      listBrandErpInterfaceMaps(AP4_FORM_CODE),
      listFormBrands(AP4_FORM_CODE),
      listBrandBranches(null, AP4_FORM_CODE),
      listBrandJournalBatches(null, AP4_FORM_CODE),
      listBrandAccounts("bank", null, AP4_FORM_CODE),
    ]);

  const activeByCode = new Map(reimburseBrands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
  // AP-4 self-owns its branch, like AP-2: show only an explicit AP-4 override,
  // never the inherited NULL-default. A blank means "use the requester's
  // mapped ERP dept" — the same fallback `deptAsBranch` describes in
  // erp-journal-context.ts, not a value this screen should invent by reading
  // some other form's default branch.
  const ownBranchByCode = new Map(
    branchRows
      .filter((b) => b.formCode === AP4_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b.branchCode]),
  );
  // Bank and batch read the same way, and for the same reason as the module
  // comment above — see AP-2's precedent for why the shared context cannot be
  // trusted for either once a per-form override exists.
  const ownBatchByCode = new Map(
    batchRows
      .filter((b) => b.formCode === AP4_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b.batchName]),
  );
  const ownBankByCode = new Map(
    bankRows
      .filter((b) => b.formCode === AP4_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b.accountNo]),
  );
  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));
  const ifaceByCode = new Map(ifaceMaps.map((m) => [m.brandCode.toUpperCase(), m]));

  const codes: string[] = [];
  const seen = new Set<string>();
  for (const b of reimburseBrands) {
    const c = b.brandCode.toUpperCase();
    if (!seen.has(c)) { seen.add(c); codes.push(c); }
  }

  const rows = await Promise.all(
    codes.map(async (code) => {
      const master = brandByCode.get(code);
      const base = ctx.brandAccounts[code];
      const ifaceRow = ifaceByCode.get(code);

      const targetFromReimburse = ifaceRow?.formCode === AP4_FORM_CODE;
      const target = (ifaceRow?.interfaceBrandCode ?? code).toUpperCase();
      const profile = await resolveErpTargetProfile(target, AP4_FORM_CODE);

      // An AP-4 row wins; with none, fall back to what the shared context
      // resolved so a brand that has never overridden anything still reads
      // as the default it would otherwise inherit.
      const bankAccountNo    = ownBankByCode.get(code) ?? base?.bankAccountNo ?? null;
      const branchCode       = ownBranchByCode.get(code) ?? null;
      const journalBatchName = ownBatchByCode.get(code) ?? base?.journalBatchName ?? null;

      const ready = !!(bankAccountNo && journalBatchName && profile?.profileComplete);

      return {
        brandCode: code,
        brandName: master?.brandName ?? code,
        brandLogo: master?.brandLogo ?? null,
        interfaceTarget: target,
        targetFromReimburse,
        bcName: profile?.bcName ?? null,
        bcConnectionName: profile?.bcConnectionName ?? null,
        bcProfileComplete: profile?.profileComplete ?? false,
        environment: profile?.environment ?? null,
        branchCode,
        bankAccountNo,
        journalBatchName,
        ready,
        active: activeByCode.get(code) ?? false,
      } satisfies ReimburseErpInterfaceRow;
    }),
  );
  return rows;
}

export interface ReimburseErpInterfaceSaveInput {
  brandCode: string;
  interfaceBrandCode: string;
  bankAccountNo: string;
  branchCode: string | null;
  journalBatchName: string | null;
}

/**
 * Save AP-4's ERP interface config for one brand into the shared per-form
 * tables — through the merge helpers only, never `upsertBrandAccount` (which
 * has no `formCode` parameter and would silently write a shared default
 * instead of an AP-4 override).
 *
 * Does **not** call `assertClaimBrandAllowed` or otherwise check that
 * `input.brandCode` is one AP-4 may claim against — the same choice
 * `upsertFormBrandErpInterfaceMap`'s own docblock makes, on the grounds that
 * the caller's brand already comes from `listFormBrands("AP-4")`. That is
 * true of nothing in this file; it is the responsibility of the route that
 * calls this function (not yet written) to source `brandCode` from
 * `listFormBrands(AP4_FORM_CODE)` — never from `BRANDS` and never trusted
 * verbatim off the request body.
 */
export async function saveReimburseErpInterfaceSettings(
  input: ReimburseErpInterfaceSaveInput,
  userId: number,
): Promise<void> {
  const brandCode = input.brandCode.trim().toUpperCase();
  await Promise.all([
    upsertFormBrandErpInterfaceMap(brandCode, input.interfaceBrandCode, AP4_FORM_CODE, userId),
    mergeFormBrandAccount("bank", brandCode, AP4_FORM_CODE, input.bankAccountNo, null, userId),
    mergeFormBrandBranch(brandCode, AP4_FORM_CODE, input.branchCode || null, userId),
    mergeFormBrandBatch(brandCode, AP4_FORM_CODE, input.journalBatchName || null, userId),
  ]);
}
