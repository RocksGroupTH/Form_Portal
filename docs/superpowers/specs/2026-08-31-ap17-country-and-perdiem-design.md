# AP-17 — the country a trip is to, and a per diem fixed by it

**Date:** 2026-08-31
**Status:** design agreed, not built
**Survey:** six agents, `scratchpad/ap17-survey.md`. Every file:line below was
re-opened and re-read while writing this; where the survey had drifted it is
corrected silently and the corrected number is what appears here.

Two changes, in one spec because the second cannot start without the first.

**Part 1** records which country an AP-17 trip was to. `AccRequest.CountryCode`
already exists in both form databases — AP-1 has written it since migration 129
and AP-17 has never written anything to it — so this is a service, a DTO and a
chip band, with no DDL at all.

**Part 2** lets an admin fix a per-diem rate per country, in baht per day,
effective-dated. **This changes a figure the company pays.** For AP-17,
`AccRequest.TotalAmount` *is* the per-diem total and nothing else
(`admin-service.ts:445-451`), so Part 2 rewrites the payable.

---

## Why

A booking to Kuala Lumpur and a booking to Khon Kaen are indistinguishable on
every AP-17 surface today. Nothing on the request says where it went except a
Thai province id and a free-text place, and the province list is 77 Thai rows
seeded once by migration 049. AP-1 asks its requester the question outright —
a `ประเทศ` chip band above the expense rows — and AP-17 does not.

And the money is wrong. AP-17's per diem is the requester's own
`Rocks_Portal_HR.dbo.EmployeeAllowanceLog` rate for every day of every trip,
Thailand or not (`allowance-log.ts:10-24`, `request-service.ts:1201`). A daily
allowance set for working in Thailand is not what the company intends to pay
somebody spending a week in Tokyo. The rate has to be a property of **where they
went**, not only of **who they are**.

---

## Decisions

Each is written with what it costs if it turns out to be wrong. D1, D2 and D4
were taken by the user and are settled; the rest are this spec's.

### D1 — the picker offers all 25 `COUNTRIES`, not the brand's currencies

`COUNTRIES` (`country-currency.ts:54-80`) is the same 25-row list AP-1 uses. The
AP-17 band is **not** filtered through `claimCountryOptions`
(`claim-currency.ts:139`), which narrows to the countries whose currency the
brand has a `BrandCurrency` row for.

*Reason.* Once D3 settles that the country does not decide the currency, the
filter that shapes `COUNTRIES` has no bearing on where somebody travelled.
`COUNTRIES` is already filtered to the currencies the reference-rate source
quotes (`country-currency.ts:26-42`), and narrowing it again by a *brand's*
currency configuration would make the contents of a travel question a side
effect of a money setting. It also means the band needs no brand data and no
fetch: it is `COUNTRIES` and the tab's own value.

*What it costs.* The user was told explicitly that this list excludes
**Cambodia, Laos, Vietnam and Myanmar** — four neighbours — because the ECB does
not quote KHR, LAK, VND or MMK, and chose it anyway. A trip to Vientiane cannot
name its country. The remedy is a line in `COUNTRIES`, and it is not free: adding
one there also adds it to AP-1's picker, where an unquotable currency produces a
claim that can be started and never converted — which is the whole reason those
ten countries were removed. **Do not add a country to `COUNTRIES` to serve AP-17
alone.** If AP-17 needs a wider list than AP-1 can safely offer, that is a second
list, and a decision, not a patch.

### D2 — the country is per trip, not per group

`CountryCode` sits on `AccRequest`, and AP-17 writes one `AccRequest` row per
tab. So a three-tab group can hold three countries, exactly as it can hold three
brands today.

*Reason.* This is not a new argument; it is the one already written down for
`brandCode` (`types.ts:364-369`, and the same sentence in
`TravelBookingTab.tsx:100-106`): *"Per trip, not per request: a group is one
`AccRequest` row per tab, each with its own `BrandCode`, and one journey can be
for a different company than the next."* A group is a chain of consecutive
journeys — that is what `IsContinuation` and `continuation-chain.ts` exist for —
and a chain that crosses a border mid-way is the ordinary reason to file one.
Putting the country on the group would make the second leg of a
Bangkok→Singapore→Bangkok trip carry the first leg's country, and Part 2 would
then bill it at the wrong rate.

*What it costs.* The requester answers the same question once per tab. That is
already true of แบรนด์ที่เบิก, เหตุผลการเดินทาง and จังหวัด, so it is the
established shape rather than a new tax. There is deliberately no "apply to all
tabs" control: a control that silently rewrites another tab's country would
rewrite that tab's per-diem rate with it.

### D3 — the country does **not** determine the booking currency (ruling R1)

AP-17's currency stays derived from the brand and chosen from the invoice by the
booking desk. Nothing in Part 1 or Part 2 reads or writes `AccRequest.Currency`,
`ExchangeRate`, `RateAsOf` or `RateSource`.

*Reason.* `booking-currency.ts:12-22` states the design outright and explains why
AP-17's rule is the *opposite* of AP-1's: AP-1's requester chooses a currency, so
an absent choice resolves to baht; AP-17's requester has no money field at all,
the amounts are typed weeks later by the booking desk, and the currency is
therefore derived from the brand. The same file closes the argument at `:56-63`:
baht is offered even to a brand that has switched Thailand off, because the
toggle answers *"is the invoice on the desk denominated in baht"* — a fact about
a document — and **"AP-1's country picker is where the brand's decision is
enforced."** There is exactly one writer of that currency,
`admin-service.ts:547-559`, inside `saveBookingDetail`'s transaction, and it
derives the brand from the database rather than the client precisely so the
client cannot pick the currency (`loadBrandCode`, `admin-service.ts:335-342`).

*What it costs.* A trip to Malaysia filed against a Thai brand records a THB
currency for its hotel invoice unless the desk toggles it. That is correct: the
desk is holding the invoice and we are not.

*What breaking it costs.* A second writer of `AccRequest.Currency`. Two writers
of one currency is how the request header and the booking rows come to disagree
about what the figures on screen are denominated in, on the request that carries
both a foreign booking cost and a baht per diem. If a future reader thinks the
country "obviously" implies the currency, this paragraph and
`booking-currency.ts:12-22` are the two places that say why it does not — and
`booking-currency-guard.test.ts` is what makes the second writer fail a test.

### D4 — the country rate is **baht per day** and **effective-dated**

`AccTravelPerDiemCountry` is keyed `(CountryCode, EffectiveDate)` and its
`Amount` is Thai baht.

*Reason (baht).* AP-17's per diem is baht in every consumer by explicit design —
`EmployeeAllowanceLog` has no currency column, the report heading is
`"เบี้ยเลี้ยง (ยอดรวม, บาท)"` (`report-service.ts:364`), and the multi-currency
spec pins it (`2026-08-28-ap1-ap17-multi-currency-design.md` §7). A rate in the
destination's own currency would drag `resolveRate`'s fail-closed refusal onto
the **submit** path, so an ECB outage would stop AP-17 submissions entirely.

*Reason (effective-dated).* It mirrors `EmployeeAllowanceLog`, which
`rateForDay` (`perdiem.ts:24-33`) already reads that way, and it is the property
`recomputeGroupPerDiem` needs. That function rewrites the per diem of trips
submitted months ago (`perdiem-recompute.ts:86-115`); a single current amount per
country would silently re-pay an old trip at today's number the first time a
sibling trip in its group was cancelled. Effective dating also means a trip
spanning a rate change bills at both rates and shows as two groups, which
`computePerDiem` already produces (`perdiem.ts:73-86`) with no change.

*What it costs.* An admin who wants to *change* a rate must add a row rather than
edit one — see D8 for why editing in place is dangerous.

### D5 — the rate table is dual-written master configuration, read with `getAccPool()`

It exists in **both** form databases, joins `MASTER_TABLES`
(`scripts/checks/verify-master-alignment.ts:66-91`, +1 — 26 if this lands before the brand-access spec's `AccBookingApproverBrand`, 27 if after), is written through
`writeBothPools` (`dual-write.ts:41`), and is **absent** from migrations 061 and
064.

*Reason.* It is configuration an admin edits and a UAT tester must be able to
rehearse against, so the two environments have to hold the same rows. That is
the definition of a master table here. Absence from 061/064 follows from the same
argument CLAUDE.md gives for every other one: dual-write runs the same statement
against both databases and reads no id back, so the counters must stay in
lockstep, and 064's `CHECK (Id >= 900000)` would reject a lockstep id outright.

*The pool is the trap, and it points the other way from the currency work.*
`BrandSetting`, `BrandCurrency`, `TravelProvince`, `TeamMember`, `ApiKey` and
`DepartmentErpMap` exist **only** in `Rocks_Portal_Form`, and every read of them
must use `getProductionFormPool()` — `currency-pool-guard.test.ts:64-89` enforces
that per file for the first two. `AccTravelPerDiemCountry` is the opposite: it is
in both, so the correct pool is `getAccPool()`, and **it must not be added to
`PRODUCTION_ONLY_TABLES`.** Adding it would turn a correct reader into a test
failure and invite somebody to "fix" the reader by pinning it to production,
which would then serve production's rates to a UAT tester's submit.

*What it costs if wrong the other way.* Making it production-only instead would
be quieter and worse: a tester's UAT submit would compute against rates nobody
had entered in UAT, so the two environments would price the same trip
differently with no error anywhere.

### D6 — "no rate for this country" is an explicit `null`, never `0`

`perDiemCountryLog` returns `AllowanceLogEntry[] | null`. It returns `null` — not
an empty array — when the country has no active rows, and the caller then uses
the employee's HR log.

*Reason.* `rateForDay` already returns `0` for a day earlier than every entry
(`perdiem.ts:32`). An empty array therefore produces a rate of 0 for every day,
a total of 0, and a `TotalAmount` of 0 — a trip that pays nothing, written
without an error, past every validator. Null and empty must not be the same
value anywhere on this path. The database backs the same rule up:
`CK_AccTravelPerDiemCountry_Amount CHECK ([Amount] > 0)`, so a stored 0 cannot
exist to be confused with the unmatched case.

### D7 — `TH` is not a country rate

The resolver treats a blank, missing or `TH` country as "use the employee's HR
log", and the settings write refuses a `TH` row. There is deliberately **no**
`CHECK` on `CountryCode`.

*Reason.* The HR allowance log is per employee and is the company's existing
domestic policy, applying to almost every AP-17 request ever filed. A single
company-wide `TH` row would override all of it at once, silently, on the next
recompute of every still-writable trip. Refusing it in code rather than in the
database follows `AccBookingApproverTab`'s precedent — the table is writable from
more than one place, so a hand-inserted row can appear whatever the migration
says, and the code refusal is what makes it inert. It also means reversing D7
later is a code change rather than a migration applied to two databases.

*What it costs.* A company that later wants one flat domestic rate cannot express
it here; it belongs in `EmployeeAllowanceLog`, which is another application's
table.

### D8 — `computePerDiem` and `rateForDay` do not change. One resolver decides *which* log

No signature change, no `fixedRate` parameter, no second code path. The country
rate is delivered **as an `AllowanceLogEntry[]`** — the shape those two functions
already take — and a single pure function decides which array a caller gets.

*Reason.* This is the answer to the central hazard (see Hazards). A `fixedRate`
parameter would be a second arm inside `computePerDiem` that four call sites must
each pass correctly, and it would flatten the multi-rate `groups` breakdown that
D4's effective dating exists to produce. Delivering a log instead means the
engine is untouched, the rate-change breakdown works for country rates for free,
and the only thing that can differ between the four consumers is *which array
they were handed* — which is one function, and a source-reading test can assert
that nothing else produces one.

*What it costs.* `perdiem-source.ts` becomes a required import in four files, and
a fifth consumer added later that calls `computePerDiem` directly will compute
the Thai rate. That is exactly what the guard test in Tests is for.

### D9 — the client is handed the server's inputs, not asked to re-derive them

`GET /api/request/travel-booking/allowance-log` grows a second field in its
response — the active country rates — and the browser calls the **same pure
resolver** the server calls. It does not fetch or hold a rate table of its own.

*Reason.* The live estimate on the form (`useTravelBookingForm.ts:583-590`) is
one of the four derivations. Sharing the pure function and the data removes it
from that set: it becomes a consumer of the server's answer rather than a fourth
opinion. A per-tab fetch keyed on country was considered and rejected — the
country is per tab and hooks cannot be called in a loop, so it would have meant
either a fetch per tab or a bespoke cache, both of which reintroduce a second
source of truth for the sake of a preview.

### D10 — `AccPerDiem` and `AccPerDiemDay` are not reused, despite the name

Both exist in both form databases with zero rows and **zero references anywhere
in `src/`** (verified by grep this session; the only hits are in
`migrations/059`, `061` and `064`). `AccPerDiem`
(`059:197-210`) is per-request, carries `AllowancePerDay`, `BranchId`,
`BranchName` and `BranchCode`, and is a dead AP-15-era shape.

*Reason, beyond the name collision.* They are in **061's reseed list**
(`061:40`) and **064's identity-floor list** (`064:62`), so in
`Rocks_Portal_Form_UAT` they carry `CHECK (Id >= 900000)`. A dual-written master
table cannot live there: the UAT pass would allocate 900001 where production
allocated 42, or the CHECK would reject a replayed id — the two failure modes
CLAUDE.md describes for `AccTravelVehicleOption` and for every lockstep table.
Reusing these tables is not merely untidy, it is structurally impossible for
what Part 2 needs.

### D11 — the settings tab is admin-only, not grantable

The rate editor is gated `requireRole(["IT Admin", "System Admin"])`, like
`settings/approvers`. It is **not** added to `GrantableBookingTabKey`
(`settings-tabs.ts:31`) and so cannot be handed to a booking approver.

*Reason.* `AccVehicle`'s บาท/กม. rate is grantable through AP-1's `vehicles` tab,
so "money-shaped configuration is admin-only" is not an existing rule here — this
is a judgement, and it rests on reversibility. Widening a gate later is one line.
Narrowing it is not: `AccBookingApproverTab` has no `CHECK` on `TabKey`
(migration 096), so once the key is grantable, rows naming it exist, and
un-granting means deciding what to do about them. Starting closed is the cheap
direction to be wrong in.

*What it costs.* Adding a country rate needs an IT Admin. Given that the table is
expected to hold a handful of rows changed once or twice a year, that is not a
workflow.

---

## Schema

### Part 1 — **none**

`AccRequest.CountryCode CHAR(2) NULL` was added by
`migrations/129_expense_item_currency.sql:74-75`, whose header targets **both**
form databases (`129:3-5`) and whose guard admits either
(`IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%' THROW`, `129:53-54`). Its own
post-apply block reports the column (`129:80-86`).

The survey measured `COL_LENGTH('dbo.AccRequest','CountryCode') = 2` in both
databases, column_id 38 in each. **That was not re-measured in this session.**
Before writing Part 1's code, run 129's own check against both:

```sql
SELECT DB_NAME() AS db, COL_LENGTH('dbo.AccRequest','CountryCode') AS CountryCode;
```

Two non-NULL answers and there is nothing to apply. A NULL on either side means
129 was applied to one database only, and the fix is 129, not a new migration.

### Part 2 — migration **133**, BOTH form databases

Numbered 133 because **132** belongs to the worldwide-places spec (`TravelProvince.CountryCode`) and **134** to the approver brand-visibility spec.
Re-check with `ls migrations/` before creating the file: the highest number
present is 131 and eleven numbers (088, 089, 090, 091, 094, 103, 117, 118, 119,
120, 124) are each used twice, so counting is not a substitute for looking.

```sql
-- 133_acc_travel_perdiem_country.sql
-- TARGET: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — both, symmetrically.
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/133_acc_travel_perdiem_country.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/133_acc_travel_perdiem_country.sql
--
-- Apply BEFORE the code reaches either database. SQL Server binds object names
-- at compile time, so a missing table is 'Invalid object name', not an empty
-- result — and this one is read on AP-17's submit path and inside the
-- transaction that cancels or rejects a trip.
--
-- SHARED MASTER TABLE. Dual-written by src/lib/acc/travel-booking/
-- perdiem-source.ts and asserted by npm run check:alignment, which gains one entry (26 alone, 27 if AccBookingApproverBrand landed first)
-- tables to 26. It carries NO identity floor and is deliberately absent from
-- migrations 061 and 064: dual-write relies on the two identity counters
-- staying in lockstep, and CHECK (Id >= 900000) in UAT would reject every write.
--
-- Amount is THAI BAHT PER DAY. EmployeeAllowanceLog has no currency column and
-- AP-17's per diem is baht in every consumer; a foreign-currency rate would put
-- an FX lookup on the submit path, so an outage would stop submissions.
--
-- Amount > 0 is load-bearing, not hygiene: rateForDay returns 0 for a day it
-- cannot match (perdiem.ts:24-33), so a stored 0 would be indistinguishable
-- from "no rate" and would pay nothing while looking configured.
--
-- There is NO CHECK on CountryCode, and 'TH' is refused in code rather than
-- here — the table is writable from more than one place, so enforcement has to
-- be in code anyway, and reversing that decision must not need a migration
-- applied to two databases.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelPerDiemCountry', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccTravelPerDiemCountry] (
    [Id]            INT IDENTITY(1,1) NOT NULL
                    CONSTRAINT [PK_AccTravelPerDiemCountry] PRIMARY KEY,
    [CountryCode]   CHAR(2)       NOT NULL,   -- ISO-3166-1 alpha-2, matches AccRequest.CountryCode
    [EffectiveDate] DATE          NOT NULL,   -- from this day inclusive
    [Amount]        DECIMAL(18,2) NOT NULL
                    CONSTRAINT [CK_AccTravelPerDiemCountry_Amount] CHECK ([Amount] > 0),
    [Note]          NVARCHAR(300) NULL,
    [IsActive]      BIT NOT NULL
                    CONSTRAINT [DF_AccTravelPerDiemCountry_Active] DEFAULT (1),
    [CreatedBy]     INT NULL,
    [CreatedAt]     DATETIME2(7) NOT NULL
                    CONSTRAINT [DF_AccTravelPerDiemCountry_Created] DEFAULT (SYSDATETIME()),
    [UpdatedBy]     INT NULL,
    [UpdatedAt]     DATETIME2(7) NOT NULL
                    CONSTRAINT [DF_AccTravelPerDiemCountry_Updated] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccTravelPerDiemCountry created.';
END
ELSE
  PRINT 'AccTravelPerDiemCountry already exists -- nothing to do.';
GO

-- Scoped to the object, not database-wide: an index name is unique only within
-- its table, so the unscoped form can be satisfied by a same-named index on
-- another table and skip creating this one without saying so (120's note).
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_AccTravelPerDiemCountry'
    AND object_id = OBJECT_ID('dbo.AccTravelPerDiemCountry')
)
  CREATE UNIQUE INDEX [UX_AccTravelPerDiemCountry]
    ON [dbo].[AccTravelPerDiemCountry] ([CountryCode], [EffectiveDate]);
GO

-- Post-apply, on BOTH databases: 0 rows, identity unallocated, and the same
-- answer on each side. It ships empty and inert — every trip resolves to the HR
-- log until somebody enters a rate.
SELECT DB_NAME() AS db,
       COUNT(*) AS Rows_,
       IDENT_CURRENT('dbo.AccTravelPerDiemCountry') AS IdentCurrent
FROM dbo.AccTravelPerDiemCountry;
GO
```

**No seed.** The feature arrives switched off: with no rows, `perDiemCountryLog`
answers `null` for every country and every request computes exactly what it
computes today. That is the property to check on deploy day.

---

## Server

### Part 1 — the country on the request

**`src/lib/acc/travel-booking/booking-country.ts`** — new, pure, imports only
`isKnownCountry` from `@/lib/acc/country-currency` (itself import-free), so it is
unit-testable and safe in the client bundle.

```ts
export const BOOKING_DEFAULT_COUNTRY = "TH";

/** The country a trip is filed as, given what the client posted. */
export function resolveBookingCountry(posted: string | null | undefined): string;
```

Trim, upper-case, accept it if `isKnownCountry` knows it, otherwise
`BOOKING_DEFAULT_COUNTRY`. Never throw and never store an unknown code — a
`CHAR(2)` will happily hold `XX`, and Part 2 would then resolve a rate for it.

It does **not** import `DEFAULT_COUNTRY` from
`features/accounting/lib/claim-currency.ts:66`, and the constant is redefined
rather than shared. The two are the same string and a different rule: AP-1's is
the tail of a brand-scoped resolution (`effectiveClaimCountry`,
`claim-currency.ts:211`), AP-17's is a plain admission test over the whole list
(D1). Importing it would suggest the rules travel together, and the next person
to change AP-1's would change AP-17's without meaning to.

**`src/lib/acc/travel-booking/request-service.ts`** — four edits:

| Where | Today | Change |
|---|---|---|
| `:851-869` draft UPDATE | binds `brandCode` only | add `.input("country", sql.Char(2), resolveBookingCountry(tab.countryCode))` and `CountryCode=@country` to the `SET` |
| `:871-891` draft INSERT | same | add the bind, the column and the value |
| `:79-134` `mapTravelBookingRow` | maps `provinceId`/`provinceName` at `:127-128` | add `countryCode: ((r.CountryCode as string \| null) ?? "").trim().toUpperCase() \|\| null` beside them |
| `:361-377` `listMyTravelBookings` | names header columns explicitly at `:368-369` | add `r.CountryCode` |

`getTravelBookingRequest` needs no SELECT change: its header query is
`SELECT r.*` (`:296-321`), so the column arrives as soon as the mapper reads it.

**No submit-time re-check.** `resolveBookingCountry` runs on the only writer, so
a stored value is already either a known code or `TH`; a second check in
`validateTravelBookingTab` (`:993-1009`) would be a second copy of the rule and
only one of the two would ever be corrected. This is the same shape AP-1 uses —
`resolveClaimCountry` (`request-service.ts:233`) is called once at
`:1189` and the write at `:1217`/`:1262` takes its answer — except that AP-17's
resolution has no brand in it, which is D1.

### Part 2 — the rate

**`src/lib/acc/travel-booking/perdiem-country.ts`** — new, pure. Its only import
is `import type { AllowanceLogEntry } from "./perdiem"`, which is erased.

```ts
export interface PerDiemCountryRate {
  countryCode: string;
  effectiveDate: string;   // 'YYYY-MM-DD'
  amount: number;
}

export const PER_DIEM_HOME_COUNTRY = "TH";

/** false for blank, unknown-cased junk, and for TH (D7). */
export function isPerDiemCountry(code: string | null | undefined): boolean;

/**
 * The effective-dated log for this country, or **null** meaning "fall back to
 * the employee's HR log". Never an empty array — see D6.
 */
export function perDiemCountryLog(
  countryCode: string | null | undefined,
  rates: readonly PerDiemCountryRate[],
): AllowanceLogEntry[] | null;

/** The one decision. Every consumer of computePerDiem/rateForDay calls this. */
export function perDiemLogFor(
  countryCode: string | null | undefined,
  employeeLog: readonly AllowanceLogEntry[],
  rates: readonly PerDiemCountryRate[],
): {
  log: AllowanceLogEntry[];
  source: "country" | "employee";
  countryCode: string | null;   // the country the rate came from, or null
};
```

`perDiemCountryLog` filters `rates` to the country, drops nothing else (the
caller supplies active rows only), maps to `{ effectiveDate, amount }`, sorts
ascending, and returns `null` if the result is empty. `perDiemLogFor` returns
`{ log: employeeLog, source: "employee", countryCode: null }` whenever it is
null. The `source` field is not decoration: it is what the form's note, the
report column and the recompute's audit row all state, and it exists so none of
them has to re-derive "did a country rate apply here".

**`src/lib/acc/travel-booking/perdiem-source.ts`** — new, the pool half.

```ts
export async function listPerDiemCountryRates(): Promise<PerDiemCountryRate[]>;
export async function upsertPerDiemCountryRate(row, userId): Promise<void>;
export async function resolvePerDiemLog(
  employeeId: string | null,
  countryCode: string | null,
): Promise<ReturnType<typeof perDiemLogFor>>;
```

- `listPerDiemCountryRates` reads `getAccPool()` — **not** `getProductionFormPool()`
  (D5) — `WHERE IsActive = 1 ORDER BY CountryCode, EffectiveDate`.
- `upsertPerDiemCountryRate` runs inside `writeBothPools` (`dual-write.ts:41`),
  the same statement against each database, reading no id back. It refuses
  `TH` (D7) and refuses a non-positive amount before the CHECK does, so the
  message is Thai rather than a constraint violation.
- `resolvePerDiemLog` is the convenience wrapper for a caller with one request in
  hand. It calls `getAllowanceLog` and `listPerDiemCountryRates` and hands both
  to `perDiemLogFor`.

**`getAllowanceLog` is imported by this file and by nothing else.** That is the
rule the guard test pins, and it is what makes "one resolver" checkable rather
than aspirational.

#### The four consumers, and what each must change

**1. Submit — `request-service.ts:1201-1208`.** Today one `getAllowanceLog(emp.id)`
serves the whole group. It becomes: one `getAllowanceLog(emp.id)` and one
`listPerDiemCountryRates()` before the loop, then `perDiemLogFor(tabs[i].countryCode, log, rates)`
**inside** the loop — because the country is per tab (D2) and the group may hold
more than one. Two queries, not two per tab. `computePerDiem` at `:1208` takes
the resolved `.log` and is otherwise untouched. The writes at `:1232`
(`AccRequest.TotalAmount`) and `:1266` (`AccTravelBooking.PerDiemTotal`) do not
change shape.

**2. Recompute — `perdiem-recompute.ts:41-48`, `:86-95`.** Two changes, and the
first is the one that costs money if it is missed:

- the SELECT at `:43-48` currently reads `r.Status, r.EmployeeId`. It must also
  read **`r.CountryCode`**. Without it, `perDiemLogFor` is handed `null` and a
  cancellation in a UK trip's group re-derives that trip at the Thai rate and
  writes it to `AccTravelBooking.PerDiemTotal` **and** `AccRequest.TotalAmount`
  inside the cancelling transaction (`:104-115`).
- the country rates are loaded **once, before the loop, and only if at least one
  row names a country other than `TH`**. That is not an optimisation. It is what
  keeps `perdiem-recompute.test.ts` running without a database: that file's
  preamble (`:4-20`) records that no fixture row carries an `EmployeeId`, so
  `getAllowanceLog` — the only real network call the module can make — is never
  reached. A rate loader called unconditionally would break that and force the
  test to grow a second stub.

The audit row at `:151-163` gains `rateSource` and `countryCode` in its
`MetadataJson`. A per-diem figure that moved because a rate list applies is a
different event from one that moved because a day was given back, and the
timeline is where somebody reconciling this will look.

**3. Report — `report-service.ts:128-152`, `:156-160`, `:254-273`.**
`computeReportPerDiemDisplay` re-derives the displayed rate from `rateForDay` at
`:140`, entirely independently of what was stored. Three changes:

- `BASE_CTE` at `:156-160` selects `r.CountryCode` beside `r.EmployeeId`.
- `listPerDiemCountryRates()` is loaded once beside the `logByEmployee` batch at
  `:254-262`.
- the call at `:268-273` passes `perDiemLogFor(x.CountryCode, log, rates).log`.

Miss any of the three and the report prints the employee's Thai rate against a
country-rate total — which is worse than printing nothing, because a reader
divides the total by the rate and gets a day count that does not match the
column beside it.

**4. The live estimate — `useTravelBookingForm.ts:556-590`.** The SWR fetch at
`:567-571` keeps its key and gains the country rates in its response (D9). The
memo at `:583-590` calls `perDiemLogFor(tabs[i].countryCode, entries, countryRates)`
per tab.

The existing fallback at `:561`/`:572` — a flat log built from
`employee.allowance` while the real log is in flight — **must not be used for a
non-home country.** A tab whose country is not `TH` renders no estimated total
until the fetch answers; days alone, and `—` for the money. This is the same
guard, for the same reason, as AP-1's `brandsKnown`
(`useTravelExpenseForm.ts:414-423`): reconciling against data that has not
arrived yet does not narrow the answer, it produces a confidently wrong one.

---

## Routes

| Method | Path | Gate | Shape |
|---|---|---|---|
| POST | `/api/request/travel-booking/requests` | `requireAuth()` (`route.ts:24-26`) | **unchanged.** `SaveTravelBookingInput` gains `countryCode: string \| null`; the route already forwards the whole DTO (`:29-31`). No `ROUTE_RULES` entry — `/api/request/travel-booking` already classifies `AP-17`. |
| GET | `/api/request/travel-booking/allowance-log` | `requireAuth()` (`route.ts:12-14`) | response goes from `{ entries }` to `{ entries, countryRates }`. **`entries` keeps its exact meaning** — the requester's raw HR history — so `AllowanceHistoryModal` (`AllowanceHistoryModal.tsx:33`), which reads `.entries` and nothing else, is untouched. |
| GET | `/api/request/travel-booking/settings/per-diem` | `requireRole(["IT Admin","System Admin"])` | `{ ok: true, data: PerDiemCountryRateRow[] }` — **all** rows, inactive included, so an admin can see what they switched off. |
| POST | `/api/request/travel-booking/settings/per-diem` | `requireRole(["IT Admin","System Admin"])` | `{ id?, countryCode, effectiveDate, amount, note?, isActive? }` → `{ ok: true }`. 400 on an unknown country, on `TH`, on a non-positive amount, on a malformed date. |

`per-diem` is a **static** segment sitting beside `settings/[kind]`. That is the
arrangement `settings/brands` already uses and it works because a static segment
wins over a dynamic one; belt and braces, `isSettingsKind("per-diem")` is false
(`settings-route-map.ts:55-59`), so the dynamic route would answer 400 even if it
were reached.

**`requireRole`, not `requireBookingSettingsTab`.** The gate's parameter is typed
`GrantableBookingTabKey` (`require-booking-settings-tab.ts:56-64`), so an
admin-only tab is *unrepresentable* to it — the same mechanism that keeps `access`
out. This is D11, and it has a test consequence: see below.

---

## UI

### Part 1 — the `ประเทศ` band

**`src/features/travel-booking/components/TravelBookingTab.tsx`**, a new block
immediately after the `data-field="brand"` div (`:230-262`) and before
`data-field="reason"` (`:265`) — the country is a property of the trip, at the
same rank as the brand, and above `data-field="province"` (`:334`) which it
qualifies.

Copy `TravelExpenseForm.tsx:1119-1188` and adapt:

- **label** `ประเทศ`, same `labelClass` as the fields around it.
- **options** are `COUNTRIES` (D1) rather than a computed `countryOptions`. There
  are 25 of them and no brand fetch, so the `only`/`disabled` arm at
  `TravelExpenseForm.tsx:1130`/`:1135` has nothing to do and is dropped.
- **flags are `/flags/{code}.svg`, not emoji.** `TravelExpenseForm.tsx:1157-1165`
  says why in its own comment: Windows ships no flag glyphs, so Chrome and Edge
  render `countryFlag()`'s regional-indicator pair as two plain letters. The 25
  SVGs are already in `public/flags`. Keep the `onError` handler that hides a
  missing file (`:1164`).
- **two lines, English over Thai**, from `countryNames(code)`
  (`country-currency.ts:183`) — `TravelExpenseForm.tsx:1174` and `:1180`. Thai
  script is wider at the same size, so stacking is what stops 25 chips pushing
  the form sideways.
- **do not copy the block comment at `TravelExpenseForm.tsx:1096-1118.`** It is
  stale: it describes a `length > 1 || fxNote` gate, and the code beneath it at
  `:1119` reads `brandCode && countryOptions.length > 0`. Copying it into AP-17
  would import a wrong explanation of a rule AP-17 does not have anyway.
- **do not copy the `fxNote` paragraph** at `:1191-1195`. That is AP-1's
  per-line currency note and it is exactly the thing D3 says AP-17 does not do.

`TabFormState` gains `countryCode: string | null` (beside `brandCode` at
`useTravelBookingForm.ts:48`), initialised `null` (`:106`), hydrated from the
loaded request (`:151`), and sent by `buildSaveInput` (`:199`). It is **not**
added to `validateTab` (`:257-262`): the server resolves a blank to `TH`, so a
requester who never touches the band files a Thai trip, which is what they meant.

### Part 1 — the country where the province is shown

- **Detail page.** `TravelBookingDetail.tsx:1056` renders
  `<DetailRow label="จังหวัด" …>`. Add `<DetailRow label="ประเทศ" value={countryNameBoth(request.countryCode)} />`
  above it. `countryNameBoth` (`country-currency.ts:169`) gives
  `"มาเลเซีย · Malaysia"` — both, because the person reading a booking reconciles
  it against an invoice and a hotel confirmation written in English.
- **Report.** Add `"ประเทศ"` to `columns` (`report-service.ts:355-371`) directly
  after `"จังหวัด"` (`:358`). Insertion is safe: every styled column is located by
  `columns.indexOf(...)` at `:381-385` rather than by a literal index, and the
  comment there records why. Add the matching value to the row push at `:388-410`.

### Part 2 — what the rate changes on screen

- **The estimate note, `TravelBookingTab.tsx:549-551.`** It currently reads
  `* ยอดจริงคำนวณจากอัตราเบี้ยเลี้ยงย้อนหลังตามวันที่ในระบบ HR เมื่อกด "ส่งคำขอ"`,
  which becomes false the moment a country rate applies. Three states, keyed on
  `perDiemLogFor(...).source` and whether the country is home:
  - home — unchanged, exactly as above;
  - country, rate found —
    `* ใช้อัตราเบี้ยเลี้ยงต่างประเทศของ{ประเทศ} (บาท/วัน) ตามวันที่เดินทาง — ยอดจริงคำนวณเมื่อกด "ส่งคำขอ"`;
  - country, no rate —
    `* ยังไม่ได้ตั้งอัตราเบี้ยเลี้ยงสำหรับ{ประเทศ} — ใช้อัตราในระบบ HR`.
  The third is not an error state and must not be styled as one. It is the
  designed fallback (D6), and it is also what every request looks like on the day
  Part 2 deploys.
- **The wallet chip.** `TravelBookingForm.tsx:290-297` (the form) and
  `TravelBookingDetail.tsx:988` (the detail) both print
  `฿{allowance}/วัน` from the employee's HR figure —
  `AccRequest`/`AccTravelBooking.AllowanceSnapshot`, written from `emp.allowance`
  at `request-service.ts:623` and read only for display. On a country-rate trip
  that names a rate which was not applied. It must be captioned so it cannot be
  read as the trip's rate — `เบี้ยเลี้ยง (HR)` — or hidden when
  `source === "country"`. **`AllowanceSnapshot` itself is not repurposed**: it is
  a snapshot of an HR fact and overwriting it with a country rate would destroy
  the only record of what the employee's own allowance was at the time.
- **`AllowanceHistoryModal` stays as it is.** It is the HR log, per requester, and
  the group may span countries so there is no single country it could show. Its
  title `ประวัติเบี้ยเลี้ยง` already scopes it; its own header comment at `:18-21`
  says it is the authoritative HR log.
- **Report.** A second new column, `"เบี้ยเลี้ยง (ที่มาของเรท)"`, holding
  `HR` or `ประเทศ`. The country column alone cannot answer it, because a country
  with no configured rate falls back to the HR log — and "which list produced this
  number" is the first question anybody investigating a per-diem discrepancy asks.

### Part 2 — the settings tab

`src/app/(dashboard)/request/accounting/travel-booking-settings/page.tsx`:

- `TabKey` (`:34`) gains `| "per-diem"`.
- `TAB_ICONS` (`:42-49`) gains an entry — it is `Record<TabKey, …>`, so a missing
  icon is a compile error, which is the good kind.
- `TABS` (`:51-57`) appends it in the same `.concat([...])` that appends `access`,
  labelled **`เบี้ยเลี้ยงต่างประเทศ`**.
- `panel` (`:173-176`) adds it to the null arm beside `access` and `brands`; it
  renders its own component, not the generic option list. Without this the
  `TAB_PANELS[effectiveTab]` lookup fails the typecheck, which is again the good
  kind.
- **And it needs its own render branch, placed BEFORE `page.tsx:229`.** That line
  reads `effectiveTab === "access" || panel === null ? <BookingApproverSettings />`,
  so a tab added to the null arm and left there renders **the approver roster**
  under a เบี้ยเลี้ยงต่างประเทศ heading. The typecheck does not catch it: it
  covers the `TAB_PANELS[effectiveTab]` lookup, not which arm of the render
  ternary wins. This is the same trap the worldwide-places spec names as a
  hazard for its own new tab — and both specs add a tab to this one file, so
  whichever lands second rebases onto a ternary that already has an extra arm.
- **Nothing else is needed to make it admin-only.** `visibleTabs` (`:158-163`)
  gives an admin every tab and a non-admin only tabs that are *both*
  `isGrantableBookingTabKey` and granted — and `per-diem` is neither
  (D11), exactly as `access` is neither.

The panel itself: a table of `ประเทศ / มีผลตั้งแต่ / บาท/วัน / หมายเหตุ / สถานะ`,
newest effective date first within a country, with an add dialog whose country
control is `COUNTRIES` minus `TH`. **"Remove" writes `IsActive = 0` and the
dialog says what that means**: it marks a row as *entered in error*, not as
*superseded*. Superseding a rate is adding a row with a later `EffectiveDate`.
See Hazards H6 for why the distinction is not pedantry.

---

## Tests

### Pure, new

**`perdiem-country.test.ts`** — the whole of D6 and D7 lives here.

- no rows at all → `null`; rows for another country only → `null`; rows for `TH`
  → `null` even when present.
- **an active-but-empty result returns `null`, not `[]`.** Assert the type, not
  just the emptiness — this is the one that pays 0 if it regresses.
- `perDiemLogFor` with `null` from the country arm returns the employee log and
  `source: "employee"`; with a country log returns it and `source: "country"`,
  and **never merges the two**.
- effective dating at the exact boundary: a day equal to `EffectiveDate` takes
  the new rate, the day before takes the previous one, and a day before every row
  falls through — which in a country log means the trip is priced 0 for those
  days. Assert that explicitly and decide it is acceptable, or make
  `perDiemCountryLog` refuse a log whose earliest row post-dates the trip.
- a trip spanning a country-rate change produces two `groups` through
  `computePerDiem`, unmodified.

**`perdiem.test.ts`** — **this file does not exist today.** `computePerDiem` and
`rateForDay` (`perdiem.ts:24-89`) have no unit test at all, and they produce the
figure AP-17 pays. Part 2 must not be the second feature built on an untested
money function. Minimum: `rateForDay` returning 0 for an unmatched day (the
behaviour D6 is built around), the continuation slice at `:71`, the `groups`
ordering at `:73-86`, and the 2dp rounding at `:85`.

### Source-reading guards

Modelled on `booking-currency-guard.test.ts:34-43`, which already strips comments
so a paragraph quoting a rule cannot satisfy or trip the check for it.

**`perdiem-source-guard.test.ts`** — four assertions, and they are the mechanism
by which the four derivations are kept from disagreeing:

1. **`getAllowanceLog`'s importers are an allow-list, not a count of one.**
   Four non-test files import it today — `perdiem-recompute.ts:4`,
   `report-service.ts:4`, `request-service.ts:21` and
   `app/api/request/travel-booking/allowance-log/route.ts:5` — and this design
   **keeps all four**: the two services batch it per employee (routing the
   report's `logByEmployee` batch through a per-request resolver would be N+1
   per row), and the route must keep returning raw entries so
   `AllowanceHistoryModal` is untouched. So the guard asserts the importer set
   equals those four **plus `perdiem-source.ts`**, and nothing else. Written as
   "exactly one importer" — as an earlier draft of this spec had it — the guard
   is red the day it is written and contradicts the Server section above it.
   What it is really protecting is that no *new* file forms its own opinion about
   which log a trip is priced with; guard 2 is the stronger half of that.
2. **Every non-test file importing `computePerDiem` or `rateForDay` from
   `@/lib/acc/travel-booking/perdiem` also imports `perDiemLogFor`.** Pin the
   file list at exactly four — `request-service.ts`, `perdiem-recompute.ts`,
   `report-service.ts`, `useTravelBookingForm.ts` — so a fifth consumer has to be
   looked at rather than merged on the strength of the import being legal.
3. **`perdiem-recompute.ts`'s group SELECT names `r.CountryCode`**, and
   **`report-service.ts`'s `BASE_CTE` names `r.CountryCode`.** Two regexes over
   the source. Both are a column somebody can delete while tidying a SELECT, and
   neither deletion fails a typecheck: the value simply arrives `undefined` and
   `perDiemLogFor` answers "employee".
4. **`AccTravelPerDiemCountry` is absent from `currency-pool-guard.test.ts`'s
   `PRODUCTION_ONLY_TABLES` (`:64`) and present in `MASTER_TABLES`
   (`verify-master-alignment.ts:66-91`).** The two lists answer opposite
   questions and the table belongs in exactly one of them (D5).

### Existing tests that must be updated, and why each is a real check

- **`settings-tabs.test.ts:298-302`** asserts `roleGated` deepEquals
  `["approvers"]` — the list of AP-17 settings routes allowed to stay on
  `requireRole`. **Add `"per-diem"` to it.** Express the change as an addition,
  never as a literal final list: the worldwide-places spec adds `"provinces"` to
  the same array, so whichever lands second finds a two-element list rather than
  the one-element list written here. Do not weaken the assertion to an
  `includes`; the point is that adding an admin-only settings route is a
  deliberate act.
- **`settings-tabs.test.ts:306-310`** pins `handlerCount` at 11. **This spec adds
  two, so raise it by two** — 13 if it lands first, 16 if the worldwide-places
  spec's three are already in. Read the assertion and add; do not copy an
  absolute number into the plan. Its own message says the number exists so a new
  handler is looked at rather than waved through.
- **`perdiem-recompute.test.ts`** — its fixtures gain a `CountryCode` field. Keep
  at least one fixture set with no country at all and assert that the run still
  opens no pool, which is the property the preamble at `:4-20` documents and
  which the "load rates only if some row names a foreign country" rule preserves.
- **`npm run check:alignment`** gains one entry — 26 if this lands first, 27 if the brand-access spec's table is already there — and **will be red until
  133 is applied to both databases**. That is the check working.

---

## Hazards

Ranked by what they cost, worst first.

**Read them against this measurement first (taken 2026-08-31, both databases).**
`Rocks_Portal_Form` holds **one** `AccRequest` row in total, an AP-3, and
`AccTravelBooking` is **empty**. Every AP-17 request that exists — five, four of
them live — is in `Rocks_Portal_Form_UAT`, along with all 42 AP-1, 24 AP-2, 10
AP-3 and 3 AP-11 requests. So this spec changes a money figure that, today, has
**never been computed in production**: there is no historical per diem to
re-price, nothing to backfill, and no payment already made that a recompute could
contradict.

Two things follow, and the second is the one that catches people. The hazards
below are real but currently theoretical, so the cost of getting one wrong is
paid in UAT rather than in somebody's payslip — which is the right time to be
wrong. And **the database that must not be missed is `Rocks_Portal_Form_UAT`,
not `Rocks_Portal_Form`**, which inverts the usual instinct: a migration applied
only to production breaks the database everybody is actually working in, and
because AP-1 and AP-17 share `AccRequest`, it breaks both forms at once.

**H1 — `recomputeGroupPerDiem` re-derives a foreign trip at the Thai rate.**
The SELECT at `perdiem-recompute.ts:43-48` reads `r.Status, r.EmployeeId` and not
`r.CountryCode`. Left that way, cancelling any trip in a group re-prices its
surviving siblings from the employee's HR log and writes the result to
`AccTravelBooking.PerDiemTotal` **and** `AccRequest.TotalAmount` in one batch
(`:104-115`), inside the cancelling transaction, with an activity row that says
the figure changed and not why. A Tokyo trip silently reverts to a Thai daily
allowance and nothing on any screen contradicts it. Guard 3 in Tests is the only
thing that catches a later tidy-up removing the column.

**H2 — an empty country-rate array pays nothing.** `rateForDay` returns 0 for an
unmatched day (`perdiem.ts:32`). If `perDiemCountryLog` ever returns `[]` instead
of `null` — the obvious thing to write, and what a `.filter().map()` produces —
every day of the trip prices at 0, `computePerDiem` totals 0, and the submit
stamps `TotalAmount = 0` with no error at any layer. D6 and the
`CHECK ([Amount] > 0)` are two independent defences and both are wanted.

**H3 — migration 133 applied to one database only.** SQL Server binds object
names at compile time, so `listPerDiemCountryRates` is `Invalid object name` on
the missing side, not an empty result. It is on AP-17's **submit** path and
inside the transaction that cancels or rejects a trip, so the visible failure is
"cannot submit" and "cannot cancel" for whichever population resolves that
database. **Unlike the `AccReimburseApprover`/090 precedent, this does not take
AP-1 down**: the table is named only on AP-17 paths and nothing reached by
`queryBothPools` touches it. That is a smaller blast radius, not a licence to
apply it to one side.

**H4 — Part 2 before Part 1.** Part 2 has no key without Part 1. Verified this
session: nothing in `src/lib/acc/travel-booking/` or
`src/features/travel-booking/` reads a country today; `AccRequest.CountryCode` is
written by AP-1 alone. Deployed alone, Part 2 would read `CountryCode = NULL` on
every AP-17 request, `perDiemLogFor` would answer `"employee"` every time, and
the whole feature would be dead configuration — **not wrong, just inert**, which
is the safe direction but also means it would pass a smoke test while doing
nothing. The dangerous partial is the reverse in a different sense: Part 1
deployed, drafts saved with `CountryCode = 'JP'`, and Part 2 arriving weeks later
— those drafts are then re-priced at the country rate the moment they are
submitted, which is correct but is a change of figure between what the requester
saw on the form and what the request carries. Ship Part 2 close behind Part 1, or
accept that.

**H5 — a country picked against a Thai province.** `validateTravelBookingTab`
still refuses a submit with no province (`request-service.ts:1009`,
`กรุณาเลือกจังหวัด`), and `TravelProvince` holds 77 Thai rows. So after Part 1 a
requester can pick `MY` and then must pick a Thai province to submit. The request
is filable and internally contradictory, and `ProvinceName` is what every
display, email, queue and Excel cell reads. **This is not fixed here** — it is the
worldwide-places spec's subject (foreign cities as `TravelProvince` rows with a
`CountryCode` column). Until that lands, either sequence it first, or ship Part 1
knowing the province field is unqualified by the country. The one thing not to do
is quietly relax the province requirement in this work: three separate guards
enforce it and relaxing one leaves the other two refusing.

**H6 — deactivating a rate row already in effect.** `IsActive = 0` removes the
row from `listPerDiemCountryRates`, so the next recompute of any *still-writable*
trip that used it re-prices at the previous rate — or at the HR log, if it was
the only row. `perDiemWritable` (`perdiem-window.ts:16-20`) admits `Draft`,
`Submitted`, `ManagerApproved` and `Returned`, so a trip in an approver's queue
can change price because an admin tidied a settings table. `Completed` is safe:
the sign-off freezes the figure. The mitigation is copy, not code — the dialog
says `IsActive = 0` means *entered in error* and that superseding means adding a
row — plus the recompute's audit row naming its rate source.

**H7 — identity lockstep on the new dual-written table.** `writeBothPools`
(`dual-write.ts:41`) runs the same statement against both databases and reads no
id back, and SQL Server allocates identity outside the transaction, so a
production insert that succeeds followed by a UAT one that throws leaves the two
counters permanently one apart. **The cost here is lower than for
`AccReimburseRuleAck`**, and it is worth saying why so nobody over-corrects:
nothing stores a *rate id*. The submit stores the derived `PerDiemTotal`, so
drifted ids produce a mismatched settings grid, not a request attributed to the
wrong rate. Run `npm run check:alignment` after any dual-write failure regardless.

**H8 — somebody "fixes" the currency inconsistency.** A reader who has just
finished Part 1 will see a country on an AP-17 request and a currency derived
from a brand and conclude one should feed the other. D3 is the answer, and it has
three anchors: this section, `booking-currency.ts:12-22`, and
`booking-currency-guard.test.ts`, which asserts that `admin-service.ts` holds
exactly one `UPDATE [dbo].[AccRequest] SET … Currency=` statement.

**H9 — the client estimate falling back to the Thai flat rate.** `estimateLog`
(`useTravelBookingForm.ts:572`) falls back to a one-entry log built from
`employee.allowance` while the fetch is in flight. On a foreign tab that shows
the employee's Thai daily rate as the trip's rate for as long as the fetch takes.
The rule in Server (no total until the fetch answers) is what prevents it, and it
is the same shape as AP-1's `brandsKnown` guard.

**H10 — reusing `AccPerDiem`.** The name matches, the table is empty, and it
looks free. D10 records why it is not: it is in 061/064, so in UAT it carries
`CHECK (Id >= 900000)`, which a dual-written master table cannot satisfy.

**H11 — adding the new table to 061/064.** The mirror of H10. Those migrations
are for transactional tables; adding a master table to either breaks it in one of
the two ways CLAUDE.md describes — loudly through the CHECK, or silently through
a UAT counter that starts at 900001 where production's is at 1.

---

## Deployment

**Order, and none of it is optional.**

1. **Verify Part 1's premise on both databases** (see Schema):
   `SELECT DB_NAME(), COL_LENGTH('dbo.AccRequest','CountryCode');` — expect `2`
   on each. A NULL means migration 129 was applied to one side only; apply 129,
   do not write a new migration.
2. **Deploy Part 1's code.** No migration. `check:alignment` is unaffected.
   Smoke test: save an AP-17 draft with a country, reload it, confirm the chip
   comes back; submit it; open the detail page and the report and confirm the
   country appears; confirm the per-diem total is **unchanged** from what the
   same trip would have produced before — Part 1 must not move a figure.
3. **Apply migration 133 to `Rocks_Portal_Form` AND `Rocks_Portal_Form_UAT`,
   before Part 2's code reaches either.** Post-apply on both: 0 rows, and the
   same `IDENT_CURRENT`.
4. **Run `npm run check:alignment`.** It gains one entry (26 alone, 27 if `AccBookingApproverBrand` landed first) and is red until 133 is on
   both sides. Red here is the check working; red *after* both sides are applied
   means the counters were already apart before this table existed.
5. **Deploy Part 2's code.** With the table empty, every request must still price
   exactly as it did in step 2. **That is the deploy-day acceptance test**: a
   feature that changes a payable must be provably inert until somebody
   configures it.
6. **Enter one rate**, at Settings → ตั้งค่าแบบฟอร์มขอเดินทาง (AP-17) →
   เบี้ยเลี้ยงต่างประเทศ, with an `EffectiveDate` in the past, and verify all
   four consumers agree on one trip:
   - the form's estimate strip while filling it;
   - the stored `AccTravelBooking.PerDiemTotal` and `AccRequest.TotalAmount`
     after submit;
   - the report's `เบี้ยเลี้ยง (เรท/วัน)` and `(ยอดรวม, บาท)` columns;
   - then cancel a *predecessor* trip in the same group and confirm the recompute
     rewrites the survivor at the **country** rate, that the activity row names
     the source, and that the header and the detail row still agree.
   The last of those is H1. It is the only one that cannot be checked by looking
   at a single screen, and it is the one that costs money.

**Nothing backfills.** Every AP-17 request submitted before this carries
`CountryCode = NULL` and keeps the per diem it was given. A recompute triggered
on such a request resolves `"employee"` and reproduces today's behaviour exactly.

---

## Out of scope

- **⚠ The worldwide-places spec adds a settings tab to the same page this one
  does.** That spec adds `provinces`; this one adds `per-diem`. Both edit
  `TabKey` (`:34`), `TAB_ICONS` (`:42-49`), `TABS` (`:51-56`), the `panel`
  ternary (`:173-176`) and the render ternary at `:229`, and both raise
  `handlerCount` and extend `roleGated` in `settings-tabs.test.ts`. **Whichever
  lands second rebases** — read the current values rather than the ones written
  in either spec.

- **The booking currency.** D3 / R1. It stays derived from the brand with one
  writer at `admin-service.ts:547-559`. See
  `docs/superpowers/specs/2026-08-28-ap1-ap17-multi-currency-design.md`.
- **A foreign-currency per diem.** Pinned baht by D4 and by that spec's §7.
- **Worldwide places and the province field.** `TravelProvince` gaining a
  `CountryCode` column, foreign city rows, and the admin CRUD screen that table
  has needed since migration 049 seeded it — plus the ORS `boundary.country`
  parameter. That is the worldwide-places spec. This spec's H5 records what its
  absence costs.
- **The approver brand-visibility right.** `AccBookingApproverBrand`, scoping the
  Admin booking queue, the accounting sign-off queue, the report and the act
  paths. Migration **134**, its own spec. It does not touch the requester's brand
  chips and therefore does not interact with Part 1.
- **A country filter on the AP-17 report.** The column is added; a
  `?countryCode=` filter beside the existing `?provinceId=` is a small follow-up
  and is better decided once the province work has settled whether the province
  filter survives at all.
- **AP-1.** It has no per diem. Its country picker is the thing Part 1 copies, not
  a thing Part 1 changes.
