# AP-4 Hub, ERP Settings and Interface Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AP-4 one card leading to one hub, its own Interface ERP settings, and a queue showing which approved claims are waiting to reach Business Central.

**Architecture:** Almost nothing here is new. Every piece has a working
precedent in this repo built for another form, and the work is calling the same
functions with AP-4's form code: AP-2's hub page for the merge, AP-2's
`advance-interface-settings-service.ts` for the settings (it already writes
per-form overrides), AP-3's `clear-advance-erp-queue-service.ts` for the queue.
No migration. **No send** — that is a later stage and needs a Business Central
call nobody has supplied.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MSSQL via `mssql`,
SWR on the client, `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-26-ap4-accounting-erp-design.md`
§4 (stage 2) and §5 (stage 3). **Read it, then read the amendment block below —
the spec is stale in four measured ways and following it verbatim produces
redundant work.**

### What the spec gets wrong, measured 2026-09-09

1. **§4 "This is the first UI that writes an override" — false, by two forms.**
   `src/lib/adv/advance-interface-settings-service.ts` has written AP-2
   overrides since that branch merged. Measured in the live databases today:
   `AccBrandGlAccount` 3 default + **3 AP-2**, `AccBrandBankAccount` 3 + **3**,
   `AccBrandJournalBatch` 1 + **3**, `AccBrandBranchCode` 3 + **3**,
   `AccBrandErpInterface` 5 + **2** — identical in both form databases, so the
   identity lockstep holds and `mergeFormBrand*` is proven in real use. **Design
   from that file, not from the prose.**
2. **§5.3's new `ErpPvNo` column is unnecessary.** `AccRequest.ErpDocumentNo`
   exists (migration 108, `NVARCHAR(35)`, both databases) and AP-2 and AP-3
   already write it.
3. **§10 open item #1 is answered.** Business Central's posting call *does*
   return the document number; AP-2 and AP-3 both extract `results[].documentNo`
   from the PPAP response and store it in the same UPDATE that sets `Sent`.
   Stage 3 was never blocked on this. It is blocked only on somebody supplying
   the call.
4. **§7's migration number 122 is taken.** Irrelevant here — **this plan needs
   no migration at all.**

### And one place the spec is right and the shipped code is not

§2 and §6 design the interface queue at `(ManagerApproved, ACCOUNT_FINAL)` with
`ACCOUNT_FINAL` moved to *after* the send. That is stage 4 and is **not built**:
`approveReimburseFinal` lands at `(Approved, NULL)`. This plan builds the queue
over the state that exists today, which is byte-identical to what AP-1's and
AP-3's queues already select on. **Say so in the code**, because a reader who
finds the spec will otherwise think the queue is in the wrong place.

## Global Constraints

- **No migration, and no SQL DDL.** Every column and index this needs already
  exists, measured today: all six per-form tables carry `FormCode`, and every
  unique index leads with it (`UQ_AccBrandGlAccount (FormCode, BrandCode,
  AccountNo)` and its five siblings) in **both** form databases, so a second
  row per brand is accepted. `check:alignment` must stay at **27**.
- **`FormCode = 'AP-4'` is load-bearing in every query, and a text guard is not
  a defence.** `queue-service-guard.test.ts`'s docblock records three review
  rounds where a regex was defeated by a working SQL mutation. The defence that
  held is `belongsInAccountQueue` re-deriving the predicate from the row's own
  returned `FormCode`. **Any new AP-4 query does both**: pins in SQL, and
  re-derives from the row.
- **Every write to a shared per-form table goes through the `mergeFormBrand*`
  helpers**, which use `writeBothPools`. Six of the seven tables are in
  `MASTER_TABLES`; a write outside those helpers lands in one database and reds
  `check:alignment`.
- **`upsertBrandAccount` has NO `formCode` parameter.** AP-1's gl-accounts route
  passes one and it is silently dropped through an `any` spread. Do not copy
  that call. Use `mergeFormBrandAccount`.
- **`DepartmentErpMap` is production-only** — `getProductionFormPool()`, never
  `getAccPool()` — and its write stays `requireRole` admin-only, because two
  sibling applications read those rows. It is **out of scope** for this plan.
- **`AccBrandErpTargetSetting` has no per-form writer anywhere in `src/`.**
  Measured: zero override rows on any form. Do not add a tab for it; record it.
- **Nothing writes `ErpInterface*` outside a send path**, and
  `CK_AccRequest_ErpInterfaceStatus` permits only `Pending`/`Sent`/`Failed`. So
  the queue this plan builds is **read-only**, with no button that pretends to
  send. The screen must say the send is not built yet.
- **"Ready to send" is a property of the ITEM ROWS, not of `Status`.**
  `AccReimburseItem.Category` (the G/L account) is written by an AI read,
  correctable by an accountant, validated only for length, and may be null. The
  queue derives readiness from the items and names what is missing, the way
  AP-1's `prepStatus`/`prepIssues` do.
- **`/api/request/reimburse/**` classifies `AP-4` wholesale**, settings
  included, with a "do not fix" comment at `classify-path.ts:100-116`. AP-2 took
  the opposite treatment for its settings. Leave AP-4's alone and understand
  what it means: an AP-4 settings read resolves the **UAT** database for a
  tester. The per-form ERP tables exist in both, so this is fine — but do not
  reach a production-only table (`BrandCurrency`, `BrandSetting`, `ApiKey`,
  `FxRateCache`, `DepartmentErpMap`) from an AP-4 route through `getAccPool()`.
- **`ICON_MAP`** (`src/app/(dashboard)/request/page.tsx`) is hand-kept; a card
  whose icon is absent renders an empty tile with no type error. `Receipt` is
  already there.
- `npm test` (1305 now) and `npm run typecheck` must both be clean. No lint
  script. Thai copy, English identifiers. Comments record decisions and hazards.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/acc/reimburse/erp-interface-settings-service.ts` *(create)* | read + write AP-4's per-form ERP config, modelled on `src/lib/adv/advance-interface-settings-service.ts` |
| `src/app/api/request/reimburse/settings/erp-interface/route.ts` *(create)* | GET + POST, gated `requireRole` |
| `src/features/reimburse/components/settings/ReimburseErpInterfaceSettings.tsx` *(create)* | the panel |
| `src/lib/acc/reimburse/settings-tabs.ts` *(modify)* | a fifth tab key, NOT grantable |
| `src/app/(dashboard)/request/reimburse/settings/page.tsx` *(modify)* | render the fifth tab |
| `src/lib/acc/reimburse/erp-queue-policy.ts` *(create)* | pure: which claims are in the queue, and whether one is ready |
| `src/lib/acc/reimburse/erp-queue-policy.test.ts` *(create)* | the predicate and the readiness rule |
| `src/lib/acc/reimburse/erp-queue-service.ts` *(create)* | the one query, modelled on `clear-advance-erp-queue-service.ts` |
| `src/app/api/request/reimburse/erp-queue/route.ts` *(create)* | GET |
| `src/features/reimburse/ReimburseErpQueue.tsx` *(create)* | the queue tab |
| `src/app/(dashboard)/request/reimburse/approvals/page.tsx` *(modify)* | two tabs: รออนุมัติ / Interface ERP |
| `src/app/(dashboard)/request/reimburse/admin/page.tsx` *(create)* | AP-4's hub, modelled on `request/advance/admin/page.tsx` |
| `src/lib/constants.ts` *(modify)* | one AP-4 management card, pointing at the hub |
| `src/app/(dashboard)/request/page.tsx` *(modify)* | the hard-coded `reimburse-approvals` filter arm |

---

## Task 1: AP-4's ERP interface settings service

**Files:**
- Create: `src/lib/acc/reimburse/erp-interface-settings-service.ts`
- Read first, in full: `src/lib/adv/advance-interface-settings-service.ts`

**Interfaces:**
- Produces: `loadReimburseErpInterfaceSettings(): Promise<ReimburseErpInterfaceRow[]>`
  and `saveReimburseErpInterfaceSettings(input, userId): Promise<void>`, one row
  per claimable brand, carrying the journal batch, bank account and branch code
  that AP-4 resolves for it.

- [ ] **Step 1: Read the precedent and copy its SHAPE, not its text**

`advance-interface-settings-service.ts` is the model. Its lines 41-63 carry a
trap in a comment — read it before writing anything:

> the shared `ctx.brandAccounts` resolves a journal batch through the interface
> company (ROCKS → PCTH) and picks a brand's rows by id, so an AP-2 override
> lost to an older NULL default and the screen displayed TRAVELING while the
> payload correctly sent BEE. **Read the per-form rows directly for display.**

AP-4 must read its own rows directly for the same reason. `.filter(b => b.formCode === AP4_FORM_CODE)` is the shape AP-2 uses.

- [ ] **Step 2: Write through the merge helpers only**

`mergeFormBrandAccount`, `mergeFormBrandBranch`, `mergeFormBrandBatch` and
`upsertFormBrandErpInterfaceMap` are the four that take a form code and go
through `writeBothPools`. **Do not use `upsertBrandAccount`** — it has no
`formCode` parameter, and AP-1's gl-accounts route passes one that is silently
dropped through an `any` spread.

- [ ] **Step 3: The brands come from `listFormBrands("AP-4")`**

Not from `BRANDS` and not from the request body. Note the hazard the precedent
carries: `upsertFormBrandErpInterfaceMap`'s docblock justifies skipping
`assertClaimBrandAllowed` on the grounds that the caller's brand comes from
`listFormBrands`. Make that true in AP-4's route rather than assuming it.

- [ ] **Step 4: `npm run typecheck`, then commit**

```bash
git commit -m "feat(ap-4): read and write AP-4's own ERP interface config"
```

---

## Task 2: The route, the panel, and the fifth tab

**Files:**
- Create: `src/app/api/request/reimburse/settings/erp-interface/route.ts`
- Create: `src/features/reimburse/components/settings/ReimburseErpInterfaceSettings.tsx`
- Modify: `src/lib/acc/reimburse/settings-tabs.ts`
- Modify: `src/app/(dashboard)/request/reimburse/settings/page.tsx`
- Read first: `src/app/api/request/advance/settings/erp-interface/route.ts`

**Interfaces:**
- Consumes: Task 1's two functions.
- Produces: `"erpInterface"` in `REIMBURSE_SETTINGS_TAB_ORDER`, **excluded from
  `GRANTABLE_REIMBURSE_TABS`**.

- [ ] **Step 1: The tab key is NOT grantable**

Add `"erpInterface"` to `REIMBURSE_SETTINGS_TAB_ORDER` and give it a label, but
leave `GRANTABLE_REIMBURSE_TABS` alone — it is filtered from the order down to
`rules` and `brands` and must stay that way. CLAUDE.md states the reason for
AP-1 and it holds here: `gl-accounts`, `bank-accounts`, `journal-batches` and
`branch-codes` are tab-gated but **not brand-scoped**, so a scoped approver
holding that grant could set another brand's posting configuration.

Add a test to `settings-tabs.test.ts` asserting `erpInterface` is in the order
and is NOT grantable — the existing tests will not catch a mistake here.

- [ ] **Step 2: The route is `requireRole`, both methods**

Not `requireReimburseSettingsTab`. This tab is admin-only for the reason above.
`settings-route-gates.test.ts` pins `handlerCount` and lists AP-4's settings
routes by hand — **it will go red, which is the test working.** Add the new
route to its `ROUTE_GATES` array with `gate: requireRole` and update the count.
Do not weaken its other assertions: it also checks the gate is the handler's
first `await` and that its refusal is returned.

- [ ] **Step 3: The panel**

Model it on AP-2's Interface ERP panel. One row per claimable brand; journal
batch, bank account and branch code per row; save writes them all.

- [ ] **Step 4: `npm test`, `npm run typecheck`, `npm run check:alignment` (must read 27), then commit**

---

## Task 3: The ERP queue's predicate and readiness rule, pure

**Files:**
- Create: `src/lib/acc/reimburse/erp-queue-policy.ts`
- Test: `src/lib/acc/reimburse/erp-queue-policy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function belongsInErpQueue(formCode: string, status: string): boolean
  export type ErpReadiness = { ready: boolean; issues: string[] }
  export function erpReadiness(items: readonly { category: string | null; amount: number | null }[]): ErpReadiness
  export interface ReimburseErpQueueRow { … }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("only an APPROVED AP-4 claim is in the ERP queue", () => {
  assert.equal(belongsInErpQueue("AP-4", "Approved"), true);
});

test("another form at the same status is OUT — FormCode is the only discriminator", () => {
  // AP-1 and AP-3 park approved claims at exactly this status on the same
  // shared AccRequest table. AP-1's own erp-prep-service comment spells out
  // what happens if one leaks in: an empty day count and a journal built from
  // nothing, posted to Business Central.
  assert.equal(belongsInErpQueue("AP-1", "Approved"), false);
  assert.equal(belongsInErpQueue("AP-3", "Approved"), false);
});

test("an AP-4 claim not yet approved is OUT", () => {
  for (const s of ["Draft", "Submitted", "ManagerApproved", "Returned", "Rejected", "Cancelled"]) {
    assert.equal(belongsInErpQueue("AP-4", s), false, s);
  }
});

test("an unknown status is OUT — an allow-list", () => {
  assert.equal(belongsInErpQueue("AP-4", "SomethingNew"), false);
});

test("a claim is ready only when EVERY line has a G/L account", () => {
  assert.deepEqual(erpReadiness([{ category: "5100-01", amount: 100 }]), { ready: true, issues: [] });
});

test("a missing G/L names the line, because that is what the accountant must fix", () => {
  const r = erpReadiness([
    { category: "5100-01", amount: 100 },
    { category: null, amount: 250 },
    { category: "   ", amount: 90 },
  ]);
  assert.equal(r.ready, false);
  // Lines are numbered as a human counts them, and BOTH bad lines are named —
  // reporting only the first means a second round trip to discover the second.
  assert.deepEqual(r.issues, ["บรรทัดที่ 2 ยังไม่ได้เลือกผังบัญชี", "บรรทัดที่ 3 ยังไม่ได้เลือกผังบัญชี"]);
});

test("a claim with no lines at all is not ready", () => {
  // Not "ready with nothing to post" — an empty claim reaching a journal
  // builder is the AP-1 failure quoted above, in its purest form.
  const r = erpReadiness([]);
  assert.equal(r.ready, false);
  assert.equal(r.issues.length, 1);
});
```

- [ ] **Step 2: Run and watch them fail** — module not found.

- [ ] **Step 3: Implement, import-free**

The module must import nothing, so it is unit-tested with no database. Follow
`queue-policy.ts`'s header for the voice and for why the allow-list is the
fail-safe direction.

- [ ] **Step 4: Run, typecheck, commit**

---

## Task 4: The queue query, the route and the tab

**Files:**
- Create: `src/lib/acc/reimburse/erp-queue-service.ts`
- Create: `src/app/api/request/reimburse/erp-queue/route.ts`
- Create: `src/features/reimburse/ReimburseErpQueue.tsx`
- Modify: `src/app/(dashboard)/request/reimburse/approvals/page.tsx`
- Read first: `src/lib/clr/clear-advance-erp-queue-service.ts` (the whole file — it is short and it is the model)

**Interfaces:**
- Consumes: Task 3's `belongsInErpQueue`, `erpReadiness`, `ReimburseErpQueueRow`.
- Produces: `listReimburseErpQueue(): Promise<ReimburseErpQueueRow[]>`;
  `GET /api/request/reimburse/erp-queue`.

- [ ] **Step 1: The query**

AP-3's is the shape: `getAccPool()`, `WHERE req.FormCode = @form AND req.Status
= 'Approved'`, LEFT JOIN the form's own detail table, `ORDER BY req.Id DESC`,
selecting `ErpInterfaceStatus`, `ErpDocumentNo`, `ErpInterfaceEnvironment`,
`ErpInterfaceSentAt`, `ErpInterfaceError` alongside the form's own columns.

**Two things AP-3's does not do that AP-4's must:**
- **re-derive the predicate from the row.** Select `req.FormCode` and `req.Status`
  and drop any row `belongsInErpQueue` refuses. The SQL pin is the first layer;
  this is the one with teeth, for the reason `queue-service.ts` records.
- **carry the items' readiness.** Join `AccReimburseItem` and compute
  `erpReadiness` per claim, so the screen can say *why* a claim is not ready.

- [ ] **Step 2: The route**

Gate it the way `approvals/route.ts` does — the same `approvalQueue` menu key.
A person who may work the accounting queue may see what is waiting to post.

- [ ] **Step 3: The tab**

`/request/reimburse/approvals` becomes two tabs, `?tab=` — รออนุมัติ (the
existing queue) and **Interface ERP**. This is what AP-1, AP-2 and AP-3 all do;
none of them gives the ERP queue its own route.

**The Interface ERP tab must say the send is not built.** There is no button
that posts, because there is nothing to post with, and
`CK_AccRequest_ErpInterfaceStatus` has no value meaning "held pending
build-out". One line of Thai above the table saying the list is what is waiting
and that sending arrives with the Business Central call. A button that does
nothing is worse than no button.

- [ ] **Step 4: A source-reading guard**

Add `erp-queue-service-guard.test.ts` in the shape of
`queue-service-guard.test.ts`: the `FormCode` pin is present, the
`AP4_FORM_CODE` binding is correct, `req.FormCode` is read off the row, and
`belongsInErpQueue` is called in a gating `if`. Drill each by removing it,
watching the assertion red, reverting, and confirming the tree is byte-identical.

- [ ] **Step 5: Run everything, commit**

---

## Task 5: AP-4's hub, and one card

**Files:**
- Create: `src/app/(dashboard)/request/reimburse/admin/page.tsx`
- Modify: `src/lib/constants.ts`
- Modify: `src/app/(dashboard)/request/page.tsx`
- Modify: `src/features/reimburse/ReimburseApprovalQueue.tsx` (its `backHref` comment)
- Read first: `src/app/(dashboard)/request/advance/admin/page.tsx` (the model, ~70 lines)

- [ ] **Step 1: The hub**

Copy AP-2's shape: `"use client"`, `useSearchParams` for `from`,
`requestBackHref`, `PageContainer`, `PageHeaderBar`, `FormEnvironmentChip`, a
`CARDS` array and a `HubCardView` over `HoverCard`. AP-4's cards: **ฟอร์ม AP-4**
(`/request/reimburse`), **คิวอนุมัติ (บัญชี)** (`/request/reimburse/approvals`),
**Interface ERP** (`.../approvals?tab=interface`), **ตั้งค่า**
(`/request/reimburse/settings`).

- [ ] **Step 2: One card**

Delete `reimburse-approvals` from `REQUEST_CARDS`. Point `reimburse-settings` at
`/request/reimburse/admin`, rename it to describe the whole area, and give it a
`desc` listing what the hub offers — the convention every other card follows.

**Keep `manage: true`** — that flag exempts a management card from the form's
`available` switch, so dropping it would hide AP-4's whole management area
whenever the form is switched off. **Keep it not `devHostOnly`** — the reasoning
is already in the comment there and is unchanged.

This is exactly what AP-17 did on 2026-08-27, in one commit: delete the
redundant card AND make the survivor reach the work. CLAUDE.md records it.

- [ ] **Step 3: The hard-coded filter arm**

`request/page.tsx` has `(item.id !== "reimburse-approvals" || reimburseApprovalQueueGranted)`.
With that card gone the arm is dead — but **do not simply delete it and leave
the merged card ungated**, and **do not gate the merged card on `approvalQueue`
alone**: that would hide the settings door from a non-admin holding only a
`rules` or `brands` tick. The merged card's condition is the **union** —
`canSettings || approvalQueue` — because either grant is a reason to reach the
hub, and every destination on the hub re-decides its own access server-side.

Note while you are here: `approvalQueue` is `false` on a FAILED `/access` fetch
as well as while loading, and this hub renders no error banner (AP-17's does).
An `/access` outage silently removes the card. Out of scope to fix; say so in a
comment so the next reader knows it is known.

- [ ] **Step 4: The stale `backHref` comment**

`ReimburseApprovalQueue.tsx`'s `backHref="/request"` is justified by a comment
saying the card on `/request` is the only entry point. The hub falsifies that.
Point it at the hub and correct the comment.

- [ ] **Step 5: Verify by hand**

`npm run dev` is the user's own session — **do not start one**. Report that the
render was not observed and that it needs a visual pass, listing exactly what to
look at.

- [ ] **Step 6: Commit**

---

## Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-26-ap4-accounting-erp-design.md` (its amendment block only)

- [ ] **Step 1: Correct what is now false, not just add what is new**

Three claims in CLAUDE.md's "Per-form ERP configuration" section are stale and
were stale before this work:

- "**It ships inert, and there is no UI to add an override**" — AP-2's settings
  tab has written them since its branch merged. Measured 2026-09-09: 14 override
  rows across five tables, identical in both form databases.
- "**Creating an override today means a hand-written SQL `INSERT`**" — same.
- The AP-4 section's "**AP-4 never reaches Business Central, deliberately**"
  paragraph — this plan does NOT falsify it. There is still no send. Leave it,
  and add beside it that AP-4 now has its own ERP configuration and a queue
  showing what is waiting, so the paragraph is read correctly rather than
  looking contradicted.

- [ ] **Step 2: Record the two divergences this stage carries**

- the queue reads `(Approved, NULL)` where the spec designs
  `(ManagerApproved, ACCOUNT_FINAL)`, because the spec's stage 4 is not built
- `AccBrandErpTargetSetting` is one of the seven per-form tables and has **no
  per-form writer anywhere in `src/`** — measured today, zero override rows on
  any form. AP-4 can read an override nothing can write.

- [ ] **Step 3: Update the spec's amendment block** with the four staleness
  findings from this plan's header, including that open item #1 is answered.

- [ ] **Step 4: Commit**

---

## Out of scope, recorded so nobody adds them

- **The send.** No Business Central call has been supplied. When it is, the spec
  §5.1 seam is right and the send core is shared with AP-1 — it is the only code
  in this repo with the atomic claim and the refusal to retry an unconfirmed
  outcome, and AP-2's and AP-3's copies have neither.
- **`AccRequest.ErpPvNo`.** `ErpDocumentNo` already exists and is already
  written by two forms.
- **Moving `ACCOUNT_FINAL` after the send** (spec §6, stage 4). It must land
  after the send exists, or every approved claim parks with nothing able to
  advance it.
- **A department (HR ↔ ERP) tab for AP-4.** `getMultiBrandDepartmentMappingPage`
  is hard-pinned to AP-1 and would need a `formCode` parameter; the write
  already takes one. `DepartmentErpMap` is production-only and admin-only.
- **`AccBrandErpTargetSetting`.** No writer exists for any form.
- **Any migration.**
