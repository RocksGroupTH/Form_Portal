# AP-4 — grouped Interface ERP, one hub, one roster

**Date:** 2026-09-10
**Branch:** `feat/ap4-accounting-and-erp`
**Predecessor:** `2026-08-26-ap4-accounting-erp-design.md` (stages 1–2, shipped)

Three changes the user asked for after seeing stage 2 render. Each corrects
something AP-4 does differently from every other form in this app, and in all
three cases the other forms are right.

---

## 0. What was measured, and when

Everything below rests on a survey run 2026-09-10 against the working tree at
`9653135`. Figures that will go stale are dated where they appear.

- Migrations run to **143**; **twelve** numbers are duplicated (088, 089, 090,
  091, 094, 103, 117, 118, 119, 120, 124, **137**). The next free number is
  **144**. CLAUDE.md and migration 137's own header both still say eleven —
  137 is the twelfth, and the file asserting eleven is the one that made it so.
- `MASTER_TABLES` holds **27** entries. The verifier's own docstring says 25 in
  two places and calls migration 120 "106"; both are stale comments, and the
  PASS line interpolates the real length.
- `AccReimburseApprover`, `AccReimburseAccess`, `AccReimburseAccessTab` and
  `AccReimburseRule` are all in that list, all dual-written.

---

## 1. Interface ERP, grouped by interface target

### What is wrong today

AP-4's tab is a flat list: one card per claim brand, each carrying its own
Company ปลายทาง, Bank, Branch and Journal Batch. It is a line-for-line mirror
of **AP-2's** panel. AP-1 — the form AP-4 actually resembles — groups by
**interface target**: one card per PCTH / KSI / PCMY / UNO, listing the claim
brands mapped into it, with the group's shared Journal Batch and BC connection
on the card and a modal holding a per-claim-brand table.

The user asked for AP-1's shape. This is not cosmetic: a group is the unit a
journal is posted under, and a flat list hides which brands share one.

### The shape

**Group card** — one per entry of `ERP_INTERFACE_BRANDS` (`PCTH KSI PCMY UNO`,
a hardcoded four from `src/lib/brand.ts`), empty groups included:
target logo and name · the claim brands mapped into it · the group's
JOURNAL BATCH · its BC connection · a ครบแล้ว / ยังไม่ครบ chip · แก้ไข.

**Group modal** — `ตั้งค่าร่วมกลุ่ม` with one Journal Batch select and the
read-only BC connection block, then `บัญชีแยกตามแบรนด์เบิก`:

| แบรนด์เบิก | Bank Account | Branch Code | |
|---|---|---|---|
| Potato Corner TH · PCTH | K-CA6999 | HQ01 · `+ Fix Dept` | 🗑 |
| Potato Corner MY · PCMY | K-CA6999 | RFM · `FIX RFM` | 🗑 |

plus `+ เพิ่มแบรนด์` over the brands not yet in any group.

### Two columns AP-1 has that AP-4 does not, and why

- **No G/L Account.** Ruled by the user 2026-09-10. AP-1 needs a per-brand G/L
  because a travel-expense claim posts to one account per brand. **AP-4 already
  chooses a G/L per expense LINE** — `AccReimburseItem.Category`, proposed by
  the AI document read from `Rocks_ERP_Data` and corrected by accounting from
  the queue (`PATCH .../requests/[id]/items`). A per-brand default underneath a
  per-line answer is a second answer to a settled question. `AccBrandGlAccount`
  stays untouched by AP-4, read-only through `loadErpJournalBuildContext`.
- **No Description.** It follows the G/L out, and not by preference: the column
  is `AccBrandGlAccount.ErpDescription` (migration 037), and
  **`AccBrandBankAccount` has no `ErpDescription` column** — verified against
  migration 059:72-82. With no G/L row for AP-4 there is nowhere to put it.
  Adding one would mean a migration for a field nothing reads, since AP-4 has
  no send.

### Fix Dept is included

`DeptAsBranch` + `FixedErpDeptCode` on `AccBrandBranchCode` (migrations
041/042) are in the modal the user pointed at, so they are in scope.
`mergeFormBrandBranch` takes only `branchCode` today and inserts
`DeptAsBranch = 0`; it gains two parameters. AP-1's server-side validation is
reused rather than re-implemented — `assertFixedErpDeptInErp`
(`brand-branch-service.ts:115`, file-local) refuses a blank code and a code
absent from `ErpDimensionValue` for that target.

### The one thing that must not be copied from AP-1

**AP-1 stores a group's shared Journal Batch keyed on the TARGET brand.**
`saveTargetGroup` POSTs `brandCode: targetKey`, and `resolveJournalForTarget`
reads `journalBatchMap[targetKey]` first.

**AP-4 must keep storing it keyed on the CLAIM brand**, and a group Save fans
one `mergeFormBrandBatch(claimBrand, "AP-4", batch, …)` out per member. The
reason is written on `erp-interface-settings-service.ts:32-43` and it is a bug
that already happened once, in AP-2: `resolveJournalBatchName`
(`erp-journal-context.ts:80-93`) looks the batch up by the **interface** brand
first, so a target-keyed row is shadowed by any per-form claim-brand override —
the screen displayed `TRAVELING` while the payload correctly sent `BEE`.
Target-keyed storage would walk AP-4 straight back into it.

**So the group is a UI grouping over claim-brand-keyed rows.** Everything the
modal saves is still `(claim brand, FormCode='AP-4')`.

### What the route needs

- **A `DELETE` handler**, to move a brand out of a group. Today
  `interfaceBrandCode` is mandatory on every POST and no DELETE exists, so a
  brand can be re-pointed but never un-mapped, and AP-1's grouped UI depends on
  exactly that operation. This moves `settings-route-gates.test.ts`'s
  `handlerCount` from 11 to 12 — deliberately, and the test is updated in the
  same commit.
- The GET returns a grouped DTO: targets, their members, the group batch, BC
  metadata, and an **unassigned** bucket. Per-target profiles resolve through
  `resolveAllErpTargetProfiles` once, not `resolveErpTargetProfile` per row —
  today's loader makes N calls each doing four reads.

### Two hazards carried forward, recorded not fixed

- **`ready` is satisfied by AP-1's inherited defaults.** `bankAccountNo` and
  `journalBatchName` both fall back to `base?.…`, so a brand with no AP-4 row
  reads ตั้งค่าครบ. A group-level chip inherits this. Left as is — the
  fallback is the intended behaviour; only the chip's wording is at risk, and
  it says ตั้งค่าครบ, not "AP-4 has its own".
- **`ROCKS`** (seeded by migration 092) resolves to no ERP profile and appears
  in no target option list, yet is what an unmapped brand falls back to. In the
  grouped shape it lands in the unassigned bucket instead, which is an
  improvement rather than a fix.

---

## 2. The hub loses two cards

`ฟอร์ม AP-4` and `Interface ERP` come off `/request/reimburse/admin`, leaving
คิวอนุมัติ (บัญชี) and ตั้งค่า.

**The user's premise was checked and is right on both counts.** Of the five
hubs — AP-1, AP-2, AP-3, AP-4, AP-17 — **AP-4 is the only one that links its
own fill form**, and **the only one with a standalone Interface ERP card**;
AP-2 and AP-3 both put ERP in a tab exactly as AP-4's own queue now does. The
form is already reachable twice from `/request` (`REQUEST_CARDS`'s
`reimburse-form`) and from Home, so the hub card was a third link. The ERP tab
is the second tab of the page the surviving คิวอนุมัติ card opens.

Four pieces of copy go stale with them and are corrected in the same commit:
the hub subtitle, the hub's JSDoc "all four unconditionally", `REQUEST_CARDS`'s
`desc` (rendered on `/request`), and the comment beside it naming four
destinations.

---

## 3. One roster: สิทธิ์เข้าถึง absorbs ผู้อนุมัติฝ่ายบัญชี

### What the user asked

Remove the ผู้อนุมัติฝ่ายบัญชี tab. Being on สิทธิ์เข้าถึง with **at least one
brand ticked** is what makes somebody an AP-4 accounting approver, scoped to
those brands — AP-1's shape.

### This reverses a decision migration 120 exists to record

Verbatim, `120_acc_reimburse_access.sql:21-31`:

> `AccReimburseApprover` is the pool that takes the ACCOUNT and ACCOUNT_FINAL
> steps — being on it means approving real reimbursement payments. AP-17's
> `AccBookingApprover` is nothing of the sort: it grants sight of a queue and a
> report. So AP-17 can hang its settings-tab grants off its approver roster and
> AP-4 cannot: doing that here would make "may edit the payment rules" and "may
> approve a payment" the same tick.

**The design below keeps that property while giving the user the single screen
they asked for**, and the brand tick is what makes it possible.

### The design: two tables, one grid, and the tick is the switch

`AccReimburseApprover` and `AccReimburseAccess` **both stay**. They are not
merged, because merging them would widen three things that are not about
approving — `request-acl.ts`'s read verdict, `/my-work`'s pending list, and
`approverEmails`'s notification fan-out — to everyone granted a settings tab.
What merges is the **screen**.

One grid in สิทธิ์เข้าถึง, one row per person:

| ผู้ใช้ | PCTH | KSI | PCMY | UNO | แท็บตั้งค่า | สถานะ |
|---|---|---|---|---|---|---|

- **≥1 brand ticked ⇒ an active `AccReimburseApprover` row.** The ticks
  themselves live in a new `AccReimburseApproverBrand`, the mirror of
  `AccApproverInterfaceBrand`.
- **0 brands ticked ⇒ `IsActive = 0`.** The tick set *is* the on/off switch;
  there is no separate toggle to contradict it.
- Settings-tab ticks keep writing `AccReimburseAccessTab` exactly as now.
- **Membership alone still grants nothing**, which is the property migration
  120 was defending: a person added with settings ticks and no brand ticks
  approves nothing, and a person with brand ticks and no settings ticks opens
  no settings tab.

**No privilege change comes with the merge.** Measured: `/settings/approvers`
and `/settings/access` are *both* already `requireRole(["IT Admin","System
Admin"])` on every handler, and `access` is unreachable by any grant
(`isGrantableReimburseTabKey("access") === false`). The two panels were
admin-only before and the merged one is admin-only after.

### AP-1's fail-open is not reproduced

In AP-1, all-four-ticked and none-ticked both store **zero rows**, and zero
rows reads as **unrestricted** — so clearing a KSI-only approver's last tick
silently promotes them to every brand, with the grid then showing all four
ticked. Ruled 2026-09-10: **AP-1 is left alone** (it is nine server paths plus
the ACC Portal sibling on the same `AccApprover` rows, and nobody has measured
which existing zero-row approvers are unrestricted on purpose), and **AP-4 is
built without the ambiguity**: rows are always explicit, zero rows means zero
brands, and zero brands means not an approver. There is no state in AP-4 where
absence means "all".

### The scope is enforced where it acts, not only where it lists

Ruled by the user 2026-09-10: the tick controls **both** sight and action.

- **Sight**: the accounting queue and the Interface ERP queue return only rows
  whose claim brand maps to a ticked target.
- **Action**: `approveReimburseAccountCheck`, `approveReimburseFinal`,
  `rejectReimburse`, `returnReimburse` and `setReimburseItemAccounts` refuse
  403 out of scope — re-decided from the database, inside the transaction that
  writes, exactly as `requireApproverStaffId` already is.

Filtering a list is not a control: a scoped approver holding an id from a link,
a bookmark, or a page loaded before the scope narrowed still reaches the action.
That is the argument `booking-brand-scope-guard.test.ts` was written for, and
AP-4 gets its own guard of the same shape.

**The claim brand maps to a target through `AccBrandErpInterface`**, the same
map AP-1 uses — read per form, `FormCode='AP-4'` with the `NULL` default
behind it. A claim whose brand maps to no target is visible to nobody but an
admin, and that is the fail-safe direction.

### What must not be lost with the tab

- **The two commissioning banners.** `ReimburseApproverSettings.tsx:144-156`
  warns at **0 active** approvers and at **exactly 1**. The second is the one
  its own docblock calls "the one that looks fine until it is tried": with one
  approver the two-person rule stalls every claim permanently at
  `ACCOUNT_FINAL`. Both move to the merged grid.
- **The queue's notice copy** ends by directing the reader to
  `ตั้งค่าขอเบิกเงินคืนพนักงาน → ผู้อนุมัติบัญชี`, a tab that stops existing.
- **`parseTabKey` falls back to `approvers`** for an unknown `?tab=`; the
  fallback becomes `access`, and the page's docblock about opening on the
  approver tab is rewritten — an empty approver pool is still the thing that
  stops AP-4 dead, and สิทธิ์เข้าถึง is now where it is fixed.
- **`setReimburseItemAccounts`' own roster check.** `authorizeAccRequest(…,
  "read")` also admits AP-1's shared `AccApprover` through
  `buildAccAclViewer`'s `isSharedAccountArea || ownFormApprover` OR, which is
  why that route carries a second check. It stays, and gains the brand scope.

### Migration 144

`144_acc_reimburse_approver_brand.sql`, **both form databases, before the code**.

```
AccReimburseApproverBrand
  Id                  INT IDENTITY(1,1) PK
  ApproverId          INT NOT NULL   -- FK -> AccReimburseApprover(Id) ON DELETE CASCADE
  InterfaceBrandCode  NVARCHAR(20) NOT NULL
  CreatedAt           DATETIME2(7) NOT NULL DEFAULT SYSDATETIME()
  UNIQUE (ApproverId, InterfaceBrandCode)
  INDEX (ApproverId)
```

Mirrors `AccApproverInterfaceBrand` (migration 038) including the cascade.
`MASTER_TABLES` goes **27 → 28**; the table is dual-written, so its ids must
match across both databases and `npm run check:alignment` covers it.

**Backfill: none, and that is a decision.** `AccReimburseApprover` ships empty
(measured; CLAUDE.md records it), so there is nothing to backfill. **If it is
not empty when this ships, every existing approver has zero brand rows and
therefore approves nothing until an admin ticks a brand.** That is the
fail-safe direction and it must be stated in the deployment note, because the
alternative — treating zero rows as "all brands" — is exactly AP-1's bug.

---

## 4. Out of scope, recorded

- **The Business Central send.** Still not supplied. Nothing in §1 posts.
- **Fixing AP-1's zero-rows-means-all.** Ruled 2026-09-10: report only.
- **The journal Description template.** Global `AccSetting`, not per form;
  AP-4 has no send to use it.
- **`AccBrandErpTargetSetting`.** Still has no per-form writer anywhere.
- **Merging the two roster tables.** Only the screen merges.
