# AP-17 UAT Per-Diem Implementation Plan

> **Superseded the same day** by
> [`docs/superpowers/specs/2026-09-07-uat-tester-move-design.md`](../specs/2026-09-07-uat-tester-move-design.md):
> `UatTesterPerDiem` no longer lives in `Fast_Core` — migrations 139/141 move it
> into `Rocks_Portal_Form_UAT`, with no synonym left behind. This plan is
> implementation history and is kept as written, not rewritten.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a System Admin set an effective-dated per-diem rate per UAT tester on Settings → UAT Users, and have AP-17 use it instead of the tester's real HR allowance — in UAT only.

**Architecture:** A new `Fast_Core.dbo.UatTesterPerDiem` table holds `{StaffId, EffectiveDate, Amount}` rows, which are already the shape `rateForDay` walks. One server-side wrapper in `allowance-log.ts` substitutes that log for the HR one, so all four things that price a trip change at a single point. Whether the override applies is decided per call site: by `isUatId(id)` where a record id exists, and by `resolveFormEnvironment()` where one does not. The browser's displayed rate stops reading `employee.allowance` and is derived from the log the form already fetches.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `mssql` (tedious), `node:test` via `tsx --test`, SWR, Tailwind 4, `sonner`, `lucide-react`.

**Spec:** [`docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md`](../specs/2026-09-07-ap17-uat-per-diem-design.md)

## Global Constraints

- **`rateForDay` returns `0` for a day no entry covers.** A stored `0`, or a `Number()`-coerced `0`, therefore pays nothing while looking configured. Refuse it in the parser **and** at the `CHECK` constraint.
- **"No rate configured" is `null`, never `[]`.** `[]` handed to `rateForDay` prices every day at 0.
- **`UatTesterPerDiem` lives in `Fast_Core` and is read with `getCorePool()`.** Never `getAccPool()`, never `getFormPool()`, never `getProductionFormPool()`.
- **It is not dual-written and not in `MASTER_TABLES`.** `npm run check:alignment` must stay at **27** tables.
- **Never static-import `@/lib/form-environment` or `@/lib/uat-tester/guards` into `src/lib/acc/travel-booking/allowance-log.ts`.** The environment arrives as a boolean parameter.
- **Never import a `getCorePool()` reader into `src/features/travel-booking/hooks/useTravelBookingForm.ts`** — it is `"use client"`.
- **Dates are Thai wall clock.** Format with local getters (`getFullYear`/`getMonth`/`getDate`), never `toISOString()`.
- **ES5 target:** use `Array.from(...)`, never `[...set]` or `[...map.values()]`.
- **Thai copy, fixed strings** (reused verbatim from `perdiem-source.ts:106-111` where they already exist):
  - `จำนวนเงินต่อวันต้องมากกว่า 0`
  - `กรุณาเลือกวันที่เริ่มมีผล`
  - `ไม่พบผู้ทดสอบรายนี้`
  - Column header / panel title: `เบี้ยเลี้ยง UAT`
  - Modal footer when the log is a UAT one: `เรตทดสอบสำหรับ UAT — ตั้งค่าที่ ตั้งค่า → UAT Users`
- **API envelope:** `{ ok: true, data }` or `{ ok: false, error }`.
- **SQL is parameterised.** `pool.request().input(name, sql.Type, value).query(...)`.

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/138_core_uat_tester_per_diem.sql` | **Create.** The `Fast_Core` table. |
| `src/lib/uat-tester/per-diem-rule.ts` | **Create.** Pure: rows → log (or `null`), and input parsing/refusals. |
| `src/lib/uat-tester/per-diem-rule.test.ts` | **Create.** Its unit tests. |
| `src/lib/uat-tester/per-diem.ts` | **Create.** The `getCorePool()` half: list, batched load, upsert, soft delete. |
| `src/lib/acc/travel-booking/perdiem-uat-gate.ts` | **Create.** The two spellings of "is this a UAT record", with the rule written once. |
| `src/lib/acc/travel-booking/perdiem-uat-gate.test.ts` | **Create.** Its unit tests. |
| `src/lib/acc/travel-booking/allowance-log.ts` | **Modify.** Add `getPerDiemEmployeeLog` + `getPerDiemEmployeeLogMap`. |
| `src/lib/acc/travel-booking/perdiem-source.ts` | **Modify.** Delete the dead `resolvePerDiemLog` and its import. |
| `src/app/api/request/travel-booking/allowance-log/route.ts` | **Modify.** Use the wrapper; return `allowanceSource`. |
| `src/lib/acc/travel-booking/request-service.ts` | **Modify.** Submit uses the wrapper; re-stamp `AllowanceSnapshot`. |
| `src/lib/acc/travel-booking/perdiem-recompute.ts` | **Modify.** Add `r.StaffId`; use the wrapper gated on `isUatId`. |
| `src/lib/acc/travel-booking/report-service.ts` | **Modify.** Batched wrapper keyed on `x.Id`. |
| `src/lib/acc/travel-booking/perdiem-source-guard.test.ts` | **Modify.** Four new/rewritten arms. |
| `src/lib/hr/employee-lookup.ts` | **Modify.** `withUatManager` → `withUatOverrides`. |
| `src/features/travel-booking/hooks/useTravelBookingForm.ts` | **Modify.** Derive `displayRate` from `estimateLog`. |
| `src/features/travel-booking/components/TravelBookingForm.tsx` | **Modify.** Chip + `allowanceRate` read `displayRate`. |
| `src/features/travel-booking/components/AllowanceHistoryModal.tsx` | **Modify.** Footer reads `allowanceSource`. |
| `src/app/api/settings/uat-users/per-diem/route.ts` | **Create.** GET / POST / PATCH, System Admin. |
| `src/features/settings/UatUserSettings.tsx` | **Modify.** `เบี้ยเลี้ยง UAT` column + SidePanel editor. |
| `CLAUDE.md` | **Modify.** Record the feature and the production behaviour change. |

---

### Task 1: Migration 138 — the `Fast_Core` table

**Files:**
- Create: `migrations/138_core_uat_tester_per_diem.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `Fast_Core.dbo.UatTesterPerDiem (Id, StaffId, EffectiveDate, Amount, Note, IsActive, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)` with `UQ_UatTesterPerDiem_Staff_Date` on `(StaffId, EffectiveDate)` and `CK_UatTesterPerDiem_Amount` on `Amount > 0`.

- [ ] **Step 1: Confirm 138 is free**

Run: `ls migrations/ | tail -5`
Expected: the highest number shown is `137_fx_rate_cache.sql`. If anything named `138_*` already exists, stop and pick the next free number, updating every reference in this plan.

- [ ] **Step 2: Write the migration**

Create `migrations/138_core_uat_tester_per_diem.sql`:

```sql
-- A per-diem rate per UAT tester, effective-dated.
--
-- TARGET: Fast_Core — one copy, and only this database.
--   npm run apply-sql -- --db Fast_Core --file migrations/138_core_uat_tester_per_diem.sql
--
-- NUMBERED 138. Read `ls migrations/` before picking a number: 137 was the
-- highest before this branch, and eleven numbers (088, 089, 090, 091, 094, 103,
-- 117, 118, 119, 120, 124) are each used twice — so counting files is not a
-- substitute for looking.
--
-- Design: docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md
--
-- ---------------------------------------------------------------------------
-- WHY Fast_Core, beside UatTester and FormEnvironment.
--
-- What a UAT tester is paid must not depend on which form database answered.
-- getCorePool() is the one pool the environment resolver never picks, which is
-- the same reason UatTester and FormEnvironment live here. Do NOT apply this to
-- Rocks_Portal_Form or Rocks_Portal_Form_UAT: there is exactly one copy, it is
-- not dual-written, and it is not in MASTER_TABLES — `npm run check:alignment`
-- must stay at 27 tables after this lands.
--
-- ---------------------------------------------------------------------------
-- APPLY BEFORE THE CODE.
--
-- SQL Server binds object names at compile time, so a missing table is
-- 'Invalid object name', not an empty result. The read is reached only in UAT,
-- so an unapplied migration errors UAT AP-17 loudly rather than silently
-- pricing a tester at their real HR allowance — which is the outcome this whole
-- feature exists to prevent, and why the read is deliberately NOT degraded to
-- "no override".
--
-- ---------------------------------------------------------------------------
-- CK_UatTesterPerDiem_Amount IS NOT HYGIENE.
--
-- rateForDay (src/lib/acc/travel-booking/perdiem.ts) returns 0 for a day it
-- cannot match, so a stored 0 is indistinguishable from "no rate configured"
-- while looking configured on screen — on a path that writes
-- AccRequest.TotalAmount. AccTravelPerDiemCountry defends this twice, at the
-- constraint and in its service, and so does this table.
--
-- ---------------------------------------------------------------------------
-- NO FOREIGN KEY TO UatTester, deliberately: rates outlive a soft-deleted
-- tester row and are read by StaffId, which UQ_UatTester_StaffId already makes
-- that table's real identity key.

IF DB_NAME() NOT LIKE 'Fast_Core%'
  THROW 50000, 'This migration targets Fast_Core. Re-run with --db Fast_Core.', 1;
GO

IF OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[UatTesterPerDiem] (
    [Id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTesterPerDiem] PRIMARY KEY,
    [StaffId]       INT            NOT NULL,
    [EffectiveDate] DATE           NOT NULL,
    [Amount]        DECIMAL(18,2)  NOT NULL CONSTRAINT [CK_UatTesterPerDiem_Amount] CHECK ([Amount] > 0),
    [Note]          NVARCHAR(300)  NULL,
    [IsActive]      BIT            NOT NULL CONSTRAINT [DF_UatTesterPerDiem_IsActive] DEFAULT (1),
    [CreatedBy]     INT            NULL,
    [CreatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_CreatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedBy]     INT            NULL,
    [UpdatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_UpdatedAt] DEFAULT (SYSDATETIME()),
    CONSTRAINT [UQ_UatTesterPerDiem_Staff_Date] UNIQUE ([StaffId], [EffectiveDate])
  );
  PRINT 'Created dbo.UatTesterPerDiem';
END
ELSE PRINT 'dbo.UatTesterPerDiem already present - skipped';
GO
```

- [ ] **Step 3: Apply it**

Run: `npm run apply-sql -- --db Fast_Core --file migrations/138_core_uat_tester_per_diem.sql`
Expected: `Created dbo.UatTesterPerDiem`.

- [ ] **Step 4: Verify the guard refuses the wrong database**

Run: `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/138_core_uat_tester_per_diem.sql`
Expected: it FAILS with `This migration targets Fast_Core. Re-run with --db Fast_Core.` and creates nothing. This is the check working, not a fault.

- [ ] **Step 5: Confirm the alignment count did not move**

Run: `npm run check:alignment`
Expected: `PASS — 27 configuration tables identical …`. If the number changed, the table was created in a form database by mistake.

- [ ] **Step 6: Commit**

```bash
git add migrations/138_core_uat_tester_per_diem.sql
git commit -m "feat(ap-17): add Fast_Core.UatTesterPerDiem, a per-tester effective-dated rate"
```

---

### Task 2: The pure rule module

**Files:**
- Create: `src/lib/uat-tester/per-diem-rule.ts`
- Test: `src/lib/uat-tester/per-diem-rule.test.ts`

**Interfaces:**
- Consumes: `AllowanceLogEntry` (type only) from `@/lib/acc/travel-booking/perdiem`.
- Produces:
  - `interface UatPerDiemRateRow { id: number; staffId: number; effectiveDate: string; amount: number; note: string | null; isActive: boolean }`
  - `uatPerDiemLogFrom(rows: readonly UatPerDiemRateRow[]): AllowanceLogEntry[] | null`
  - `class UatPerDiemInputError extends Error`
  - `parseUatPerDiemInput(raw: { staffId: unknown; effectiveDate: unknown; amount: unknown; note?: unknown }): { staffId: number; effectiveDate: string; amount: number; note: string | null }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/uat-tester/per-diem-rule.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UatPerDiemInputError,
  parseUatPerDiemInput,
  uatPerDiemLogFrom,
  type UatPerDiemRateRow,
} from "./per-diem-rule";

function row(over: Partial<UatPerDiemRateRow>): UatPerDiemRateRow {
  return {
    id: 1,
    staffId: 100,
    effectiveDate: "2026-01-01",
    amount: 500,
    note: null,
    isActive: true,
    ...over,
  };
}

test("no rows is null, never an empty array", () => {
  // [] handed to rateForDay prices every day at 0, which is a different claim
  // from "this tester has no override".
  assert.equal(uatPerDiemLogFrom([]), null);
});

test("only-inactive rows is null", () => {
  assert.equal(uatPerDiemLogFrom([row({ isActive: false })]), null);
});

test("inactive rows are dropped and the rest survive", () => {
  const log = uatPerDiemLogFrom([
    row({ id: 1, effectiveDate: "2026-01-01", amount: 500 }),
    row({ id: 2, effectiveDate: "2026-06-01", amount: 800, isActive: false }),
  ]);
  assert.deepEqual(log, [{ effectiveDate: "2026-01-01", amount: 500 }]);
});

test("the log is sorted by effective date ascending", () => {
  const log = uatPerDiemLogFrom([
    row({ id: 1, effectiveDate: "2026-06-01", amount: 800 }),
    row({ id: 2, effectiveDate: "2026-01-01", amount: 500 }),
    row({ id: 3, effectiveDate: "2026-03-01", amount: 650 }),
  ]);
  assert.deepEqual(log, [
    { effectiveDate: "2026-01-01", amount: 500 },
    { effectiveDate: "2026-03-01", amount: 650 },
    { effectiveDate: "2026-06-01", amount: 800 },
  ]);
});

test("the caller's array is not mutated", () => {
  const rows = [
    row({ id: 1, effectiveDate: "2026-06-01" }),
    row({ id: 2, effectiveDate: "2026-01-01" }),
  ];
  uatPerDiemLogFrom(rows);
  assert.equal(rows[0].effectiveDate, "2026-06-01");
});

test("a valid input parses", () => {
  assert.deepEqual(
    parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount: 800, note: "  ทดสอบ  " }),
    { staffId: 100, effectiveDate: "2026-09-07", amount: 800, note: "ทดสอบ" },
  );
});

test("a blank note becomes null", () => {
  const parsed = parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount: 800, note: "   " });
  assert.equal(parsed.note, null);
});

test("a numeric string amount is accepted", () => {
  const parsed = parseUatPerDiemInput({ staffId: "100", effectiveDate: "2026-09-07", amount: " 800.50 " });
  assert.equal(parsed.amount, 800.5);
  assert.equal(parsed.staffId, 100);
});

// Every one of these is a finite 0 under Number(), which would look configured
// and pay nothing. They are listed individually because a single case would not
// prove the guard is on the value rather than on its type.
for (const amount of [0, -1, "", " ", null, undefined, [], false, "abc", NaN, Infinity]) {
  test(`amount ${JSON.stringify(amount)} is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount }),
      (e: unknown) =>
        e instanceof UatPerDiemInputError && e.message === "จำนวนเงินต่อวันต้องมากกว่า 0",
    );
  });
}

for (const effectiveDate of ["", "   ", "2026-9-7", "07/09/2026", "2026-13-01", "2026-02-30", null, 20260907]) {
  test(`effective date ${JSON.stringify(effectiveDate)} is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId: 100, effectiveDate, amount: 800 }),
      (e: unknown) =>
        e instanceof UatPerDiemInputError && e.message === "กรุณาเลือกวันที่เริ่มมีผล",
    );
  });
}

for (const staffId of [0, -1, 1.5, "", "abc", null, undefined]) {
  test(`staffId ${JSON.stringify(staffId)} is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId, effectiveDate: "2026-09-07", amount: 800 }),
      (e: unknown) => e instanceof UatPerDiemInputError && e.message === "ไม่พบผู้ทดสอบรายนี้",
    );
  });
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/uat-tester/per-diem-rule.test.ts`
Expected: FAIL — `Cannot find module './per-diem-rule'`.

- [ ] **Step 3: Implement**

Create `src/lib/uat-tester/per-diem-rule.ts`:

```ts
import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";

/**
 * A UAT tester's own per-diem rate log — the pure half of
 * `Fast_Core.dbo.UatTesterPerDiem` (migration 138).
 *
 * This file imports nothing at runtime (the one import is a type and is
 * erased), so the rules below are unit-tested with no database and no
 * environment — the split `perdiem-country.ts` / `perdiem-source.ts` already
 * uses, and for the same reason: `@/env` validates the whole environment at
 * import time, so anything reachable from a pool drags a live configuration
 * into the test run.
 */

export interface UatPerDiemRateRow {
  id: number;
  staffId: number;
  /** 'YYYY-MM-DD', inclusive. */
  effectiveDate: string;
  /** Thai baht per day. Always > 0 — the table's CHECK, and `parseUatPerDiemInput`. */
  amount: number;
  note: string | null;
  isActive: boolean;
}

/**
 * This tester's effective-dated log, or `null` meaning "no override — fall back
 * to the employee's HR allowance". **Never an empty array.**
 *
 * `rateForDay` (`perdiem.ts:24-33`) answers 0 for a day no entry covers, so `[]`
 * would price every day of the trip at zero — a different claim from "this
 * tester has no override", on a path that writes `AccRequest.TotalAmount`.
 * `perDiemCountryLog` states the same rule in its own header.
 *
 * The result is a fresh, sorted array: the report hands one row set to many
 * trips, and sorting the caller's array in place would reorder somebody else's.
 */
export function uatPerDiemLogFrom(
  rows: readonly UatPerDiemRateRow[],
): AllowanceLogEntry[] | null {
  const mine: AllowanceLogEntry[] = [];
  for (const r of rows) {
    if (!r.isActive) continue;
    mine.push({ effectiveDate: r.effectiveDate, amount: r.amount });
  }
  if (mine.length === 0) return null;

  mine.sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0,
  );
  return mine;
}

/** Refusals are Thai and name the problem, so a constraint name never reaches an admin. */
export class UatPerDiemInputError extends Error {}

/**
 * Validate one posted rate, **before** any `Number()` coercion reaches the
 * database.
 *
 * `Number(null)`, `Number("")`, `Number(" ")`, `Number([])` and `Number(false)`
 * are all a finite **0**, which the `CHECK` would then reject with
 * `CK_UatTesterPerDiem_Amount` — a message no admin can act on. More
 * importantly, this is the layer that exists whether or not the constraint does.
 *
 * The date is checked for shape *and* for being a real calendar day: the regex
 * alone admits `2026-02-30`, which `sql.Date` turns into a driver error rather
 * than the Thai refusal beside the field.
 */
export function parseUatPerDiemInput(raw: {
  staffId: unknown;
  effectiveDate: unknown;
  amount: unknown;
  note?: unknown;
}): { staffId: number; effectiveDate: string; amount: number; note: string | null } {
  const staffId = typeof raw.staffId === "number" ? raw.staffId : Number(raw.staffId);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    throw new UatPerDiemInputError("ไม่พบผู้ทดสอบรายนี้");
  }

  const effectiveDate = typeof raw.effectiveDate === "string" ? raw.effectiveDate.trim() : "";
  if (!isCalendarDate(effectiveDate)) {
    throw new UatPerDiemInputError("กรุณาเลือกวันที่เริ่มมีผล");
  }

  const amount =
    typeof raw.amount === "number" ? raw.amount : Number(String(raw.amount ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new UatPerDiemInputError("จำนวนเงินต่อวันต้องมากกว่า 0");
  }

  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : null;
  return { staffId, effectiveDate, amount, note };
}

/** 'YYYY-MM-DD' AND a day that exists. Local getters, never toISOString. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/lib/uat-tester/per-diem-rule.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/uat-tester/per-diem-rule.ts src/lib/uat-tester/per-diem-rule.test.ts
git commit -m "feat(ap-17): the pure half of the UAT per-tester per-diem rate"
```

---

### Task 3: The `Fast_Core` pool half

**Files:**
- Create: `src/lib/uat-tester/per-diem.ts`

**Interfaces:**
- Consumes: `getCorePool`, `sql` from `@/lib/db/mssql`; `uatPerDiemLogFrom`, `parseUatPerDiemInput`, `UatPerDiemInputError`, `UatPerDiemRateRow` from `./per-diem-rule`.
- Produces:
  - `listAllUatPerDiemRates(): Promise<UatPerDiemRateRow[]>` — every row, active or not.
  - `uatPerDiemLogsByStaffIds(staffIds: readonly number[]): Promise<Map<number, AllowanceLogEntry[]>>` — one query; a StaffId with no active rows is **absent** from the map.
  - `uatPerDiemLogFor(staffId: number | null | undefined): Promise<AllowanceLogEntry[] | null>`
  - `upsertUatPerDiemRate(raw, userId: number | null): Promise<void>`
  - `setUatPerDiemRateActive(id: number, isActive: boolean, userId: number | null): Promise<void>`
  - re-exports `UatPerDiemInputError`.

- [ ] **Step 1: Write the module**

Create `src/lib/uat-tester/per-diem.ts`:

```ts
import { getCorePool, sql } from "@/lib/db/mssql";
import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";
import {
  parseUatPerDiemInput,
  uatPerDiemLogFrom,
  UatPerDiemInputError,
  type UatPerDiemRateRow,
} from "./per-diem-rule";

export { UatPerDiemInputError };
export type { UatPerDiemRateRow };

/**
 * `Fast_Core.dbo.UatTesterPerDiem` (migration 138) — the pool half.
 *
 * **`getCorePool()`, and nothing else.** What a UAT tester is paid must not
 * depend on which form database answered, which is the same reason `UatTester`
 * and `FormEnvironment` live in Fast_Core. There is exactly one copy: this table
 * is not dual-written and is not in `MASTER_TABLES`.
 *
 * This module imports only the pool and its own pure half, so it introduces no
 * cycle when `allowance-log.ts` pulls it in — and `allowance-log.ts` is reached
 * from inside a `getAccPool()` transaction, where a static import of
 * `@/lib/form-environment` would be exactly the loop `getFormPool` dynamically
 * imports the resolver to avoid.
 *
 * **A missing table throws.** It is not degraded to "no override": the read is
 * reached only in UAT, so an unapplied migration errors UAT AP-17 loudly rather
 * than silently pricing a tester at their real HR allowance and writing that to
 * `AccRequest.TotalAmount`.
 */

interface Rec {
  Id: number;
  StaffId: number;
  EffectiveDate: Date;
  Amount: number;
  Note: string | null;
  IsActive: boolean;
}

function toRow(r: Rec): UatPerDiemRateRow {
  return {
    id: r.Id,
    staffId: r.StaffId,
    effectiveDate: toDateKey(r.EffectiveDate),
    amount: Number(r.Amount),
    note: r.Note,
    isActive: !!r.IsActive,
  };
}

/** Every row including inactive ones — the settings grid shows both. */
export async function listAllUatPerDiemRates(): Promise<UatPerDiemRateRow[]> {
  const pool = await getCorePool();
  const r = await pool.request().query<Rec>(`
    SELECT Id, StaffId, EffectiveDate, Amount, Note, IsActive
    FROM [dbo].[UatTesterPerDiem]
    ORDER BY StaffId, EffectiveDate DESC
  `);
  return r.recordset.map(toRow);
}

/**
 * One query for a whole set of testers, in `uatManagerStaffIdsFor`'s shape.
 *
 * The report resolves a rate per row and must never do a lookup per row. A
 * StaffId with no active rows is **absent from the map** rather than present
 * with `[]`, so a caller reading `map.get(id) ?? null` gets the "no override"
 * answer without restating the rule.
 */
export async function uatPerDiemLogsByStaffIds(
  staffIds: readonly number[],
): Promise<Map<number, AllowanceLogEntry[]>> {
  const out = new Map<number, AllowanceLogEntry[]>();
  const ids = Array.from(
    new Set(staffIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (ids.length === 0) return out;

  const pool = await getCorePool();
  const req = pool.request();
  const placeholders: string[] = [];
  ids.forEach((id, i) => {
    req.input(`s${i}`, sql.Int, id);
    placeholders.push(`@s${i}`);
  });
  const r = await req.query<Rec>(`
    SELECT Id, StaffId, EffectiveDate, Amount, Note, IsActive
    FROM [dbo].[UatTesterPerDiem]
    WHERE IsActive = 1 AND StaffId IN (${placeholders.join(", ")})
    ORDER BY StaffId, EffectiveDate
  `);

  const byStaffId = new Map<number, UatPerDiemRateRow[]>();
  for (const rec of r.recordset) {
    const row = toRow(rec);
    const list = byStaffId.get(row.staffId) ?? [];
    list.push(row);
    byStaffId.set(row.staffId, list);
  }
  byStaffId.forEach((rows, staffId) => {
    const log = uatPerDiemLogFrom(rows);
    if (log) out.set(staffId, log);
  });
  return out;
}

/** One tester's log, or `null` — the single-subject convenience over the batch. */
export async function uatPerDiemLogFor(
  staffId: number | null | undefined,
): Promise<AllowanceLogEntry[] | null> {
  if (typeof staffId !== "number" || !Number.isInteger(staffId) || staffId <= 0) return null;
  const map = await uatPerDiemLogsByStaffIds([staffId]);
  return map.get(staffId) ?? null;
}

/**
 * Add or amend one tester's rate for one effective date.
 *
 * `MERGE ... WITH (HOLDLOCK)` in one statement, the idiom `upsertUatTester` and
 * `setFormFlag` already use: an `UPDATE` then `IF @@ROWCOUNT = 0 INSERT` pair is
 * two autocommit transactions, so two concurrent upserts for the same
 * `(StaffId, EffectiveDate)` could both see zero rows updated and race onto
 * `UQ_UatTesterPerDiem_Staff_Date`.
 *
 * An amend sets `IsActive = 1`, so re-saving a switched-off date brings it back
 * — the same behaviour `upsertPerDiemCountryRate` has.
 */
export async function upsertUatPerDiemRate(
  raw: { staffId: unknown; effectiveDate: unknown; amount: unknown; note?: unknown },
  userId: number | null,
): Promise<void> {
  const input = parseUatPerDiemInput(raw);
  const pool = await getCorePool();
  await pool
    .request()
    .input("staffId", sql.Int, input.staffId)
    .input("eff", sql.Date, input.effectiveDate)
    .input("amount", sql.Decimal(18, 2), input.amount)
    .input("note", sql.NVarChar(300), input.note)
    .input("by", sql.Int, userId)
    .query(`
      MERGE [dbo].[UatTesterPerDiem] WITH (HOLDLOCK) AS t
      USING (SELECT @staffId AS StaffId, @eff AS EffectiveDate) AS s
        ON t.StaffId = s.StaffId AND t.EffectiveDate = s.EffectiveDate
      WHEN MATCHED THEN UPDATE SET
        Amount = @amount, Note = @note, IsActive = 1,
        UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (StaffId, EffectiveDate, Amount, Note, CreatedBy, UpdatedBy)
        VALUES (@staffId, @eff, @amount, @note, @by, @by);
    `);
}

/** The soft delete. A rate a UAT trip was already priced at is history. */
export async function setUatPerDiemRateActive(
  id: number,
  isActive: boolean,
  userId: number | null,
): Promise<void> {
  const pool = await getCorePool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("active", sql.Bit, isActive ? 1 : 0)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[UatTesterPerDiem]
      SET IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);
}

/** Local getters, never toISOString — the server runs on Thai wall clock. */
function toDateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the existing suite is still green**

Run: `npm test`
Expected: PASS. Nothing imports this module yet, so a failure here means something unrelated is broken — fix that before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/uat-tester/per-diem.ts
git commit -m "feat(ap-17): read and write the UAT per-tester rate from Fast_Core"
```

---

### Task 4: The environment gate

**Files:**
- Create: `src/lib/acc/travel-booking/perdiem-uat-gate.ts`
- Test: `src/lib/acc/travel-booking/perdiem-uat-gate.test.ts`

**Interfaces:**
- Consumes: `isUatId` from `@/lib/form-environment/uat-identity`.
- Produces:
  - `uatByRecordId(requestId: number | null | undefined): boolean`
  - `uatByEnvironment(environment: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/lib/acc/travel-booking/perdiem-uat-gate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { uatByEnvironment, uatByRecordId } from "./perdiem-uat-gate";

test("a UAT id prices in UAT", () => {
  assert.equal(uatByRecordId(900001), true);
  assert.equal(uatByRecordId(900000), true);
});

test("a production id does not", () => {
  assert.equal(uatByRecordId(1), false);
  assert.equal(uatByRecordId(899999), false);
});

test("an absent id is not UAT", () => {
  // The recompute's SELECT can lose a column without failing a typecheck, so
  // undefined must resolve to the production answer rather than throwing.
  assert.equal(uatByRecordId(undefined), false);
  assert.equal(uatByRecordId(null), false);
});

test("the resolved environment answers the same question", () => {
  assert.equal(uatByEnvironment("UAT"), true);
  assert.equal(uatByEnvironment("Production"), false);
});

test("an unknown or absent environment is not UAT", () => {
  assert.equal(uatByEnvironment(null), false);
  assert.equal(uatByEnvironment(undefined), false);
  assert.equal(uatByEnvironment("uat"), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/acc/travel-booking/perdiem-uat-gate.test.ts`
Expected: FAIL — `Cannot find module './perdiem-uat-gate'`.

- [ ] **Step 3: Implement**

Create `src/lib/acc/travel-booking/perdiem-uat-gate.ts`:

```ts
import { isUatId } from "@/lib/form-environment/uat-identity";

/**
 * "Is the record being priced a UAT record?" — the one question the UAT
 * per-diem override turns on, in the two spellings the call sites can actually
 * answer it in.
 *
 * The rule is written here once so the two are visibly ONE rule rather than two
 * policies somebody later "unifies" in the wrong direction.
 *
 * ── Why the recompute must not use the environment resolver ──
 *
 * Not because it does I/O — it does not. `resolveCurrentFormAccess` short-circuits
 * to Production without touching the cookie, the header or the database when
 * `resolveFormClass()` is null, and says so in its own comment.
 *
 * The reason is that **Production is the wrong answer** there.
 * `recomputeGroupPerDiem` runs inside somebody else's transaction, and a
 * silently-Production verdict re-prices a UAT trip at real HR while writing
 * `AccTravelBooking.PerDiemTotal` AND `AccRequest.TotalAmount` in one batch,
 * leaving an activity row that records the figure moved and not why.
 *
 * `isUatId` is exact: migration 061 reseeds `AccRequest` to 900000 and 064 adds
 * the `CHECK`, so every id in a UAT group is >= 900000.
 */

/** Use where a record id exists — a submit, a recompute, a report row. */
export function uatByRecordId(requestId: number | null | undefined): boolean {
  return isUatId(requestId);
}

/**
 * Use only where no record id exists yet — a draft being filled, and the
 * allowance-log route that feeds its estimate. Pass the value of
 * `resolveFormEnvironment()`.
 */
export function uatByEnvironment(environment: string | null | undefined): boolean {
  return environment === "UAT";
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/lib/acc/travel-booking/perdiem-uat-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/perdiem-uat-gate.ts src/lib/acc/travel-booking/perdiem-uat-gate.test.ts
git commit -m "feat(ap-17): one rule for whether a per-diem figure is a UAT one"
```

---

### Task 5: The wrapper, and deleting the dead resolver

**Files:**
- Modify: `src/lib/acc/travel-booking/allowance-log.ts`
- Modify: `src/lib/acc/travel-booking/perdiem-source.ts` (delete `resolvePerDiemLog` at `:159-168` and its `getAllowanceLog` import at `:3`)

**Interfaces:**
- Consumes: `uatPerDiemLogFor`, `uatPerDiemLogsByStaffIds` from `@/lib/uat-tester/per-diem`.
- Produces:
  - `interface PerDiemLogSubject { employeeId: string | null; staffId: number | null; uat: boolean }`
  - `perDiemLogSubjectKey(s: PerDiemLogSubject): string`
  - `getPerDiemEmployeeLog(employeeId: string | null, staffId: number | null, uat: boolean): Promise<AllowanceLogEntry[]>`
  - `getPerDiemEmployeeLogMap(subjects: readonly PerDiemLogSubject[]): Promise<Map<string, AllowanceLogEntry[]>>`

- [ ] **Step 1: Confirm `resolvePerDiemLog` really has no callers**

Run: `grep -rn "resolvePerDiemLog" src/ scripts/`
Expected: exactly one hit — its own definition at `src/lib/acc/travel-booking/perdiem-source.ts:159`. If there is a second, stop: this task's deletion is wrong and the plan needs revising.

- [ ] **Step 2: Delete the dead resolver**

In `src/lib/acc/travel-booking/perdiem-source.ts`, delete the import line

```ts
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
```

and the whole `resolvePerDiemLog` block including its docblock:

```ts
/**
 * The convenience wrapper for a caller holding one request.
 * ...
 */
export async function resolvePerDiemLog(
  employeeId: string | null,
  countryCode: string | null,
): Promise<ReturnType<typeof perDiemLogFor>> {
  const [log, rates] = await Promise.all([
    employeeId ? getAllowanceLog(employeeId) : Promise.resolve([]),
    listPerDiemCountryRates(),
  ]);
  return perDiemLogFor(countryCode, log, rates);
}
```

Leave `perDiemLogFor` in the import list from `./perdiem-country` only if it is still referenced; if the typecheck reports it unused, remove it from that import too.

- [ ] **Step 3: Add the wrapper**

Append to `src/lib/acc/travel-booking/allowance-log.ts`, and add the import at the top:

```ts
import { uatPerDiemLogsByStaffIds } from "@/lib/uat-tester/per-diem";
```

```ts
/**
 * Who a per-diem log is being loaded for, and whether this is a UAT record.
 *
 * `uat` is a PARAMETER, never resolved inside this module. `allowance-log.ts` is
 * reached from inside a `getAccPool()` transaction, so a static import of
 * `@/lib/form-environment` here would be the very loop `getFormPool` dynamically
 * imports the resolver to break — and the recompute could not use that resolver
 * anyway (see `perdiem-uat-gate.ts`).
 */
export interface PerDiemLogSubject {
  employeeId: string | null;
  staffId: number | null;
  uat: boolean;
}

export function perDiemLogSubjectKey(s: PerDiemLogSubject): string {
  return `${s.uat ? "u" : "p"}:${s.staffId ?? ""}:${s.employeeId ?? ""}`;
}

/**
 * The per-diem employee log for one person — **the single point at which a UAT
 * tester's own rate replaces their real HR allowance.**
 *
 * Every consumer that prices an AP-17 trip calls this or its batched twin, and
 * `perdiem-source-guard.test.ts` asserts that lexically, because the failure is
 * a *missing* call that no behavioural test of the four would notice.
 *
 * A null `staffId` falls back to HR — `AccRequest.StaffId` is nullable
 * (`059_portal_form_baseline.sql:231`), and "no id" is the same answer as "no
 * rate set", which is the fail-safe direction.
 */
export async function getPerDiemEmployeeLog(
  employeeId: string | null,
  staffId: number | null,
  uat: boolean,
): Promise<AllowanceLogEntry[]> {
  const subject: PerDiemLogSubject = { employeeId, staffId, uat };
  const map = await getPerDiemEmployeeLogMap([subject]);
  return map.get(perDiemLogSubjectKey(subject)) ?? [];
}

/**
 * The same decision for many people at once — one Fast_Core query for every UAT
 * subject and one HR query per distinct employee, never a lookup per row. The
 * report calls this; routing it through the single-subject version would be N+1.
 */
export async function getPerDiemEmployeeLogMap(
  subjects: readonly PerDiemLogSubject[],
): Promise<Map<string, AllowanceLogEntry[]>> {
  const out = new Map<string, AllowanceLogEntry[]>();
  if (subjects.length === 0) return out;

  const uatStaffIds: number[] = [];
  for (const s of subjects) {
    if (s.uat && typeof s.staffId === "number") uatStaffIds.push(s.staffId);
  }
  const overrides = await uatPerDiemLogsByStaffIds(uatStaffIds);

  // Only the subjects the override did not answer reach HR, and each distinct
  // employee is read once.
  const needHr = new Set<string>();
  for (const s of subjects) {
    const hasOverride = s.uat && typeof s.staffId === "number" && overrides.has(s.staffId);
    if (!hasOverride && s.employeeId) needHr.add(s.employeeId);
  }
  const hrLogs = new Map<string, AllowanceLogEntry[]>();
  await Promise.all(
    Array.from(needHr).map(async (employeeId) => {
      hrLogs.set(employeeId, await getAllowanceLog(employeeId));
    }),
  );

  for (const s of subjects) {
    const key = perDiemLogSubjectKey(s);
    if (out.has(key)) continue;
    const override =
      s.uat && typeof s.staffId === "number" ? overrides.get(s.staffId) : undefined;
    out.set(key, override ?? (s.employeeId ? (hrLogs.get(s.employeeId) ?? []) : []));
  }
  return out;
}
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean. `npm test` FAILS on `perdiem-source-guard.test.ts`'s first test — `perdiem-source.ts` no longer imports `getAllowanceLog`, so the allow-list no longer matches. That is expected and is fixed in Task 9; note it and continue.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/allowance-log.ts src/lib/acc/travel-booking/perdiem-source.ts
git commit -m "feat(ap-17): one seam where a UAT rate replaces the HR allowance log"
```

---

### Task 6: Wire the allowance-log route and the submit

**Files:**
- Modify: `src/app/api/request/travel-booking/allowance-log/route.ts`
- Modify: `src/lib/acc/travel-booking/request-service.ts:1238` (the submit's `getAllowanceLog` call)

**Interfaces:**
- Consumes: `getPerDiemEmployeeLog` (Task 5), `uatByEnvironment` (Task 4), `resolveFormEnvironment` from `@/lib/form-environment`.
- Produces: the route's payload gains `allowanceSource: "hr" | "uat"`.

- [ ] **Step 1: Rewrite the route's body**

In `src/app/api/request/travel-booking/allowance-log/route.ts`, replace the `getAllowanceLog` import with

```ts
import { getPerDiemEmployeeLog } from "@/lib/acc/travel-booking/allowance-log";
import { uatByEnvironment } from "@/lib/acc/travel-booking/perdiem-uat-gate";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { uatPerDiemLogFor } from "@/lib/uat-tester/per-diem";
```

and replace the body of the `try` block's tail with:

```ts
    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId);

    // No record id exists while a draft is being filled, so this is the one
    // place the resolved environment is the right signal. See perdiem-uat-gate.
    const uat = uatByEnvironment(await resolveFormEnvironment());

    const [entries, countryRates, override] = await Promise.all([
      getPerDiemEmployeeLog(emp.id, emp.staffId ?? null, uat),
      listPerDiemCountryRates(),
      uat ? uatPerDiemLogFor(emp.staffId ?? null) : Promise.resolve(null),
    ]);

    // The modal's footer names the source, and an HR footer over UAT rates is a
    // false statement about where to change them.
    return NextResponse.json({
      ok: true,
      data: { entries, countryRates, allowanceSource: override ? "uat" : "hr" },
    });
```

Also update the empty-email early return so the shape stays consistent:

```ts
      return NextResponse.json({
        ok: true,
        data: { entries: [], countryRates: [], allowanceSource: "hr" },
      });
```

- [ ] **Step 2: Wire the submit**

In `src/lib/acc/travel-booking/request-service.ts`, replace the import

```ts
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
```

with

```ts
import { getPerDiemEmployeeLog } from "@/lib/acc/travel-booking/allowance-log";
import { uatByEnvironment } from "@/lib/acc/travel-booking/perdiem-uat-gate";
import { resolveFormEnvironment } from "@/lib/form-environment";
```

and at the submit's log load (currently `const log = await getAllowanceLog(emp.id);` near `:1238`, loaded alongside `listPerDiemCountryRates()`), change it to:

```ts
      // The submit runs on AP-17's own route, so the resolver answers correctly
      // here; the recompute is the one that cannot use it.
      const uat = uatByEnvironment(await resolveFormEnvironment());
      const [log, countryRates] = await Promise.all([
        getPerDiemEmployeeLog(emp.id, emp.staffId ?? null, uat),
        listPerDiemCountryRates(),
      ]);
```

Keep the surrounding `perDiemLogFor(tabs[i].countryCode, log, countryRates)` call exactly as it is — the country still wins, and that is the point of substituting only the employee arm.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `getAllowanceLog` is reported unused in `request-service.ts`, remove it from the import.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/request/travel-booking/allowance-log/route.ts src/lib/acc/travel-booking/request-service.ts
git commit -m "feat(ap-17): the estimate and the submit price a UAT trip at the tester's rate"
```

---

### Task 7: Wire the recompute — and give it `r.StaffId`

**Files:**
- Modify: `src/lib/acc/travel-booking/perdiem-recompute.ts:53-57` (the group SELECT) and `:124` (the log load)

**Interfaces:**
- Consumes: `getPerDiemEmployeeLog` (Task 5), `uatByRecordId` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Add `r.StaffId` to the group SELECT, with the comment that keeps it there**

In `src/lib/acc/travel-booking/perdiem-recompute.ts`, extend the query at `:53-57`:

```ts
    // r.CountryCode is load-bearing. Without it perDiemLogFor is handed null,
    // and cancelling any trip in a group re-prices its surviving siblings at the
    // employee's Thai allowance — writing that to AccTravelBooking.PerDiemTotal
    // AND AccRequest.TotalAmount inside the cancelling transaction, with an
    // activity row that records the figure moved and not why. A London trip
    // would silently revert to a domestic rate and nothing on any screen would
    // contradict it. Deleting this column from the SELECT fails no typecheck:
    // the value simply arrives undefined.
    //
    // r.StaffId is load-bearing for exactly the same reason and in exactly the
    // same way. It is how a UAT tester's own per-diem rate is found; without it
    // the lookup finds nothing and every UAT trip in the group is re-priced at
    // the tester's REAL HR allowance, here, inside the same transaction.
    .query(`SELECT t.RequestId, t.SortOrder, t.DepartDate, t.ReturnDate,
                   t.IsContinuation, t.PerDiemDays, t.PerDiemTotal,
                   r.Status, r.EmployeeId, r.CountryCode, r.StaffId
              FROM [dbo].[AccTravelBooking] t
              INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
             WHERE t.GroupKey = @gk`);
```

- [ ] **Step 2: Replace the log load**

Replace the import

```ts
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
```

with

```ts
import { getPerDiemEmployeeLog } from "@/lib/acc/travel-booking/allowance-log";
import { uatByRecordId } from "@/lib/acc/travel-booking/perdiem-uat-gate";
```

and replace the load inside `if (writable)` (currently `const log = employeeId ? await getAllowanceLog(employeeId) : [];`) with:

```ts
      const employeeId = x.EmployeeId as string | null;
      // `uatByRecordId`, NOT resolveFormEnvironment(). This runs inside somebody
      // else's transaction and may have no request scope, where the resolver
      // silently answers Production — which would re-price a UAT trip at real HR
      // and write it to both PerDiemTotal and AccRequest.TotalAmount. The id is
      // exact and needs no headers.
      //
      // It is also what keeps this module's unit test database-free: no fixture
      // RequestId reaches 900000, so the Fast_Core read is never issued, exactly
      // as `loadRates`'s `country !== "TH"` gate keeps the rate list unread.
      const log = await getPerDiemEmployeeLog(
        employeeId,
        (x.StaffId as number | null) ?? null,
        uatByRecordId(requestId),
      );
```

- [ ] **Step 3: Confirm the recompute's test is still database-free**

Run: `npm test -- src/lib/acc/travel-booking/perdiem-recompute.test.ts`
Expected: PASS, with no connection attempt and no timeout. Do **not** add a fixture at an id ≥ 900000 to exercise the UAT branch — that test stubs only `AccTx` and would attempt a live `getCorePool()` connect. Task 9's guard arm covers the branch instead.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/perdiem-recompute.ts
git commit -m "fix(ap-17): the recompute reads StaffId, so a cancellation keeps the UAT rate"
```

---

### Task 8: Wire the report

**Files:**
- Modify: `src/lib/acc/travel-booking/report-service.ts:293-298` (the batched log load) and `:308` (the per-row resolve)

**Interfaces:**
- Consumes: `getPerDiemEmployeeLogMap`, `perDiemLogSubjectKey`, `PerDiemLogSubject` (Task 5); `uatByRecordId` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Replace the batched load**

In `src/lib/acc/travel-booking/report-service.ts`, replace the import

```ts
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
```

with

```ts
import {
  getPerDiemEmployeeLogMap,
  perDiemLogSubjectKey,
  type PerDiemLogSubject,
} from "@/lib/acc/travel-booking/allowance-log";
import { uatByRecordId } from "@/lib/acc/travel-booking/perdiem-uat-gate";
```

Replace the `logByEmployee` load (the `Promise.all` at `:293-298`) with:

```ts
  // One subject per row, deduped by the map itself. The override is keyed on
  // StaffId while the HR log is keyed on EmployeeId, and both columns are in
  // BASE_CTE — so the two keys are carried together and the decision is made
  // once, inside getPerDiemEmployeeLogMap, never per row here.
  //
  // `x.Id` is AccRequest.Id. There is NO RequestId column on these rows: writing
  // `x.RequestId` compiles (raw is Record<string, unknown>), arrives undefined,
  // and would silently drop the override from every row of every UAT report.
  const subjects: PerDiemLogSubject[] = raw.map((x) => ({
    employeeId: (x.EmployeeId as string | null) ?? null,
    staffId: (x.StaffId as number | null) ?? null,
    uat: uatByRecordId(x.Id as number),
  }));

  const [countryRates, logBySubject] = await Promise.all([
    listPerDiemCountryRates(),
    getPerDiemEmployeeLogMap(subjects),
  ]);
```

- [ ] **Step 2: Replace the per-row resolve**

Where the mapper currently reads `logByEmployee.get(...)` before calling `perDiemLogFor` (around `:308`), use the subject key instead:

```ts
    const log =
      logBySubject.get(
        perDiemLogSubjectKey({
          employeeId: (x.EmployeeId as string | null) ?? null,
          staffId: (x.StaffId as number | null) ?? null,
          uat: uatByRecordId(x.Id as number),
        }),
      ) ?? [];
    const resolved = perDiemLogFor(x.CountryCode as string | null, log, countryRates);
```

Keep everything downstream of `resolved` exactly as it is.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `logByEmployee` or `employeeIds` are now unused, delete them.

- [ ] **Step 4: Commit**

```bash
git add src/lib/acc/travel-booking/report-service.ts
git commit -m "feat(ap-17): the report prints the UAT rate it priced a UAT trip at"
```

---

### Task 9: The guard test

**Files:**
- Modify: `src/lib/acc/travel-booking/perdiem-source-guard.test.ts`

**Interfaces:**
- Consumes: nothing (source-reading).
- Produces: nothing.

- [ ] **Step 1: Replace the first test with two**

Replace `ALLOWED_ALLOWANCE_IMPORTERS` and the test `"only the named files import getAllowanceLog"` with:

```ts
/**
 * Every non-test file allowed to name `getPerDiemEmployeeLog` /
 * `getPerDiemEmployeeLogMap`, and why.
 *
 * This is an ALLOW-LIST, not a count. An earlier draft of the country design
 * asserted a single importer of `getAllowanceLog`; that would have been red the
 * day it was written. What made a single-importer assertion finally correct for
 * `getAllowanceLog` is the wrapper below — the four consumers now name the
 * wrapper, not the raw reader.
 */
const ALLOWED_PERDIEM_LOG_IMPORTERS = [
  // Batches one log per subject across a whole report.
  "lib/acc/travel-booking/report-service.ts",
  // Loads one log for a whole submit group, then resolves per tab.
  "lib/acc/travel-booking/request-service.ts",
  // Loads one log per surviving trip inside the cancelling transaction.
  "lib/acc/travel-booking/perdiem-recompute.ts",
  // Serves the requester their own allowance history; prices nothing, but it is
  // what feeds the browser's estimate, so it must resolve the same log.
  "app/api/request/travel-booking/allowance-log/route.ts",
];

/**
 * `getAllowanceLog` reads HR and nothing else. Once anything but its own file
 * names it, a per-diem figure is being computed from the employee's REAL HR
 * allowance with no chance for a UAT tester's own rate to replace it — which is
 * silent, and lands on `AccRequest.TotalAmount`.
 */
test("only allowance-log.ts names getAllowanceLog", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === "lib/acc/travel-booking/allowance-log.ts") continue;
    if (/\bgetAllowanceLog\b/.test(code(rel))) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "these read the HR allowance log directly, bypassing getPerDiemEmployeeLog — a UAT tester " +
      "would be priced at their real compensation: " + offenders.join(", "),
  );
});

test("only the named files import the per-diem log wrapper", () => {
  const importers: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === "lib/acc/travel-booking/allowance-log.ts") continue;
    if (/\bgetPerDiemEmployeeLog(Map)?\b/.test(code(rel))) importers.push(rel);
  }
  assert.ok(importers.length > 0, "nothing imports getPerDiemEmployeeLog — has it been renamed?");
  assert.deepEqual(
    importers.slice().sort(),
    ALLOWED_PERDIEM_LOG_IMPORTERS.slice().sort(),
    "a new file computes a per-diem figure from the employee log. It must go through " +
      "getPerDiemEmployeeLog and perDiemLogFor, or the country rate and the UAT override " +
      "silently do not apply to whatever it computes.",
  );
});
```

- [ ] **Step 2: Add the "matches the call, not the mention" arm**

Add after the existing `"every file that prices a trip also resolves the rate"` test. Note this list is **not** `PRICERS`: that constant's fourth member is the `"use client"` hook, which must never call a `getCorePool()` reader.

```ts
/**
 * The three server pricers and the route that feeds the browser's estimate must
 * all CALL the wrapper — matched as a call, because a comment naming it would
 * satisfy a bare identifier and `code()` only strips whole-line `//` comments.
 *
 * Deliberately not `PRICERS`: that list's fourth member is
 * features/travel-booking/hooks/useTravelBookingForm.ts, a "use client" file
 * that gets its log from the route and must never reach Fast_Core itself.
 */
test("every server-side pricer calls the per-diem log wrapper", () => {
  for (const file of ALLOWED_PERDIEM_LOG_IMPORTERS) {
    const src = code(file);
    assert.ok(
      /getPerDiemEmployeeLog(Map)?\s*\(/.test(src),
      `${file} names the wrapper but never calls it — a UAT tester would be priced at their ` +
        "real HR compensation",
    );
  }
});

/**
 * The client half of the same rule. Importing a getCorePool() reader into the
 * form hook pulls @/lib/db/mssql -> @/env into the browser bundle and breaks the
 * build — which no type error predicts, and whose "obvious fix" is to make the
 * override reach the browser some other way.
 */
test("the form hook reaches no server-side per-diem reader", () => {
  const src = code("features/travel-booking/hooks/useTravelBookingForm.ts");
  assert.ok(
    !/getPerDiemEmployeeLog|getCorePool|uatPerDiemLog/.test(src),
    "useTravelBookingForm.ts is a client component: it must take the resolved log from " +
      "/api/request/travel-booking/allowance-log, never read Fast_Core itself",
  );
});
```

- [ ] **Step 3: Add the `r.StaffId` arm**

Add beside the two existing `r.CountryCode` arms:

```ts
/**
 * The other column in the recompute's SELECT that costs money if it is tidied
 * away. Without `r.StaffId` the UAT override lookup is handed `undefined`, finds
 * nothing, and every UAT trip in the group is re-priced at the tester's real HR
 * allowance — inside the transaction that cancels a sibling, writing both
 * PerDiemTotal and AccRequest.TotalAmount. It fails no typecheck.
 */
test("the recompute reads the request's StaffId", () => {
  const src = code("lib/acc/travel-booking/perdiem-recompute.ts");
  assert.ok(
    /r\.StaffId/.test(src),
    "perdiem-recompute.ts's group SELECT no longer names r.StaffId — a cancellation will " +
      "re-price every surviving UAT trip in the group at the tester's real HR allowance",
  );
});
```

- [ ] **Step 4: Run the guard test**

Run: `npm test -- src/lib/acc/travel-booking/perdiem-source-guard.test.ts`
Expected: PASS, every test. A red `"only allowance-log.ts names getAllowanceLog"` means a consumer from Tasks 6-8 was missed — fix the consumer, not the test.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/acc/travel-booking/perdiem-source-guard.test.ts
git commit -m "test(ap-17): pin every per-diem pricer to the one wrapper, and StaffId to the recompute"
```

---

### Task 10: The rate the browser displays

**Files:**
- Modify: `src/features/travel-booking/hooks/useTravelBookingForm.ts` (near `:579-603`, and the returned object near `:956`)
- Modify: `src/features/travel-booking/components/TravelBookingForm.tsx:290` and `:431`

**Interfaces:**
- Consumes: `rateForDay` from `@/lib/acc/travel-booking/perdiem` (already imported for the estimate; add it if not).
- Produces: the hook returns `displayRate: number | null`.

- [ ] **Step 1: Derive `displayRate` in the hook**

In `src/features/travel-booking/hooks/useTravelBookingForm.ts`, after `estimateLog` is defined, add:

```ts
  /**
   * The rate to SHOW, as opposed to the log used to price.
   *
   * It used to be `employee.allowance`, which comes from `/api/me/employee` —
   * a route that is unclassified in ROUTE_RULES (so it resolves Production for
   * everyone, and a UAT override could never reach it) and that returns the
   * ACTOR's row, not the requester's. Both are wrong here.
   *
   * `estimateLog` is already the right answer: it comes from
   * /api/request/travel-booking/allowance-log, which is classified AP-17, keyed
   * on requesterStaffId, and already substitutes the tester's UAT rate.
   *
   * The `> 0` arm is not defensive noise: `rateForDay` answers 0 for a day no
   * entry covers, and a chip reading ฿0/วัน is a worse answer than the figure it
   * replaced.
   */
  const displayRate = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    const fromLog = rateForDay(today, estimateLog);
    return estimateLog.length > 0 && fromLog > 0 ? fromLog : (employee?.allowance ?? null);
  }, [estimateLog, employee?.allowance]);
```

Add `displayRate` to the object the hook returns, beside `employee`.

- [ ] **Step 2: Read it in the form**

In `src/features/travel-booking/components/TravelBookingForm.tsx`, take `displayRate` off the hook's return value and change the two sites:

At `:290`:

```tsx
                        <Wallet size={11} /> ฿{displayRate != null ? fmtBaht(displayRate) : "-"}/วัน
```

At `:431`:

```tsx
          allowanceRate={displayRate}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Confirm the guard still holds**

Run: `npm test -- src/lib/acc/travel-booking/perdiem-source-guard.test.ts`
Expected: PASS — in particular `"the form hook reaches no server-side per-diem reader"`, which is what stops this task being implemented by importing the Fast_Core reader into the browser.

- [ ] **Step 5: Commit**

```bash
git add src/features/travel-booking/hooks/useTravelBookingForm.ts src/features/travel-booking/components/TravelBookingForm.tsx
git commit -m "fix(ap-17): show the rate this trip is priced at, for the requester and in UAT"
```

---

### Task 11: `withUatOverrides` and the submit's snapshot

**Files:**
- Modify: `src/lib/hr/employee-lookup.ts:583-590` (`withUatManager`) and its two call sites at `:621` and `:636`
- Modify: `src/lib/acc/travel-booking/request-service.ts:1305-1312` (the submit's `AccTravelBooking` UPDATE)

**Interfaces:**
- Consumes: `uatPerDiemLogFor` from `@/lib/uat-tester/per-diem`; `rateForDay` from `@/lib/acc/travel-booking/perdiem`.
- Produces: `withUatOverrides(employee: EmployeeContext): Promise<EmployeeContext>` replaces `withUatManager`.

- [ ] **Step 1: Rename and extend**

In `src/lib/hr/employee-lookup.ts`, add the imports

```ts
import { rateForDay } from "@/lib/acc/travel-booking/perdiem";
import { uatPerDiemLogFor } from "@/lib/uat-tester/per-diem";
```

and replace `withUatManager` with:

```ts
/**
 * ...keep the existing docblock above this function verbatim, then add:
 *
 * It also replaces `allowance`, the employee's CURRENT per-diem rate, with the
 * tester's own UAT rate when one is configured. That figure is a display value
 * everywhere except one place that matters: `upsertTravelBooking` stamps it into
 * `AccTravelBooking.AllowanceSnapshot`, which the detail page prints beside the
 * priced total. Leaving it as the real HR figure puts a tester's real
 * compensation on screen next to a UAT-priced total.
 *
 * One environment resolve for both overrides, because they answer the same
 * question and two resolves could not disagree without being a bug.
 */
async function withUatOverrides(employee: EmployeeContext): Promise<EmployeeContext> {
  if ((await resolveFormEnvironment()) !== "UAT") return employee;

  const [manager, uatLog] = await Promise.all([
    uatManagerFor(employee.email ?? employee.emailCompBr ?? null, employee.staffId ?? null),
    uatPerDiemLogFor(employee.staffId ?? null),
  ]);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  return {
    ...employee,
    managerStaffId: manager ? manager.staffId : null,
    // rateForDay answers 0 for a day no entry covers; a 0 here would claim the
    // tester's allowance is zero rather than that no rate is in force yet.
    allowance:
      uatLog && rateForDay(today, uatLog) > 0 ? rateForDay(today, uatLog) : employee.allowance,
  };
}
```

Update both call sites in `resolveEmployeeForActor` (`:621`, `:636`) from `withUatManager(...)` to `withUatOverrides(...)`.

- [ ] **Step 2: Re-stamp `AllowanceSnapshot` at submit**

In `src/lib/acc/travel-booking/request-service.ts`, extend the submit's `AccTravelBooking` UPDATE:

```ts
      // AllowanceSnapshot is otherwise written only by upsertTravelBooking, at
      // save. A draft saved before a rate changed — a UAT rate being set, or an
      // HR rate changing in production — would print the old figure beside a
      // total priced from the new one. Submit is the moment the figure is fixed,
      // so the snapshot is fixed with it.
      await tx.request()
        .input("id", sql.Int, requestId)
        .input("cont", sql.Bit, continuationFlags[i] ? 1 : 0)
        .input("days", sql.Int, perDiems[i].days)
        .input("total", sql.Decimal(18, 2), perDiems[i].total)
        .input("allowance", sql.Decimal(18, 2), emp.allowance ?? null)
        .query(`UPDATE [dbo].[AccTravelBooking] SET
                IsContinuation=@cont, PerDiemDays=@days, PerDiemTotal=@total,
                AllowanceSnapshot=@allowance, UpdatedAt=SYSDATETIME()
                WHERE RequestId=@id`);
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Confirm no other caller expected `withUatManager`**

Run: `grep -rn "withUatManager" src/`
Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hr/employee-lookup.ts src/lib/acc/travel-booking/request-service.ts
git commit -m "feat(ap-17): the stamped allowance follows the rate the trip was priced at"
```

---

### Task 12: The history modal's footer

**Files:**
- Modify: `src/features/travel-booking/components/AllowanceHistoryModal.tsx:102`

**Interfaces:**
- Consumes: `allowanceSource` from the allowance-log payload (Task 6).
- Produces: nothing.

- [ ] **Step 1: Read the new field**

Widen the modal's fetched payload type to include `allowanceSource?: "hr" | "uat"`, and replace the footer line at `:102`:

```tsx
          <History size={12} className="shrink-0" />{" "}
          {allowanceSource === "uat"
            ? "เรตทดสอบสำหรับ UAT — ตั้งค่าที่ ตั้งค่า → UAT Users"
            : "ข้อมูลจากระบบ HR — แก้ไขได้ที่ระบบต้นทางเท่านั้น"}
```

The field is optional and defaults to the HR wording, so a cached response from before this deploy renders exactly as it did.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/travel-booking/components/AllowanceHistoryModal.tsx
git commit -m "fix(ap-17): the allowance history says where its rates actually come from"
```

---

### Task 13: The settings route

**Files:**
- Create: `src/app/api/settings/uat-users/per-diem/route.ts`

**Interfaces:**
- Consumes: `listAllUatPerDiemRates`, `upsertUatPerDiemRate`, `setUatPerDiemRateActive`, `UatPerDiemInputError` from `@/lib/uat-tester/per-diem`; `listUatTesters` from `@/lib/uat-tester/service`.
- Produces: `GET → { ok: true, data: UatPerDiemRateRow[] }`, `POST`, `PATCH`.

- [ ] **Step 1: Write the route**

Create `src/app/api/settings/uat-users/per-diem/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  UatPerDiemInputError,
  listAllUatPerDiemRates,
  setUatPerDiemRateActive,
  upsertUatPerDiemRate,
} from "@/lib/uat-tester/per-diem";
import { listUatTesters } from "@/lib/uat-tester/service";

/**
 * A UAT tester's own per-diem rate — System Admin only, on every method.
 *
 * `requireRole(["System Admin"])`, matching the UAT Users page this lives on and
 * NOT the AP-17 per-diem-country route's IT-Admin-and-above. A row here changes
 * what a UAT trip is priced at, and it is edited from a System-Admin page.
 *
 * Validation happens HERE, before Number() reaches the database
 * (`parseUatPerDiemInput`), not only in the component: this page has never had a
 * typed numeric input before, and its only existing numeric check is on ids the
 * server itself issued.
 */

const ADMIN = ["System Admin"] as const;

export async function GET() {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listAllUatPerDiemRates() });
  } catch (e) {
    console.error("[api/settings/uat-users/per-diem] GET", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as {
      staffId?: unknown;
      effectiveDate?: unknown;
      amount?: unknown;
      note?: unknown;
    };

    // A rate is only meaningful for somebody on the tester list; without this a
    // typo in a StaffId creates a row nothing will ever read.
    const staffId = Number(body.staffId);
    const testers = await listUatTesters();
    if (!testers.some((t) => t.staffId === staffId)) {
      return NextResponse.json({ ok: false, error: "ไม่พบผู้ทดสอบรายนี้" }, { status: 400 });
    }

    await upsertUatPerDiemRate(
      {
        staffId: body.staffId,
        effectiveDate: body.effectiveDate,
        amount: body.amount,
        note: body.note ?? null,
      },
      Number(session.user.id) || null,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    // The parser's refusals are Thai and name the problem; a constraint
    // violation surfacing raw would say "CK_UatTesterPerDiem_Amount".
    if (e instanceof UatPerDiemInputError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error("[api/settings/uat-users/per-diem] POST", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** The soft delete. A rate a UAT trip was already priced at is history. */
export async function PATCH(req: NextRequest) {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { id?: number; isActive?: boolean };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0 || typeof body.isActive !== "boolean") {
      return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }
    await setUatPerDiemRateActive(id, body.isActive, Number(session.user.id) || null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/settings/uat-users/per-diem] PATCH", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Confirm no `ROUTE_RULES` entry is needed**

Run: `grep -n "api/settings" src/lib/form-environment/classify-path.ts`
Expected: no `/api/settings` rules at all — settings routes are not form routes, they carry no `AccRequest` id, and this one reads Fast_Core through `getCorePool()`, which the resolver never picks. Add nothing.

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/uat-users/per-diem/route.ts
git commit -m "feat(ap-17): a System Admin can set a UAT tester's per-diem rate"
```

---

### Task 14: The settings panel

**Files:**
- Modify: `src/features/settings/UatUserSettings.tsx`

**Interfaces:**
- Consumes: `/api/settings/uat-users/per-diem` (Task 13).
- Produces: nothing.

- [ ] **Step 1: Fetch the rates and add the column**

In `src/features/settings/UatUserSettings.tsx`, add the imports and the SWR read:

```tsx
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { Wallet } from "lucide-react";
```

```tsx
interface UatPerDiemRate {
  id: number;
  staffId: number;
  effectiveDate: string;
  amount: number;
  note: string | null;
  isActive: boolean;
}
```

```tsx
  const { data: rateData, mutate: mutateRates } = useSWR<{ ok: boolean; data: UatPerDiemRate[] }>(
    "/api/settings/uat-users/per-diem",
    fetcher,
  );
  const rates = rateData?.ok ? rateData.data : [];
  const [perDiemFor, setPerDiemFor] = useState<UatTesterListItem | null>(null);

  /** The rate in force today, by the same rule the trip pricing uses. */
  const rateToday = (staffId: number): number | null => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    let best: UatPerDiemRate | null = null;
    for (const r of rates) {
      if (r.staffId !== staffId || !r.isActive || r.effectiveDate > today) continue;
      if (!best || r.effectiveDate > best.effectiveDate) best = r;
    }
    return best ? best.amount : null;
  };
```

Add a header cell `เบี้ยเลี้ยง UAT` to the table's `<thead>`, before `สถานะ`, and this cell to each row before the status cell:

```tsx
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[11px]"
                          style={{ color: rateToday(t.staffId) != null ? "var(--text-secondary)" : "var(--text-faint)" }}
                        >
                          {rateToday(t.staffId) != null
                            ? `฿${rateToday(t.staffId)!.toLocaleString("en-US", { minimumFractionDigits: 2 })}/วัน`
                            : "—"}
                        </span>
                        <button
                          onClick={() => setPerDiemFor(t)}
                          className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-lg cursor-pointer border-none"
                          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                        >
                          <Wallet size={10} /> ตั้งเรต
                        </button>
                      </div>
                    </td>
```

- [ ] **Step 2: Add the editor panel**

Add this component above `UatUserSettings`, and render `{perDiemFor && <PerDiemPanel … />}` beside the existing `{confirmAction && …}` block:

```tsx
/* ── Per-diem editor ──
   The AMOUNT opens BLANK and the DATE defaults to today. That split is the
   lesson PerDiemCountrySettings paid for: pre-filling the stored values makes
   one click an in-place rewrite of a rate trips were already priced at, when
   the intent is almost always to add a new dated row. Defaulting the date has
   no such risk — the save key is (StaffId, EffectiveDate), and today is rarely
   an existing row — and it is what keeps a new rate covering every trip, since
   a trip cannot depart before tomorrow. */
function PerDiemPanel({
  tester, rates, onClose, onSaved,
}: {
  tester: { staffId: number; name: string; email: string };
  rates: UatPerDiemRate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  const [effectiveDate, setEffectiveDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = rates
    .filter((r) => r.staffId === tester.staffId)
    .slice()
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/uat-users/per-diem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: tester.staffId, effectiveDate, amount, note }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error ?? "บันทึกไม่สำเร็จ"); return; }
      toast.success("บันทึกเรตแล้ว");
      setAmount("");
      setNote("");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: number, isActive: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/uat-users/per-diem", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error ?? "ทำรายการไม่สำเร็จ"); return; }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel open onClose={onClose} width="480px">
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border-card)" }}>
        <div>
          <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>เบี้ยเลี้ยง UAT</h3>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{tester.name} · {tester.email}</p>
        </div>
        <SidePanelClose onClick={onClose} />
      </div>

      <div className="px-5 py-4 overflow-y-auto flex-1">
        <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
          ใช้เฉพาะใน UAT · ถ้าไม่ตั้ง จะใช้เบี้ยเลี้ยงจริงจากระบบ HR · ทริปต่างประเทศที่มีเรตรายประเทศ จะใช้เรตรายประเทศ
        </p>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            วันที่เริ่มมีผล
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 rounded-lg text-[12px]"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)" }} />
          </label>
          <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            จำนวนเงินต่อวัน (บาท)
            <input type="number" min={0} step="0.01" value={amount} placeholder="เช่น 800"
              onChange={(e) => setAmount(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 rounded-lg text-[12px]"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)" }} />
          </label>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)" maxLength={300}
          className="w-full px-2 py-1.5 rounded-lg text-[12px] mb-3"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)" }} />
        <button onClick={() => void save()} disabled={busy}
          className="w-full px-3 py-2 rounded-lg text-[12px] font-bold border-none text-white enabled:cursor-pointer disabled:opacity-60"
          style={{ background: "var(--color-action)" }}>
          {busy ? "กำลังบันทึก…" : "บันทึกเรต"}
        </button>

        <div className="mt-5">
          <p className="text-[11px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>เรตที่ตั้งไว้</p>
          {mine.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>ยังไม่ได้ตั้งเรต — จะใช้ข้อมูลจากระบบ HR</p>
          ) : (
            mine.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--border-card)" }}>
                <span className="text-[12px]" style={{ color: r.isActive ? "var(--text-primary)" : "var(--text-faint)" }}>
                  {r.effectiveDate} · ฿{r.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}/วัน
                  {r.note ? ` · ${r.note}` : ""}
                </span>
                <button onClick={() => void toggle(r.id, !r.isActive)} disabled={busy}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-lg border-none enabled:cursor-pointer disabled:opacity-60"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
                  {r.isActive ? "ปิดใช้" : "เปิดใช้"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </SidePanel>
  );
}
```

Render it:

```tsx
      {perDiemFor && (
        <PerDiemPanel
          tester={perDiemFor}
          rates={rates}
          onClose={() => setPerDiemFor(null)}
          onSaved={() => { void mutateRates(); }}
        />
      )}
```

- [ ] **Step 2b: Confirm the token names used above exist**

Run: `grep -n "\-\-bg-input\|--border-main\|--text-faint\|--color-action" src/app/globals.css | head`
Expected: each is defined. If any is not, substitute the nearest token that is — never a raw hex value.

- [ ] **Step 3: Typecheck and lint the page**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Check it in the browser**

Run: `npm run dev`, open `http://localhost:3081/settings/uat-users` as a System Admin.
Expected: a `เบี้ยเลี้ยง UAT` column reading `—` for every tester, a `ตั้งเรต` button opening the panel, a saved rate appearing in the column, and `จำนวนเงินต่อวันต้องมากกว่า 0` on a `0` or blank amount.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/UatUserSettings.tsx
git commit -m "feat(ap-17): set a UAT tester's per-diem rate from Settings"
```

---

### Task 15: Documentation and full verification

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Update CLAUDE.md**

In the AP-17 section, after the bullet that says AP-17 uses
`Rocks_Portal_HR.EmployeeAllowanceLog` for effective-dated per-diem history, add:

```markdown
- **In UAT, a tester's per diem can come from their own configured rate instead
  of real HR.** `Rocks_Portal_HR` has no UAT twin, so a tester rehearsing AP-17
  was priced at their real compensation and four screens displayed it.
  `Fast_Core.dbo.UatTesterPerDiem` (migration **138**, `getCorePool()`, **one
  copy — not dual-written, not in `MASTER_TABLES`**) holds an effective-dated
  rate per StaffId, set at Settings → UAT Users. Design:
  `docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md`.
  - **One seam: `getPerDiemEmployeeLog` / `getPerDiemEmployeeLogMap`** in
    `allowance-log.ts`. `getAllowanceLog` now has **no caller outside its own
    file**, and `perdiem-source-guard.test.ts` asserts that lexically. The dead
    `resolvePerDiemLog` was deleted to make that true.
  - **The country rate still wins**, for free: only the *employee* arm is
    substituted, so `perDiemLogFor` is untouched and its `source` union still has
    two members. **No rate set falls back to real HR** — `null`, never `[]`.
  - **Whether it applies is `isUatId(id)` where a record id exists**
    (`perdiem-recompute.ts`, `report-service.ts`) **and the resolved environment
    where one does not** (the submit, the allowance-log route,
    `withUatOverrides`). Both spellings live in `perdiem-uat-gate.ts`. The
    recompute cannot use the resolver — not because it does I/O, it does not,
    but because it answers **Production** with no request scope, which would
    re-price a UAT trip at real HR inside the cancelling transaction.
  - **`perdiem-recompute.ts`'s SELECT now names `r.StaffId` as well as
    `r.CountryCode`**, and for the same reason: deleting it fails no typecheck
    and silently re-prices every UAT trip in the group. Both have guard arms.
  - **The browser's displayed rate no longer comes from `employee.allowance`.**
    `/api/me/employee` is unclassified in `ROUTE_RULES`, so it resolves
    Production for everyone and could never carry a UAT override, and it returns
    the **actor's** row rather than the requester's. The chip and
    `allowanceRate` are derived from `estimateLog`, which the form already
    fetches from the AP-17-classified allowance-log route keyed on
    `requesterStaffId` — which also fixes the long-standing bug where filing on
    behalf showed the actor's rate.
  - **`AllowanceSnapshot` is now re-stamped at submit**, not only at draft save.
    **This changes production too**: a draft saved before an HR rate change and
    submitted after it used to keep the stale figure. Submit is when the priced
    total is fixed, so the snapshot is fixed with it.
```

In the **Parallel Production and UAT** section, where it says `FormEnvironment`
and `UatTester` must stay in Fast_Core, add `UatTesterPerDiem` to that list with
the reason: what a tester is paid must not vary with the form pool.

- [ ] **Step 2: Run the full verification**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: PASS, every file.

Run: `npm run check:alignment`
Expected: `PASS — 27 configuration tables …`. The count must **not** have moved: this table is in Fast_Core and is not a shared master table.

- [ ] **Step 3: Confirm no forbidden import crept in**

Run: `grep -n "form-environment\|uat-tester/guards" src/lib/acc/travel-booking/allowance-log.ts`
Expected: no hits — the environment reaches that module only as a parameter.

Run: `grep -rn "getCorePool\|uatPerDiemLog" src/features/`
Expected: no hits — nothing under `src/features/` may read Fast_Core.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record the UAT per-tester per-diem rate and its two seams"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 storage | 1 |
| §3.1 pricing seam + delete `resolvePerDiemLog` | 5, 6, 7, 8 |
| §3.1 report's two keys | 8 |
| §3.2 display rate | 10 |
| §3.3 `AllowanceSnapshot` + `withUatOverrides` | 11 |
| §3.4 modal footer | 12 |
| §4 the gate | 4, 6, 7, 8 |
| §5.1 `r.StaffId` | 7, 9 |
| §5.2 database-free recompute test | 7 |
| §6 modules | 2, 3 |
| §7 settings UI + route | 13, 14 |
| §8 testing | 2, 4, 9 |
| §9 migration and ordering | 1 |
| §10 documentation | 15 |

**Type consistency checked:** `UatPerDiemRateRow` (Task 2) is the row type
returned by `listAllUatPerDiemRates` (Task 3) and consumed by the panel (Task
14). `PerDiemLogSubject` / `perDiemLogSubjectKey` (Task 5) are used only by Task
8. `uatByRecordId` / `uatByEnvironment` (Task 4) keep those exact names in Tasks
6, 7, 8 and the guard's message in Task 9. `getPerDiemEmployeeLog` and
`getPerDiemEmployeeLogMap` keep their names in Tasks 5-9 and in the guard's
regex `getPerDiemEmployeeLog(Map)?`.

**Known ordering constraint:** `npm test` is red between Task 5 and Task 9 —
`perdiem-source.ts` stops importing `getAllowanceLog` in Task 5 while the
allow-list is only rewritten in Task 9. Task 5 Step 4 says so explicitly. Do not
"fix" it by re-adding the dead function.
