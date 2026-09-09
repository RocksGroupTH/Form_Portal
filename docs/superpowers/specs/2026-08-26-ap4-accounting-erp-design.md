# AP-4 — the accounting work area, ERP interface, and document clearance

**Date:** 2026-08-26
**Branch:** `feat/ap-4-reimbursement`
**Status:** design agreed, not built

---

## Amendment — 2026-09-08

**Stage 1 (§3) shipped**, on `feat/ap4-accounting-and-erp`, fourteen commits
(`1db0bb9..2769193`) — the plan is
`docs/superpowers/plans/2026-09-08-ap4-accounting-queue.md`. This block is
what a reader following the body below needs corrected; the body itself is
left as written on 2026-08-26, dated history rather than current state.

- **The payment date is not a round-membership choice, contrary to §3.2.**
  §3.2 describes the queue's control as offering "one payment date for the
  whole selection, from `getReimbursePaymentOptions`" — a list of 1st/3rd-
  Friday rounds. What shipped instead is `paymentDateProblem`
  (`approval-policy.ts`): a one-month-back/twelve-months-forward sanity
  bound, so accounting may pick any real calendar date and the round is
  offered only as the field's default. `PAYMENT_DATE_NOT_A_ROUND` and its 409
  never shipped — see CLAUDE.md's AP-4 section for why a fixed bound replaced
  a membership test.
- **The queue shows a granted non-approver EVERY claim, not the empty queue
  §3.3 promises.** §3.3 says "a person with the tick and no approver row sees
  an empty queue and cannot act". What shipped is the second half only: the
  route answers every row parked at `(ManagerApproved, ACCOUNT)` to anyone
  holding the `approvalQueue` grant, and authority is re-decided per action by
  the approval service against `AccReimburseApprover`, inside the transaction
  that writes. **The shipped behaviour is the one kept**, ruled 2026-09-08 on
  review: filtering the queue by the approver roster would conflate "may see"
  with "may act", which is the exact coupling `AccReimburseAccess` was added to
  prevent — a grant that only ever shows an empty page is not a grant, and the
  filter would be a second, weaker copy of an authorization rule that already
  lives where the money moves. The defect was that a spec decision had been
  reversed silently; it is recorded here and in CLAUDE.md's AP-4 queue
  paragraph rather than reverted. The consequence — an empty
  `AccReimburseApprover` means select-all → approve → N failures — is answered
  by a **notice**, not a filter: `/api/request/reimburse/access` reports
  `isReimburseApprover` and the queue says so before the first click.
- **A G/L-account picker shipped that this spec never scoped.**
  `PATCH /api/request/reimburse/requests/[id]/items` lets accounting correct
  the AI-proposed `AccReimburseItem.Category` per line, from the queue, while
  the claim is still at `ACCOUNT`. §5.2 below is still accurate about what
  stage 3 will do to that column — this route edits it under its current name
  and type, and does not touch the rename.
- **§7's migration number and the alignment-table count in §4/§7 are both
  stale.** 122 is taken — the tree runs to 143. How many migration numbers
  are currently duplicated is not worth pinning down here: it was eleven when
  this amendment was first drafted and is twelve as of this correction — `137`
  joined (`137_acc_advance_payee_bank_branch.sql` and `137_fx_rate_cache.sql`)
  when the AP-2 work merged into this branch's base — and a count that moves
  under a merge is exactly why the sentence's own advice, `ls migrations/`, is
  the only thing here safe to rely on; do not restate a number and expect it
  to still be right. `check:alignment`'s target is **27** tables, not 25:
  AP-17's per-diem-by-country and brand-scoped-access migrations (133, 134)
  moved it after this spec was written. Neither figure matters to what
  shipped — **stage 1 needed no migration at all**, which §7 already says and
  is the fact most likely to be missed by a reader who follows its migration
  table rather than its prose.

**Stage 2 (§4) is scoped here but not started** — per-AP-4 ERP settings gets
its own plan. **Stages 3 and 4 (§5, §6) remain blocked on this spec's own open
item #1**: whether Business Central's posting call returns the posted
document number has never been measured, and §5.3's PV-number design depends
on the answer. Until it is measured, CLAUDE.md's "AP-4 never reaches Business
Central, deliberately" is still true — stage 3 is what makes it false, and
that paragraph is rewritten there, not here.

## Amendment — 2026-09-09

**Stage 2 (§4) shipped**, on the same branch, plan
`docs/superpowers/plans/2026-09-09-ap4-hub-erp-settings-and-queue.md`. It
carried two things §4 did not scope — a read-only Interface ERP queue, and the
merge of AP-4's two hub cards into one — because the user asked for both
directly.

- **Open item #1 is answered, and it never needed measuring.** §10 asks
  whether Business Central's posting call returns the posted document number,
  and treats the answer as blocking stages 3 and 4. It is not blocking and the
  question was already settled in the code: **`AccRequest.ErpDocumentNo`
  exists** (migration 108) and **two forms already write it** — AP-2's and
  AP-3's senders both extract `results[].documentNo` from the response. So
  §5.3's proposed `AccRequest.ErpPvNo` is a **third** name for a column that
  is already there twice over and should not be added. What stages 3 and 4
  are actually blocked on is narrower and entirely external: nobody has
  supplied the Business Central call itself.
- **The queue reads `(Approved, NULL)`, not `(ManagerApproved, ACCOUNT_FINAL)`
  as §6 designs.** That is a consequence of stage 4 not being built rather
  than a disagreement with it: §6 moves `ACCOUNT_FINAL` to after the send, and
  that move must land **after** a sender exists — done first, every approved
  claim parks at a step nothing can advance. While `ACCOUNT_FINAL` is still
  terminal, `Status='Approved'` is what names a finished claim, so that is
  what the queue selects. When stage 4 lands, this predicate moves with it.
- **The queue is read-only and says so on screen.** No send button, no
  selection, no export. There is nothing to post with, and
  `CK_AccRequest_ErpInterfaceStatus` admits only `Pending`/`Sent`/`Failed` —
  no value means "waiting for a sender that does not exist" — so neither a
  button nor a status was invented to fill the gap.
- **"Ready to post" is derived from the item rows, and nothing gates on it
  yet.** `AccReimburseItem.Category` may be null or blank on a claim that has
  cleared both accounting steps, and `setReimburseItemAccounts` claims
  `CurrentStepCode='ACCOUNT'`, so a claim can reach this queue unready with no
  in-app path to correction. Stage 3 resolves it: either a readiness gate at
  `ACCOUNT_FINAL` or a widened edit window. Recorded rather than patched,
  because guessing which belongs to the send's design.
- **`AccBrandErpTargetSetting` is one of the seven per-form tables and has no
  per-form writer anywhere in `src/`** — measured 2026-09-09, zero override
  rows on any form. A settings section for a table nothing writes is a control
  with no counterpart, so AP-4's Interface ERP tab does not have one; a form
  can still *read* an override of it that nothing can create.
- **AP-4's Interface ERP tab writes four of the seven, and the G/L account is
  deliberately not one of them.** It covers `AccBrandErpInterface` (Company
  ปลายทาง), `AccBrandBankAccount`, `AccBrandJournalBatch` and
  `AccBrandBranchCode`. §4 assumes a G/L account field; AP-2 dropped it because
  Business Central resolves the debit account from the matched vendor's posting
  group, and AP-4 followed. So the seven divide as four written, one
  (`AccBrandErpTargetSetting`) written by nothing anywhere, and two
  (`AccBrandGlAccount`, `DepartmentErpMap`) untouched by AP-4.
- **§4's premise that overrides are unreachable from any UI was already false
  when this spec was written.** AP-2 has written per-form rows since its
  branch merged — 14 of them across five tables, measured 2026-09-09 and
  identical in both form databases. CLAUDE.md said the same thing and has been
  corrected in the same commit as this block.

---

AP-4 today stops being interesting the moment the manager approves. The two
accounting steps exist and work, but there is no queue to work them from, no
route to Business Central, and no record of what was paid. This spec covers
building that out to match what AP-1 has, plus the two things AP-4 needs that
AP-1 does not.

It **reverses a decision CLAUDE.md records deliberately** — "AP-4 never reaches
Business Central" — on the requester's explicit instruction. That note must be
rewritten as part of this work, not left contradicting the code.

---

## 1. Decisions taken

Each of these was asked and answered before this spec was written. They are
recorded with their reasoning because the reasoning is what a later reader will
want when the code looks arbitrary.

| Question | Decision |
|---|---|
| Where does *เคลียร์เอกสารอนุมัติ* sit? | It **is** `ACCOUNT_FINAL`, moved to after the ERP send. No fourth step, no migration on `CK_AccApproval_Step`. |
| Which roster carries the menu ticks? | The **สิทธิ์เข้าถึง** tab (`AccReimburseAccessTab`). Raised as a semantic clash with that page's own copy — that roster grants *sight of settings*, not *authority over money* — and confirmed anyway. The page's copy changes to match. |
| Reject vs Revise | **Both accounting steps lose Reject**; only *ส่งกลับแก้ไข* remains. The manager keeps Reject. |
| Two-person rule | **Stays.** `canActFinalStep` still refuses when the `ACCOUNT` actor and the `ACCOUNT_FINAL` actor match, and still refuses when either StaffId is absent. |
| PV number | **One per request**, a column on `AccRequest` beside `ErpInterfaceSentAt`. |
| ERP send core | **Shared with AP-1**, parameterised by `formCode`. Not copied. |

### Why the send core is shared

`sendErpInterfaceBatch` contains the two properties CLAUDE.md records as having
cost duplicated financial journals when they were absent: the atomic
`claimRequestsForSend`, and the refusal to retry an outcome the remote never
confirmed (`holdForReconciliation`). That is the last code in this repository
that should exist in two copies.

What is pinned to AP-1 there is a **value**, not a structure —
`resolveErpTargetProfile(target, AP1_FORM_CODE)` and
`loadErpJournalBuildContext(AP1_FORM_CODE)` both already take the form code as a
parameter. Threading it through from the caller is not the pin-removal CLAUDE.md
warns about; AP-1's routes keep passing `AP1_FORM_CODE` and behave identically.

**What cannot be shared** is the row loader. `listErpPrepRows` LEFT JOINs
`AccTravelExpense` and reads `VehicleName` / `WorkDetail`; it is
travel-expense-specific by construction. AP-4 gets its own loader over
`AccReimburse` / `AccReimburseItem`, and the two are selected by form code at
the one call site that knows which form it is serving.

---

## 2. The state machine

```
Draft ─submit─▶ Submitted (MANAGER)
                   │
        ┌──────────┼───────────┬──────────────┐
     approve     reject      return       (requester)
        │          │            │          self-cancel ≤24h
        ▼          ▼            ▼               │
  ManagerApproved  Rejected   Returned ◀────────┘
      (ACCOUNT)
        │
        │  ── รออนุมัติ ──  approve sets PaymentDate
        │                   return ▶ Returned      (no reject)
        ▼
  ManagerApproved (ACCOUNT_FINAL), ErpInterfaceStatus NULL
        │
        │  ── Interface ERP ──  claim ▶ Pending ▶ Sent, PvNo stored
        ▼
  ManagerApproved (ACCOUNT_FINAL), ErpInterfaceStatus = 'Sent'
        │
        │  ── เคลียร์เอกสารอนุมัติ ──  multi-select, optional reason
        │                              return ▶ Returned   (no reject)
        ▼
     Approved
```

**The step tuple does not change.** A request sits at
`(ManagerApproved, ACCOUNT_FINAL)` both before and after the send; what moves it
between the two queues is `ErpInterfaceStatus`. This is what makes the move a
query change rather than a schema change.

**Consequence to design around:** `ACCOUNT_FINAL` opens at the moment `ACCOUNT`
approves, so its `AccApproval` row exists while the request is still waiting to
be interfaced. The clearance queue must filter on `ErpInterfaceStatus = 'Sent'`
and the approve route must re-assert it, or a request can be cleared before it
has posted.

---

## 3. Stage 1 — access flags and the approval queue

Shippable alone. Ends at `ACCOUNT_FINAL` exactly as today.

### 3.1 The menu ticks

Two new keys in `AccReimburseAccessTab.TabKey`:

| Key | Grants sight of | Default |
|---|---|---|
| `approvalQueue` | รออนุมัติ **and** Interface ERP | ticked |
| `clearance` | เคลียร์เอกสารอนุมัติ | unticked |

Both ticked shows both. Neither ticked shows no approval menu at all — stated by
the requester, and it is the fail-safe direction.

**No migration.** `AccReimburseAccessTab` has no CHECK on `TabKey`, which is also
why `decideReimburseTabAccess` refusing an unknown key is what makes a stray row
inert. The two new keys sit beside `GRANTABLE_REIMBURSE_TABS` but are **not**
settings tabs: they need their own union, because `requireReimburseSettingsTab`
must not accept them as a settings grant.

"Default = ticked" is a **UI default on the add dialog**, not a database default.
An existing row with no ticks grants nothing, unchanged.

`/api/request/reimburse/access` gains `approvalQueue` and `clearance` booleans
alongside `admin` / `settingsTabs` / `canSettings`.

**Admins:** as with settings tabs, an admin sees every menu. Membership alone
still grants nothing.

### 3.2 The queue

New page `/request/reimburse/approvals`, new route
`GET /api/request/reimburse/approvals`.

- lists `(ManagerApproved, ACCOUNT)` rows the viewer may act on
- one payment date for the whole selection, from `getReimbursePaymentOptions`
- multi-select approve
- **ส่งกลับแก้ไข only** — the Reject button is not rendered, and
  `POST .../reject` refuses a non-`MANAGER` step server-side. A control removed
  from a page is not a rule.
- a returned request needs a comment; `returnCommentOrError` already enforces it

### 3.3 Authorization

`AccReimburseApprover` decides who may approve, unchanged. The tick decides who
sees the menu. Both are checked: a person with the tick and no approver row sees
an empty queue and cannot act, which is correct and needs no special case.

---

## 4. Stage 2 — per-AP-4 ERP settings

Two tabs added to `/request/reimburse/settings`: **แผนก (HR ↔ ERP)** and
**Interface ERP**.

The per-form configuration rule already exists and is documented under "Per-form
ERP configuration" — seven brand-keyed tables carry `FormCode`, where `NULL` is
the default and a row naming a form overrides it. **This is the first UI that
writes an override.** Everything it needs is in
`src/lib/acc/per-form-config.ts`; the rule must not be hand-written anywhere
else.

Concretely, AP-4's editors write with `perFormWriteMatch("AP-4")` where AP-1's
write `perFormWriteMatch(null)`, and read with `formCode` supplied rather than
omitted — absent means defaults-only, which is the fail-safe direction and the
wrong one here.

**Two hazards to carry into the plan:**

- **Six of the seven tables are dual-written** and in `MASTER_TABLES`.
  `brand-account-service`, `brand-branch-service`, `brand-journal-batch-service`,
  `brand-erp-interface-map-service` and `erp-target-setting-service` all go
  through `writeBothPools`; an override created outside them lands in one
  database and reds `check:alignment`.
- **`department-map-service` does not dual-write, and must not.**
  `DepartmentErpMap` has exactly one physical copy, production only, reached from
  `Fast_Core` by a permanent synonym for the two sibling applications. The AP-4
  department tab writes through `getProductionFormPool()` like the AP-1 one, and
  stays **admin-only** for the reason CLAUDE.md gives: those rows are another
  application's posting configuration.

---

## 5. Stage 3 — Interface ERP and the PV number

### 5.1 What is shared, and where the seam is

```
                     AP-1 route ──┐            ┌── AP-4 route
                                  ▼            ▼
                         sendErpInterfaceBatch({ formCode, … })
                                  │
              ┌───────────────────┼────────────────────┐
              ▼                   ▼                    ▼
      row loader (per form)   claim batch          classify outcome
      AP-1: AccTravelExpense  atomic, all-or-       4xx ▶ Failed
      AP-4: AccReimburse*     nothing               else ▶ hold for
                                                    reconciliation
```

The seam is the row loader and the journal-line builder. Everything below it is
one copy.

### 5.2 AP-4's journal lines

Each `AccReimburseItem` already carries the G/L account the document read
matched, in `AccReimburseItem.Category`. A line is that account for the item's
amount; the balancing line is the brand's bank or payable account, resolved
through the same per-form configuration AP-1 uses.

**Rename `Category` to `ErpAccountNo` as part of this stage.** Migration 117
documents that column as "free text such as 'AP-4.2'", which is what it was
built for and is no longer what it holds. Once money posts according to its
value, a name that misdescribes it is a trap. There is no production data to
migrate — `AccReimburseItem` was measured empty in both form databases — so the
rename is free today and will not be later.

### 5.3 The PV number

`AccRequest.ErpPvNo NVARCHAR(50) NULL`, written in the same statement that sets
`ErpInterfaceStatus = 'Sent'` and `ErpInterfaceSentAt`. Not a separate write: a
PV recorded outside the transaction that marks the row Sent can disagree with it,
and that disagreement is unresolvable from the outside.

Shown on the request detail page and in the clearance queue.

**Where it comes from must be confirmed against a real Business Central response
before the plan is written.** This spec assumes the posted journal's document
number is returned by the same call that posts it. If it is not, the PV needs a
second read against BC and that changes stage 3's shape.

### 5.4 What does not change

The drift check, the 409s, the reconciliation hold, and the rule that an unknown
remote outcome is never retried. AP-4 inherits all of it by using the same
function.

---

## 6. Stage 4 — clearance, and moving the step

### 6.1 The page

`/request/reimburse/clearance`, listing `(ManagerApproved, ACCOUNT_FINAL)` rows
with `ErpInterfaceStatus = 'Sent'`. Multi-select approve, with an optional
free-text reason per request number. Approving moves the request to `Approved`.

Return is available here too, and requires a comment. Reject is not.

### 6.2 The move

Today `ACCOUNT_FINAL` is actionable the moment `ACCOUNT` approves. After this
stage it is actionable only once the request has posted. Two enforcement points,
both required:

- the queue query filters `ErpInterfaceStatus = 'Sent'`
- `approveReimburseFinal` re-asserts it inside the claim, so a stale tab or a
  direct call cannot clear an un-posted request

The second is the real one. The first only decides what is on screen.

### 6.3 Ordering

This stage must land **after** stage 3. Moving the step before there is anything
to post leaves every approved request parked with nothing able to advance it.

---

## 7. Migrations

| # | Target | Contents |
|---|---|---|
| 122 | both form databases | `AccRequest.ErpPvNo`; rename `AccReimburseItem.Category` → `ErpAccountNo` |

Stage 1 needs none. Stage 2 needs none — 097 already added `FormCode` to the
tables it writes. Stage 4 needs none, because the step tuple is unchanged.

`npm run check:alignment` after 122 — it must stay at 25 tables.

---

## 8. Testing

Pure, unit-tested without a database, in the shape the existing AP-4 modules
use:

- the two new access keys: granted / not granted / unknown key inert
- the queue predicate: which `(status, step, ErpInterfaceStatus)` tuples appear
  in รออนุมัติ, in Interface ERP, in เคลียร์เอกสารอนุมัติ, and in none of them
- the reject refusal at both accounting steps
- `canActFinalStep` unchanged, including the absent-StaffId refusal
- the AP-4 journal-line builder against a claim with several items and a WHT

Route-gate coverage in the shape `settings-route-gates.test.ts` already uses:
read the route sources, assert each handler's gate is its first `await` and that
its refusal is returned.

---

## 9. Documentation to correct

CLAUDE.md says, in the AP-4 section:

> **AP-4 never reaches Business Central, deliberately.** … Adding AP-4 to either
> is a decision, not a bug fix.

That sentence is correct as of today and becomes false at stage 3. It is
rewritten then — not deleted, because the reasoning it records (a reimbursement
is paid, not posted as a travel journal) is what the AP-4 journal builder has to
answer for. The AP-1 report and the AP-1 ERP prep queue **stay pinned** to
`AP1_FORM_CODE`; AP-4 gets its own queue rather than joining theirs.

---

## 10. Open items

1. **The BC response's PV number** — §5.3. Must be measured before stage 3 is
   planned, not assumed.
2. **Commissioning is still unfinished and this makes it worse.**
   `AccReimburseApprover` is empty, so no claim can pass `ACCOUNT` today; with
   three queues instead of one, an empty roster now hides three pages. And
   migration 092 seeded `AccFormBrand` with `ROCKS`, which is not one of the four
   brands `src/lib/brand.ts` knows — an AP-4 claim on that brand has no ERP
   target to resolve.
3. **`ANTHROPIC_API_KEY` on the production server** has never been verified from
   this session. Unrelated to this work, still outstanding.
