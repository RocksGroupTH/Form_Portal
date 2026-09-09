import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveAllErpTargetProfiles, resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  listBrandErpInterfaceMaps,
  upsertFormBrandErpInterfaceMap,
  deleteBrandErpInterfaceMap,
} from "@/lib/acc/brand-erp-interface-map-service";
import { listBrandAccounts, mergeFormBrandAccount } from "@/lib/acc/brand-account-service";
import { listBrandBranches, mergeFormBrandBranch } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches, mergeFormBrandBatch } from "@/lib/acc/brand-journal-batch-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * AP-4's own Business Central posting configuration, grouped the way AP-1's
 * Interface ERP tab is: one card per interface *target* (PCTH / KSI / PCMY /
 * UNO), each holding the claim brands mapped into it, a shared Journal Batch
 * and the target's BC connection.
 *
 * Read this in full before changing anything here — several decisions below
 * are load-bearing and were carried forward deliberately, not by accident.
 *
 * **The group is a UI grouping over rows that stay keyed on the CLAIM
 * brand — never the target.** Grouping by target is a display choice made in
 * this module and in the settings screen alone; every write this file makes
 * still goes through `upsertFormBrandErpInterfaceMap` / `mergeFormBrandAccount`
 * / `mergeFormBrandBranch` / `mergeFormBrandBatch` addressed by the *claim*
 * brand, with `FormCode = 'AP-4'`. In particular, **the Journal Batch a group
 * shows is not stored once against the target** — `saveReimburseErpGroup`
 * fans one `mergeFormBrandBatch(claimBrand, "AP-4", batch, …)` out per member,
 * writing the identical value under each member's own claim brand. Storing it
 * once under the target brand instead — the way AP-1's own group save
 * (`saveTargetGroup`) does — would walk straight back into a bug AP-2 already
 * shipped once: `resolveJournalBatchName` (`erp-journal-context.ts`) looks a
 * claim brand's journal batch up by its *interface* brand first, and only
 * falls back to the claim brand's own row when that lookup misses. A
 * target-keyed batch is exactly the row that first lookup finds — so the
 * moment any claim brand in the group also carries its own per-form batch
 * override (from an earlier, non-grouped save, or from a future one), that
 * override silently wins over the group's batch for that one brand alone,
 * and the settings screen and the eventual send payload disagree about which
 * batch was used. That is the literal AP-2 failure this module's previous
 * revision already recorded: "the screen displayed TRAVELING while the
 * payload correctly sent BEE." Keying the batch on the claim brand for every
 * member removes the ambiguity `resolveJournalBatchName` would otherwise have
 * to resolve, because there is only ever one row per (claim brand, AP-4) to
 * find.
 *
 * **No G/L account field.** AP-4 already resolves a G/L per expense *line*
 * (`AccReimburseItem.Category`), proposed by the AI document read and
 * corrected by accounting from the queue (`PATCH .../requests/[id]/items`). A
 * per-brand default underneath a per-line answer would be a second answer to
 * a question this form already settles elsewhere. `AccBrandGlAccount` is
 * **read** by AP-4 (through `loadErpJournalBuildContext`, for the `base`
 * fallback below) and never written by it — this module must not gain a G/L
 * write path.
 *
 * **No Description field either**, and not by symmetry alone: the column is
 * `AccBrandGlAccount.ErpDescription` (migration 037), and
 * `AccBrandBankAccount` — the table this module *does* write — carries no
 * `ErpDescription` column at all (migration 059:72-82). With no G/L row for
 * AP-4 to hold it, there is nowhere for a Description to live.
 *
 * **The display read bypasses `ctx.brandAccounts` for journal batch and bank
 * account**, reading `listBrandJournalBatches` / `listBrandAccounts("bank",
 * …)` directly instead — same reason as the batch-keying note above:
 * `loadErpJournalBuildContext`'s resolution can answer with the wrong claim
 * brand's row once a per-form override exists. `ctx.brandAccounts[code]` is
 * still read, but only as the `base` fallback beneath an explicit AP-4-owned
 * row — see the `ready` hazard below.
 *
 * **`ready` is satisfied by AP-1's inherited defaults, on purpose.** A
 * member's `bankAccountNo` and a group's `journalBatchName` both fall back to
 * `base?.…` when AP-4 has no override row of its own, so a brand that has
 * never been touched under AP-4 still reads as configured — inheriting
 * whatever AP-1 already set up for it. That fallback is the intended
 * behaviour, not a gap: it is why AP-4 needed no re-entry of data AP-1
 * already holds. It does mean a group's ครบแล้ว chip can be true for a target
 * with zero rows of its own under `FormCode = 'AP-4'` — every member is
 * simply riding AP-1's configuration.
 *
 * **The save is N×4 independent `writeBothPools` transactions, with no
 * rollback across any of them.** For a group of N members, `saveReimburseErpGroup`
 * calls four separate merge functions per member — the interface mapping, the
 * bank account, the branch/Fix Dept and the journal batch — each its own
 * `writeBothPools` transaction pair. A failure partway through (a Fix Dept
 * validation error on member 3 of 4, say) leaves members 1-2 fully saved and
 * 3-4 untouched, not rolled back. This is inherited from today's per-brand
 * save (`saveReimburseErpInterfaceSettings`, which this replaces, had the
 * identical four-transactions-per-brand shape) — a group simply multiplies it
 * by however many members it has. Not fixed here.
 */

export interface ReimburseErpMemberRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  bankAccountNo: string | null;
  branchCode: string | null;
  deptAsBranch: boolean;
  fixedErpDeptCode: string | null;
}

export interface ReimburseErpGroup {
  targetCode: string;
  targetName: string;
  targetLogo: string | null;
  bcName: string | null;
  bcConnectionName: string | null;
  environment: string | null;
  profileComplete: boolean;
  /** Read from the members' own claim-brand rows — see the module docblock. */
  journalBatchName: string | null;
  members: ReimburseErpMemberRow[];
  ready: boolean;
}

export interface ReimburseErpGroupsView {
  groups: ReimburseErpGroup[];
  unassigned: ReimburseErpMemberRow[];
}

/**
 * One group per entry of `ERP_INTERFACE_BRANDS` (PCTH, KSI, PCMY, UNO),
 * empty groups included, plus an `unassigned` bucket for every claim brand
 * AP-4 may claim against that has no `AccBrandErpInterface` row at all.
 *
 * A brand with no mapping goes to `unassigned` — never to a group named after
 * its own code. The seeded `ROCKS` claim brand (migration 092) is the
 * concrete case: it resolves to no ERP target profile and appears in no
 * picker, so falling back to `interfaceBrandCode ?? code` (as the flat loader
 * this replaces used to) would have put it in a group that can never be
 * "ครบแล้ว". In the grouped shape it lands in `unassigned` instead, which is
 * the correct place for a brand nobody has pointed at a target yet.
 */
export async function loadReimburseErpGroups(): Promise<ReimburseErpGroupsView> {
  const [allBrands, ctx, profiles, ifaceMaps, reimburseBrands, branchRows, batchRows, bankRows] =
    await Promise.all([
      listAllBrands(),
      loadErpJournalBuildContext(AP4_FORM_CODE),
      // Resolved once for every target — not per row. The loader this
      // replaces called `resolveErpTargetProfile` once per claim brand, each
      // doing four reads; a target's profile does not depend on which claim
      // brand is asking.
      resolveAllErpTargetProfiles(AP4_FORM_CODE),
      listBrandErpInterfaceMaps(AP4_FORM_CODE),
      listFormBrands(AP4_FORM_CODE),
      listBrandBranches(null, AP4_FORM_CODE),
      listBrandJournalBatches(null, AP4_FORM_CODE),
      listBrandAccounts("bank", null, AP4_FORM_CODE),
    ]);

  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));
  const ifaceByCode = new Map(ifaceMaps.map((m) => [m.brandCode.toUpperCase(), m]));
  const profileByTarget = new Map(profiles.map((p) => [p.interfaceBrandCode.toUpperCase(), p]));

  // AP-4 self-owns its branch, like AP-2: show only an explicit AP-4
  // override, never the inherited NULL-default. A blank means "use the
  // requester's mapped ERP dept" — the same fallback `deptAsBranch` describes
  // in erp-journal-context.ts, not a value this screen should invent by
  // reading some other form's default branch.
  const ownBranchByCode = new Map(
    branchRows
      .filter((b) => b.formCode === AP4_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b]),
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

  const codes: string[] = [];
  const seen = new Set<string>();
  for (const b of reimburseBrands) {
    const c = b.brandCode.toUpperCase();
    if (!seen.has(c)) { seen.add(c); codes.push(c); }
  }

  const memberByCode = new Map<string, ReimburseErpMemberRow>();
  const batchByCode = new Map<string, string | null>();
  const targetByCode = new Map<string, string | null>();
  for (const code of codes) {
    const master = brandByCode.get(code);
    const base = ctx.brandAccounts[code];
    const ownBranch = ownBranchByCode.get(code);
    const ifaceRow = ifaceByCode.get(code);

    // An AP-4 row wins; with none, fall back to what the shared context
    // resolved so a brand that has never overridden anything still reads as
    // the default it would otherwise inherit — see the `ready` hazard above.
    memberByCode.set(code, {
      brandCode: code,
      brandName: master?.brandName ?? code,
      brandLogo: master?.brandLogo ?? null,
      bankAccountNo: ownBankByCode.get(code) ?? base?.bankAccountNo ?? null,
      branchCode: ownBranch?.branchCode ?? null,
      deptAsBranch: ownBranch?.deptAsBranch ?? false,
      fixedErpDeptCode: ownBranch?.fixedErpDeptCode ?? null,
    });
    batchByCode.set(code, ownBatchByCode.get(code) ?? base?.journalBatchName ?? null);
    // No fallback to `code` — see this function's own docblock.
    targetByCode.set(code, ifaceRow?.interfaceBrandCode?.trim().toUpperCase() || null);
  }

  const groups: ReimburseErpGroup[] = ERP_INTERFACE_BRANDS.map((iface) => {
    const targetCode = iface.id.toUpperCase();
    const memberCodes = codes.filter((code) => targetByCode.get(code) === targetCode);
    const members = memberCodes.map((code) => memberByCode.get(code)!);
    const target = brandByCode.get(targetCode);
    const profile = profileByTarget.get(targetCode) ?? null;

    // First non-null across members, in member order — see the module
    // docblock for why the batch is never read off the target itself.
    let journalBatchName: string | null = null;
    for (const code of memberCodes) {
      const b = batchByCode.get(code);
      if (b) { journalBatchName = b; break; }
    }

    const ready = !!(
      journalBatchName &&
      members.every((m) => !!m.bankAccountNo) &&
      profile?.profileComplete
    );

    return {
      targetCode,
      targetName: target?.brandName ?? iface.name,
      targetLogo: `/brandlogo/${targetCode.toLowerCase()}-200.png`,
      bcName: profile?.bcName ?? null,
      bcConnectionName: profile?.bcConnectionName ?? null,
      environment: profile?.environment ?? null,
      profileComplete: profile?.profileComplete ?? false,
      journalBatchName,
      members,
      ready,
    } satisfies ReimburseErpGroup;
  });

  const unassigned = codes
    .filter((code) => !targetByCode.get(code))
    .map((code) => memberByCode.get(code)!);

  return { groups, unassigned };
}

export interface ReimburseErpGroupSaveMember {
  brandCode: string;
  bankAccountNo: string;
  branchCode: string | null;
  deptAsBranch: boolean;
  fixedErpDeptCode: string | null;
}

export interface ReimburseErpGroupSaveInput {
  targetCode: string;
  journalBatchName: string | null;
  members: ReimburseErpGroupSaveMember[];
}

/**
 * Save a group: every member's interface mapping, bank account, branch/Fix
 * Dept and journal batch, all keyed on that member's own claim brand and
 * `FormCode = 'AP-4'` — see the module docblock for why the batch in
 * particular must never be stored once against `input.targetCode` instead.
 *
 * Each member is written in this fixed order — mapping, then bank, then
 * branch, then batch — and members are processed one at a time rather than
 * concurrently. The order matters for one reason: `mergeFormBrandBranch`'s
 * Fix Dept validation resolves the claim brand's *current* interface mapping
 * for `AP-4` to know which target's `ErpDimensionValue` rows a fixed
 * department code must exist in, and that current mapping is exactly what
 * the immediately preceding `upsertFormBrandErpInterfaceMap` call for this
 * same member just committed. Writing members concurrently, or reordering
 * the four calls, would race that read against the write it depends on.
 *
 * Does **not** call `assertClaimBrandAllowed` or otherwise check that a
 * member's `brandCode` is one AP-4 may claim against — the same choice
 * `upsertFormBrandErpInterfaceMap`'s own docblock makes. Sourcing every
 * `brandCode` from `listFormBrands(AP4_FORM_CODE)` — never from `BRANDS` and
 * never trusted verbatim off the request body — is the responsibility of the
 * route that calls this function.
 */
export async function saveReimburseErpGroup(
  input: ReimburseErpGroupSaveInput,
  userId: number,
): Promise<void> {
  const target = input.targetCode.trim().toUpperCase();
  if (!target) throw new Error("กรุณาระบุแบรนด์ปลายทาง");
  const batch = input.journalBatchName?.trim() || null;

  for (const member of input.members) {
    const brand = member.brandCode.trim().toUpperCase();
    await upsertFormBrandErpInterfaceMap(brand, target, AP4_FORM_CODE, userId);
    await mergeFormBrandAccount("bank", brand, AP4_FORM_CODE, member.bankAccountNo, null, userId);
    await mergeFormBrandBranch(
      brand,
      AP4_FORM_CODE,
      member.branchCode || null,
      !!member.deptAsBranch,
      member.fixedErpDeptCode || null,
      userId,
    );
    // Called once per member with the SAME value — the fan-out the module
    // docblock's Journal Batch section explains. Never stored once against
    // `target`.
    await mergeFormBrandBatch(brand, AP4_FORM_CODE, batch, userId);
  }
}

/**
 * Remove one claim brand from its group entirely — clears the AP-4 interface
 * mapping only, bounded to AP-4's own override (`perFormWriteMatch(AP4_FORM_CODE)`
 * inside `deleteBrandErpInterfaceMap`), never the shared `FormCode IS NULL`
 * default AP-1's own editor writes. The brand's bank/branch/batch rows under
 * AP-4 are left in place — being re-added to a group later (or to the same
 * one) should not have lost its saved account data just because the mapping
 * that grouped it was cleared.
 *
 * `userId` is accepted for the same shape every other write in this module
 * takes, even though a DELETE has no `CreatedBy`/`UpdatedBy` column to stamp.
 */
export async function removeReimburseErpMember(
  brandCode: string,
  userId: number,
): Promise<void> {
  void userId;
  const brand = brandCode.trim().toUpperCase();
  if (!brand) throw new Error("กรุณาระบุแบรนด์เบิก");
  await deleteBrandErpInterfaceMap(brand, AP4_FORM_CODE);
}

/* ─────────────────────────────────────────────────────────────────────────
 * The old flat, one-card-per-brand API — SDD Task 6 (this file's rewrite)
 * intentionally leaves it in place rather than deleting it. The route at
 * `src/app/api/request/reimburse/settings/erp-interface/route.ts` still
 * calls both functions below; swapping that route onto the grouped API above
 * is SDD Task 7, not this one, and this file must keep typechecking and the
 * route must keep working until that task lands. Do not add new callers of
 * either function below — build against `loadReimburseErpGroups` /
 * `saveReimburseErpGroup` / `removeReimburseErpMember` instead. Once Task 7
 * has moved the route over, both of these and this whole block should be
 * deleted.
 * ────────────────────────────────────────────────────────────────────── */

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
  const ownBranchByCode = new Map(
    branchRows
      .filter((b) => b.formCode === AP4_FORM_CODE)
      .map((b) => [b.brandCode.toUpperCase(), b.branchCode]),
  );
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
 * calls this function to source `brandCode` from
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
    // false/null: this old per-brand editor has no Fix Dept control. Only the
    // grouped save above (Task 6) and its modal (Task 8) offer one.
    mergeFormBrandBranch(brandCode, AP4_FORM_CODE, input.branchCode || null, false, null, userId),
    mergeFormBrandBatch(brandCode, AP4_FORM_CODE, input.journalBatchName || null, userId),
  ]);
}
