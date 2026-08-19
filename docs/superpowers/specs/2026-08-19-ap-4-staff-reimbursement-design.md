# AP-4 — ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)

## Solution Design

**Form code:** `AP-4` · **Running prefix:** `RBM` · **Group:** Accounting
**Name (TH):** ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)
**Name (EN):** Staff Reimbursement

An employee pays for something out of pocket, itemises it, attaches the receipts,
and claims the money back. Three approvals, then a payment date on the 1st or 3rd
Friday of a month.

---

## 0. Decisions already taken

Recorded here because each one closes an alternative the implementation would
otherwise have to weigh again.

| # | Decision | Why |
|---|---|---|
| 1 | **Line items are captured in the form**, and the AP-4.1 Excel is attached alongside | A total alone cannot be searched, reported on, or turned into an ERP journal. The Excel stays because Accounting works from the printed sheet. |
| 2 | **Form code is `AP-4`, not `AP-04`** | Every existing code is unpadded — `AP-1`, `AP-2`, `AP-15`, `AP-17`. The value is written into the database, URLs and a TypeScript union; a later change means touching every stored row. |
| 3 | **One approver pool covers both accounting steps**, in its own table `AccReimburseApprover` | Follows AP-2's precedent that a new form owns its approver list. Sharing `AccApprover` would make an edit for AP-4 silently change who can approve AP-1. |
| 4 | **The same person may not action both accounting steps** on one request | Otherwise step 3 is the same person signing twice and reviews nothing. Money leaves the company on exactly one pair of eyes. |
| 5 | **Payment dates are the 1st and 3rd Friday only** | The notice text promises those two rounds. "Any Friday" would let a request be dated to a round on which nobody pays. |
| 6 | **`CK_AccApproval_Step` is widened to admit `ACCOUNT_FINAL`** | See §3.1. |

---

## 1. Where AP-4 sits

AP-4 is the fourth form on the shared Accounting backbone. It reuses, unchanged:

- `AccRequest` — the request header (status, running number, brand, requester
  snapshot, `PaymentDate`, `TotalAmount`)
- `AccApproval` — one row per approval step
- `AccRequestFile` — attachments
- `AccActivityLog` — the timeline
- `AccSequence` — running numbers
- `AccEmailQueue` — notification mail
- `AccFormMaster` — the form catalogue
- `AccFormBrand` — which brands a form may be claimed against

and adds four tables of its own (§2).

**File layout** follows AP-2's, which is the most recent new form:

```
src/app/(dashboard)/request/reimburse/           page.tsx, [id]/page.tsx, settings/page.tsx
src/app/api/request/reimburse/                   the form's own routes
src/features/reimburse/                          components, hooks, constants, types
src/lib/acc/reimburse/                           request-service, approval, payment-calendar, settings-service
migrations/088_*.sql onward                      see §7
```

---

## 2. Data model

### 2.1 `AccReimburse` — one row per request

| Column | Type | Notes |
|---|---|---|
| `RequestId` | INT PK, FK → `AccRequest.Id` | 1:1 |
| `Purpose` | NVARCHAR(500) NULL | free text, what the spend was for |
| `TotalAmount` | DECIMAL(18,2) NOT NULL | VAT-inclusive; the sum of the items, recomputed server-side at submit |
| `ExcelFileId` | INT NULL, FK → `AccRequestFile.Id` | the AP-4.1 workbook |
| `RulesAcceptedAt` | DATETIME2 NULL | when the ticks were made. The ticks themselves are rows in §2.4 — this is only the timestamp, so "when did they agree" needs no aggregate over that table. |

`AccRequest.TotalAmount` is written from the same figure so list rows, the report
and the payment queue all read one number.

### 2.2 `AccReimburseItem` — the expense lines

| Column | Type | Notes |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `RequestId` | INT FK → `AccRequest.Id`, ON DELETE CASCADE | |
| `SortOrder` | INT NOT NULL | the order the user arranged them in |
| `ExpenseDate` | DATE NOT NULL | when the money was spent |
| `Description` | NVARCHAR(500) NOT NULL | |
| `Amount` | DECIMAL(18,2) NOT NULL | VAT-inclusive |
| `VatAmount` | DECIMAL(18,2) NULL | |
| `WhtAmount` | DECIMAL(18,2) NULL | withholding tax, where the service exceeded 1,000 THB |

### 2.3 `AccReimburseRule` — the acknowledgement checklist

The list of statements a requester must tick before submitting. Editable at
Settings, so Accounting can change the wording without a deploy.

| Column | Type | Notes |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `RuleText` | NVARCHAR(1000) NOT NULL | Thai, shown verbatim |
| `SortOrder` | INT NOT NULL | |
| `IsActive` | BIT NOT NULL DEFAULT 1 | soft delete, so a submitted request's ticks stay explainable |
| `UpdatedBy` / `UpdatedAt` | | |

Seeded with the one rule given: *ส่งเอกสารตัวจริงให้บัญชีภายในวันจันทร์ 12.00 เพื่อรับเงินวันศุกร์*

### 2.4 `AccReimburseRuleAck` — which rules a request ticked

Recording the ticks against rule ids rather than a single boolean means a request
approved last month can still be shown with the wording that was in force when it
was submitted, after Settings has been edited.

| Column | Type |
|---|---|
| `RequestId` | INT FK → `AccRequest.Id`, ON DELETE CASCADE |
| `RuleId` | INT FK → `AccReimburseRule.Id` |
| PK | (`RequestId`, `RuleId`) |

### 2.5 `AccReimburseApprover` — the accounting pool

| Column | Type | Notes |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `StaffId` | INT NOT NULL UNIQUE | HR identity |
| `Email` | NVARCHAR(200) NOT NULL | |
| `DisplayName` | NVARCHAR(200) NOT NULL | |
| `IsActive` | BIT NOT NULL DEFAULT 1 | soft delete |
| `CreatedBy` / `CreatedAt` / `UpdatedBy` / `UpdatedAt` | | |

One pool, both accounting steps (decision 3). Which of the two steps a given
person ends up actioning is decided by who gets there first, bounded by the
two-person rule in §3.3.

### 2.6 Catalogue rows

- `AccFormMaster`: `AP-4` · Accounting · `RBM` · `SortOrder = 4` · active
- `AccFormBrand`: one row per brand AP-4 may be claimed against, managed at
  Settings exactly as AP-1's are

---

## 3. Approval

### 3.1 Three steps on a two-step constraint

`AccApproval.StepCode` is guarded by `CK_AccApproval_Step`, which today admits
only `MANAGER` and `ACCOUNT` — verified against both databases. AP-4 needs three.

**The constraint is widened to admit `ACCOUNT_FINAL`.** Widening a CHECK cannot
invalidate a stored row, so AP-1, AP-2 and AP-17 are unaffected and the migration
needs no data pass. It must be applied to `Rocks_Portal_Form` and
`Rocks_Portal_Form_UAT` alike.

The two alternatives were rejected:

- *Two `ACCOUNT` rows told apart by `StepOrder`.* No schema change, but every
  query that filters `StepCode = 'ACCOUNT'` would have to carry an order as well,
  and AP-2 has already overloaded `MANAGER` for its Head Accounting role. A second
  overload in the same shared table makes step identity positional and unreadable.
- *A private approval table for AP-4.* Clean isolation, but the timeline, My Work
  and the reports all read `AccApproval`; AP-4 would drop out of every one of them.

### 3.2 The flow

| Step | `StepCode` | `StepOrder` | Who | Action |
|---|---|---|---|---|
| 1 | `MANAGER` | 1 | `Rocks_Portal_HR.Employee.ManagerStaffId` of the requester | Approve · Reject (**reason required**) |
| 2 | `ACCOUNT` | 2 | any active `AccReimburseApprover` | Check + choose `PaymentDate` · Approve · Reject (**reason required**) |
| 3 | `ACCOUNT_FINAL` | 3 | any active `AccReimburseApprover` **except the actor of step 2** | Approve · Reject (**reason required**) |

### 3.2.1 Status, and why there is no new one

`CK_AccRequest_Status` admits `Draft | Submitted | ManagerApproved | Approved |
Rejected | Returned | Cancelled | Completed` — verified against the live
database. A third step is a third *place to be*, but not a third status:

| After | `Status` | `CurrentStepCode` |
|---|---|---|
| submit | `Submitted` | `MANAGER` |
| step 1 | `ManagerApproved` | `ACCOUNT` |
| step 2 | `ManagerApproved` | `ACCOUNT_FINAL` |
| step 3 | `Approved` | `NULL` |

`CurrentStepCode` already carries which step is pending, so the two accounting
stages are distinguishable without a schema change. **`CK_AccRequest_Status` is
therefore left alone** — one widened CHECK on a shared table is a considered
cost, two is a habit.

The consequence to accept: a requester's status badge reads the same through both
accounting steps. That matches what they can act on, which is nothing either way.
Accounting's own queue splits the two on `CurrentStepCode`, which is what it
already does for AP-1.

A rejection at any step sets `Rejected` and clears `CurrentStepCode`; the reason
is stored on the approval row and shown on the timeline.

Returning for revision reuses AP-1's behaviour, including the fix that a returned
request **keeps its running number** when resubmitted.

### 3.3 The two-person rule

Step 3 refuses the StaffId that actioned step 2. Enforced server-side in the
approval service, not only in the UI — the UI hides the button, the service is
what makes it true. The message names the reason rather than saying "no
permission", because the person genuinely is an approver.

### 3.4 Payment date

A new `getReimbursePaymentDates()` beside the existing AP-1 calendar. Same
holiday source (`Rocks_Codex.Holiday`) and the same backward shift off weekends
and holidays; the only difference is which Fridays it offers.

- Valid dates: the **1st and 3rd Friday** of each month, holiday-shifted
- The picker accepts nothing else
- Default, stated so there is one reading of it: take the moment step 2 is being
  actioned. Find the most recent Monday 12:00 at or before it. The default is the
  **first payment round strictly after that Monday noon**. So a check on Monday
  at 11:00 defaults to that week's Friday if that Friday is a round; a check on
  Monday at 13:00, or any time Tuesday to Sunday, defaults to the next round
  after the coming Friday. Holiday shifting is applied after the round is chosen,
  so a shifted date is still the same round.

The approver can override the default with any other valid round — the default is
a convenience, not a lock.

AP-1's `getPaymentDates()` (2nd and 4th Friday) is left alone. The two forms pay
on different rounds and one function cannot answer for both.

---

## 4. Running number

`RBM` + two-digit year + five digits: `RBM26-00001`.

`allocateRequestNo` already keys `AccSequence` on prefix **and** year, so the
first submit of 2027 starts `RBM27-00001` with no intervention. AP-4 supplies the
prefix from `AccFormMaster.RunningPrefix` and inherits everything else, including
the UAT floor that starts test numbers at `09001` (§6).

---

## 5. Form UI

### 5.1 The notice

A read-only panel at the top of the form, before any input, carrying the
instructions as written by Accounting. Content is business copy and is stored in
the codebase as a constant, not in the database — it is prose, not configuration,
and it changes with process rather than with a setting.

It covers: printing the Excel summary and submitting originals within one month;
withholding tax on services over 1,000 THB and its 5th-of-next-month deadline;
originals go to the Senior AP Accountant; travel costs and deposits may not be
claimed here; spends over 3,000 THB should go through PR unless urgent, with a
stated reason; SC/PCM inventory items always need a PO; van hire and fuel need
the registration on the receipt plus a photo showing the plate; claims of 500 THB
or under go through the department's petty cash, except birthday cakes and
get-well baskets which go through HR; and the cut-off — approved by Monday 12:00,
paid on the 1st and 3rd Friday.

### 5.2 Fields

| # | Field | Required | Source / behaviour |
|---|---|---|---|
| 1 | รหัสพนักงาน | — | read-only, the signed-in user's `StaffId` |
| 2 | ชื่อ-สกุล | — | read-only, `Rocks_Portal_HR.Employee` `FirstName` + `LastName` |
| 3 | แบรนด์ที่เบิก | ✔ | picker limited to AP-4's rows in `AccFormBrand` |
| 4 | รายการค่าใช้จ่ายจริง | ✔ | the repeating grid of §2.2; the form totals it live, the server recomputes at submit. At least one line. |
| 4b | ไฟล์ Excel (AP-4.1) | ✔ | one workbook, attached |
| 5 | หลักฐาน (ใบเสร็จ/ใบกำกับภาษี) | ✔ | images or PDF, many files |
| 6 | ระเบียบการจ่าย Reimburse | ✔ | every active `AccReimburseRule`, all must be ticked |

Submit is refused until 3, 4, 4b, 5 and every rule in 6 are satisfied. The
missing-item list follows AP-1's pattern: named, in order, above the button.

### 5.3 Pages

| Route | Purpose |
|---|---|
| `/request/reimburse` | fill, save draft, resume, submit |
| `/request/reimburse/[id]` | detail, timeline, self-cancel within 24 h of submit and before the manager acts |
| `/request/reimburse/settings` | the rule list and the brand allowlist (Accounting admin) |

The approval queue is the existing Accounting approvals page, which reads
`AccApproval` and therefore picks AP-4 up once the step codes exist. **The AP-1
filters added to `queryReport` and `listErpPrepRows` mean AP-4 will not appear in
AP-1's report or ERP queue** — correct, and if AP-4 ever needs either, it gets
its own rather than having those filters loosened.

---

## 6. Environment and routing — do not skip

AP-2 shipped without this and its consequences are visible today: its `ADV`
numbers were allocated from 1 instead of the UAT floor, and its Form Environment
switches do nothing because nothing can resolve to a code the router does not
know.

AP-4 must register in four places:

1. `FormCode` union in `src/lib/form-environment/classify-path.ts`
2. `FORM_CODES` in the same file
3. A rule in `ROUTE_RULES` mapping `/request/reimburse` and
   `/api/request/reimburse` to `"AP-4"`
4. A `Fast_Core.dbo.FormEnvironment` row for `AP-4`

Without all four the form silently inherits AP-1's environment, misses the UAT
running-number floor, and its switches on the Settings page are inert.

---

## 7. Migrations

Numbered from **088**. Master is at 066; the AP-2 branch holds 073–087, so 088 is
clear whichever branch merges first.

| # | Contents |
|---|---|
| 088 | `AccReimburse`, `AccReimburseItem` |
| 089 | `AccReimburseRule`, `AccReimburseRuleAck`, seed the first rule |
| 090 | `AccReimburseApprover` |
| 091 | Widen `CK_AccApproval_Step` to admit `ACCOUNT_FINAL` |
| 092 | `AccFormMaster` + `AccFormBrand` rows for AP-4 |

Every one runs against **both** `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`,
following the convention for `Acc*` tables. The `FormEnvironment` row is a
Fast_Core migration and runs there only.

---

## 8. Testing

The suite is `tsx --test` over pure functions, listed explicitly in
`package.json`. AP-4 adds:

- **The payment calendar** — 1st and 3rd Friday for a month starting on each
  weekday; the shift when a payment Friday is a holiday; the default round either
  side of the Monday-12:00 cut-off; and that a date which is a Friday but neither
  the 1st nor the 3rd is rejected.
- **The two-person rule** — a pure predicate over (step-2 actor, candidate), so
  the rule is testable without a database.
- **Item totals** — the sum the form shows equals what the server recomputes,
  including empty, one-line and rounding cases.

---

## 9. Out of scope

- **ERP / Business Central posting.** AP-4 has no journal mapping and the ERP prep
  queue is AP-1's. If AP-4 needs to post, that is its own design.
- **Excel parsing.** The workbook is stored and handed on. The portal does not
  read it, and the line items in the form are the machine-readable copy.
- **Editing an approved request.** Rejection and resubmission is the route back.
