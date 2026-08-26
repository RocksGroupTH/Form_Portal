# AP-4 — the accounting work area, ERP interface, and document clearance

**Date:** 2026-08-26
**Branch:** `feat/ap-4-reimbursement`
**Status:** design agreed, not built

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
