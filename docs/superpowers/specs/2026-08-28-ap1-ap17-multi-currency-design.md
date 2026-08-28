# AP-1 / AP-17 — per-brand currency, and claiming in it

**Date:** 2026-08-28
**Status:** design agreed, not built — all three open decisions answered (§9)
**Survey:** 9 agents, 285 cited facts, 65 risks. Every live-database claim below
was re-measured against the real databases afterwards, because the survey
agents' own probes all failed on `Login failed for user 'saai'`.

A company brand gets a country and a currency. A claim against that brand may
be entered in that currency, converted to Thai baht at a recorded rate, and
paid in baht. A brand with nothing configured behaves exactly as today: baht,
no dropdown, nothing new on screen.

---

## 1. What already exists, and is not being rebuilt

AP-2 (`เบิกเงินทดรองจ่าย`) has done this since migration 073, and the user asked
that its approach be reused rather than a second one invented.

| Piece | Where | Reuse |
|---|---|---|
| FX lookup | `src/lib/adv/bot-fx.ts` | **As is.** Bank of Thailand when `BOT_API_CLIENT_ID` is set, else keyless ECB via frankfurter. |
| Currency picker | `src/features/advance/components/CurrencyCombobox.tsx` | **As is** — already a standalone component. |
| Storage shape | `AccAdvance.Currency` / `ExchangeRate` / `BaseAmount` | **Shape copied**, not the table. |
| Brand registry | `src/lib/brand-registry.ts` | Extended; already reads `getProductionFormPool()`. |

### Three things the survey corrected about that reuse

These were stated wrongly earlier in the conversation and are corrected here so
the plan is not written from the wrong premise.

- **AP-2 does not snapshot the rate at submit.** `persistAdvance` is the only
  writer of the three columns and its sole call site is inside `saveDraft`
  (`advance-request-service.ts:438`, within `:363-449`). `submitRequest`
  (`:481`) re-reads the row and recomputes `computeBaseAmount` from the
  **already stored** rate (`:507`); it never calls `fetchFxRate`. Submit-time
  capture is **new work**, not reuse.
- **The stored rate comes from the browser.** AP-2 fetches it client-side and
  posts it; nothing server-side verifies it. Copying that would let a requester
  post any rate they liked. §5 does not copy it.
- **`bot-fx.ts` has no timeout.** A hanging provider hangs the request.

---

## 2. Where the currency lives

**`BrandSetting`** (migration 122), one row per brand, gains the columns. This
is the user's choice — per brand, shared by both forms — taken over per
`(form, brand)`.

```
ALTER TABLE dbo.BrandSetting ADD
  CountryCode   CHAR(2)      NULL,   -- ISO-3166-1 alpha-2, e.g. 'MY'
  CurrencyCode  CHAR(3)      NULL,   -- ISO-4217, e.g. 'MYR'
  CurrencyEnabled BIT NOT NULL CONSTRAINT DF_BrandSetting_CurrencyEnabled DEFAULT (0);
```

**Why not `AccFormBrand`.** It is one of the 25 dual-written tables in
`MASTER_TABLES`, so a column there must be added to both form databases
symmetrically or `npm run check:alignment` reds on every row. `BrandSetting` is
this app's own, production-only, and not dual-written.

**Why not `Rocks_Codex.dbo.Brand`.** Measured: it has `Id, Name, Code,
Description, Logo, IsActive, CreatedAt, UpdatedAt, BcApiUrl` and no country or
currency. It is shared with the Rocks Fast and ACC Portal siblings; widening it
is a change to two other applications' schema.

### The pool rule, which is the one that bites

**`BrandSetting` does not exist in `Rocks_Portal_Form_UAT`.** Measured
2026-08-28: `USER_TABLE` with 6 rows in production, `ABSENT` in UAT.

> Any read of a brand's currency **must** go through `brand-registry.ts`, which
> opens `getProductionFormPool()` (`brand-registry.ts:73`). A reader written
> with `getAccPool()` or `getFormPool()` throws `Invalid object name
> 'BrandSetting'` for **every UAT tester**, on the amount-entry path of both
> forms. This is the same hazard CLAUDE.md records for `DepartmentErpMap`.

The existing code is already correct. The rule is written down because the next
person to add a currency read is the one who will get it wrong.

---

## 3. `CurrencyEnabled` is a third flag, and the existing one does less than it looks

`BrandSetting.IsEnabled` already exists and **does not control the claim forms**.
Measured:

- `getAllowedBrands(formCode)` (`brand-options.ts:31`) feeds AP-1's and AP-17's
  brand pickers. It reads `AccFormBrand` and enriches display from
  `listAllBrands()`, which maps the registry **without filtering `isEnabled`**.
- `listSelectableBrands()` (`brand-registry.ts:112`) is the only `isEnabled`
  filter, and its only caller is `/api/brands` → **`BrandGate`**, the pick-a-company
  modal.

**A live consequence, unrelated to currency and worth fixing separately:** all
six `BrandSetting` rows are `IsEnabled = 0` (KSI, PAL, PCMY, PCTH, SAN, UNO,
measured 2026-08-28). The master holds 7 active codes. So **`BrandGate` currently
offers `ROCKS` alone.** Existing users are unaffected only because their brand
cookie is already set.

`CurrencyEnabled` is therefore its own column rather than a reuse of
`IsEnabled`: they answer different questions ("may a user pick this company" vs
"may a claim against it be entered in a foreign currency"), and conflating them
would make turning on a currency also change who can see the brand.

---

## 4. One currency per request, not per line

`AccRequest.TotalAmount` **is always Thai baht**, whatever the claim was entered
in. That single sentence is what keeps every downstream consumer correct, and
it is why the currency sits on the request rather than the line.

### The claim

AP-1 gains three columns on `AccTravelExpense`; AP-17 on `AccTravelBooking`:

```
Currency      CHAR(3)        NULL   -- NULL and 'THB' both mean baht
ExchangeRate  DECIMAL(18,6)  NULL   -- THB per 1 unit; NULL for baht
BaseAmount    DECIMAL(18,2)  NULL   -- the foreign figure, before conversion
```

`AccRequest.TotalAmount` keeps its meaning and its type, and every existing
reader keeps working untouched.

### Why per-line was rejected

Per-line was recommended earlier in the conversation and is withdrawn. Three
reasons, in order of weight:

1. **Four separate implementations sum AP-1 money**, not one:
   `calc.ts:computeTotalAmount`, the T-SQL `TRAVEL_DAYS_CSV_SELECT`
   (`report-service.ts:117-188`), the ERP journal builder, and the approval
   queue's per-vehicle cell (`ApprovalsQueue.tsx:75,142`). Per-line means all
   four must learn currency. Per-request means none of them do — they keep
   summing a baht column.
2. **The T-SQL one is not just a report.** It is interpolated into the ERP prep
   query (`erp-prep-service.ts:350`, parsed at `:171`) and is the figure an
   approver reads **before pressing Send**. A wrong number there is a wrong
   posting nobody caught.
3. **AP-2 is per-request** and this is meant to match it.

A trip whose receipts genuinely span two currencies must be filed as two claims.
That is a real limitation and is stated in §8.

---

## 5. Capturing the rate

**The rate is fetched server-side and written by the server.** The client never
posts a rate. This deliberately does *not* copy AP-2, whose stored rate is
whatever the browser sent.

**Captured on save, refreshed on submit.** Saving a draft records the rate of
that day so the form can show a running baht figure. Submit re-fetches and
overwrites it, because the rate that matters is the one on the day the claim
was actually made, and a draft may sit for weeks.

**A failed fetch at submit refuses the submit** rather than posting a stale or
absent rate. This is the one place the feature fails closed, and it is narrow:
a baht claim never fetches anything, so an FX outage cannot stop ordinary work.
`bot-fx.ts` gains a timeout as part of this.

**Accounting may override the rate** at the ACCOUNT step, as AP-2 allows, with
the override recorded in `AccActivityLog`. This is **required in the first
release, not deferred**: §9.1 settles that no Bank of Thailand key will be
provisioned, so every rate here is an ECB mid-market reference rate rather than
the rate a bank settles at. The override is the only place that difference can
be corrected.

---

## 6. The mileage leg

**A foreign-currency claim may not use a rate-based vehicle.** Manual-entry
vehicles only.

`AccVehicle.RatePerKm` carries a database CHECK — `([IsManualEntry]=(1) OR
[RatePerKm]>=(1))`, verified in the live database and in `013:220` / `059:700` —
so a strong-currency rate like `0.35 EUR/km` is refused by the schema, not by
the form. The rate is also a single dual-written row labelled `บาท/กม.`, shared
by every brand.

Rather than widen the constraint and add a per-brand rate, the rule is that the
mileage allowance is a Thai company-car allowance and does not apply abroad. A
foreign trip's transport is a receipt, and receipts are manual entry. This costs
nothing today and can be revisited without a migration.

---

## 7. AP-17 per diem stays baht, always

`Rocks_Portal_HR.dbo.EmployeeAllowanceLog` has columns `Id, EmployeeId,
EffectiveDate, Amount, Note, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy` —
**no currency column**, measured 2026-08-28. Making per diem foreign means
changing another application's schema.

So an AP-17 request may carry a foreign **booking cost** while its per diem is
baht. `AccRequest.TotalAmount` is the baht sum of both, which is consistent with
§4 and needs no special case.

---

## 8. What the AI reads must change — and it is wrong today

**Both vision routes assert Thai baht in their prompt and their schema.** So a
foreign receipt attached today already produces a bare number that AP-1 and
AP-17 store and total as baht. This is a live defect, not a future one.

- `POST /api/request/accounting/receipt-amount` and
  `POST /api/request/travel-booking/booking-fields` return a currency code
  alongside the figure.
- **The model is never trusted to pick.** The answer is accepted only if it is
  the brand's configured currency or `THB`. Anything else — a third currency, an
  unreadable one, no answer — leaves the field blank and **the user chooses**.
  This is the rule `sanitizeReceiptAmount` already applies to the amount: a blank
  editable field beats a wrong figure on a document about to be submitted.
- **The baht ceilings must become currency-aware.** `MAX_RECEIPT_AMOUNT`
  (1,000,000฿) and `MAX_BOOKING_AMOUNT` (10,000,000฿) are baht bounds; applied
  to a foreign figure they silently null legitimate amounts. They are applied to
  the **converted** figure.
- Rate-limit buckets stay per-purpose, unchanged.

---

## 9. Decisions taken (2026-08-28)

All three were put to the user and answered. Two overrule the recommendation
that was made here; both are recorded with what they cost.

### 9.1 No Bank of Thailand key — every rate is ECB mid-market

`BOT_API_CLIENT_ID` will **not** be provisioned. `bot-fx.ts` therefore always
takes its keyless fallback, and every rate this feature records is
**frankfurter's ECB mid-market reference rate**.

Three things follow, and all three are requirements, not notes:

- **No screen may caption a rate as a Bank of Thailand rate.** The copy says it
  is a reference rate (`อัตราอ้างอิง`) and that accounting may adjust it.
- **The accounting override in §5 becomes load-bearing rather than a
  convenience.** A mid-market rate is not the rate a bank settles at, so the
  figure the company actually pays will differ. The override is the only place
  that difference can be corrected, and it must be present from the first
  release rather than deferred.
- **The BOT branch in `bot-fx.ts` stays.** It is existing, working code and
  deleting it would have to be undone the day a key is bought. It is simply
  never taken.

### 9.2 The six disabled brands stay disabled

`BrandSetting` keeps all six rows at `IsEnabled = 0`. The consequence recorded
in §3 stands and is accepted: **`BrandGate` offers `ROCKS` alone** to anyone
whose brand cookie is not already set. This is unrelated to currency and is not
changed by this work.

### 9.3 The currency is edited wherever แบรนด์ที่เบิกได้ is edited

Not System Admin only. The editor sits in **each form's own brand tab**, behind
the same gate that already guards that tab — `requireSettingsTab("brands")` for
AP-1, `requireBookingSettingsTab("brands")` for AP-17 — so anyone who may grant
a brand to a form may also set its currency.

**The asymmetry this creates must be visible on screen, because it cannot be
removed.** The value is stored **once per brand** (§2, the user's choice) while
the permission to change it is **per form**. So an AP-17 booking approver
holding the `brands` grant can change a currency that decides how an **AP-1**
travel claim converts, on a roster AP-1's admins do not control.

Required, therefore:

- Both brand tabs carry a line saying the value is shared with the other form
  and that changing it here changes it there.
- Every write records who changed it, from what to what, in `AccActivityLog` —
  the only way an unexpected change can be traced back across two rosters.
- The rule is **not** representable as a constraint and must not be presented as
  one. A reviewer who "tightens" the gate to System Admin is undoing a decision
  the user took knowingly, not fixing a hole.

---

## 10. Migrations

**124** (`BrandSetting`, production only — no UAT twin, not dual-written, not in
`MASTER_TABLES`): the three columns in §2.

**125** (BOTH form databases, symmetrically): `Currency` / `ExchangeRate` /
`BaseAmount` on `AccTravelExpense` and on `AccTravelBooking`. Both are
transactional, so neither enters `MASTER_TABLES` and `check:alignment` is
unaffected — but both databases need the columns, because SQL Server binds
object names at compile time and a query naming `Currency` fails outright
against whichever side is missing it.

Numbering: highest committed on master is **123**. (124 was briefly occupied by
an untracked file, `124_acc_booking_approver_areas.sql`, accidentally committed
in `035f116` and removed in `2fb19f0`; the number is free.)

---

## 11. Testing

Pure and unit-tested, in the shape this repo already uses:

- **conversion**: baht in and baht out for a THB claim; a foreign figure times a
  rate; a null rate refused; rounding to satang at the boundary.
- **the admission rule for the model's currency**: brand currency accepted, THB
  accepted, a third currency refused, no answer refused — the table that decides
  whether the user must pick.
- **the ceilings applied to the converted figure**, both sides of each bound.
- **`eligibleForForeignCurrency(brand)`**: a brand with no row, a row with no
  currency, a row with `CurrencyEnabled = 0`, and a configured row — the four
  states that decide whether the dropdown renders at all.
- **the rate-refresh rule**: what submit does when the fetch fails, and that a
  THB claim never fetches.

A source-reading guard, in the shape of `blocked-dates-parity.test.ts`, asserting
that no currency read is written against `getAccPool()` / `getFormPool()` — §2's
rule is the one that cannot be caught by types and would fail only for testers.
