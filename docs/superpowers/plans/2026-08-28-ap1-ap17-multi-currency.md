# AP-1 / AP-17 Multi-Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company brand can carry a country and a currency; a claim against that brand can be entered in that currency and is converted to Thai baht at a recorded rate.

**Architecture:** Currency lives once per brand on `BrandSetting`, read only through `brand-registry.ts` (production pool). One currency per *request*, stored on **`AccRequest`** as `Currency` + `ExchangeRate` + `BaseAmount` — not on `AccTravelExpense`, which carries `UQ_AccTravel_Request_Date` and is one row **per travel day**, so three columns there would be N rows per claim with nothing saying which is authoritative. `AccRequest.TotalAmount` stays Thai baht always, which is what leaves every existing summer, report, export and ERP path untouched. The FX lookup is AP-2's `bot-fx.ts`, called server-side.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (ES5 target), MSSQL, `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-28-ap1-ap17-multi-currency-design.md` — read it first; it carries the measurements and the three decisions the user took.

## Global Constraints

- **`AccRequest.TotalAmount` is Thai baht, always.** No task may write a foreign figure to it.
- **Every read of a brand's currency goes through `brand-registry.ts`**, which opens `getProductionFormPool()`. `BrandSetting` does not exist in `Rocks_Portal_Form_UAT` — a read via `getAccPool()`/`getFormPool()` throws `Invalid object name` for every UAT tester.
- **The client never posts an exchange rate.** The server fetches and writes it.
- **No screen captions a rate as a Bank of Thailand rate.** `BOT_API_CLIENT_ID` will not be provisioned (spec §9.1); every rate is an ECB mid-market reference rate. Thai copy: `อัตราอ้างอิง`.
- **A foreign-currency claim may not use a rate-based vehicle** — manual entry only. `CK_AccVehicle_Rate` refuses `RatePerKm < 1`.
- **AP-17 per diem is always baht.** `EmployeeAllowanceLog` has no currency column.
- TypeScript **ES5 target**: `Array.from(...)`, never `[...someSet]`.
- Parameterised SQL only. CSS `var(--token)` only. Icons `lucide-react`. Toasts `sonner`. Thai user-facing copy.
- A brand with no configured currency must behave **exactly** as today: no dropdown, no extra field, no new request.
- **Tasks 1 and 2 need live database credentials.** If `npm run apply-sql` fails, STOP and report — do not proceed to Task 4. Task 4 widens the only `SELECT` on `BrandSetting` (`brand-registry.ts:72-90`), which every brand picker in the app reads: an `Invalid column name` there takes down AP-1, AP-2, AP-3, AP-4, AP-17 and `BrandGate` at once.
- **`AccActivityLog` cannot hold a brand-currency audit row.** `RequestId` is `int NOT NULL` with `FK_AccActivity_Request` (verified in the live database), and a brand change has no request. Task 1 creates `BrandSettingLog` for it, in the shape `ApiKeyLog` already uses.
- **Task 4's pool guard is per *file*, not per statement.** Any module that touches `BrandSetting` must not also import `getAccPool`/`getFormPool`. Brand writes therefore live in `brand-registry.ts`, never in `settings-service.ts` (which imports `getAccPool` at line 1). A later task that "fixes" a red guard by weakening it has removed the only check that catches a UAT-only failure.

---

### Task 1: Migration 124 — BrandSetting gains country and currency

**Files:**
- Create: `migrations/124_brand_setting_currency.sql`

**Interfaces:**
- Produces: `BrandSetting.CountryCode`, `.CurrencyCode`, `.CurrencyEnabled`, and the table `BrandSettingLog` — consumed by Tasks 4 and 6.

- [ ] **Step 1: Write the migration**

```sql
-- A brand's country and the currency a claim against it may be entered in.
--
-- Apply with (PRODUCTION form database ONLY — there is no UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/124_brand_setting_currency.sql
--
-- NUMBERED 124. Read the highest number on *master* before picking one.
--
-- PRODUCTION ONLY, like the rest of BrandSetting (122). Not dual-written, not in
-- MASTER_TABLES. Rocks_Portal_Form_UAT has no BrandSetting object at all, which
-- is exactly why every reader must go through brand-registry.ts and its
-- getProductionFormPool() — a getFormPool() read throws for a UAT tester on the
-- amount-entry path of both forms.
--
-- CurrencyEnabled IS NOT IsEnabled. IsEnabled answers "may a user pick this
-- company at all" and is read only by BrandGate. This answers "may a claim
-- against it be entered in a foreign currency". Conflating them would make
-- turning on a currency also change who can see the brand.
--
-- ALL THREE NULLABLE / DEFAULT 0, so every existing row keeps behaving exactly
-- as it does today: no currency, no dropdown, baht.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form'
  THROW 50000, 'Run this against Rocks_Portal_Form only — BrandSetting has no UAT twin.', 1;
GO

IF OBJECT_ID('dbo.BrandSetting', 'U') IS NULL
  THROW 50000, 'dbo.BrandSetting is missing — apply 122 first.', 1;
GO

BEGIN TRANSACTION;

IF COL_LENGTH('dbo.BrandSetting', 'CountryCode') IS NULL
  ALTER TABLE [dbo].[BrandSetting] ADD [CountryCode] CHAR(2) NULL;

IF COL_LENGTH('dbo.BrandSetting', 'CurrencyCode') IS NULL
  ALTER TABLE [dbo].[BrandSetting] ADD [CurrencyCode] CHAR(3) NULL;

IF COL_LENGTH('dbo.BrandSetting', 'CurrencyEnabled') IS NULL
  ALTER TABLE [dbo].[BrandSetting] ADD [CurrencyEnabled] BIT NOT NULL
    CONSTRAINT [DF_BrandSetting_CurrencyEnabled] DEFAULT (0);

-- The audit trail spec 9.3 requires, and the reason it is its own table.
--
-- AccActivityLog cannot hold it: RequestId is int NOT NULL with
-- FK_AccActivity_Request (verified in the live database), and a brand-currency
-- change has no request. There is no id to supply and no nullable column to omit.
--
-- 9.3 is why this matters more than tidiness: the value is stored once per brand
-- while the permission to change it is per form, so an AP-17 approver can change
-- what an AP-1 claim converts at. That cannot be constrained away, so it is made
-- traceable instead. Shape copied from ApiKeyLog
-- (Id, ApiKeyId, Code, Action, Detail, ChangedBy, ChangedAt).
IF OBJECT_ID('dbo.BrandSettingLog', 'U') IS NULL
CREATE TABLE [dbo].[BrandSettingLog] (
  [Id]        int IDENTITY(1,1) NOT NULL CONSTRAINT [PK_BrandSettingLog] PRIMARY KEY,
  [BrandCode] nvarchar(40)  NOT NULL,
  [Field]     nvarchar(40)  NOT NULL,   -- 'CountryCode' | 'CurrencyCode' | 'CurrencyEnabled'
  [OldValue]  nvarchar(100) NULL,
  [NewValue]  nvarchar(100) NULL,
  [FormCode]  nvarchar(20)  NULL,       -- which form's tab it was changed from
  [ChangedBy] int           NULL,
  [ChangedAt] datetime2(7)  NOT NULL CONSTRAINT [DF_BrandSettingLog_ChangedAt] DEFAULT (sysdatetime())
);

COMMIT TRANSACTION;
GO

-- Post-apply: all three non-NULL, and every existing row still disabled.
SELECT
  COL_LENGTH('dbo.BrandSetting','CountryCode')     AS CountryCode,
  COL_LENGTH('dbo.BrandSetting','CurrencyCode')    AS CurrencyCode,
  COL_LENGTH('dbo.BrandSetting','CurrencyEnabled') AS CurrencyEnabled;
SELECT BrandCode, CountryCode, CurrencyCode, CurrencyEnabled FROM dbo.BrandSetting ORDER BY BrandCode;
GO
```

- [ ] **Step 2: Apply it**

Run: `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/124_brand_setting_currency.sql`
Expected: `applied ... OK`, then three non-NULL lengths and six rows with `CurrencyEnabled = 0`.

Then confirm the log table: `SELECT COUNT(*) FROM dbo.BrandSettingLog` returns 0 rather than erroring.

- [ ] **Step 3: Commit**

```bash
git add migrations/124_brand_setting_currency.sql
git commit -m "feat(currency): BrandSetting carries a country and a currency"
```

---

### Task 2: Migration 125 — the request header carries the currency

**Files:**
- Create: `migrations/125_request_currency.sql`

**Interfaces:**
- Produces: `AccRequest.Currency`, `.ExchangeRate`, `.BaseAmount` — consumed by Tasks 8, 9, 11, 12.

**Why `AccRequest` and not the detail tables.** The design is one currency per
*request*. `AccRequest` is one row per request by definition and already holds
`TotalAmount`. `AccTravelExpense` is **not** — it carries
`UQ_AccTravel_Request_Date` and `saveDraft` deletes and re-inserts one row per
travel day (`request-service.ts:685-719`), so three columns there would be N rows
per claim with nothing saying which is authoritative and nothing keeping them
equal. Putting them on the header also means one migration serves both forms and
no `bindTravel` / `TRAVEL_COLUMNS` / `TRAVEL_VALUES` / `TRAVEL_SET` surgery
(`:516-561`).

- [ ] **Step 1: Write the migration**

```sql
-- One currency per request, on the shared request header.
--
-- Apply to BOTH form databases, before the code deploy:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/125_request_currency.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/125_request_currency.sql
--
-- BOTH SIDES. AccRequest is transactional — neither dual-written nor in
-- MASTER_TABLES, so check:alignment is unaffected and its table count must not
-- move. But SQL Server binds object names at compile time, so a query naming
-- Currency fails outright against whichever database is missing it, and both
-- forms resolve either database depending on who is asking.
--
-- WHY THE HEADER AND NOT AccTravelExpense. That table is one row per travel DAY
-- (UQ_AccTravel_Request_Date), and saveDraft deletes and re-inserts N of them per
-- request. Three columns there would be N copies with no rule about which is
-- authoritative. AccRequest is one row per request by definition and is where
-- TotalAmount already lives.
--
-- AP-2 and AP-3 keep their own Currency/ExchangeRate/BaseAmount on AccAdvance and
-- AccClearAdvance and are untouched by this. The columns here are nullable and
-- unread by those forms.
--
-- NULL Currency and 'THB' both mean baht. No backfill: an existing row reads
-- NULL, which is correct -- nobody recorded a currency, and writing 'THB' would
-- claim somebody had.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
  THROW 50000, 'dbo.AccRequest is missing -- apply 059 first.', 1;
GO

BEGIN TRANSACTION;

IF COL_LENGTH('dbo.AccRequest', 'Currency') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [Currency] CHAR(3) NULL;
IF COL_LENGTH('dbo.AccRequest', 'ExchangeRate') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [ExchangeRate] DECIMAL(18,6) NULL;
IF COL_LENGTH('dbo.AccRequest', 'BaseAmount') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [BaseAmount] DECIMAL(18,2) NULL;

COMMIT TRANSACTION;
GO

SELECT
  COL_LENGTH('dbo.AccRequest','Currency')     AS Currency,
  COL_LENGTH('dbo.AccRequest','ExchangeRate') AS ExchangeRate,
  COL_LENGTH('dbo.AccRequest','BaseAmount')   AS BaseAmount;
GO
```

- [ ] **Step 2: Apply to both databases, then check alignment**

```bash
npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/125_request_currency.sql
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/125_request_currency.sql
npm run check:alignment
```
Expected: both applied; `check:alignment` still PASS **at 25 tables** — `AccRequest` is not in `MASTER_TABLES`, so the count must not move. A changed count means the wrong table was altered.

- [ ] **Step 3: Commit**

---

### Task 3: The pure currency rules

**Files:**
- Create: `src/lib/acc/currency.ts`
- Test: `src/lib/acc/currency.test.ts`

**Interfaces:**
- Consumes: nothing (import-free by design).
- Produces:
  - `THB: "THB"`
  - `isBaht(code: string | null | undefined): boolean`
  - `toBaht(amount: number, rate: number | null): number | null`
  - `admitModelCurrency(answer: string | null | undefined, brandCurrency: string | null): string | null`
  - `brandCurrencyState(b: { currencyCode: string | null; currencyEnabled: boolean }): "none" | "configured"`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { THB, isBaht, toBaht, admitModelCurrency, brandCurrencyState } from "./currency";

test("null, empty and THB all mean baht", () => {
  assert.equal(isBaht(null), true);
  assert.equal(isBaht(undefined), true);
  assert.equal(isBaht(""), true);
  assert.equal(isBaht(THB), true);
  assert.equal(isBaht("thb"), true);
  assert.equal(isBaht("MYR"), false);
});

test("converting applies the rate and rounds to satang", () => {
  assert.equal(toBaht(100, 8.25), 825);
  assert.equal(toBaht(12.34, 8.25), 101.81);
});

/** A foreign amount with no rate is not zero and not itself — it is unknown. */
test("a foreign amount with no usable rate converts to null, never to itself", () => {
  assert.equal(toBaht(100, null), null);
  assert.equal(toBaht(100, 0), null);
  assert.equal(toBaht(100, -1), null);
  assert.equal(toBaht(100, Number.NaN), null);
});

test("a non-finite amount converts to null", () => {
  assert.equal(toBaht(Number.NaN, 8.25), null);
  assert.equal(toBaht(Number.POSITIVE_INFINITY, 8.25), null);
});

/**
 * The admission rule. The model may answer only with the brand's currency or
 * baht; anything else means the user picks, which is what null signals.
 */
test("the model's answer is admitted only if it is the brand's currency or baht", () => {
  assert.equal(admitModelCurrency("MYR", "MYR"), "MYR");
  assert.equal(admitModelCurrency("myr", "MYR"), "MYR");
  assert.equal(admitModelCurrency("THB", "MYR"), THB);
  assert.equal(admitModelCurrency("USD", "MYR"), null);
  assert.equal(admitModelCurrency("", "MYR"), null);
  assert.equal(admitModelCurrency(null, "MYR"), null);
});

/** With no brand currency the only admissible answer is baht. */
test("an unconfigured brand admits baht alone", () => {
  assert.equal(admitModelCurrency("THB", null), THB);
  assert.equal(admitModelCurrency("MYR", null), null);
});

test("a brand is configured only when it has a currency AND the flag is on", () => {
  assert.equal(brandCurrencyState({ currencyCode: "MYR", currencyEnabled: true }), "configured");
  assert.equal(brandCurrencyState({ currencyCode: "MYR", currencyEnabled: false }), "none");
  assert.equal(brandCurrencyState({ currencyCode: null, currencyEnabled: true }), "none");
  assert.equal(brandCurrencyState({ currencyCode: "THB", currencyEnabled: true }), "none");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test src/lib/acc/currency.test.ts`
Expected: FAIL, `Cannot find module './currency'`.

- [ ] **Step 3: Write the module**

```ts
/**
 * The currency rules, with no imports, so they are unit-tested without a
 * database and shared by the form, the save, the AI read and the report.
 *
 * `null` and `"THB"` are both baht. Absence has to mean baht, because every row
 * written before this feature existed has no currency and every one of them was
 * in baht.
 */

export const THB = "THB";

export function isBaht(code: string | null | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase();
  return c === "" || c === THB;
}

/**
 * A foreign figure in baht, or null when it cannot be known.
 *
 * **Never falls back to the unconverted figure.** Returning `amount` when the
 * rate is missing would put a foreign number into a baht column, which is the
 * one failure this whole feature exists to prevent, and it would be invisible.
 */
export function toBaht(amount: number, rate: number | null): number | null {
  if (!Number.isFinite(amount)) return null;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(amount * rate * 100) / 100;
}

/**
 * The currency a document read may be trusted with.
 *
 * Only the brand's own currency or baht. A third currency is a misread, not a
 * discovery — the claim is against one company, in one country. Returning null
 * means the user must choose, which is the same answer `sanitizeReceiptAmount`
 * gives for a figure it cannot trust.
 */
export function admitModelCurrency(
  answer: string | null | undefined,
  brandCurrency: string | null,
): string | null {
  const a = (answer ?? "").trim().toUpperCase();
  if (a === "") return null;
  if (a === THB) return THB;
  const b = (brandCurrency ?? "").trim().toUpperCase();
  if (b !== "" && b !== THB && a === b) return b;
  return null;
}

/**
 * Whether a brand offers a currency choice at all.
 *
 * Both halves are required: a code without the flag is configuration somebody
 * has staged but not turned on, and the flag without a code names nothing. A
 * brand whose currency is literally THB offers no choice either — there is
 * nothing to choose between.
 */
export function brandCurrencyState(b: {
  currencyCode: string | null;
  currencyEnabled: boolean;
}): "none" | "configured" {
  if (!b.currencyEnabled) return "none";
  if (isBaht(b.currencyCode)) return "none";
  return "configured";
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/lib/acc/currency.test.ts` → 7 pass.
Then `npm test` → the whole suite still green.

- [ ] **Step 5: Commit**

---

### Task 4: The brand registry carries the currency, and a guard test pins the pool

**Files:**
- Modify: `src/lib/brand-registry.ts` (the `BrandSettingRow` interface ~`:43`, the `SELECT` ~`:88`, the mapper ~`:100-107`)
- Modify: `src/lib/acc/brand-options.ts` (`AccBrandOption` mapping, `:19-25` and `:31-51`)
- Modify: `src/features/accounting/types.ts` (`AccBrandOption`, `:137`)
- Create: `src/lib/acc/currency-pool-guard.test.ts`

**Interfaces:**
- Consumes: Task 1's columns, Task 3's `brandCurrencyState`.
- Produces: `RegistryBrand.countryCode|currencyCode|currencyEnabled`; **`AccBrandOption.currencyCode: string | null` AND `.currencyEnabled: boolean`** — both, because Tasks 8, 9 and 12 call `brandCurrencyState({ currencyCode, currencyEnabled })`, which needs the pair. Producing only the code would leave the client unable to call the function the plan tells it to call, and would render the dropdown for a brand whose currency is staged but switched off — the exact state `CurrencyEnabled` exists to represent.

- [ ] **Step 1: Extend the registry**

Add `CountryCode`, `CurrencyCode`, `CurrencyEnabled` to `BrandSettingRow`, to the `SELECT` list, and to the mapped `RegistryBrand`:

```ts
      countryCode: s?.CountryCode ?? null,
      // A brand with no row has no currency, which reads as baht everywhere.
      currencyCode: s?.CurrencyCode ?? null,
      currencyEnabled: s ? s.CurrencyEnabled : false,
```

- [ ] **Step 2: Widen `AccBrandOption`**

`AccBrandOption` is `{ brandCode, brandName, brandLogo }` today and drops everything else. Add **both** `currencyCode: string | null` and `currencyEnabled: boolean`.

**There are three construction sites, and missing the third fails `npm run build` in a feature this task never otherwise touches:**

1. `src/lib/acc/brand-options.ts:20-24` — `listAllBrands`
2. `src/lib/acc/brand-options.ts:46-50` — `getAllowedBrands` (take the values from the `byCode` map it already builds; do **not** add a second query)
3. `src/features/reimburse/components/ReimburseForm.tsx:457` — AP-4's fallback option for a saved brand no longer on the allowlist. Give it `currencyCode: null, currencyEnabled: false`: a code the allowlist has dropped has no currency this app can vouch for.

Adding a required field to this type is `TS2739` at every site, so the build is the check — but a subagent told the file list is complete will not expect a failure in `src/features/reimburse`.

- [ ] **Step 3: Write the guard test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * BrandSetting exists in Rocks_Portal_Form and NOT in Rocks_Portal_Form_UAT
 * (measured 2026-08-28). A read through getAccPool()/getFormPool() therefore
 * throws `Invalid object name 'BrandSetting'` for every UAT tester, on the
 * amount-entry path of both forms — and only for them, so no ordinary test or
 * build would catch it.
 *
 * There is no route or database harness in this repo, so this reads the source.
 */
test("BrandSetting is only ever read through the production pool", () => {
  const root = path.resolve(process.cwd(), "src");
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const s = fs.readFileSync(p, "utf8");
        if (!/BrandSetting/.test(s)) continue;
        // Comments quoting the rule must not fail it.
        const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (!/BrandSetting/.test(code)) continue;
        if (/getAccPool|getFormPool\b/.test(code)) offenders.push(path.relative(root, p));
      }
    }
  };
  walk(root);

  assert.deepEqual(
    offenders,
    [],
    "these read BrandSetting from a pool that resolves the UAT database, where it does not exist: " +
      offenders.join(", "),
  );
});
```

- [ ] **Step 4: Prove the guard bites**

Temporarily add `getFormPool` to `brand-registry.ts`'s import and a dead call; run the test; watch it fail naming the file; revert. **Report that you did this** — a guard nobody has seen fail is a guard nobody has tested.

- [ ] **Step 5: `npm test`, `npx tsc --noEmit`, commit**

---

### Task 5: A server-side FX service

**Files:**
- Create: `src/lib/acc/fx.ts`
- Test: `src/lib/acc/fx.test.ts`
- Modify: `src/lib/adv/bot-fx.ts` — add a timeout only.

**Interfaces:**
- Consumes: `fetchFxRate` from `src/lib/adv/bot-fx.ts`, Task 3's `isBaht`.
- Produces: `resolveRate(currency: string | null): Promise<{ rate: number; asOf: string; source: string } | null>`.

- [ ] **Step 1: Add a timeout to bot-fx**

**All three** `fetch` calls in `bot-fx.ts` take `signal: AbortSignal.timeout(8000)` — `:31` (`fetchSupportedCurrencies`), `:54` (`fetchBotRate`) and `:71` (`fetchEcbRate`). The first is on AP-2's currency picker and hangs the same way; it is the one most likely skipped.

- [ ] **Step 2: Write the failing test for the pure half**

`resolveRate` needs the network, so test the pure decision instead — export `needsRate(currency)` from `fx.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRate } from "./fx";

test("baht never needs a rate", () => {
  assert.equal(needsRate(null), false);
  assert.equal(needsRate("THB"), false);
  assert.equal(needsRate(""), false);
});

test("a foreign currency needs one", () => {
  assert.equal(needsRate("MYR"), true);
});
```

- [ ] **Step 3: Write `fx.ts`**

```ts
import { fetchFxRate } from "@/lib/adv/bot-fx";
import { isBaht, THB } from "@/lib/acc/currency";

/**
 * Whether a claim in this currency has to look a rate up.
 *
 * Baht never does, which is what keeps an FX outage from stopping ordinary
 * work: the fail-closed rule at submit only applies to a foreign claim.
 */
export function needsRate(currency: string | null | undefined): boolean {
  return !isBaht(currency);
}

/**
 * Today's rate for a currency, or null when it cannot be had.
 *
 * **Server-side only.** The client never posts a rate — AP-2 does, and nothing
 * verifies it there, which would let a requester choose their own.
 *
 * The rate is an ECB mid-market reference rate: BOT_API_CLIENT_ID is
 * deliberately not provisioned (spec §9.1), so `bot-fx` always takes its
 * keyless fallback. No caller may caption it as a Bank of Thailand rate.
 */
export async function resolveRate(
  currency: string | null,
): Promise<{ rate: number; asOf: string; source: string } | null> {
  if (!needsRate(currency)) return { rate: 1, asOf: "", source: THB };
  try {
    const fx = await fetchFxRate(String(currency).toUpperCase());
    return fx && fx.rate > 0 ? { rate: fx.rate, asOf: fx.asOf, source: fx.source } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

---

### Task 6: The brand tab edits the currency — ONE component, both forms

**Files:**
- Modify: `src/features/accounting/components/settings/BrandSettings.tsx` — **one shared component**, not two
- Modify: `src/app/(dashboard)/request/accounting/travel-booking-settings/page.tsx:219-221` — where AP-17 renders it
- Modify: `src/app/api/request/accounting/settings/brands/route.ts:30-42`
- Modify: `src/app/api/request/travel-booking/settings/brands/route.ts:33-45`
- Modify: `src/lib/brand-registry.ts` — the write, beside `saveBrandSetting` (`:142-179`)

**Interfaces:**
- Consumes: Task 1's columns and `BrandSettingLog`, Task 4's registry fields.
- Produces: one service function writing `{ brandCode, countryCode, currencyCode, currencyEnabled }`.

**This was two tasks and is one, because there is one panel.** `BrandSettings.tsx`
takes its `endpoint` as a prop and AP-17's settings page renders the same
component (`travel-booking-settings/page.tsx:219`). There is no second file to
modify, and two tasks would have demanded different copy from one component.

- [ ] **Step 1: The write lives in `brand-registry.ts`, not `settings-service.ts`**

`settings-service.ts` imports `getAccPool` on line 1 and calls it seven times.
Task 4's guard is **per file**: the moment a `BrandSetting` statement lands there,
`npm test` goes red — and every task from here on ends with `npm test`. Put the
write beside `saveBrandSetting` in `brand-registry.ts`, which already uses
`getProductionFormPool()` and imports no `getAccPool`. **Do not weaken the guard
to make this pass.**

- [ ] **Step 2: The audit row, in the same transaction, on the same connection**

One row in **`BrandSettingLog`** per changed field, on the same
`getProductionFormPool()` connection as the `BrandSetting` write, in one
transaction. **Not `AccActivityLog`** — its `RequestId` is `int NOT NULL` with
`FK_AccActivity_Request` and a brand change has no request, so the insert is
impossible. Record `FormCode` too: spec §9.3's whole point is that the value is
per brand while the permission is per form, and the log is how a change is traced
back to which form's tab it came from.

- [ ] **Step 3: Both routes keep their own gate**

`requireSettingsTab("brands")` for AP-1, `requireBookingSettingsTab("brands")`
for AP-17, both calling the single service function. **Do not tighten either to
`requireRole`** — the user chose this knowingly (spec §9.3), and a reviewer who
"fixes" it is undoing a decision, not closing a hole.

- [ ] **Step 4: The component learns two props**

`currencyEndpoint` and `otherFormLabel` (`'AP-17'` from AP-1's page, `'AP-1'`
from AP-17's). Under the currency field, a Thai line saying the value is shared
with the other form and changing it here changes it there. Both pages pass their
own values; the component holds no literal form name.

- [ ] **Step 5: `npm test`, `npx tsc --noEmit`, `npm run build`, commit**

---

### Task 7: (merged into Task 6)

Left numbered so later task references do not shift. Nothing to do.

---

### Task 8: AP-1 claims in a currency

**Files:**
- Modify: `src/features/accounting/components/TravelExpenseForm.tsx`
- Modify: `src/lib/acc/request-service.ts` — `saveDraft` and `submitRequest`
- Modify: `src/features/accounting/types.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 5.

- [ ] **Step 1: The dropdown, and when it does not appear**

Render a currency selector **only** when `brandCurrencyState(brand) === "configured"`. Two options: the brand's currency and `THB`. Default `THB`. A brand with nothing configured shows nothing new.

- [ ] **Step 2: Rate-based vehicles are refused for a foreign claim**

Global Constraints: `CK_AccVehicle_Rate` refuses `RatePerKm < 1`, and the rate is one shared row labelled `บาท/กม.`. When the currency is not baht, the rate-based vehicles are disabled in the picker with a Thai note that a foreign claim uses manual entry. **Re-assert this in `validateForSubmit`** — a control removed from a page is not a rule.

- [ ] **Step 3: The server writes the rate**

`saveDraft` calls `resolveRate(currency)` and writes `Currency`, `ExchangeRate`, `BaseAmount`. `submitRequest` re-fetches and overwrites. **A failed fetch at submit throws** with a Thai message; a baht claim never calls `resolveRate` at all.

- [ ] **Step 4: `TotalAmount` stays baht — at all THREE writers**

`computeTotalAmount` keeps returning the claim's own figure; the service converts with `toBaht` before writing `AccRequest.TotalAmount`. **If `toBaht` returns null the write throws** — it must never store the unconverted figure.

There are three writers in `request-service.ts`, not two. The third is the one that gets missed:

1. `persistTravelDays` (`:722-726`), reached from `saveDraft` (`:734`)
2. **`deleteItem` (`:953-956`)** — the recompute that runs when a requester removes a receipt row, outside the transaction. On a foreign draft this re-stamps the **unconverted** figure into the baht column, on an ordinary edit. It must load the stored `Currency`/`ExchangeRate`, convert, and throw rather than write when `toBaht` returns null.
3. `submitRequest` (`:1062`)

- [ ] **Step 5: Show both figures**

The form shows the foreign total and the baht equivalent with the rate and `อัตราอ้างอิง`. Never captioned as a Bank of Thailand rate.

- [ ] **Step 6: `npm test`, `npx tsc --noEmit`, `npm run build`, commit**

---

### Task 9: AP-17 claims in a currency

**Files:**
- Modify: `src/features/travel-booking/components/AdminBookingPanel.tsx`
- Modify: `src/lib/acc/travel-booking/admin-service.ts` (the booking writer, `:288-347`)

**Not `TravelBookingTab.tsx`** — it contains no money field at all. AP-17's amounts are entered later, by the booking desk, in `AdminBookingPanel`. The requester picks the brand and a different person enters the amounts at a later step, so **the currency is derived from the request's brand and is not chosen by the requester.** The desk sees it read-only beside the four amount fields and may switch it to THB there; the rate is fetched server-side when the desk saves.

Mirror Task 8 with two differences:

- [ ] **Step 1: Per diem is always baht.** `EmployeeAllowanceLog` has no currency column. The per-diem figure is not converted and not selectable; only booking costs carry the claim's currency.
- [ ] **Step 2: `AccRequest.TotalAmount` keeps its current meaning and is NOT changed**

Today it is the **per-diem total alone** — the booking cost lives in `AccTravelBookingDetail.TotalAmount` and never reaches the header (`travel-booking/request-service.ts:1215-1219`). Adding the booking cost would double the figure on My Requests, My Work and the header **for every AP-17 request including baht ones**, breaking this plan's own promise that an unconfigured brand behaves exactly as today. It would also be silently undone: `perdiem-recompute.ts:98-114` rewrites `AccRequest.TotalAmount` from the recomputed per diem, and `perdiem-recompute.test.ts:200-228` asserts that statement.

So the booking cost's currency, rate and baht equivalent are **displayed**, not summed into the header. If the business wants the sum, that is a separate task that must also amend `perdiem-recompute.ts` and its test, and it is a behaviour change for baht requests too.

- [ ] **Step 3: No new lock — the step gate already is one**

There is no `Status = 'Completed'` amount freeze in AP-17 and none is to be invented. `AdminBookingPanel` renders only while `status === 'ManagerApproved' && currentStepCode === 'ADMIN'` (`TravelBookingDetail.tsx:572-574`), so the currency and rate fields are unreachable once accounting has signed off. `bookingFieldsLocked` is a per-row emptiness rule, explicitly **not** status-based (`booking-lock.ts:1-19`), and must not be given a currency arm.
- [ ] **Step 4:** tests, typecheck, build, commit.

---

### Task 10: The AI reads return a currency

**Files:**
- Modify: `src/app/api/request/accounting/receipt-amount/route.ts`
- Modify: `src/app/api/request/travel-booking/booking-fields/route.ts`
- Modify: `src/features/accounting/lib/read-receipt-amount.ts` (`:78`, `:85-92`)
- Modify: `src/features/travel-booking/lib/read-booking-fields.ts` (`:100`, `:109-114`)
- Modify: `src/features/accounting/components/ExpenseRows.tsx` (props at `:45-70`)
- Modify: `src/features/accounting/components/TravelExpenseForm.tsx` (five `<ExpenseRows` call sites: `:1478, :1489, :1504, :1515, :1531`)

**Interfaces:**
- Consumes: Task 3's `admitModelCurrency`, Task 4's `currencyCode`.

- [ ] **Step 1: Widen the prompt and the schema**

Both currently assert Thai baht in prompt and schema, so a foreign receipt attached **today** already yields a bare number stored as baht. Add a nullable `currency` to each schema and stop asserting baht in the prompt.

- [ ] **Step 2: The brand code has to be threaded to AP-1's call — it is not in scope today**

`readReceiptAmount(file)` and `readBookingFields(file)` take only a file and build the FormData themselves, and `ExpenseRowsProps` carries no brand at all. Without this the route reads no brand, `admitModelCurrency` sees `brandCurrency = null`, admits THB alone, and **every foreign receipt silently stays baht** — the live defect §8 exists to fix.

Both readers gain a `brandCode` argument and append `?brandCode=` to the fetch URL. `ExpenseRowsProps` gains `brandCode?: string | null`, passed from `TravelExpenseForm` (where it is already in scope at `:223`) at all five call sites. AP-17 takes it from `request.brandCode`, already in scope in `AdminBookingPanel`.

The route then resolves the brand's currency via `brand-registry.ts` and applies `admitModelCurrency`. Resolving server-side is what stops a caller shaping their own prompt to have a currency accepted.

- [ ] **Step 3: Bound the converted figure — without touching the sanitisers**

`MAX_RECEIPT_AMOUNT` (1,000,000฿) and `MAX_BOOKING_AMOUNT` (10,000,000฿) are baht bounds; applied to a raw foreign figure they silently null legitimate amounts.

**Leave `sanitizeReceiptAmount` and `sanitizeBookingAmount` unchanged.** The latter has nine non-test call sites — the browser's typed-entry validation, the admin save service, `booking-dirty.ts` — and all of them deal in the claim's own currency. Changing its semantics changes all nine.

Instead, in the **route**: after the model answers, resolve the rate with `resolveRate(admittedCurrency)` (Task 5) and bound `toBaht(figure, rate)` against the MAX. If `resolveRate` returns null, return the figure as null so the field opens blank — never guess and never skip the bound.

**Both route docblocks currently state the route reads no database** (`receipt-amount/route.ts:32-33`, `booking-fields/route.ts:47-49`). That stops being true once `brand-registry.ts` and `resolveRate` are called. Update them.

- [ ] **Step 4: An inadmissible answer leaves the field blank**

`admitModelCurrency` returning null means the user picks. No guess, no default to the brand's currency.

- [ ] **Step 5: Tests for the new sanitiser paths, then typecheck, build, commit**

---

### Task 11: Accounting may correct the rate

**Files:**
- Modify: AP-1's ACCOUNT approve route and AP-17's `account-approve` route
- Modify: the approval panels

**Interfaces:**
- Consumes: Tasks 2, 3.

- [ ] **Step 1: The override field**

At the ACCOUNT step only, an editable rate. On save it recomputes `BaseAmount → TotalAmount` with `toBaht` and writes an `AccActivityLog` row with the old and new rate.

This is **required in the first release** (spec §9.1): with no BOT key every rate is a mid-market reference rate, which is not what a bank settles at, so this is the only place the difference can be corrected.

- [ ] **Step 2: Refuse a rate that does not convert.** `toBaht` returning null refuses the save.

- [ ] **Step 3: Tests, typecheck, build, commit**

---

### Task 12: Every money surface says which currency

**Files:**
- Modify: `src/lib/acc/report-service.ts` (AP-1 Excel export), `src/lib/acc/travel-booking/report-service.ts`
- Modify: `AccountingReport.tsx`, `ApprovalsQueue.tsx`, `RequestDetail.tsx`, `TravelBookingReport.tsx`

- [ ] **Step 1: The AP-1 export**

Its money column is headed `ยอดรวม (บาท)` and carries `moneyStyle`, which is **alignment only — it has no `numFmt`** (`report-service.ts:736`; the `numFmt` at `:739-742` is `distanceStyle`, for the distance column). The header stays correct because the column stays baht; add a **currency column** beside it so a foreign claim is identifiable.

- [ ] **Step 2: AP-17's export** does carry a `numFmt` (`travel-booking/report-service.ts:283`). Same treatment: a currency column, the money column still baht.

- [ ] **Step 3: The detail and queue screens** show the foreign figure and the baht equivalent where a claim has one, and are unchanged for a baht claim.

- [ ] **Step 4: The ERP prep queue's per-day breakdown**

This is the one the spec's §4 justification missed, and it is on the posting path. `TRAVEL_DAYS_CSV_SELECT` (`report-service.ts:121-137`) aggregates `te.TotalAmount` — the **per-day** column, which holds the claim's own currency — and is interpolated into the ERP prep query (`erp-prep-service.ts:350`, parsed at `:171-179`) and rendered in `ErpPrepQueue.tsx`.

So on a foreign claim an approver sees day figures in MYR that do not sum to the baht header, with no currency label, immediately before pressing Send. Label the breakdown with the request's `Currency` and show the baht header beside it, or convert the parsed day lines with the stored rate before display.

**The posting itself is unaffected** — `erp-journal-builder.ts:144-147` builds it from `AccRequest.TotalAmount`, which is baht. Only the displayed breakdown is wrong. Correct spec §4's claim too, which the next reader would otherwise trust.

- [ ] **Step 5: Full `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run check:alignment`, commit**

---

## Deployment order

1. Apply **124** to `Rocks_Portal_Form`.
2. Apply **125** to `Rocks_Portal_Form` **and** `Rocks_Portal_Form_UAT`.
3. Run `npm run check:alignment` — must still PASS at 25 tables.
4. Deploy the code.
5. Nothing is switched on: every brand has `CurrencyEnabled = 0`, so both forms behave exactly as before until an admin configures one. PCMY is the obvious first — its Business Central company is `Rocks Foods Sdn. Bhd.`, a Malaysian entity.
