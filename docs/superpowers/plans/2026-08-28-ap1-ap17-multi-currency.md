# AP-1 / AP-17 Multi-Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company brand can carry a country and a currency; a claim against that brand can be entered in that currency and is converted to Thai baht at a recorded rate.

**Architecture:** Currency lives once per brand on `BrandSetting`, read only through `brand-registry.ts` (production pool). One currency per *request*, stored on `AccTravelExpense` / `AccTravelBooking` as `Currency` + `ExchangeRate` + `BaseAmount`. `AccRequest.TotalAmount` stays Thai baht always, which is what leaves every existing summer, report, export and ERP path untouched. The FX lookup is AP-2's `bot-fx.ts`, called server-side.

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

---

### Task 1: Migration 124 — BrandSetting gains country and currency

**Files:**
- Create: `migrations/124_brand_setting_currency.sql`

**Interfaces:**
- Produces: `BrandSetting.CountryCode`, `.CurrencyCode`, `.CurrencyEnabled` — consumed by Task 3.

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

- [ ] **Step 3: Commit**

```bash
git add migrations/124_brand_setting_currency.sql
git commit -m "feat(currency): BrandSetting carries a country and a currency"
```

---

### Task 2: Migration 125 — the two claim tables carry a currency

**Files:**
- Create: `migrations/125_travel_currency.sql`

**Interfaces:**
- Produces: `AccTravelExpense.Currency|ExchangeRate|BaseAmount` and the same three on `AccTravelBooking` — consumed by Tasks 8, 9, 11.

- [ ] **Step 1: Write the migration**

```sql
-- One currency per claim, on AP-1's and AP-17's own detail tables.
--
-- Apply to BOTH form databases, before the code deploy:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/125_travel_currency.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/125_travel_currency.sql
--
-- BOTH SIDES, even though these are transactional tables that are neither
-- dual-written nor in MASTER_TABLES. SQL Server binds object names at compile
-- time, so a query naming Currency fails outright against whichever database is
-- missing it — and both forms resolve either database depending on who is asking.
--
-- WHY NOT ON THE ITEM ROWS. AP-1 money is summed by four separate
-- implementations: calc.ts, the T-SQL TRAVEL_DAYS_CSV_SELECT
-- (report-service.ts:117-188), the ERP journal builder, and the approval queue's
-- per-vehicle cell. Per-line would make all four currency-aware; per-request
-- makes none of them, because AccRequest.TotalAmount stays baht. The T-SQL one
-- also feeds the ERP prep queue an approver reads before pressing Send.
--
-- NULL Currency and 'THB' both mean baht. No backfill: an existing row reads
-- NULL, which is correct — nobody recorded a currency, and writing 'THB' would
-- claim somebody had.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelExpense', 'U') IS NULL OR OBJECT_ID('dbo.AccTravelBooking', 'U') IS NULL
  THROW 50000, 'AccTravelExpense or AccTravelBooking is missing — apply 059 first.', 1;
GO

BEGIN TRANSACTION;

IF COL_LENGTH('dbo.AccTravelExpense', 'Currency') IS NULL
  ALTER TABLE [dbo].[AccTravelExpense] ADD [Currency] CHAR(3) NULL;
IF COL_LENGTH('dbo.AccTravelExpense', 'ExchangeRate') IS NULL
  ALTER TABLE [dbo].[AccTravelExpense] ADD [ExchangeRate] DECIMAL(18,6) NULL;
IF COL_LENGTH('dbo.AccTravelExpense', 'BaseAmount') IS NULL
  ALTER TABLE [dbo].[AccTravelExpense] ADD [BaseAmount] DECIMAL(18,2) NULL;

IF COL_LENGTH('dbo.AccTravelBooking', 'Currency') IS NULL
  ALTER TABLE [dbo].[AccTravelBooking] ADD [Currency] CHAR(3) NULL;
IF COL_LENGTH('dbo.AccTravelBooking', 'ExchangeRate') IS NULL
  ALTER TABLE [dbo].[AccTravelBooking] ADD [ExchangeRate] DECIMAL(18,6) NULL;
IF COL_LENGTH('dbo.AccTravelBooking', 'BaseAmount') IS NULL
  ALTER TABLE [dbo].[AccTravelBooking] ADD [BaseAmount] DECIMAL(18,2) NULL;

COMMIT TRANSACTION;
GO

SELECT
  COL_LENGTH('dbo.AccTravelExpense','Currency')  AS ExpCurrency,
  COL_LENGTH('dbo.AccTravelExpense','BaseAmount') AS ExpBase,
  COL_LENGTH('dbo.AccTravelBooking','Currency')  AS BkCurrency,
  COL_LENGTH('dbo.AccTravelBooking','BaseAmount') AS BkBase;
GO
```

- [ ] **Step 2: Apply to both databases, then check alignment**

```bash
npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/125_travel_currency.sql
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/125_travel_currency.sql
npm run check:alignment
```
Expected: both applied; `check:alignment` still PASS at 25 tables (neither table is in `MASTER_TABLES`, so the count must not move).

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
- Produces: `RegistryBrand.currencyCode: string | null`, `.currencyEnabled: boolean`; `AccBrandOption.currencyCode: string | null` — consumed by Tasks 6-10.

- [ ] **Step 1: Extend the registry**

Add `CountryCode`, `CurrencyCode`, `CurrencyEnabled` to `BrandSettingRow`, to the `SELECT` list, and to the mapped `RegistryBrand`:

```ts
      countryCode: s?.CountryCode ?? null,
      // A brand with no row has no currency, which reads as baht everywhere.
      currencyCode: s?.CurrencyCode ?? null,
      currencyEnabled: s ? s.CurrencyEnabled : false,
```

- [ ] **Step 2: Widen `AccBrandOption`**

`AccBrandOption` is `{ brandCode, brandName, brandLogo }` today and drops everything else. Add `currencyCode: string | null`, populated in **both** `listAllBrands` and `getAllowedBrands`. `getAllowedBrands` already builds a `byCode` map from `listAllBrands()`, so take it from there — do not add a second query.

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

Both `fetch` calls take `AbortSignal.timeout(8000)`. A hanging provider currently hangs the request that called it.

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

### Task 6: AP-1's brand tab edits the currency

**Files:**
- Modify: `src/features/accounting/components/settings/BrandSettings.tsx` (or the AP-1 brands panel — locate it from `settings/brands/route.ts`'s consumer)
- Modify: `src/app/api/request/accounting/settings/brands/route.ts`
- Modify: `src/lib/acc/settings-service.ts` — the brand write

**Interfaces:**
- Consumes: Task 4's `currencyCode`.
- Produces: a `PATCH`-style write of `{ brandCode, countryCode, currencyCode, currencyEnabled }`.

- [ ] **Step 1: The write, with its activity row**

The write goes to `BrandSetting` through `getProductionFormPool()`. **In one transaction it also writes an `AccActivityLog` row** naming the brand, the old value and the new. Spec §9.3: the permission is per form while the value is per brand, so an AP-17 approver can change what an AP-1 claim converts at — the log is the only way that is traceable.

- [ ] **Step 2: The gate stays as it is**

`requireSettingsTab("brands")`. **Do not tighten this to `requireRole`** — the user chose it knowingly (spec §9.3).

- [ ] **Step 3: The shared-value line**

Under the currency field, in Thai: that the value is shared with AP-17's form and changing it here changes it there.

- [ ] **Step 4: Tests, typecheck, build, commit**

---

### Task 7: AP-17's brand tab edits the same value

**Files:**
- Modify: AP-17's brands panel + `src/app/api/request/travel-booking/settings/brands/route.ts`

Same as Task 6, gated by `requireBookingSettingsTab("brands")`, with the shared-value line naming AP-1. **Reuse Task 6's service function** — do not write a second one.

- [ ] **Steps:** mirror Task 6, then `npm test`, `npx tsc --noEmit`, `npm run build`, commit.

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

- [ ] **Step 4: `TotalAmount` stays baht**

`computeTotalAmount` keeps returning the claim's own figure; the service converts with `toBaht` before writing `AccRequest.TotalAmount`. **If `toBaht` returns null the submit fails** — it must never write the unconverted figure.

- [ ] **Step 5: Show both figures**

The form shows the foreign total and the baht equivalent with the rate and `อัตราอ้างอิง`. Never captioned as a Bank of Thailand rate.

- [ ] **Step 6: `npm test`, `npx tsc --noEmit`, `npm run build`, commit**

---

### Task 9: AP-17 claims in a currency

**Files:**
- Modify: `src/features/travel-booking/components/TravelBookingTab.tsx`, `AdminBookingPanel.tsx`
- Modify: `src/lib/acc/travel-booking/request-service.ts`

Mirror Task 8 with two differences:

- [ ] **Step 1: Per diem is always baht.** `EmployeeAllowanceLog` has no currency column. The per-diem figure is not converted and not selectable; only booking costs carry the claim's currency.
- [ ] **Step 2: `AccRequest.TotalAmount` is the baht sum of the baht per diem and the converted booking cost.**
- [ ] **Step 3: The amount lock survives.** A request past the ACCOUNT step (`Status = 'Completed'`) has its currency, rate and converted total frozen with everything else.
- [ ] **Step 4:** tests, typecheck, build, commit.

---

### Task 10: The AI reads return a currency

**Files:**
- Modify: `src/app/api/request/accounting/receipt-amount/route.ts`
- Modify: `src/app/api/request/travel-booking/booking-fields/route.ts`
- Modify: `src/features/accounting/lib/receipt-amount.ts`, `src/features/travel-booking/lib/booking-amounts.ts`

**Interfaces:**
- Consumes: Task 3's `admitModelCurrency`, Task 4's `currencyCode`.

- [ ] **Step 1: Widen the prompt and the schema**

Both currently assert Thai baht in prompt and schema, so a foreign receipt attached **today** already yields a bare number stored as baht. Add a nullable `currency` to each schema and stop asserting baht in the prompt.

- [ ] **Step 2: The brand's currency is resolved server-side**

The route resolves it via `brand-registry.ts`, from a brand code passed as a query parameter, and applies `admitModelCurrency`. Resolving server-side is what stops a caller shaping their own prompt to have a currency accepted.

- [ ] **Step 3: The ceilings apply to the converted figure**

`MAX_RECEIPT_AMOUNT` (1,000,000฿) and `MAX_BOOKING_AMOUNT` (10,000,000฿) are baht bounds. Applied to a raw foreign figure they silently null legitimate amounts. Convert first, then bound.

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

- [ ] **Step 4: Full `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run check:alignment`, commit**

---

## Deployment order

1. Apply **124** to `Rocks_Portal_Form`.
2. Apply **125** to `Rocks_Portal_Form` **and** `Rocks_Portal_Form_UAT`.
3. Run `npm run check:alignment` — must still PASS at 25 tables.
4. Deploy the code.
5. Nothing is switched on: every brand has `CurrencyEnabled = 0`, so both forms behave exactly as before until an admin configures one. PCMY is the obvious first — its Business Central company is `Rocks Foods Sdn. Bhd.`, a Malaysian entity.
