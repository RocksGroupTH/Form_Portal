# AP-4 Staff Reimbursement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship AP-4 — an employee itemises money they spent out of pocket, attaches the AP-4.1 workbook and the receipts, and three approvals later it carries a payment date on the 1st or 3rd Friday of a month.

**Architecture:** AP-4 is the fourth form on the shared Accounting backbone. It reuses `AccRequest`, `AccApproval`, `AccRequestFile`, `AccActivityLog`, `AccSequence` and `AccEmailQueue` unchanged, and adds five tables plus a feature folder of its own. The only shared-schema change is widening one CHECK constraint so a third approval step can exist.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (ES5 target), Tailwind 4, MSSQL via `mssql`, numbered SQL migrations applied with `npm run apply-sql`.

**Spec:** `docs/superpowers/specs/2026-08-19-ap-4-staff-reimbursement-design.md` — read §0 before starting; it records six decisions that are already closed.

## Global Constraints

- `npx tsc --noEmit && npm test` must pass. **210 tests** pass at branch point `758be37`. `tsc` also reports ~24 errors under `.next/` from stale generated route types — those are pre-existing; **only `src/` errors count**.
- **Tests are auto-discovered.** `npm test` runs `scripts/run-tests.ts`, which walks `src/` for `*.test.ts`. Do **not** add test files to `package.json`.
- **Never** run `npm run build` or `npm run dev` — a dev server holds the port and `.next`.
- **Never** write to `Fast_Core` or `Fast_Data` except the one `FormEnvironment` row in Task 4. Never write to `Fast_Form` at all — it is the live Rocks Fast sibling's database.
- **Implementers do not apply migrations.** Write them; the controller applies and verifies.
- Every `Acc*` migration runs against **both** `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`.
- Parameterized SQL only: `pool.request().input("name", sql.Int, value).query(...)`. No values concatenated into statement text.
- API responses: `{ ok: true, data }` / `{ ok: false, error }`.
- Thai user-facing copy, English identifiers and comments. Comments explain *why*.
- ES5 target: `Array.from(...)`, never `[...set]` or `[...map.values()]`.
- CSS uses `var(--token)`, never raw hex. Icons from `lucide-react` only. Toasts via `sonner`.
- Money is `DECIMAL(18,2)` in SQL and `number` in TypeScript; format for display with the existing `fmtBaht`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `migrations/088_acc_reimburse.sql` … `092_*.sql` | schema and catalogue rows |
| `src/lib/acc/reimburse/payment-calendar.ts` | which Fridays are payment rounds, and which one is the default |
| `src/lib/acc/reimburse/calc.ts` | item totals — pure |
| `src/lib/acc/reimburse/two-person.ts` | the step-2/step-3 different-person rule — pure |
| `src/lib/acc/reimburse/request-service.ts` | draft, resume, submit, cancel |
| `src/lib/acc/reimburse/approval-service.ts` | the three steps |
| `src/lib/acc/reimburse/settings-service.ts` | rules and brand access |
| `src/features/reimburse/` | constants, types, form components, hooks |
| `src/app/(dashboard)/request/reimburse/` | `page.tsx`, `[id]/page.tsx`, `settings/page.tsx` |
| `src/app/api/request/reimburse/` | the form's routes |

---

### Task 1: Schema

**Files:**
- Create: `migrations/088_acc_reimburse.sql`, `089_acc_reimburse_rule.sql`, `090_acc_reimburse_approver.sql`, `091_acc_approval_step_final.sql`, `092_ap4_form_master.sql`

**Interfaces produced:** tables `AccReimburse`, `AccReimburseItem`, `AccReimburseRule`, `AccReimburseRuleAck`, `AccReimburseApprover`; `AccApproval.StepCode` additionally admits `'ACCOUNT_FINAL'`; `AccFormMaster` and `AccFormBrand` rows for `AP-4`.

Follow `migrations/063_core_uat_tester.sql` for shape: a header comment saying what and why, the `npm run apply-sql` line, `IF OBJECT_ID(...) IS NULL` guards so every file is re-runnable, and `GO` at column 0 between batches.

- [ ] **Step 1: `088_acc_reimburse.sql`**

```sql
-- AP-4's own detail tables — the request header stays in AccRequest.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/088_acc_reimburse.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/088_acc_reimburse.sql
IF OBJECT_ID('dbo.AccReimburse', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburse] (
  [RequestId]       INT NOT NULL CONSTRAINT [PK_AccReimburse] PRIMARY KEY,
  [Purpose]         NVARCHAR(500) NULL,
  [TotalAmount]     DECIMAL(18,2) NOT NULL CONSTRAINT [DF_AccReimburse_Total] DEFAULT (0),
  [ExcelFileId]     INT NULL,
  [RulesAcceptedAt] DATETIME2(7) NULL,
  CONSTRAINT [FK_AccReimburse_Request] FOREIGN KEY ([RequestId])
    REFERENCES [dbo].[AccRequest]([Id]) ON DELETE CASCADE
);
GO
-- ExcelFileId is deliberately NOT a foreign key to AccRequestFile: a file row is
-- deleted when the user swaps the workbook, and a FK would either block that or
-- cascade into the request. The service nulls it instead.
IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseItem] (
  [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseItem] PRIMARY KEY,
  [RequestId]   INT NOT NULL,
  [SortOrder]   INT NOT NULL CONSTRAINT [DF_AccReimburseItem_Sort] DEFAULT (0),
  [ExpenseDate] DATE NOT NULL,
  [Description] NVARCHAR(500) NOT NULL,
  [Amount]      DECIMAL(18,2) NOT NULL,
  [VatAmount]   DECIMAL(18,2) NULL,
  [WhtAmount]   DECIMAL(18,2) NULL,
  CONSTRAINT [FK_AccReimburseItem_Request] FOREIGN KEY ([RequestId])
    REFERENCES [dbo].[AccRequest]([Id]) ON DELETE CASCADE
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccReimburseItem_Request')
  CREATE INDEX [IX_AccReimburseItem_Request] ON [dbo].[AccReimburseItem] ([RequestId], [SortOrder]);
GO
```

- [ ] **Step 2: `089_acc_reimburse_rule.sql`**

```sql
-- The acknowledgement checklist, and which rules each request ticked.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/089_acc_reimburse_rule.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/089_acc_reimburse_rule.sql
--
-- Rules are soft-deleted and the ticks are stored per rule id, so a request
-- approved months ago still renders with the wording that was in force when it
-- was submitted, after Settings has been edited.
IF OBJECT_ID('dbo.AccReimburseRule', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseRule] (
  [Id]        INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseRule] PRIMARY KEY,
  [RuleText]  NVARCHAR(1000) NOT NULL,
  [SortOrder] INT NOT NULL CONSTRAINT [DF_AccReimburseRule_Sort] DEFAULT (0),
  [IsActive]  BIT NOT NULL CONSTRAINT [DF_AccReimburseRule_Active] DEFAULT (1),
  [UpdatedBy] INT NULL,
  [UpdatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseRule_Updated] DEFAULT (SYSDATETIME())
);
GO
IF OBJECT_ID('dbo.AccReimburseRuleAck', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseRuleAck] (
  [RequestId] INT NOT NULL,
  [RuleId]    INT NOT NULL,
  CONSTRAINT [PK_AccReimburseRuleAck] PRIMARY KEY ([RequestId], [RuleId]),
  CONSTRAINT [FK_AccReimburseRuleAck_Request] FOREIGN KEY ([RequestId])
    REFERENCES [dbo].[AccRequest]([Id]) ON DELETE CASCADE,
  CONSTRAINT [FK_AccReimburseRuleAck_Rule] FOREIGN KEY ([RuleId])
    REFERENCES [dbo].[AccReimburseRule]([Id])
);
GO
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccReimburseRule])
  INSERT INTO [dbo].[AccReimburseRule] ([RuleText], [SortOrder])
  VALUES (N'ส่งเอกสารตัวจริงให้บัญชีภายในวันจันทร์ 12.00 เพื่อรับเงินวันศุกร์', 1);
GO
```

- [ ] **Step 3: `090_acc_reimburse_approver.sql`**

```sql
-- AP-4's accounting approver pool. One pool covers both accounting steps; the
-- rule that the same person cannot take both is enforced in the service, not
-- here, because it is a property of one request rather than of the roster.
--
-- Its own table rather than AP-1's AccApprover, so editing AP-4's list cannot
-- silently change who approves AP-1.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/090_acc_reimburse_approver.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/090_acc_reimburse_approver.sql
IF OBJECT_ID('dbo.AccReimburseApprover', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseApprover] (
  [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseApprover] PRIMARY KEY,
  [StaffId]     INT NOT NULL CONSTRAINT [UQ_AccReimburseApprover_StaffId] UNIQUE,
  [Email]       NVARCHAR(200) NOT NULL,
  [DisplayName] NVARCHAR(200) NOT NULL,
  [IsActive]    BIT NOT NULL CONSTRAINT [DF_AccReimburseApprover_Active] DEFAULT (1),
  [CreatedBy]   INT NULL,
  [CreatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseApprover_Created] DEFAULT (SYSDATETIME()),
  [UpdatedBy]   INT NULL,
  [UpdatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseApprover_Updated] DEFAULT (SYSDATETIME())
);
GO
```

- [ ] **Step 4: `091_acc_approval_step_final.sql`**

```sql
-- Let AccApproval carry a third step.
--
-- CK_AccApproval_Step admits only MANAGER and ACCOUNT today. AP-4 has three
-- steps: line manager, accounting check (which sets the payment date), and a
-- final accounting approval by a different person. Widening a CHECK cannot
-- invalidate a stored row, so AP-1, AP-2 and AP-17 are untouched and no data
-- pass is needed.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/091_acc_approval_step_final.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/091_acc_approval_step_final.sql
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_AccApproval_Step'
             AND parent_object_id = OBJECT_ID('dbo.AccApproval'))
  ALTER TABLE [dbo].[AccApproval] DROP CONSTRAINT [CK_AccApproval_Step];
GO
ALTER TABLE [dbo].[AccApproval] WITH CHECK
  ADD CONSTRAINT [CK_AccApproval_Step]
      CHECK ([StepCode] IN (N'MANAGER', N'ACCOUNT', N'ACCOUNT_FINAL'));
GO
```

`WITH CHECK` validates the existing rows, so if anything already violates the new
list the migration fails loudly rather than leaving an untrusted constraint.

- [ ] **Step 5: `092_ap4_form_master.sql`**

```sql
-- AP-4 in the form catalogue, and the brands it may be claimed against.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/092_ap4_form_master.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/092_ap4_form_master.sql
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormMaster] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[AccFormMaster]
    ([FormCode], [GroupName], [FormNameTh], [FormNameEn], [RunningPrefix], [IsActive], [SortOrder])
  VALUES
    (N'AP-4', N'Accounting', N'ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)',
     N'Staff Reimbursement', N'RBM', 1, 4);
GO
-- ROCKS only to begin with; the rest are added from Settings rather than here,
-- so the seed does not decide policy.
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormBrand] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[AccFormBrand] ([FormCode], [BrandCode], [IsActive], [SortOrder])
  VALUES (N'AP-4', N'ROCKS', 1, 0);
GO
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit && npm test
git add migrations/088_acc_reimburse.sql migrations/089_acc_reimburse_rule.sql migrations/090_acc_reimburse_approver.sql migrations/091_acc_approval_step_final.sql migrations/092_ap4_form_master.sql
git commit -m "feat(ap-4): schema for the staff reimbursement form"
```

**Do not apply the migrations.** The controller applies all five to both databases and verifies.

---

### Task 2: Payment calendar

**Files:**
- Create: `src/lib/acc/reimburse/payment-calendar.ts`, `src/lib/acc/reimburse/payment-calendar.test.ts`

**Interfaces produced:**

```ts
export function isPaymentRound(date: Date): boolean;
export function paymentRoundsInMonth(year: number, month0: number): Date[];
export function defaultPaymentRound(checkedAt: Date, rounds: Date[]): Date | null;
export async function getReimbursePaymentDates(from?: Date, months?: number): Promise<string[]>;
```

Read `src/lib/acc/payment-calendar.ts` first. It has `nthFridayOfMonth`, `ymd`,
`getHolidaySet` and `shiftPaymentDay`, and AP-1 uses the 2nd and 4th Friday.
AP-4 uses the 1st and 3rd. **Do not change AP-1's file** — the two forms pay on
different rounds and one function cannot answer for both. Import its helpers if
they are exported; if they are not, export them from there rather than copying
the bodies.

- [ ] **Step 1: Write the failing tests**

`src/lib/acc/reimburse/payment-calendar.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentRoundsInMonth, defaultPaymentRound } from "./payment-calendar";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("the rounds are the 1st and 3rd Friday, whatever weekday the month opens on", () => {
  // Aug 2026 opens on a Saturday: Fridays are 7, 14, 21, 28.
  assert.deepEqual(paymentRoundsInMonth(2026, 7).map(ymd), ["2026-08-07", "2026-08-21"]);
  // May 2026 opens on a Friday: Fridays are 1, 8, 15, 22, 29.
  assert.deepEqual(paymentRoundsInMonth(2026, 4).map(ymd), ["2026-05-01", "2026-05-15"]);
});

test("the 2nd and 4th Fridays are not rounds — that is AP-1's calendar, not this one", () => {
  const rounds = paymentRoundsInMonth(2026, 7).map(ymd);
  assert.equal(rounds.includes("2026-08-14"), false);
  assert.equal(rounds.includes("2026-08-28"), false);
});

test("a check before Monday noon can still make that week's round", () => {
  const rounds = [new Date(2026, 7, 7), new Date(2026, 7, 21)];
  // Monday 3 Aug 2026, 11:00 — the Friday of the same week is the 7th.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 11, 0), rounds)!), "2026-08-07");
});

test("a check after Monday noon falls to the next round", () => {
  const rounds = [new Date(2026, 7, 7), new Date(2026, 7, 21)];
  // Monday 3 Aug 2026, 13:00 — past the cut-off, so the 7th is gone.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 13, 0), rounds)!), "2026-08-21");
  // Wednesday is likewise past that Monday's noon.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 5, 9, 0), rounds)!), "2026-08-21");
});

test("exactly Monday noon still counts as in time", () => {
  const rounds = [new Date(2026, 7, 7), new Date(2026, 7, 21)];
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 12, 0), rounds)!), "2026-08-07");
});

test("no round left means no default rather than a wrong one", () => {
  assert.equal(defaultPaymentRound(new Date(2026, 7, 25), [new Date(2026, 7, 7)]), null);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- src/lib/acc/reimburse/payment-calendar.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

`src/lib/acc/reimburse/payment-calendar.ts`. `defaultPaymentRound` is the whole
subtlety: find the Monday noon at or before `checkedAt`, then take the first
round strictly after it.

```ts
/** Monday 12:00 at or before `at` — the cut-off that decides the round. */
function cutoffBefore(at: Date): Date {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 12, 0, 0, 0);
  // getDay(): 0 Sun .. 6 Sat. Step back to Monday.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  // Standing on Monday before noon, the cut-off that has passed is last week's.
  if (d.getTime() > at.getTime()) d.setDate(d.getDate() - 7);
  return d;
}

/**
 * The round a payment defaults to when accounting checks the request at
 * `checkedAt`: the first round strictly after the most recent Monday noon.
 *
 * "Strictly after" is what makes a Monday-11:00 check reach that week's Friday
 * while a Monday-13:00 check does not — at 11:00 the cut-off that has passed is
 * the *previous* Monday's, so this week's Friday is still ahead of it.
 */
export function defaultPaymentRound(checkedAt: Date, rounds: Date[]): Date | null {
  const cutoff = cutoffBefore(checkedAt);
  for (const r of rounds) if (r.getTime() > cutoff.getTime()) return r;
  return null;
}
```

`paymentRoundsInMonth(year, month0)` returns the 1st and 3rd Friday using the
same `nthFridayOfMonth` shape AP-1 uses. `isPaymentRound(date)` tests membership
of that month's rounds. `getReimbursePaymentDates` mirrors AP-1's
`getPaymentDates`: walk `months` forward from `from`, collect the rounds, apply
`shiftPaymentDay` against the holiday set, return `ymd` strings.

**Shift after choosing, not before** — a Friday moved to Thursday by a holiday is
still that round, and shifting first would change which round the default picks.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm test -- src/lib/acc/reimburse/payment-calendar.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/reimburse/payment-calendar.ts src/lib/acc/reimburse/payment-calendar.test.ts
git commit -m "feat(ap-4): payment rounds on the 1st and 3rd Friday"
```

---

### Task 3: Totals and the two-person rule

**Files:**
- Create: `src/lib/acc/reimburse/calc.ts`, `src/lib/acc/reimburse/calc.test.ts`, `src/lib/acc/reimburse/two-person.ts`, `src/lib/acc/reimburse/two-person.test.ts`

**Interfaces produced:**

```ts
export interface ReimburseItemInput { amount: number; vatAmount?: number | null; whtAmount?: number | null; }
export function sumReimburseItems(items: ReimburseItemInput[]): number;

export function canActFinalStep(
  candidateStaffId: number | null | undefined,
  accountStepActorStaffId: number | null | undefined,
): boolean;
export const FINAL_SAME_PERSON_ERROR: string;
```

- [ ] **Step 1: Write the failing tests**

`src/lib/acc/reimburse/calc.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sumReimburseItems } from "./calc";

test("an empty claim totals zero rather than NaN", () => {
  assert.equal(sumReimburseItems([]), 0);
});

test("the total is the VAT-inclusive amounts, and VAT is not added again", () => {
  // 1,070 already contains its 70 of VAT. Adding vatAmount would double-count.
  assert.equal(sumReimburseItems([{ amount: 1070, vatAmount: 70 }]), 1070);
});

test("withholding tax does not reduce what the employee is owed", () => {
  // WHT is the company's obligation to the revenue department, not a deduction
  // from the person being paid back.
  assert.equal(sumReimburseItems([{ amount: 1070, whtAmount: 30 }]), 1070);
});

test("money rounds to two places instead of drifting", () => {
  assert.equal(sumReimburseItems([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
});
```

`src/lib/acc/reimburse/two-person.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canActFinalStep } from "./two-person";

test("the person who checked cannot also give the final approval", () => {
  assert.equal(canActFinalStep(10176, 10176), false);
});

test("anyone else in the pool can", () => {
  assert.equal(canActFinalStep(10177, 10176), true);
});

test("an unknown actor on either side is refused, not waved through", () => {
  // A missing StaffId must never be read as "different person".
  assert.equal(canActFinalStep(null, 10176), false);
  assert.equal(canActFinalStep(10177, null), false);
  assert.equal(canActFinalStep(undefined, undefined), false);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- src/lib/acc/reimburse/calc.test.ts src/lib/acc/reimburse/two-person.test.ts`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement**

```ts
// calc.ts
export function sumReimburseItems(items: ReimburseItemInput[]): number {
  let total = 0;
  for (const i of items) total += Number(i.amount) || 0;
  // Two decimal places, so a claim of 0.1 + 0.2 is 0.3 and not 0.30000000000000004.
  return Math.round(total * 100) / 100;
}
```

```ts
// two-person.ts
export const FINAL_SAME_PERSON_ERROR =
  "ขั้นอนุมัติสุดท้ายต้องเป็นคนละคนกับผู้ตรวจสอบในขั้นก่อนหน้า";

/**
 * Whether `candidateStaffId` may take the final step, given who took the
 * accounting check.
 *
 * Refuses when either id is missing. An absent id is not evidence of a different
 * person, and treating it as one is how a two-person rule quietly becomes a
 * one-person rule.
 */
export function canActFinalStep(
  candidateStaffId: number | null | undefined,
  accountStepActorStaffId: number | null | undefined,
): boolean {
  if (candidateStaffId == null || accountStepActorStaffId == null) return false;
  return candidateStaffId !== accountStepActorStaffId;
}
```

- [ ] **Step 4: Run them and watch them pass**

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/reimburse/calc.ts src/lib/acc/reimburse/calc.test.ts src/lib/acc/reimburse/two-person.ts src/lib/acc/reimburse/two-person.test.ts
git commit -m "feat(ap-4): item totals and the two-person rule"
```

---

### Task 4: Register AP-4 with the environment router

**Files:**
- Modify: `src/lib/form-environment/classify-path.ts`
- Modify: `src/lib/form-environment/classify-path.test.ts`
- Create: `migrations/093_core_ap4_form_environment.sql`

**Why this task exists as its own gate:** AP-2 shipped without it. The visible
result today is that its `ADV` numbers were allocated from 1 instead of the UAT
floor of 9001, and its switches on Settings → Form Environment do nothing,
because nothing can resolve to a form code the router does not know. Four places
must agree or AP-4 inherits AP-1's environment silently.

- [ ] **Step 1: Extend the union and the runtime list**

`src/lib/form-environment/classify-path.ts`:

```ts
export type FormCode = "AP-1" | "AP-4" | "AP-15" | "AP-17";

export const FORM_CODES: readonly FormCode[] = ["AP-1", "AP-4", "AP-15", "AP-17"];
```

- [ ] **Step 2: Add the route rules**

In `ROUTE_RULES`, **above** the `/api/request/accounting` and `/request/accounting`
catch-alls — longest prefix wins, but keeping them in specificity order is the
file's stated convention:

```ts
  // AP-4 proper.
  { prefix: "/api/request/reimburse", result: "AP-4" },
  { prefix: "/request/reimburse", result: "AP-4" },
```

- [ ] **Step 3: Add the tests**

Append to `src/lib/form-environment/classify-path.test.ts`:

```ts
test("AP-4's own paths classify to AP-4, not to AP-1's catch-all", () => {
  assert.equal(classifyPath("/request/reimburse"), "AP-4");
  assert.equal(classifyPath("/request/reimburse/123"), "AP-4");
  assert.equal(classifyPath("/api/request/reimburse/requests/123/submit"), "AP-4");
});

test("AP-4 is a known form code", () => {
  assert.equal(isFormCode("AP-4"), true);
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/lib/form-environment/classify-path.test.ts`
Expected: PASS. If an existing test asserted the exact contents of `FORM_CODES`, update it.

- [ ] **Step 5: The FormEnvironment row**

`migrations/093_core_ap4_form_environment.sql` — Fast_Core only:

```sql
-- AP-4's Production/UAT switches.
--
-- Fast_Core, like the other three forms': resolving which form database answers
-- must not itself depend on a form database.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/093_core_ap4_form_environment.sql
--
-- Production on, UAT off — the same default a form with no row gets, stated
-- explicitly so the Settings page has a row to show.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormEnvironment] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[FormEnvironment] ([FormCode], [ProductionEnabled], [UatEnabled])
  VALUES (N'AP-4', 1, 0);
GO
```

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/form-environment/classify-path.ts src/lib/form-environment/classify-path.test.ts migrations/093_core_ap4_form_environment.sql
git commit -m "feat(ap-4): register AP-4 with the environment router"
```

---

### Task 5: Services

**Files:**
- Create: `src/lib/acc/reimburse/request-service.ts`, `src/lib/acc/reimburse/settings-service.ts`
- Create: `src/features/reimburse/constants.ts`, `src/features/reimburse/types.ts`

**Interfaces consumed:** `sumReimburseItems`, `canActFinalStep`, `FINAL_SAME_PERSON_ERROR`, `getReimbursePaymentDates`, `defaultPaymentRound`.

**Interfaces produced:**

```ts
export const AP4_FORM_CODE = "AP-4";
export const AP4_RUNNING_PREFIX = "RBM";

export async function saveReimburseDraft(input: SaveInput, userId: number): Promise<number>;
export async function getReimburseRequest(id: number): Promise<ReimburseDetail | null>;
export async function submitReimburseRequest(id: number, userId: number): Promise<void>;
export async function listActiveRules(): Promise<ReimburseRule[]>;
export async function listReimburseApprovers(): Promise<ReimburseApprover[]>;
```

Model `request-service.ts` on `src/lib/acc/request-service.ts`. The parts to copy
exactly rather than reinvent:

- **The submit claim.** `UPDATE … SET Status='Submitted', CurrentStepCode='MANAGER' … OUTPUT INSERTED.RequestNo … WHERE Id=@id AND CreatedBy=@uid AND Status IN ('Draft','Returned')`, then allocate a running number **only when the row has none** — a returned request keeps the number it was already given. AP-1 was renumbering resubmissions until this was fixed; do not reintroduce it.
- **`allocateRequestNo(AP4_RUNNING_PREFIX, new Date(), tx)`** inside the claim's transaction, so a tab that lost the race never consumes a number.
- **The manager snapshot** — `ManagerStaffId` / `ManagerEmail` written at submit from the requester's HR record, through the same `withUatManager` path AP-1 uses so a UAT request routes to the tester's UAT manager rather than a real one.

- [ ] **Step 1: Constants and types**

`src/features/reimburse/constants.ts` carries `AP4_FORM_CODE`, `AP4_RUNNING_PREFIX`,
and `REIMBURSE_NOTICE` — the notice text from spec §5.1, as a `readonly string[]`
of paragraphs. It is prose, not configuration; it lives in code so it is reviewed
like code.

- [ ] **Step 2: `settings-service.ts`**

`listActiveRules()` reads `AccReimburseRule WHERE IsActive = 1 ORDER BY SortOrder, Id`.
`listReimburseApprovers()` reads `AccReimburseApprover ORDER BY DisplayName`.
Both on `getAccPool()`, so they follow the form's resolved environment.

- [ ] **Step 3: `request-service.ts` — draft and resume**

`saveReimburseDraft` upserts `AccRequest` (FormCode `AP-4`), `AccReimburse`, and
replaces `AccReimburseItem` wholesale for that request inside one transaction —
delete-then-insert, because the grid has no stable client-side row identity and a
diff would be more code with more ways to be wrong.

`getReimburseRequest` returns header, items ordered by `SortOrder`, the acked rule
ids, and the attachments.

- [ ] **Step 4: `request-service.ts` — submit**

Validate before claiming, and refuse with a named Thai message for each:
at least one item; the Excel workbook attached; at least one receipt attached;
every currently active rule acked. Recompute `TotalAmount` with
`sumReimburseItems` — never trust the client's figure — and write it to both
`AccReimburse.TotalAmount` and `AccRequest.TotalAmount`.

Insert the `MANAGER` approval row (`StepOrder` 1, `Status` `'Pending'`) and queue
the notification through the existing `AccEmailQueue` helper.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/reimburse/ src/features/reimburse/
git commit -m "feat(ap-4): draft, resume and submit"
```

---

### Task 6: The form

**Files:**
- Create: `src/app/(dashboard)/request/reimburse/page.tsx`, `[id]/page.tsx`
- Create: `src/features/reimburse/components/ReimburseForm.tsx`, `ReimburseItemGrid.tsx`, `ReimburseNotice.tsx`, `ReimburseRuleChecklist.tsx`, `ReimburseDetail.tsx`
- Create: `src/app/api/request/reimburse/…` routes

**Interfaces consumed:** everything Task 5 produced.

Mirror `src/features/accounting/components/TravelExpenseForm.tsx` for layout,
`SectionCard` usage, the missing-items list and the save/submit bar. Mirror
`src/features/travel-booking/components/TravelBookingTab.tsx` for a repeating
row grid.

- [ ] **Step 1: The notice**

`ReimburseNotice` renders `REIMBURSE_NOTICE` read-only at the top, before any
input. Use `--status-pending-bg` / `--status-pending-text`, matching the guidance
box AP-17 shows.

- [ ] **Step 2: The item grid**

Columns: วันที่ · รายละเอียด · ยอดรวม VAT · VAT · หัก ณ ที่จ่าย, plus add and
remove. A live total under the grid from `sumReimburseItems` — the same function
the server uses, so the number the user sees is the number that gets stored.

- [ ] **Step 3: Attachments**

Two distinct slots, because they are different documents: one workbook
(`.xlsx`/`.xls`, single) and the receipts (images or PDF, many). Reuse AP-1's
upload component and its `AccRequestFile` route.

- [ ] **Step 4: The rules checklist**

`ReimburseRuleChecklist` renders every active rule with a checkbox. Submit stays
disabled until all are ticked; the missing-items list names "ระเบียบการจ่าย" while
any is unticked.

- [ ] **Step 5: `UatDataBanner`**

Render it at the top of the form and the detail page, fed the saved request id,
exactly as AP-1 and AP-17 do — a UAT record must say so while it is being edited.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm test
git add src/app/\(dashboard\)/request/reimburse/ src/features/reimburse/ src/app/api/request/reimburse/
git commit -m "feat(ap-4): the reimbursement form"
```

---

### Task 7: The three approvals

**Files:**
- Create: `src/lib/acc/reimburse/approval-service.ts`
- Create: `src/app/api/request/reimburse/requests/[id]/approve/route.ts`, `reject/route.ts`
- Modify: `src/features/reimburse/components/ReimburseDetail.tsx`

**Interfaces consumed:** `canActFinalStep`, `FINAL_SAME_PERSON_ERROR`, `getReimbursePaymentDates`, `defaultPaymentRound`.

- [ ] **Step 1: Step 1 — the manager**

Approve moves `Status` to `ManagerApproved`, `CurrentStepCode` to `ACCOUNT`, and
inserts the `ACCOUNT` approval row at `StepOrder` 2. Model on
`src/lib/acc/approval-engine.ts`'s manager step. **Reject requires a comment** —
refuse an empty one server-side with a named message, not only in the UI.

- [ ] **Step 2: Step 2 — the accounting check**

Requires an active `AccReimburseApprover`. Takes a `paymentDate` and validates it
against `getReimbursePaymentDates` — a date the picker would not offer is
refused, because the picker is not the authority. Writes `AccRequest.PaymentDate`,
leaves `Status` at `ManagerApproved`, moves `CurrentStepCode` to `ACCOUNT_FINAL`,
and inserts the `ACCOUNT_FINAL` row at `StepOrder` 3.

- [ ] **Step 3: Step 3 — the final approval**

Requires an active approver **and** `canActFinalStep(actor, step2Actor)`. Read the
step-2 actor from the `ACCOUNT` approval row's `ActionedByStaffId`. On refusal
return `FINAL_SAME_PERSON_ERROR` — it names the reason, which matters because the
person genuinely is an approver and a bare "no permission" would read as a bug.

Approve sets `Status` to `Approved` and `CurrentStepCode` to `NULL`.

- [ ] **Step 4: The detail page**

Show the three steps on the timeline with their actors and comments. Render the
action bar only for the step that is pending and only for someone who may act.
On step 2 show the payment-date picker limited to the rounds, defaulted with
`defaultPaymentRound`.

- [ ] **Step 5: Mail**

Queue a notification at every transition through the existing
`src/lib/acc/email-queue.ts`, as AP-1 does. It already redirects UAT mail and
exempts active testers; nothing here needs to know about that.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/reimburse/approval-service.ts src/app/api/request/reimburse/ src/features/reimburse/
git commit -m "feat(ap-4): manager, accounting check and final approval"
```

---

### Task 8: Settings and the catalogue entry

**Files:**
- Create: `src/app/(dashboard)/request/reimburse/settings/page.tsx`
- Create: `src/app/api/request/reimburse/settings/rules/route.ts`, `approvers/route.ts`
- Modify: `src/lib/constants.ts` (the AP-4 card in `REQUEST_CARDS`)
- Modify: `CLAUDE.md`

- [ ] **Step 1: The rules editor**

Add, edit, reorder and deactivate `AccReimburseRule` rows. **Deactivate, never
delete** — `AccReimburseRuleAck` references them, and a deleted rule would leave a
submitted request unable to explain what its author agreed to.

- [ ] **Step 2: The approver list**

Add and deactivate `AccReimburseApprover` rows, picking people through the
existing AD search modal. Follow `src/features/settings/UatUserSettings.tsx` for
the table shape: one status column where the badge reports state and a round
button beside it performs the one available action.

- [ ] **Step 3: The brand allowlist**

Reuse AP-1's brand settings mechanism against `AccFormBrand` rows with
`FormCode = 'AP-4'`.

- [ ] **Step 4: The catalogue card**

Add AP-4 to `REQUEST_CARDS` in `src/lib/constants.ts` with `badge: "AP-4"` and
`group: "Accounting"` so it appears on Home and the request hub. Availability
filtering and the PRO/UAT chip then work without further wiring, because Task 4
registered the code.

- [ ] **Step 5: CLAUDE.md**

Add AP-4 beside AP-1 and AP-17 in the Features section: what it is, its tables,
its three approval steps, its payment rounds, and that its `RBM` numbers reset
each year. Note that AP-4 is deliberately absent from AP-1's report and ERP prep
queue.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm test
git add src/app/\(dashboard\)/request/reimburse/settings/ src/app/api/request/reimburse/settings/ src/lib/constants.ts CLAUDE.md
git commit -m "feat(ap-4): settings, catalogue entry and documentation"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §2.1–2.2 `AccReimburse`, `AccReimburseItem` | 1 |
| §2.3–2.4 rules and acks | 1, 8 |
| §2.5 `AccReimburseApprover` | 1, 8 |
| §2.6 catalogue rows | 1, 8 |
| §3.1 widened `CK_AccApproval_Step` | 1 |
| §3.2 the three steps | 7 |
| §3.2.1 status stays within the existing CHECK | 7 |
| §3.3 two-person rule | 3 (pure), 7 (enforced) |
| §3.4 payment date | 2 (pure), 7 (enforced) |
| §4 running number, yearly reset | 5 |
| §5.1 notice | 5 (constant), 6 (rendered) |
| §5.2 fields 1–6 | 6 |
| §5.3 pages | 6, 8 |
| §6 environment registration | 4 |
| §7 migrations | 1, 4 |
| §8 tests | 2, 3 |

No spec section is unclaimed. §9's out-of-scope items appear in no task, which is
the point of them.

**Placeholder scan:** no "TBD", no "handle errors appropriately", no "similar to
Task N". Tasks 5–8 describe UI and service work by naming the exact file to
mirror rather than restating hundreds of lines of it; every value that has to be
exact — table names, step codes, constants, error identifiers — is written out.

**Type consistency:** `AP4_FORM_CODE` and `AP4_RUNNING_PREFIX` are defined in
Task 5 and used in Tasks 5–8. `sumReimburseItems`, `canActFinalStep`,
`FINAL_SAME_PERSON_ERROR`, `defaultPaymentRound` and `getReimbursePaymentDates`
are defined in Tasks 2–3 and consumed under those exact names in 5–7. The step
codes `MANAGER`, `ACCOUNT`, `ACCOUNT_FINAL` are the same three strings in the
migration, the services and the UI.
