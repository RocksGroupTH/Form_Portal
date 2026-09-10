# AP-4 — grouped Interface ERP, one hub, one roster: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AP-4's Interface ERP tab AP-1's grouped-by-target shape, trim two cards off its hub, and fold the ผู้อนุมัติฝ่ายบัญชี tab into สิทธิ์เข้าถึง with per-brand ticks that gate both sight and action.

**Architecture:** Three independent changes on one branch. The ERP tab becomes a UI grouping over rows that stay keyed on the *claim* brand. The roster merge keeps both tables and merges only the screen, with a new `AccReimburseApproverBrand` making "≥1 brand ticked" the approver switch. The brand scope is enforced at every path that acts, not only at the lists.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MSSQL (`mssql`), SWR, Tailwind 4, `lucide-react`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-10-ap4-erp-groups-and-one-roster-design.md`

## Global Constraints

- **One migration: `144_acc_reimburse_approver_brand.sql`, both form databases, before the code.** 143 is the highest today and twelve numbers are duplicated, so 144 is the next free one. Nothing else in this plan touches SQL DDL.
- **`MASTER_TABLES` goes 27 → 28** (`scripts/checks/verify-master-alignment.ts`). The new table is dual-written, so its ids must match on both databases. `npm run check:alignment` is currently RED on a **pre-existing** `AccFormBrand` id drift (two rows, business data identical) — that is not this plan's and must not be "fixed" here.
- **Every write to a shared table goes through `writeBothPools`** or the `mergeFormBrand*` / `upsertFormBrandErpInterfaceMap` helpers, which use it. A write outside them lands in one database and reds `check:alignment`.
- **AP-4's Journal Batch stays keyed on the CLAIM brand.** A group Save fans one `mergeFormBrandBatch(claimBrand, "AP-4", batch, …)` per member. Storing it on the target reproduces the AP-2 bug `erp-interface-settings-service.ts:32-43` records — the screen showed `TRAVELING` while the payload sent `BEE` — because `resolveJournalBatchName` (`erp-journal-context.ts:80-93`) looks the batch up by the interface brand first.
- **No G/L account and no Description on AP-4's grid.** Ruled by the user 2026-09-10. `AccBrandGlAccount` is read by AP-4 and never written by it. `AccBrandBankAccount` has no `ErpDescription` column (migration 059:72-82), so Description has nowhere to live.
- **Zero brand rows means zero brands, never "all".** AP-1's `AccApproverInterfaceBrand` treats zero rows as unrestricted, which is a fail-open this plan deliberately does not reproduce. **AP-1 itself is not touched.**
- **Scoping must hold on the paths that ACT**, not only the lists: a scoped approver holding an id from a link or a stale page still reaches the action. Same argument as `booking-brand-scope-guard.test.ts`.
- **`erpInterface` stays out of `GRANTABLE_REIMBURSE_TABS`** and its route stays `requireRole` on every handler. Same for `access` and (until it is deleted) `approvers`.
- **Do not run any database command. Do not start a dev server** — port 3081 is the user's live session. Migrations are applied by the user.
- `npm test` and `npm run typecheck` must both be green before every commit. Baseline is **1346**. Thai copy, English identifiers, `var(--token)` never raw hex, `lucide-react` only, ES5 target (`Array.from()`, never `[...set]`), parameterised SQL, `{ ok, data }` / `{ ok, error }`.

---

### Task 1: Trim the hub to two cards

**Files:**
- Modify: `src/app/(dashboard)/request/reimburse/admin/page.tsx`
- Modify: `src/lib/constants.ts`

**Interfaces:**
- Consumes: nothing. Produces: nothing importable — `CARDS` is file-local and unexported.

Independent of every other task. Do it first so the rest never conflicts with it.

- [ ] **Step 1: Remove two entries from `CARDS`**

Delete the `ฟอร์ม AP-4` entry (href `/request/reimburse`) and the `Interface ERP` entry (href `/request/reimburse/approvals?tab=interface`), leaving `คิวอนุมัติ (บัญชี)` and `ตั้งค่า`.

Both destinations stay reachable and this was verified: `/request/reimburse` is also `REQUEST_CARDS`' `reimburse-form` card and Home's AP-4 entry; the ERP tab is the second tab of the page the surviving คิวอนุมัติ card opens. **Do not also remove `reimburse-form` or the Home entry** — after this they are the only two links to the form.

Drop the now-unused `Upload` import. **Keep `Receipt`** — it is still the `PageHeaderBar` icon.

- [ ] **Step 2: Correct four pieces of copy the removal falsifies**

1. The hub subtitle, currently `ฟอร์ม คิวอนุมัติ Interface ERP และตั้งค่า (AP-4)` → `คิวอนุมัติ (บัญชี) และตั้งค่า (AP-4)`.
2. The page JSDoc's claim that it shows "all four unconditionally".
3. `REQUEST_CARDS`' `reimburse-admin` `desc`, currently `ฟอร์ม AP-4 · คิวอนุมัติ (บัญชี) · Interface ERP · ตั้งค่า` → `คิวอนุมัติ (บัญชี) · Interface ERP · ตั้งค่า`. Interface ERP stays named here because the queue page still has that tab — this string describes what the area contains, not what the hub links.
4. The comment beside it naming four destinations.

Add a line to the hub's docblock recording *why* the two went: of the five form hubs, AP-4 was the only one linking its own fill form and the only one with a standalone Interface ERP card; AP-2 and AP-3 both put ERP in a tab.

- [ ] **Step 3: Run and commit**

`npm run typecheck` and `npm test` (1346). The hub has no test; nothing references `CARDS`.

---

### Task 2: Migration 144 and the pure brand-scope rule

**Files:**
- Create: `migrations/144_acc_reimburse_approver_brand.sql`
- Create: `src/lib/acc/reimburse/brand-scope.ts`
- Create: `src/lib/acc/reimburse/brand-scope.test.ts`
- Modify: `scripts/checks/verify-master-alignment.ts`

**Interfaces:**
- Produces:
  ```ts
  export function isApproverScope(targets: readonly string[]): boolean
  export function canActOnTarget(targets: readonly string[], target: string | null): boolean
  export function filterToScope<T>(rows: readonly T[], targets: readonly string[], targetOf: (row: T) => string | null): T[]
  export function normalizeScopeTargets(raw: readonly unknown[]): string[]
  ```

- [ ] **Step 1: Write the migration**

`migrations/144_acc_reimburse_approver_brand.sql`. Header must state: target **both** `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`, apply **before** the code deploy, and that ids must match on both sides because the table is dual-written and in `MASTER_TABLES`.

```sql
-- 144_acc_reimburse_approver_brand.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before the code.
--
-- Per-brand scope for AP-4's accounting approvers. Mirrors AccApproverInterfaceBrand
-- (migration 038), including the ON DELETE CASCADE, with ONE deliberate difference:
--
--   AP-1 reads ZERO rows as "unrestricted". AP-4 does not, and must not. Here zero
--   rows means zero brands, and zero brands means the person is not an approver at
--   all -- the tick set IS the on/off switch (AccReimburseApprover.IsActive is kept
--   in step with it by the settings service). In AP-1, clearing an approver's last
--   tick silently promotes them to every brand; there is no state here where absence
--   means "all".
--
-- No backfill. AccReimburseApprover ships empty. If it is NOT empty when this runs,
-- every existing approver has zero brand rows and therefore approves nothing until an
-- admin ticks a brand. That is the fail-safe direction and it is deliberate.
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.AccReimburseApproverBrand', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseApproverBrand] (
  [Id]                 INT IDENTITY(1,1) NOT NULL
    CONSTRAINT [PK_AccReimburseApproverBrand] PRIMARY KEY,
  [ApproverId]         INT NOT NULL,
  [InterfaceBrandCode] NVARCHAR(20) NOT NULL,
  [CreatedAt]          DATETIME2(7) NOT NULL
    CONSTRAINT [DF_AccReimburseApproverBrand_Created] DEFAULT (SYSDATETIME()),
  CONSTRAINT [FK_AccReimburseApproverBrand_Approver] FOREIGN KEY ([ApproverId])
    REFERENCES [dbo].[AccReimburseApprover]([Id]) ON DELETE CASCADE,
  CONSTRAINT [UQ_AccReimburseApproverBrand] UNIQUE ([ApproverId], [InterfaceBrandCode])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccReimburseApproverBrand_Approver')
  CREATE INDEX [IX_AccReimburseApproverBrand_Approver]
    ON [dbo].[AccReimburseApproverBrand] ([ApproverId]);
GO
```

There is deliberately **no CHECK on `InterfaceBrandCode`** — `AccApproverInterfaceBrand` has none either, and the vocabulary is enforced by `isErpInterfaceBrandCode` in TypeScript. Say so in the header, and say that removing that filter is what would make a foreign row into a grant.

- [ ] **Step 2: Add the table to `MASTER_TABLES`**

Append `"AccReimburseApproverBrand"` to the array in `scripts/checks/verify-master-alignment.ts` (27 → 28). While you are there, correct the two stale "25" figures in its docstring and the comment calling migration 120 "106" — both were measured stale on 2026-09-10.

- [ ] **Step 3: Write the failing tests**

`brand-scope.test.ts`. The module must import nothing.

```ts
test("zero brands is not an approver — absence never means all", () => {
  assert.equal(isApproverScope([]), false);
  assert.equal(canActOnTarget([], "PCTH"), false);
});

test("one brand is an approver, scoped to it", () => {
  assert.equal(isApproverScope(["KSI"]), true);
  assert.equal(canActOnTarget(["KSI"], "KSI"), true);
  assert.equal(canActOnTarget(["KSI"], "PCTH"), false);
});

test("a claim that maps to no target is out of every scope", () => {
  // The fail-safe direction: an unmapped claim brand is visible to nobody but
  // an admin, rather than to everybody.
  assert.equal(canActOnTarget(["PCTH", "KSI", "PCMY", "UNO"], null), false);
});

test("target comparison is case-insensitive and trimmed", () => {
  assert.equal(canActOnTarget(["KSI"], " ksi "), true);
});

test("filterToScope drops rows whose target is out of scope, keeping order", () => {
  const rows = [{ id: 1, t: "PCTH" }, { id: 2, t: "KSI" }, { id: 3, t: null }, { id: 4, t: "PCTH" }];
  assert.deepEqual(
    filterToScope(rows, ["PCTH"], (r) => r.t).map((r) => r.id),
    [1, 4],
  );
});

test("normalizeScopeTargets uppercases, trims, dedupes and drops non-brands", () => {
  assert.deepEqual(normalizeScopeTargets([" ksi ", "KSI", "PCTH", "", null, 7, "NOPE"]), ["KSI", "PCTH"]);
});
```

`normalizeScopeTargets` must keep only codes `isErpInterfaceBrandCode` would accept — but this module imports nothing, so inline the four-code allow-list as a local constant and **assert in the test that it equals `ERP_INTERFACE_BRANDS`'s codes**, importing that only in the test file, not the module.

- [ ] **Step 4: Run, watch fail, implement, run, commit**

---

### Task 3: The scope's database half, and keeping the two tables in step

**Files:**
- Create: `src/lib/acc/reimburse/brand-scope-load.ts`
- Modify: `src/lib/acc/reimburse/settings-service.ts`

**Interfaces:**
- Consumes: Task 2's `brand-scope.ts`.
- Produces:
  ```ts
  // brand-scope-load.ts
  export async function loadApproverScopeByStaffId(staffId: number | null, email: string | null): Promise<string[] | null>
  export async function loadClaimBrandTargets(): Promise<Map<string, string>>   // claim brand -> interface target, AP-4 per-form
  export async function resolveClaimTarget(brandCode: string | null): Promise<string | null>
  // settings-service.ts
  export async function listReimburseApproverBrands(): Promise<Map<number, string[]>>
  export async function setReimburseApproverBrands(staffId: number, targets: string[], userId: number, identity: { email: string; displayName: string }): Promise<void>
  ```

- [ ] **Step 1: `brand-scope-load.ts`**

`loadApproverScopeByStaffId` returns the ticked targets for the roster row matching this actor, or **`null` when there is no active roster row at all** — `null` means "not an approver", `[]` would be indistinguishable from "an approver with no ticks", and the settings service makes the latter impossible. Reads through `getAccPool()` (transactional-adjacent config that must follow the environment, as the rest of AP-4's roster does), joining `AccReimburseApprover` to `AccReimburseApproverBrand` on `ApproverId`, matching on `StaffId` or, failing that, the trimmed lower-cased `Email` — the same fallback `findActiveApprover` uses.

`loadClaimBrandTargets` reads `AccBrandErpInterface` per form via `listBrandErpInterfaceMaps` and `pickAllForForm`, keyed `BrandCode → InterfaceBrandCode`, with the `FormCode IS NULL` default behind the `AP-4` override. **Use `perFormPredicate`/`pickAllForForm` from `@/lib/acc/per-form-config`; do not hand-write the predicate** — a copy that loses the `IS NULL` arm silently reads another form's mapping.

- [ ] **Step 2: `setReimburseApproverBrands` is the single writer, and it keeps `IsActive` in step**

One `writeBothPools` transaction doing all of: upsert the `AccReimburseApprover` row (MERGE on `StaffId`, as `upsertReimburseApprover` already does), **set `IsActive = targets.length > 0`**, delete every `AccReimburseApproverBrand` row for that approver, and insert one row per target.

This is the switch. Its docblock must say that a separate active toggle is deliberately absent, because a toggle plus a tick set can hold two contradictory states that then have to be defended against on every read — the same reasoning `ApiKey`'s single nullable `ExpiresAt` carries.

**The insert must not read an id back across the two databases.** MERGE the approver row, then re-select its `Id` *within the same transaction on the same pool* for the child inserts. Both databases allocate their own approver id from counters that are in lockstep; nothing is copied between them.

- [ ] **Step 3: Commit**

No new tests here — Task 5's guard and Task 4's route tests cover it. Say so in the report.

---

### Task 4: One grid in สิทธิ์เข้าถึง, and the tab strip loses one

**Files:**
- Modify: `src/features/reimburse/components/settings/ReimburseAccessSettings.tsx`
- Delete: `src/features/reimburse/components/settings/ReimburseApproverSettings.tsx`
- Delete: `src/app/api/request/reimburse/settings/approvers/route.ts` (and its directory)
- Modify: `src/app/api/request/reimburse/settings/access/route.ts`
- Modify: `src/lib/acc/reimburse/settings-tabs.ts`
- Modify: `src/app/(dashboard)/request/reimburse/settings/page.tsx`
- Modify: `src/lib/acc/reimburse/settings-tabs.test.ts`
- Modify: `src/lib/acc/reimburse/settings-route-gates.test.ts`
- Modify: `src/features/reimburse/ReimburseApprovalQueue.tsx` (its notice copy only)
- Read first: `src/features/accounting/components/settings/ApproverInterfaceBrandTable.tsx` (the tick grid to mirror)

- [ ] **Step 1: The tab strip drops `approvers`**

`REIMBURSE_SETTINGS_TAB_ORDER` becomes `["brands", "rules", "erpInterface", "access"]`. `GRANTABLE_REIMBURSE_TABS` is unchanged (`rules`, `brands`). `settings-tabs.test.ts`'s `deepEqual` on the five keys becomes four, and its other three assertions follow.

`parseTabKey`'s fallback moves from `approvers` to `access`, and the page docblock explaining why it opens on the approver tab is rewritten: an empty approver pool is still what stops AP-4 dead, and สิทธิ์เข้าถึง is now where it is fixed.

- [ ] **Step 2: The access route absorbs the brand ticks**

`POST /api/request/reimburse/settings/access` gains `brandTargets: string[]` beside `settingsTabs`. It calls `normalizeScopeTargets` then `setReimburseApproverBrands`, and keeps writing `AccReimburseAccessTab` through `filterStorableReimburseKeys` exactly as now. **Both filters stay and neither is widened** — `filterStorableReimburseKeys` for the tab/menu union, `normalizeScopeTargets` for the brand vocabulary.

The GET returns each row's `brandTargets` alongside its `settingsTabs`, from `listReimburseApproverBrands()`.

**Delete the `approvers` route directory.** `settings-route-gates.test.ts` pins `handlerCount === 11` and deep-equals the on-disk directory list against `ROUTE_GATES`; both drop by two handlers and one directory. Update the number deliberately and say so in the commit.

- [ ] **Step 3: The grid**

One row per person: avatar/name/email/staff id · four brand tick columns (PCTH KSI PCMY UNO, from `ERP_INTERFACE_BRANDS`) · the settings-tab tick columns · สถานะ · remove. Mirror `ApproverInterfaceBrandTable.tsx`'s column layout, **but not its emptiness semantics**: there is no "all ticked = null" collapse here; the ticked set is sent verbatim.

Header note, replacing AP-1's: `ติ๊กแบรนด์ที่อนุมัติได้ — อย่างน้อย 1 แบรนด์จึงจะเป็นผู้อนุมัติ · ไม่ติ๊กเลย = ไม่ใช่ผู้อนุมัติ`.

**Carry both commissioning banners across from `ReimburseApproverSettings.tsx`**, which is being deleted:
- 0 people with ≥1 brand → every claim stops at the ACCOUNT step.
- exactly 1 → the two-person rule stalls every claim permanently at ACCOUNT_FINAL. Its own docblock calls this "the one that looks fine until it is tried"; that sentence is the reason the banner exists and it must survive the move.

- [ ] **Step 4: Fix the queue's notice copy**

`ReimburseApprovalQueue.tsx`'s `isReimburseApprover === false` notice ends by directing the reader to `ตั้งค่าขอเบิกเงินคืนพนักงาน → ผู้อนุมัติบัญชี`, a tab that no longer exists. Point it at `→ สิทธิ์เข้าถึง` and say a brand must be ticked.

- [ ] **Step 5: Run, typecheck, commit**

---

### Task 5: Enforce the scope where it acts

**Files:**
- Modify: `src/lib/acc/reimburse/approval-service.ts`
- Modify: `src/lib/acc/reimburse/queue-service.ts`
- Modify: `src/lib/acc/reimburse/erp-queue-service.ts`
- Modify: `src/lib/acc/report-service.ts` (the AP-4 arm of `listMyWorkRows`)
- Create: `src/lib/acc/reimburse/brand-scope-guard.test.ts`
- Read first: `src/lib/acc/travel-booking/booking-brand-scope-guard.test.ts` (the guard's shape)

- [ ] **Step 1: The five action paths refuse out of scope**

`requireApproverStaffId` gains a companion, `requireApproverScopeFor(actor, brandCode)`, which loads the actor's scope and the claim's target and throws `AccForbiddenError` → **403** when `canActOnTarget` says no. Thai message: `ไม่มีสิทธิ์ — แบรนด์นี้ไม่ได้อยู่ในกลุ่ม Interface ที่คุณดูแล`.

Call it in `approveReimburseAccountCheck`, `approveReimburseFinal`, `rejectReimburse`, `returnReimburse` (the last two only on an account step, matching where `requireApproverStaffId` is already called) and `setReimburseItemAccounts`.

**Decide it from the database inside the transaction that claims the row**, the way `approveByAccount` re-decides AP-17's per-diem dependency: a stale page, a replayed POST or a scope narrowed since the page loaded must not slip past. `requireApproverStaffId` stays outside the transaction as now — it is a membership question, not a per-row one.

- [ ] **Step 2: The two queues and `/my-work` filter by scope**

`listReimburseAccountQueue` and `listReimburseErpQueue` drop rows out of scope — **in the accumulator, from the row's own `BrandCode`**, not by widening the SQL. Both accumulators already re-derive their predicate from returned columns; this is one more re-derivation, and it inherits the tests that make that layer the one with teeth.

`listMyWorkRows`' AP-4 arm gains the same scope condition. An **admin with no roster row sees nothing here and that is unchanged behaviour** — they already could not approve.

- [ ] **Step 3: The guard test**

`brand-scope-guard.test.ts`, in the shape of `booking-brand-scope-guard.test.ts`: read the sources and assert `requireApproverScopeFor` is called in each of the five action paths, and that each call's result is awaited rather than merely constructed.

**Drill every one**: remove the call from each path in turn, watch a named assertion red, revert, confirm `git status --short` and `git diff` are both empty. Report which assertion caught which. A source-reading guard is the weaker layer — say so in its docblock, and name what the behavioural accumulator tests cover instead.

- [ ] **Step 4: Run, typecheck, commit**

---

### Task 6: The grouped Interface ERP service

**Files:**
- Modify: `src/lib/acc/reimburse/erp-interface-settings-service.ts`
- Modify: `src/lib/acc/brand-branch-service.ts`
- Read first: `src/lib/acc/brand-erp-interface-groups.ts` (AP-1's grouping), `src/lib/acc/erp-target-profile.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReimburseErpMemberRow { brandCode: string; brandName: string; brandLogo: string | null; bankAccountNo: string | null; branchCode: string | null; deptAsBranch: boolean; fixedErpDeptCode: string | null }
  export interface ReimburseErpGroup { targetCode: string; targetName: string; targetLogo: string | null; bcName: string | null; bcConnectionName: string | null; environment: string | null; profileComplete: boolean; journalBatchName: string | null; members: ReimburseErpMemberRow[]; ready: boolean }
  export interface ReimburseErpGroupsView { groups: ReimburseErpGroup[]; unassigned: ReimburseErpMemberRow[] }
  export async function loadReimburseErpGroups(): Promise<ReimburseErpGroupsView>
  export async function saveReimburseErpGroup(input: ReimburseErpGroupSaveInput, userId: number): Promise<void>
  export async function removeReimburseErpMember(brandCode: string, userId: number): Promise<void>
  ```

- [ ] **Step 1: `mergeFormBrandBranch` gains Fix Dept**

Two new parameters, `deptAsBranch: boolean` and `fixedErpDeptCode: string | null`, written into the row it already inserts. When `deptAsBranch` is true it must call the existing file-local `assertFixedErpDeptInErp(interfaceBrand, fixedErpDeptCode)` — the same validation `upsertBrandBranch` uses, which refuses a blank code and a code absent from `ErpDimensionValue` for that target. Every existing caller passes `false, null`.

- [ ] **Step 2: Group the rows**

`loadReimburseErpGroups` emits **one group per entry of `ERP_INTERFACE_BRANDS`, empty groups included** — mirror `buildAllTargetErpGroups`, not `buildTargetErpGroups`. A claim brand with no `AccBrandErpInterface` row goes to `unassigned`, **not** to a group named after itself: today's loader falls back to `interfaceBrandCode ?? code`, which puts the seeded `ROCKS` brand in a group that resolves to no profile and appears in no picker.

Resolve profiles with **`resolveAllErpTargetProfiles` once**, not `resolveErpTargetProfile` per row — today's loader makes N calls each doing four reads.

A group's `journalBatchName` is read from its **members'** claim-brand rows. When members disagree, report the first non-null and let the modal rewrite all of them on Save; the group's `ready` requires a batch, a bank account on every member, and `profileComplete`.

- [ ] **Step 3: Save fans out per member**

`saveReimburseErpGroup` takes the target, its member list and the group batch. For each member: `upsertFormBrandErpInterfaceMap(member, target, "AP-4", userId)`, `mergeFormBrandAccount("bank", member, "AP-4", bank, null, userId)`, `mergeFormBrandBranch(member, "AP-4", branch, deptAsBranch, fixedErpDeptCode, userId)`, `mergeFormBrandBatch(member, "AP-4", groupBatch, userId)`.

**`mergeFormBrandBatch` is called once per member with the same value** — that is the fan-out the Global Constraints require, and its comment must say why storing it on the target instead would reproduce AP-2's `TRAVELING`/`BEE` bug.

`removeReimburseErpMember` calls `deleteBrandErpInterfaceMap` bounded by `perFormWriteMatch(AP4_FORM_CODE)` — **not** `FormCode IS NULL`, which is AP-1's default and not AP-4's override.

Note in the docblock that the save is N×4 independent `writeBothPools` transactions with no rollback across them, so a partial failure leaves a half-saved group. That is inherited from today's per-brand save, not introduced here.

- [ ] **Step 4: Run, typecheck, commit**

---

### Task 7: The route gains DELETE and a group save

**Files:**
- Modify: `src/app/api/request/reimburse/settings/erp-interface/route.ts`
- Modify: `src/lib/acc/reimburse/settings-route-gates.test.ts`

- [ ] **Step 1: POST takes a group**

`{ targetCode, journalBatchName, members: [{ brandCode, bankAccountNo, branchCode, deptAsBranch, fixedErpDeptCode }] }`. Validate in order, each a 400 with the existing Thai wording where one exists: `targetCode` required and `isErpInterfaceBrandCode`; every `brandCode` in `listFormBrands(AP4_FORM_CODE)` → `แบรนด์นี้ไม่ได้อยู่ในสิทธิ์ของ AP-4`; every member's `bankAccountNo` required.

- [ ] **Step 2: Add `DELETE`**

`DELETE ?brandCode=` removes a claim brand from its group. `requireRole` as the first `await`, refusal returned. Without it a brand can be re-pointed but never un-mapped, which is the operation AP-1's grouped UI depends on.

- [ ] **Step 3: Update the gate test deliberately**

`handlerCount` moves 11 → 12 for the new DELETE, then **down by two** when Task 4 deletes the `approvers` route's GET and POST — reconcile whichever order the tasks land in and state the arithmetic in the commit body. The directory deep-equal drops `approvers`. The `erp-interface` entry stays `{kind: "role"}` with its existing `why`.

- [ ] **Step 4: Run, typecheck, commit**

---

### Task 8: The grouped panel

**Files:**
- Modify: `src/features/reimburse/components/settings/ReimburseErpInterfaceSettings.tsx`
- Read first: `src/features/accounting/components/settings/BrandErpInterfaceSettings.tsx` — specifically `TargetErpSummaryCard` (:963) and `TargetErpGroupEditForm` (:1078). **Read those two only; the file is 3109 lines.**

- [ ] **Step 1: Group cards**

One card per group: target logo and name, the member brands as chips, the group's Journal Batch, the BC connection line, a ครบแล้ว / ยังไม่ครบ chip, and แก้ไข. Plus an `ยังไม่ได้จัดกลุ่ม` section listing unassigned brands.

- [ ] **Step 2: The modal**

`ตั้งค่าร่วมกลุ่ม` — one Journal Batch select, caption `ใช้ร่วมทุกแบรนด์เบิกในกลุ่มนี้`, and the read-only BC block. Then `บัญชีแยกตามแบรนด์เบิก`: a table with **four** columns — แบรนด์เบิก · Bank Account · Branch Code (with the Fix Dept control beneath) · remove — and a `+ เพิ่มแบรนด์` row over the unassigned brands.

**No G/L Account column and no Description column.** Put the reason in a comment where a reader comparing against AP-1 will find it: AP-4 picks its G/L per expense line (`AccReimburseItem.Category`), and Description lives on `AccBrandGlAccount`, which AP-4 does not write.

Save is disabled while any member has no bank account, and the modal says which.

- [ ] **Step 3: Run, typecheck, commit**

Report that the render was **not** observed — no dev server — and list precisely what a human must look at: the group cards at `lg` (the grid is `sm:grid-cols-2 lg:grid-cols-3`), the modal table at a narrow width, the Fix Dept chip in both its set and unset states, and the unassigned section when it is empty.

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-26-ap4-accounting-erp-design.md` (amendment block)

- [ ] **Step 1: Correct what this plan falsifies**

- AP-4's settings tabs go five → **four**; `approvers` is gone and สิทธิ์เข้าถึง is where the approver pool is edited.
- The สิทธิ์เข้าถึง section's "second roster, not a rename" paragraph — **the two tables still exist and the reason still holds**; what changed is that one screen edits both, and the brand tick is what keeps "may edit the rules" and "may approve a payment" separable. Rewrite it to say that rather than deleting it.
- The AP-4 hub's card list.
- The Interface ERP tab is now grouped by target, and still writes no G/L.

- [ ] **Step 2: Record what is new**

- Migration 144, `MASTER_TABLES` 27 → 28, and the deployment order: **144 to both form databases before the code**.
- **AP-1's zero-rows-means-all fail-open**, measured 2026-09-10 and deliberately not fixed — with the note that AP-4 has no such state. This is the most valuable thing to write down, because the next person to read the two side by side will assume AP-4 simply forgot AP-1's shortcut.
- That the scope is enforced on five action paths and three lists, and why filtering a list is not a control.

- [ ] **Step 3: Update the spec's amendment block, and commit**

---

## Out of scope, recorded so nobody adds it

- **The Business Central send.** Still not supplied.
- **Fixing AP-1's fail-open.** Ruled 2026-09-10: report only. It is nine server paths plus the ACC Portal sibling reading the same `AccApprover` rows, and nobody has measured which existing zero-row approvers are unrestricted on purpose.
- **A G/L or Description column on AP-4's grid.** Ruled 2026-09-10.
- **Merging `AccReimburseApprover` into `AccReimburseAccess`.** Only the screen merges.
- **`AccBrandErpTargetSetting`.** Still has no per-form writer anywhere in `src/`.
