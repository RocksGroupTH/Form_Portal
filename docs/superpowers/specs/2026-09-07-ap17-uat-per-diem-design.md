# AP-17 — a per-tester per-diem rate that applies only in UAT

**Date:** 2026-09-07
**Status:** design agreed, not built
**Migration:** 138 (`Fast_Core`)

AP-17 prices a trip by walking its days and charging, per day, whichever
effective-dated rate was in force. For a foreign trip that log comes from
`AccTravelPerDiemCountry`; for a Thai one it comes from
`Rocks_Portal_HR.dbo.EmployeeAllowanceLog` — the employee's real HR allowance.

`Rocks_Portal_HR` has **no UAT twin**. A tester rehearsing AP-17 in UAT is
therefore priced at their own real compensation, read live out of the HR system,
and the screens that display it show that same real figure. This spec adds a
per-tester rate, set on **Settings → UAT Users**, that replaces the HR arm and
**only in UAT**.

> §12 records what the first draft of this spec got wrong. It is kept because
> two of those errors are the ones a reader would make again.

---

## 1. Decisions taken

| Question | Decision |
|---|---|
| One amount per tester, or effective-dated? | **Effective-dated**, a log per tester. |
| Country rate vs the UAT per-tester rate | **Country wins.** The override replaces the *employee* arm only. |
| A tester with no rate set | **Falls back to real HR**, exactly as today. Not zero, not a refusal. |
| The screens that display the allowance | **Show the UAT rate too.** |
| Widen `UatTester`, or a new table? | **A new table.** §2. |
| Filing on behalf of somebody else | The **requester's** rate, never the actor's. |
| `AllowanceSnapshot` on a draft saved before the rate existed | **Re-stamped at submit** — see §3.3. Affects production too, deliberately. |
| The `฿X/วัน` chip showing the actor's rate when filing on behalf | **Fixed here**, as a consequence of §3.2. A pre-existing bug, unrelated to UAT. |

### Why effective-dated rather than one amount

`rateForDay` (`perdiem.ts:24-33`) walks a log of `{ effectiveDate, amount }` and
charges the newest entry on or before the day. A single amount would have to be
adapted into that shape, and the adapter is a trap: give it a real date and every
trip day *before* it resolves to **0** and the trip silently under-pays. The
existing workaround is the sentinel `effectiveDate: "0001-01-01"`
(`useTravelBookingForm.ts:579-581`).

A log needs no sentinel, and it buys what a flat amount cannot rehearse at all:
AP-17 has real behaviour for a rate that changes mid-trip — `computePerDiem`'s
`groups`, `tripRateSegments`, the report's เปลี่ยนเรท note, `TripRateHistoryModal`.

### Why country still wins

Because it needs no rule. `perDiemLogFor(countryCode, employeeLog, rates)` already
prefers the country log when one exists and falls back to the employee log
otherwise. Substituting what is passed as `employeeLog` gives country-wins for
free, leaves the decision function untouched, and keeps its `source` union at two
members.

---

## 2. Storage — `Fast_Core.dbo.UatTesterPerDiem`

```sql
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
```

**In `Fast_Core`, beside `UatTester` and `FormEnvironment`, for the reason those
two are there:** what a UAT tester is paid must not depend on which form database
answered. `getCorePool()` is a pool the environment resolver never picks.

**A new table, not a column on `UatTester`:**

1. Effective-dating needs many rows per tester; a column holds one value.
2. `UatTester`'s writers are `upsertUatTester`'s `MERGE` (`service.ts:379-385`)
   and `setUatTesterActive` (`:389-404`), and the split between them is
   deliberate — the MERGE omits `IsActive` so that editing a manager cannot
   reactivate a removed tester. A rate written through the same statement would
   have to defend that rule for no benefit.
3. `Fast_Core` is shared with Rocks Fast and ACC Portal. A table they never name
   is inert; widening one they might is a question this spec would have to answer
   first.

**No UAT twin, not dual-written, not in `MASTER_TABLES`.** `writeBothPools` opens
the two *form* pools (`dual-write.ts:44-47`) and `MASTER_TABLES` compares `Acc*`
tables across those same two databases — a `Fast_Core` table added to either
would write to neither and fail with `Invalid object name`. `check:alignment`
must stay at **27**.

**`CHECK (Amount > 0)` is not hygiene.** `rateForDay` returns **0** for a day it
cannot match, so a stored 0 is indistinguishable from "no rate configured" while
looking configured on screen — on a path that writes `AccRequest.TotalAmount`.
`AccTravelPerDiemCountry` defends this twice, at the constraint and in the
service (`133:75`, `perdiem-source.ts:106-108`), and so does this. `Number(null)`,
`Number("")`, `Number(" ")` and `Number(false)` are all a finite 0 — validate
before coercing.

**Keyed on `StaffId`**, which is `UatTester`'s natural key
(`UQ_UatTester_StaffId`) and the identifier every consumer holds. Not on
`UatTester.Id`, so removing and re-adding a tester does not orphan their rates;
not on email, whose index is not unique. **No FK**: rates outlive a soft-deleted
tester row.

---

## 3. The seam — three substitutions

The first draft assumed one seam covered everything. It does not: the figure that
**prices** a trip and the figure the browser **displays** come from two different
places, and a third is stamped into the row.

### 3.1 The log that prices the trip

`getAllowanceLog` is imported at exactly five sites, four of which are the four
things that compute a per-diem figure:

| Consumer | Call site |
|---|---|
| the live estimate on the form | via `app/api/request/travel-booking/allowance-log/route.ts:36` |
| the submit | `request-service.ts:1238` |
| the recompute after a cancellation | `perdiem-recompute.ts:124` |
| the report's เรทเบี้ยเลี้ยง column | `report-service.ts:296` |

The fifth is `resolvePerDiemLog` (`perdiem-source.ts:159-168`), which has **zero
callers**. **Delete it and its import** (`perdiem-source.ts:3`) as part of this
work — it is the natural-looking wrong entry point a new consumer would reach
for, and leaving it makes §8's guard arm impossible to state cleanly.

Add to `allowance-log.ts`:

```ts
export async function getPerDiemEmployeeLog(
  employeeId: string | null,
  staffId: number | null,
  uat: boolean,
): Promise<AllowanceLogEntry[]>
```

Returns the tester's UAT log when `uat` **and** that tester has one; otherwise
`getAllowanceLog(employeeId)` unchanged. The four consumers call this instead.

**`staffId` may legitimately be null** — `AccRequest.StaffId` is nullable
(`059_portal_form_baseline.sql:231`) — and a null falls back to HR, the same
answer as "no rate set". That is the fail-safe direction and it is stated so
nobody reads a null as an error.

**Not a fourth parameter on `perDiemLogFor`.** That function is pure and reaches
the browser — `useTravelBookingForm.ts` is `"use client"` and calls it at :631,
and `perdiem-country.ts:1` is an `import type` precisely to keep anything
touching `@/env` out of the client graph. A `Fast_Core` read cannot go there. The
alternative costs the same four edits and buys nothing: an **optional** fourth
parameter is caught by neither `tsc` nor the guard test, and a third `source`
value cascades into `perdiem-note.ts:18`'s two-member union, the form's
`PerDiemAttribution` (`useTravelBookingForm.ts:638-645`) and
`perdiem-country.test.ts:147-158`.

**The report keys two ways at once.** `report-service.ts:293-298` batches the HR
logs into `logByEmployee`, keyed on `EmployeeId`; the override is keyed on
`StaffId`. Both columns are in `BASE_CTE` (`:165-166`), so the loader takes one
`IN (@s0..@sN)` pass over the distinct **StaffIds** — `uatManagerStaffIdsFor`'s
shape (`service.ts:226-255`) — and the per-row resolution picks the override by
StaffId, else the HR log by EmployeeId. Never a lookup per row.

### 3.2 The rate the browser displays

**This is the part the first draft got wrong**, and the correction is the whole
of §12.1. Three surfaces show a rate and price nothing:

| Surface | Where | Source today |
|---|---|---|
| the `฿X/วัน` chip | `TravelBookingForm.tsx:290` | `employee.allowance` |
| `allowanceRate` on each tab | `TravelBookingForm.tsx:431` → `TravelBookingTab.tsx:78` | `employee.allowance` |
| `flatRateLog`, the in-flight stand-in | `useTravelBookingForm.ts:579-581` | `employee.allowance` |

All three read one object, `employee`, and it comes from
**`/api/me/employee`** (`useTravelBookingForm.ts:431-438`), whose route builds it
with `findActiveEmployeeByEmail(loginEmail)` (`route.ts:54`) — **not**
`resolveEmployeeForActor`, so `withUatManager` is nowhere on that path. Two
further facts rule out simply overriding it there:

- **`/api/me/employee` has no entry in `ROUTE_RULES`**, so it is unclassified and
  `resolveCurrentFormAccess` short-circuits to Production for everyone
  (`form-environment/index.ts:136-137`; `employee-context.ts:88-90` says so
  outright). The manager preview on that route only works because
  `resolveManagerInfo(loginEmail, formCode, requestId)` is handed the form and id
  explicitly from `?form=AP-17&id=`.
- It returns the **actor's** row, so it could never answer §1's "the requester's
  rate, never the actor's".

**The fix is to stop reading the rate from `employee` at all.** The form already
fetches `/api/request/travel-booking/allowance-log?requesterStaffId=…`
(`useTravelBookingForm.ts:585-592`) — a route correctly classified `AP-17`, keyed
on the **requester**, and already the source of `estimateLog`. So:

```ts
// pure, client-safe: rateForDay is already imported for the estimate
const today = /* local getters, never toISOString */;
const fromLog = rateForDay(today, estimateLog);
const displayRate = estimateLog.length > 0 && fromLog > 0 ? fromLog : (employee?.allowance ?? null);
```

`displayRate` feeds the chip and `allowanceRate`. `flatRateLog` stays exactly as
it is — the stand-in *while the fetch is in flight*, which is all it ever was.

The `fromLog > 0` arm is not defensive noise: `rateForDay` answers 0 for a day no
entry covers, and a chip reading `฿0/วัน` is a worse answer than the HR figure it
replaces.

**There is no on-behalf chip to fix.** `TravelBookingForm.tsx` renders the
`฿X/วัน` chip and the allowance-history button only in the
`requesterStaffId == null` branch — filing for yourself; the on-behalf branch
has never shown a rate at all, so this change touches nothing there. The
genuine residual is `flatRateLog` (`useTravelBookingForm.ts:578-581`), the
stand-in shown while `estimateLog` has not yet arrived — including a fetch
that fails and never will — which prices from the **actor's**
`employee.allowance` regardless of who the trip is filed for. That is a
pre-existing property, unrelated to on-behalf, and in UAT it is the one
remaining way a tester's real HR compensation reaches the screen: `flatRateLog`
and `displayRate` must withhold rather than fall back to it whenever the
resolved environment is UAT. §12.6 records the earlier, wrong version of this
paragraph.

### 3.3 The rate stamped into the row

`AccTravelBooking.AllowanceSnapshot` is written by `upsertTravelBooking`
(`request-service.ts:590`, `:605`, `:617-634`) from `emp.allowance`, where `emp`
comes from `resolveEmployeeForActor` (`:745`) — so extending `withUatManager`
into **`withUatOverrides`** (`employee-lookup.ts:583-590`), which resolves the
environment once and replaces the manager *and* the allowance, fixes every new
save. Its allowance is `rateForDay(today, uatLog)`.

It does **not** fix a draft saved before the rate existed: the submit's
`AccTravelBooking` UPDATE (`:1305-1312`) sets `IsContinuation`, `PerDiemDays` and
`PerDiemTotal` and never re-stamps the snapshot, so the detail page
(`TravelBookingDetail.tsx:1011`) would print a real HR figure beside a
UAT-priced total.

**Decision: re-stamp `AllowanceSnapshot` in that same UPDATE.** Submit is the
moment the figure is fixed, so the snapshot should agree with it. **This changes
production behaviour too** — a production draft saved before an HR rate change
and submitted after it currently keeps the stale figure and will stop doing so.
That is a correction, taken deliberately, not a UAT side effect.

### 3.4 The history modal

`AllowanceHistoryModal` renders whatever
`/api/request/travel-booking/allowance-log` returns, so §3.1 already changes it.
Its footer (`AllowanceHistoryModal.tsx:102`) reads
`ข้อมูลจากระบบ HR — แก้ไขได้ที่ระบบต้นทางเท่านั้น`, which becomes untrue. The
route gains `allowanceSource: "hr" | "uat"` and the modal reads its footer off
it:

| `allowanceSource` | Footer |
|---|---|
| `"hr"` | `ข้อมูลจากระบบ HR — แก้ไขได้ที่ระบบต้นทางเท่านั้น` (unchanged) |
| `"uat"` | `เรตทดสอบสำหรับ UAT — ตั้งค่าที่ ตั้งค่า → UAT Users` |

---

## 4. When the override applies

The rule is **"is the record being priced a UAT record"**, expressed with what
each consumer can actually know.

| Consumer | Signal |
|---|---|
| `perdiem-recompute.ts` | `isUatId(requestId)` |
| `report-service.ts` | `isUatId(x.Id)` — **`AccRequest.Id`**, selected at `report-service.ts:165` |
| `request-service.ts` (submit) | `resolveFormEnvironment() === "UAT"` |
| `allowance-log` route | `resolveFormEnvironment() === "UAT"` |
| `withUatOverrides` | `resolveFormEnvironment() === "UAT"` (already there) |

**The report has no `RequestId` column.** `BASE_CTE` selects `r.Id` and the
mapper reads `x.Id`; `raw` is `Record<string, unknown>[]` (`:280`), so
`x.RequestId` compiles, arrives `undefined`, and `isUatId` answers false
(`uat-identity.ts:19-21`) — the override would be dropped for every row of every
UAT report with no error and no typecheck failure. The first draft of this spec
wrote exactly that.

**Why the recompute cannot use `resolveFormEnvironment()`.** Not because it does
I/O — it does not; `resolveCurrentFormAccess` short-circuits to Production
without touching the cookie, the header or the database when `resolveFormClass()`
is null, and says so in its own comment (`index.ts:130-137`). The reason is that
**Production is the wrong answer**: `recomputeGroupPerDiem` runs inside somebody
else's transaction, and a silently-Production verdict re-prices a UAT trip at
real HR while writing `AccTravelBooking.PerDiemTotal` **and**
`AccRequest.TotalAmount` in one batch (`perdiem-recompute.ts:147-158`), with an
activity row recording that the figure moved and not why.

`isUatId` is pure, transaction-local, needs no headers, and is exact: migration
061 reseeds `AccRequest` to 900000 and 064 adds the `CHECK`, so every id in a UAT
group is ≥ 900000.

Both spellings go through one tiny helper so the rule is written once and the two
are visibly one rule.

**The estimate and the submit can already disagree** about the environment —
`/api/request/travel-booking/allowance-log?requesterStaffId=` carries no numeric
path segment, so it is decided by cookie + AP-17's switches, while the submit
carries an id and is decided by `boundIdEnvironment`. That predates this feature
and bites only foreign trips today; the override extends it to Thai ones.
**Out of scope**, and it is why the estimate is a suggestion and the submit is
what is stored.

---

## 5. Two silent regressions this must not introduce

### 5.1 `perdiem-recompute.ts` has no `StaffId`

Its SELECT (`:53-57`) reads `r.Status, r.EmployeeId, r.CountryCode` and no
StaffId. `AccRequest.StaffId INT NULL` is created at
`059_portal_form_baseline.sql:231`. Without adding it the value arrives
`undefined`, the lookup finds nothing, and **every UAT trip in the group is
re-priced at real HR inside the cancelling transaction** — typecheck-clean, no
error, nothing on screen contradicting it.

This is the identical hazard `r.CountryCode` carries, and that column has a
seven-line comment and two guard-test arms. `r.StaffId` gets both.

### 5.2 The recompute's database-free unit test

`perdiem-recompute.test.ts:4-21` records that it runs with no database because no
fixture row carries an `EmployeeId`, so `getAllowanceLog` — its only real network
call — is never reached. Its fixture RequestIds are 1, 2, 3 and 9.

The `Fast_Core` read must therefore be conditional **in the same way `loadRates`
is** (`:78-90`, whose comment says outright "That condition is not an
optimisation"): reached only when `isUatId(requestId)`, which no fixture
satisfies.

**Do not add a fixture at a UAT id to prove the branch.** That test stubs only
`AccTx` (`:44-65`) and dynamically imports the real module, so such a fixture
would attempt a live `getCorePool()` connect and destroy the very property this
section protects. The branch is asserted by §8's guard arm instead.

---

## 6. Modules

Split the way `perdiem-country.ts` / `perdiem-source.ts` are, so the rules are
unit-testable with no database and no environment:

| File | Contents |
|---|---|
| `src/lib/uat-tester/per-diem-rule.ts` | **pure, imports nothing.** `uatPerDiemLogFrom(rows): AllowanceLogEntry[] \| null`, and the input refusals |
| `src/lib/uat-tester/per-diem.ts` | the `getCorePool()` half: list all, batched list by StaffIds, upsert (`MERGE` on the unique key), soft delete, `UatPerDiemRateError` |

**`null`, never `[]`** — the rule `perDiemCountryLog` states in its own header:
`[]` handed to `rateForDay` pays 0 every day, and "no rate configured" must not
be expressible as "this day is worth nothing".

**`null` does not cover every zero, and that is accepted.** A tester whose only
rows are effective *after* the trip gets a non-null log that `rateForDay` still
prices at 0 for the earlier days. This is exactly how `EmployeeAllowanceLog`
already behaves, so it is not a new class of failure, and it is mostly
unreachable: a trip cannot depart before tomorrow (`earliest-travel-date.ts`) and
the panel defaults the effective date to **today**. It is not defended in code,
because a rule refusing a future date would forbid the legitimate act of
scheduling a rate change.

`per-diem.ts` imports only `getCorePool` and `sql`, so it introduces no cycle:
`allowance-log.ts` is reached from inside a `getAccPool()` transaction, and
`getFormPool` dynamically imports the environment resolver (`mssql.ts:105`)
precisely to keep `getFormPool → auth → jwt → getFormPool` broken. **Do not
static-import `@/lib/form-environment` — or `@/lib/uat-tester/guards`, which
re-exports it — into `allowance-log.ts`.** The environment arrives as a
parameter, which is also §4's rule.

---

## 7. Settings UI and API

### 7.1 The page

`src/features/settings/UatUserSettings.tsx` gains a **เบี้ยเลี้ยง UAT** column
showing the rate in force today (or `—`) and a control opening a `SidePanel` with
that tester's dated rates: add one (วันที่เริ่มมีผล · จำนวนเงินต่อวัน ·
หมายเหตุ), or switch an existing one off.

**The amount opens blank; the date defaults to today.** The blank amount is the
hardest-won rule in `PerDiemCountrySettings` (`:147-165`) and it transfers —
pre-filling makes one click an in-place rewrite of a rate trips were already
priced at, where the intent is almost always to add a new dated row. Defaulting
the *date* to today does not carry that risk (the save key is
`(StaffId, EffectiveDate)`, and today is rarely an existing row) and it is what
makes §6's "mostly unreachable" true.

The panel today has **zero `<input>` elements**, and `/api/settings/uat-users`
has never had to defend a typed number — its only numeric check is
`Number.isInteger(id) && id > 0` (`route.ts:224`, `:236`) on ids the server
itself issued. A typed amount is a new class of input for this page.

### 7.2 The route

`/api/settings/uat-users/per-diem` — `GET` every row (all testers, inactive rates
included, for the grid), `POST` upsert, `PATCH` soft delete. Shaped on
`settings/per-diem/route.ts`, including its `→ 400` arm so a Thai refusal reaches
the admin rather than `CK_UatTesterPerDiem_Amount`.

Refusals, reusing `perdiem-source.ts:106-111`'s wording so the two per-diem
editors do not speak differently:

| Condition | Message |
|---|---|
| amount missing, non-finite, ≤ 0 | `จำนวนเงินต่อวันต้องมากกว่า 0` |
| date missing or not `YYYY-MM-DD` | `กรุณาเลือกวันที่เริ่มมีผล` |
| StaffId not an active tester | `ไม่พบผู้ทดสอบรายนี้` |

**`requireRole(["System Admin"])` on every method** — the gate the UAT Users page
already carries (`uat-users/route.ts:63`, `:126`), not the per-diem country
route's IT-Admin-and-above. Validation happens at the route, before `Number()`,
not only in the component.

---

## 8. Testing

- **`per-diem-rule.test.ts`** — `null` not `[]` for a tester with no rows;
  inactive rows excluded; sorted by effective date; every refusal (0, negative,
  non-finite, `""`, `" "`, `null`, malformed date).
- **The environment helper**, at both spellings and both answers.
- **`perdiem-source-guard.test.ts`.** Its existing arms constrain this work in two
  ways the first draft missed, so state the edits exactly:
  - Test 1 (`:63-79`) skips `allowance-log.ts` by name (`:68`) and asserts
    `importers.length > 0` (`:72`) **before** the `deepEqual`. So it cannot be
    "shrunk to `allowance-log.ts` alone". **Invert it**: no non-test file under
    `src/` other than `allowance-log.ts` may name `getAllowanceLog`, and
    `ALLOWED_ALLOWANCE_IMPORTERS` goes away with the `> 0` assert. This is only
    achievable because §3.1 deletes `resolvePerDiemLog`.
  - Test 2's `PRICERS` (`:86-101`) has **four** members and the fourth is
    `features/travel-booking/hooks/useTravelBookingForm.ts`, a `"use client"`
    file that must never call a `getCorePool()` reader. The new arm asserting
    `getPerDiemEmployeeLog(` therefore runs over the **three server pricers plus
    `app/api/request/travel-booking/allowance-log/route.ts`** — a separate list,
    not `PRICERS`. Match the call, `getPerDiemEmployeeLog(`, never a bare
    identifier a comment would satisfy.
  - A new arm for `r.StaffId` in `perdiem-recompute.ts`'s SELECT, beside the two
    existing `r.CountryCode` arms (`:110-127`).
  - A new arm that `useTravelBookingForm.ts` does **not** name
    `getPerDiemEmployeeLog` or `getCorePool` — the client half of §3.2, whose
    failure mode is a plausible-looking import that breaks the build.
- **`perdiem-recompute.test.ts`** keeps running with no database; its fixtures
  stay below 900000 and no UAT fixture is added (§5.2).

---

## 9. Migration

| # | Target | Contents |
|---|---|---|
| 138 | `Fast_Core` | create `dbo.UatTesterPerDiem` |

138 is free — 137 is the highest on disk. Eleven numbers already exist twice, so
confirm with `ls migrations/` rather than counting.

`Fast_Core` only. **Not** `Rocks_Portal_Form`, **not** its UAT twin: the table
must be readable whichever form database answers, which is why `UatTester` lives
there. Idempotent (`IF OBJECT_ID(...) IS NULL`), applied with
`npm run apply-sql -- --db Fast_Core --file migrations/138_core_uat_tester_per_diem.sql`.

**Apply the migration before the code, and let a missing table throw.** The
pricing read is reached only in UAT (§4), so the blast radius of an unapplied
migration is "UAT AP-17 errors" — loud, contained, and fixed by applying it.
Degrading it to "no override" would do the opposite: price a tester at real HR
and write that to `AccRequest.TotalAmount` with no error, which is the failure
§5.1 exists to prevent. The `loadReimburseTabsByAccessIds` precedent degrades on
a **visibility** axis, where wrong-and-quiet costs an admin a tab; this is a
money axis. The settings route's grid read may degrade, since nothing is priced
from it.

---

## 10. Documentation to correct

CLAUDE.md's AP-17 section says per diem falls back to
`Rocks_Portal_HR.EmployeeAllowanceLog`, "the per-employee allowance AP-17 has
always used". That stays true in production and gains a UAT arm. The four-way
`perDiemLogFor` note and `perdiem-source-guard.test.ts`'s description need the
new input named; the Parallel-UAT section needs `UatTesterPerDiem` listed beside
`FormEnvironment` and `UatTester` as a thing that must stay in `Fast_Core`; and
§3.3's re-stamp is a production behaviour change that belongs in the AP-17
section.

---

## 11. Out of scope

- **AP-1 and AP-4.** Neither reads an HR allowance.
- **The estimate/submit environment asymmetry** (§4).
- **A UAT twin of HR.** The general fix, and a far larger one.
- **Backfilling.** Nothing exists to backfill — no tester has a rate until an
  admin sets one.

**A trip already filed is *not* frozen, and this is the honest version of a claim
the first draft got wrong.** Setting a rate today does change figures on UAT
trips already submitted, by two live paths: `recomputeGroupPerDiem` re-prices any
trip inside `perDiemWritable`'s window from a freshly loaded log, and the report
re-derives its rate column from the current log (`report-service.ts:304-309`)
while printing the stored `perDiemTotal` beside it. In UAT that is acceptable —
nobody is paid from these figures — but it must not be described as frozen,
because a reader would then trust the report's two columns to agree.

---

## 12. What the first draft of this spec got wrong

Kept because the first two are mistakes a reader would make again from the same
evidence.

1. **It put the display override on `resolveEmployeeForActor`.** Three of the
   four surfaces it listed are served by `/api/me/employee`, which calls
   `findActiveEmployeeByEmail` and is unclassified in `ROUTE_RULES` — so the
   obvious remedy of "override it there instead" resolves Production for
   everyone and silently does nothing. §3.2 is the correction.
2. **It used `isUatId(row.RequestId)` for the report**, a column that does not
   exist; `x.RequestId` compiles and arrives `undefined`. §4 is the correction.
3. It claimed `resolveFormEnvironment()` would break the recompute's
   database-free test. It would not — it does no I/O without request scope. The
   real reason is that it answers Production wrongly.
4. It proposed guard-test edits that cannot pass (§8), and cited
   `059_portal_form_baseline.sql:42` — which is `AccApprover` — for
   `AccRequest.StaffId`, at `:231`.
5. **§3.2's table listed `allowanceRate` as a display surface.** It is passed
   into `TravelBookingTab` as a prop — declared at `:78`, destructured at
   `:98` — but the component never renders it anywhere else in the file. The
   `฿X/วัน` chip on `TravelBookingForm.tsx` is the surface that actually
   changed; `allowanceRate` carries the same `displayRate` value but reaches
   no screen. (Since deleted — the prop, its destructuring and the pass at
   `TravelBookingForm.tsx:431` are gone; nothing was ever wired to it.)
6. **§3.2 claimed this spec "also fixes the on-behalf chip", which shows the
   actor's rate today while the priced log has always been the requester's.**
   There is no on-behalf chip. `TravelBookingForm.tsx` renders the `฿X/วัน`
   chip and the allowance-history button only in the
   `requesterStaffId == null` branch — filing for yourself — and the
   on-behalf branch (`requesterStaffId` truthy) has never rendered a rate of
   any kind, actor's or requester's, for this change to have fixed. The
   mistake reads as item 1's shape: a plausible-sounding claim about a screen
   the drafting pass never actually opened. What §3.2 should have said, and
   now does, is narrower — `flatRateLog` prices its in-flight stand-in from
   the **actor's** `employee.allowance` regardless of who the trip is filed
   for, which is a real property but has nothing to do with on-behalf; it
   matters here only because in UAT that actor figure is the tester's own real
   HR compensation, which is what the withholding in §3.2's corrected version
   closes.
