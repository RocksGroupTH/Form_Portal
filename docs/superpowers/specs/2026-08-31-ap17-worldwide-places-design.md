# AP-17 — worldwide place search and foreign destinations

**Date:** 2026-08-31
**Status:** design agreed, not built
**Survey:** six agents. Every `file:line` below was re-read in this session;
where the survey's citation had drifted it is corrected silently, and the three
places where it was *wrong* rather than merely stale are named in §Hazards.

Two halves that ship together because either alone leaves AP-17 unable to file a
foreign trip: **2a** parameterises the ORS country boundary, **2b** gives
`TravelProvince` a country and an admin screen that can add a row to it.

---

## Why (the problem, in the user's terms)

AP-17 cannot be used for a trip abroad. Not "is awkward for" — cannot be
submitted at all, and for two unrelated reasons:

1. **The place fields only find Thai places.** ข้อ9 สถานที่ไปปฏิบัติงาน and ข้อ13
   จุดขึ้นรถ/ขึ้นเครื่อง both go through `OrsPlaceField`, which calls
   `/api/ors/geocode` (`OrsPlaceField.tsx:65`), which calls `orsSearch` — and
   that function hard-codes `&boundary.country=TH` (`ors.ts:118`), as does
   `orsGeocode` (`ors.ts:68`). Typing "Narita" returns nothing. The requester's
   only way through is the manual "ใช้ข้อความนี้" escape hatch
   (`OrsPlaceField.tsx:205-214`), which stores the typed string and gives the
   booking desk no coordinates and no verified name.

2. **ข้อ8 จังหวัด is required and only Thai provinces exist.** Submit refuses
   without it — `กรุณาเลือกจังหวัด` (`request-service.ts:1009`) — and the client
   refuses first (`useTravelBookingForm.ts:274`). The picker is fed by
   `listProvinces()`, which reads `Rocks_Portal_Form.dbo.TravelProvince`
   (`province-service.ts:12-17`): 77 Thai provinces, seeded once by migration
   049 and **never written since, by any of the three applications**. There is
   no row for Kuala Lumpur and no screen anywhere that could add one.

So the first half opens the search, and the second gives the destination
somewhere to be recorded.

---

## Decisions (each with its reason and what it costs if wrong)

### 2a — the ORS boundary

**D1. The country is a parameter on `orsGeocode` / `orsSearch`, defaulting to
`"TH"`, so AP-1 is byte-identical.**
`ors.ts` is shared. `LeafletRoutePicker.tsx:67` is AP-1's origin/destination
search, and the two points it produces become a driving distance
(`/api/ors/directions` → `orsRoute`) that a fuel claim is **paid** on. It passes
no country and must go on passing none.
*Cost if wrong:* an AP-1 requester searching "Chiang Mai" is offered Chiang Mai,
New Zealand, and the kilometre figure a reimbursement is computed from is
measured between the wrong two points. Nothing in the form would flag it.

**D2. `"*"` means worldwide. Anything the route cannot parse falls back to
`"TH"`, never to worldwide.**
Fail-safe direction. A two-letter code is a country; the literal `"*"` is the
only way to ask for no boundary; an absent, empty, three-letter or numeric value
is `TH`. This is why the route never has to tell "omitted" apart from "empty
string", a distinction that exists in `URLSearchParams` (`null` vs `""`) and is
exactly the kind of thing a later refactor collapses.
*Cost if wrong (unknown → worldwide):* one malformed query string silently
globalises AP-1's picker, and the failure surfaces as a wrong distance rather
than an error.

**D3. The Bangkok focus point stays on every query, bounded or not.**
`FOCUS` (`ors.ts:5`) is a Pelias `focus.point`, a **soft distance bias, not a
filter** — it re-ranks, it never excludes. Keeping it unconditionally is what
preserves the common case once AP-17's fields go worldwide: a Thai query already
narrows itself (Thai script matches Thai places), and the focus point handles
what is left. Dropping it when unbounded would have made every AP-17 search
worse to make a rare one marginally better.
*Cost if wrong:* a worldwide query ranks a near Thai match above the intended
foreign place. The requester scrolls, types more, or commits the raw text
(`OrsPlaceField.tsx:205-214`). If it proves noisy in practice the fix is one
line at the call site — pass `"TH"` until a country is chosen — because the
parameter already exists. **This is a judgement, not a measurement.**

**D4. The scope vocabulary lives in a new import-free module,
`src/lib/ors-scope.ts`.**
`ors.ts` imports `resolveApiKey` → `db/mssql` → `next/headers`, so a client
component cannot import from it. `OrsPlaceField` is a client component and needs
the same constant the server parses with. Precedent and the reason it exists:
`src/lib/api-keys/codes.ts:1-8`, where taking a shared constant off a
server module dragged the pool chain into the browser bundle and **broke the
build with no type error**.
*Cost if wrong:* two copies of `"*"`, and the day one of them changes, the
client asks for worldwide and the server hears "unparseable" and answers
Thailand — silently, because D2 makes that the safe fallback.

**D5. AP-17's place fields go worldwide (`"*"`) unconditionally; AP-1's do not
change.**
Before spec S3 lands there is no country on an AP-17 request to scope by (§Out
of scope). After it lands, the tab passes `tab.countryCode ?? "*"` and the
search narrows — an improvement to one argument, not a rewrite.

### 2b — foreign cities in `TravelProvince` (the user's decision)

**D6. Foreign cities are rows in the existing `TravelProvince`, which gains
`CountryCode`. The id model is kept.** *(User decision — settled.)*
What it buys, concretely: `whereIn("ProvinceId", "province", f.provinceIds,
sql.Int)` (`report-service.ts:237`) keeps working with no change; the two report
routes keep their `?provinceId=` (`report/route.ts:29`,
`report/export/route.ts:33`); `AccTravelBooking.ProvinceName` (`048:27`) stays
the snapshot that every display, email, queue row and Excel cell already reads;
and every existing row keeps meaning what it meant.
*Cost:* the table has had no writer in any of the three applications since 049,
so a CRUD screen has to be built, and the check script that asserts nothing
writes it has to be edited (D9).

**D7. `CountryCode CHAR(2) NOT NULL`, added `WITH DEFAULT ('TH')` and the
default then dropped in the next batch.**
- `CHAR(2)` to match `AccRequest.CountryCode` (`129:74-75`) and the
  `COUNTRIES` codes.
- `NOT NULL` because every place is in a country, and because a NULL row would
  be dropped silently by both our filter and the sibling's remedy (D10) rather
  than showing up as wrong.
- `DEFAULT ('TH')` on the add, because that is what backfills all 77 rows in one
  statement.
- **Dropped immediately afterwards**, because with the default in place a writer
  that forgets the column files a foreign city as a Thai province — in *another
  application's* dropdown. Without it, that writer fails loudly. There is
  exactly one writer and it always names the column; the drop is what keeps that
  true for the second one.

**D8. No new index, and `UQ_TravelProvince_NameTh` is not widened to
`(CountryCode, NameTh)`.**
`scripts/checks/verify-travel-province-move.ts:93-96` pins the index set by
exact name and key-column order, and compares the names as one joined string at
`:154-158`. Any added index, and any rebuild of that unique constraint, turns
`npm run check:travel-province-home` red — and the gain would be nil on 77 rows
going to perhaps 150, filtered in memory anyway (`LocalSearchSelect.tsx:42-47`).
*Cost:* two places in different countries cannot share a `NameTh`. The admin
screen must surface that as a duplicate-name message naming the existing row,
not as a 500.

**D9. The province editor is `requireRole(["IT Admin", "System Admin"])`, not a
grantable settings tab.**
The rule that decides it, and it fits all three cases already in the tree:
**tab-gated when the rows are this app's own; role-gated when a sibling
application reads them.**

| Route | Rows | Gate |
|---|---|---|
| `settings/brands/currency` | `BrandCurrency` — Form Portal's own | `requireBookingSettingsTab("brands")` |
| `settings/departments/map` | `DepartmentErpMap` — read by Rocks Fast and ACC Portal | `requireRole` (CLAUDE.md, สิทธิ์เข้าถึง) |
| `settings/approvers` | hands out the grants | `requireRole` |

`TravelProvince` is read by Rocks Fast, so: `requireRole`.
*Cost:* an AP-17 booking approver holding a settings grant cannot add a city and
must ask an admin. Accepted — every row they would add appears in another
application's form the moment it commits.

**D10. Migration 132 adds the column and no rows. The first foreign row is a
separate, gated act.**
See §Deployment. The column is safe to apply today; the first `CountryCode <>
'TH'` row must not exist until Rocks Fast has shipped its filter.

**D11. The admin screen's country field offers `COUNTRIES`
(`country-currency.ts:54-80`) and the route validates with `isKnownCountry`
(`:94-96`).**
Consistency with the country picker S3 will build, which the user has already
chosen to be that same 25-entry list. That list excludes **Cambodia, Laos,
Vietnam and Myanmar** because it is filtered to ECB-quotable currencies
(`:38-42`, reasoning at `:26-32`). A `TravelProvince` row for Phnom Penh would
be a destination no country picker can ever name.
*Cost, stated plainly:* a Cambodian city cannot be added. This is the same trade
the user already took for the country list, landing a second time. If it becomes
intolerable the fix is to widen `COUNTRIES`, **not** to relax this validation —
relaxing it produces province rows that S3's picker cannot express.

**D12. The ORS→province auto-detect becomes a token match, scoped by country
when one is known, and it no longer overwrites a province the requester picked
by hand.** Reasons in §Server.

**D13. The booking currency is not touched. The country does not determine it.**
`booking-currency.ts:12-22` records that AP-17 deliberately derives its currency
from the **brand** and falls back to the brand's currency rather than to baht —
the opposite of AP-1's rule, stated as a decision. There is exactly one writer:
the `UPDATE [dbo].[AccRequest] SET Currency=…` inside `saveBookingDetail`'s
transaction (`admin-service.ts:547-559`), fed by `resolveBookingFx(await
loadBrandCode(pool, requestId), input.currency)` at `:477`, where the brand is
read from the database and not from the client.
*Cost if wrong:* a second writer of one currency is how two copies of it start
to disagree, on the row a payment is made against. Nothing in this spec writes
`AccRequest.Currency`, and nothing in it may.

---

## Schema

### 2a — none.

Both place fields are already free text: `AccTravelWorkLocation.Name
NVARCHAR(300) NOT NULL` (`048:87`) and `AccTravelDepartureLocation.Name
NVARCHAR(300) NOT NULL` (`048:105`). No id, no coordinates, no lookup.
`OrsPlaceField` commits a label string (`OrsPlaceField.tsx:104-109`) and already
accepts free-typed text (`:127`).

### 2b — migration **132**, `Rocks_Portal_Form` **ONLY**.

Not the UAT twin, and 132 must refuse it outright the way 104 does
(`104:138-142`, `104:138-142`). Not dual-written. **Not** added to
`MASTER_TABLES` (`verify-master-alignment.ts:66-92`, still 25). Not in
migrations 061/064.

```sql
-- 132_travel_province_country.sql
-- TARGET: Rocks_Portal_Form ONLY — NEVER Rocks_Portal_Form_UAT.
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/132_travel_province_country.sql
--
-- SINGLE COPY, same as 104. Rocks_Portal_Form_UAT holds no TravelProvince
-- object of any kind and must not gain one: Fast_Data's synonym (migration
-- 105) names exactly one database, so the Rocks Fast sibling could never reach
-- a UAT twin even if one existed.
--
-- THE COLUMN IS SAFE FOR THE SIBLING. ADDING ROWS IS NOT — see the spec's
-- Deployment section. Rocks Fast selects three named columns from these rows
-- with NO country filter; a foreign city appears in ITS province dropdown the
-- moment the row commits.

-- (batch guards: refuse '%[_]UAT'; refuse a database not named
--  'Rocks[_]Portal[_]Form%' or without dbo.AccRequest; skip if the column
--  already exists)

ALTER TABLE [dbo].[TravelProvince]
  ADD [CountryCode] CHAR(2) NOT NULL
      CONSTRAINT [DF_TravelProvince_CountryCode] DEFAULT ('TH');
GO

-- The default existed only to backfill the 77 rows. Dropped so a future writer
-- that forgets the column FAILS rather than quietly filing a foreign city as a
-- Thai province in the sibling's dropdown.
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_TravelProvince_CountryCode')
  ALTER TABLE [dbo].[TravelProvince] DROP CONSTRAINT [DF_TravelProvince_CountryCode];
GO

-- Post-apply: exactly one group, TH, 77.
SELECT CountryCode, COUNT(*) AS [rows] FROM [dbo].[TravelProvince] GROUP BY CountryCode;
```

The two `GO`s are load-bearing. `apply-sql.ts` runs each batch separately, and a
batch that both adds a column and then names it does not compile.

**Why widening the column is safe for the siblings.** Neither `SELECT *`s the
table. Rocks Fast names `Id, NameTh, NameEn`
(`../RocksFast/src/lib/acc/travel-booking/province-service.ts:8-11`) and
`NameTh` (`../RocksFast/src/lib/acc/travel-booking/request-service.ts:391`).
ACC_Portal never mentions the table — a grep of `../ACC_Portal/src` for
`TravelProvince` returns nothing.

**Why it does not join `MASTER_TABLES`.** A dual-written table's ids must be
identical in both form databases, and this table exists in only one of them; the
alignment check has no second side to compare against. Adding it would red
`npm run check:alignment` permanently.

---

## Server (services, functions, signatures, transactions)

### 2a

**New: `src/lib/ors-scope.ts` — imports nothing, and must stay that way.**

```ts
export const ORS_DEFAULT_COUNTRY = "TH";
export const ORS_WORLDWIDE = "*";

/** `"*"` → null (no boundary). Two letters → uppercased. Anything else → "TH". */
export function resolveOrsCountry(raw: string | null | undefined): string | null;
```

Pure, so it is unit-tested with no environment. The fallback-to-`TH` arm is the
whole point (D2) and is what the tests pin.

**`src/lib/ors.ts`:**

```ts
export async function orsGeocode(text: string, country: string | null = ORS_DEFAULT_COUNTRY): Promise<OrsPlace[]>
export async function orsSearch (text: string, country: string | null = ORS_DEFAULT_COUNTRY): Promise<OrsPlace[]>
```

- One private helper builds the two query fragments: `&boundary.country=` +
  `encodeURIComponent(country)` when `country` is non-null, and
  `&focus.point.lat/lon` **always** (D3). Today's `:68-69` and `:118-119` become
  calls to it.
- `encodeURIComponent` even though the value is `^[A-Z]{2}$` after
  `resolveOrsCountry` — `ors.ts` is exported and a second caller will not
  necessarily go through the route.
- **`orsRoute` (`:166`) is untouched**: it posts coordinates and carries no
  boundary today.
- **`testOrsKey` (`:47-57`) is untouched**, `TH` at `:52`. It is a credential
  smoke test; making it worldwide would change what "the key works" means for no
  reason.
- **`PLACE_SYNONYMS` (`:93-97`) applies regardless of country, ungated.** The
  expansion only fires when the query *contains* one of three Thai terms
  (`:108`), so a worldwide Latin query never enters the loop. Gating it on
  country would be a second rule doing what the data already does.

**Callers, all of them, traced:**

| Caller | Passes a country? |
|---|---|
| `src/app/api/ors/geocode/route.ts:12` (`orsGeocode`/`orsSearch`) | **yes** — the new parameter |
| `src/app/api/settings/ors/test/route.ts:10` (`orsGeocode`) | no → `TH`, unchanged |
| `src/lib/api-keys/test-connection.ts:14` (`testOrsKey`) | n/a — separate function |
| `src/app/api/ors/directions/route.ts:16` (`orsRoute`) | n/a — no boundary |

and the two browser callers of the geocode route:

| Browser caller | Passes `country`? |
|---|---|
| `LeafletRoutePicker.tsx:67` (AP-1) | **no** — must stay exactly as written |
| `OrsPlaceField.tsx:65` (AP-17, both fields) | yes, via a new prop |

(`LeafletRouteView.tsx:67` calls `/api/ors/directions`, not geocode.)

### 2b

**`resolveProvinceName` moves out of `request-service.ts:503-515` into
`province-service.ts`.** This is required, not tidying: `request-service.ts:1`
imports `getAccPool`, and that file therefore names a production-only table in
real SQL (`:513`) from a module that also holds the environment-varying pool.
See §Hazards H1 — it is the one existing violation of a rule this spec has to
extend.

**`province-service.ts` gains the whole surface, all on
`getProductionFormPool()` (`:11`, and `mssql.ts:113-115`), none through
`writeBothPools`:**

```ts
listProvinces(): Promise<ProvinceOption[]>          // active only — the form and report pickers
listAllProvinces(): Promise<ProvinceAdminRow[]>     // includes inactive — the admin grid
upsertProvince(row: { id?: number; nameTh: string; nameEn: string | null; countryCode: string; isActive?: boolean }): Promise<void>
setProvinceActive(id: number, isActive: boolean): Promise<void>
resolveProvinceName(id: number | null): Promise<string | null>   // moved in, unchanged
```

`listProvinces` returns `countryCode` **from day one** (D10 of §Out of scope),
and orders:

```sql
ORDER BY CASE WHEN CountryCode = 'TH' THEN 0 ELSE 1 END, CountryCode, NameTh
```

Thailand first, because the whole list is delivered to the browser and filtered
in memory (`LocalSearchSelect.tsx:42-47`), so the 77 rows people actually use
must stay at the top.

**Validation, server-side, in the service:**
`nameTh` required and ≤ 100 chars (`104:123`); `nameEn` ≤ 100 or null;
`isKnownCountry(countryCode)` or 400; a `NameTh` that already exists →
`AccConflictError` (409) naming the existing row, because
`UQ_TravelProvince_NameTh` (`104:128`) would otherwise surface as a 500.

**No `writeBothPools`, ever.** `settings-service.ts:1-2` imports both
`getAccPool` and `writeBothPools`, which is why the province CRUD must not live
there. If it did, the UAT pass at `dual-write.ts:63` would run the same
statement against `Rocks_Portal_Form_UAT`, where the table does not exist —
`Invalid object name`, both transactions rolled back (`:64-68`), and **every
province save fails, always.**

**Removal is `IsActive = 0`.** No hard delete: `AccTravelBooking.ProvinceId`
(`048:26`) has no FK anywhere (grep of `migrations/` for `REFERENCES
[dbo].[TravelProvince]` returns nothing), so a delete would leave historical
rows pointing at nothing and break the report's id filter for them.

**The three guards, and what each becomes:**

| Guard | Where | Change |
|---|---|---|
| save — a `provinceId` that resolves to no `NameTh` throws | `request-service.ts:782-784` | **none.** It asks only "does this id name a row"; a foreign row is a row. |
| submit — `กรุณาเลือกจังหวัด` | `request-service.ts:1009` | **copy only** → `กรุณาเลือกจังหวัด/เมืองปลายทาง`. Still required. |
| client — `issues.push({ key: "province", label: "จังหวัด" })` | `useTravelBookingForm.ts:274` | **copy only** → `จังหวัด/เมือง` |

That is the real answer and it is smaller than it looks: keeping the id model
means **none of the three rules changes**, only their wording and their option
set. Also `INVALID_OPTION_LABELS.provinceId` (`derive-flags.ts:160`) →
`จังหวัด/เมือง`.

**One pre-existing asymmetry that becomes load-bearing and is kept
deliberately.** Every other option id is run through `firstInvalidOption`, which
refuses an **inactive** row (`derive-flags.ts:143-150`). The province is not: it
uses the separate check at `request-service.ts:782-784`, and
`resolveProvinceName`'s `SELECT` (`:513`) does not filter `IsActive`. So a draft
holding a since-deactivated province still saves and still submits. Keep it —
now that there is a writer, deactivating a city would otherwise block the save
of everyone mid-draft on it.

**The report does not change and must not learn about `TravelProvince`.**
`report-service.ts:163` reads `t.ProvinceId, t.ProvinceName` off
`AccTravelBooking`; it never joins the lookup, and its pool is `getAccPool()`
(`:219`). Introducing a join would put a production-only table behind the
environment-varying pool. The filter at `:237` stays `sql.Int` on `ProvinceId`.
What changes is the filter's **option list**, which already comes from
`/options/provinces` (`TravelBookingReport.tsx:321-334`), and two headings
(§UI).

**The auto-detect (`TravelBookingTab.tsx:315-330`) — exactly what it becomes.**

Today it lowercases the ORS `region` (else the `label`), then
`provinces.find(p => en.length >= 3 && h.includes(en))` with a `nameTh`
fallback, and overwrites `tab.provinceId` with the first hit. Two things break
once the list has foreign rows in it:

- **Silent wrong match.** `find` returns the first row in list order whose name
  is a *substring* of the haystack. Add `NameEn = "Nice"` and the ORS label
  `"Venice, Italy"` matches it. The requester never asked for a province and one
  appears; `selectProvince` (`:202-216`) then also rewrites the ขากลับ departure
  default from it.
- **No match for a foreign place**, which is not new — an unmatched Thai place
  behaves the same today — but becomes the *normal* case for a foreign trip, so
  it must stop being a dead end (see the `emptyLabel` copy in §UI).

It becomes a pure, import-free, unit-tested module
`src/features/travel-booking/lib/province-match.ts`:

```ts
export function matchProvince(
  place: { label: string; region: string | null },
  options: ProvinceOption[],
  countryCode: string | null,     // null = consider every row
): ProvinceOption | null;
```

Rules, in order:

1. narrow `options` to `countryCode` when one is given (S3); otherwise consider
   all;
2. split the haystack on `[,\s/()\-]+` — enough for Pelias's comma-separated
   labels and for Thai `region` values, which arrive as one whole province name;
3. an English name matches only as a **whole token sequence**, so `"Nice"` never
   matches `"Venice"`; a Thai name matches only as a whole token;
4. among survivors prefer the **longest** name, so `"Nakhon Ratchasima"` wins
   over a hypothetical `"Nakhon"` — today's `find` returns whichever sorted
   first;
5. `region` before `label`, as today.

**And the write is narrowed: the auto-detect fills an empty province or replaces
one it set itself, never one the requester picked.** This needs one UI-only
field on `TabFormState`, `appliedProvinceId: number | null`, not sent by
`buildSaveInput` — the same shape as `goAppliedDeparturePlace` /
`returnAppliedDeparturePlace` (`useTravelBookingForm.ts:88-89`), for the same
reason: a value somebody chose is otherwise indistinguishable from one this
code wrote. Spec S1 removes those two fields because it removes the default that
needed them; **the pattern is not being retired, one use of it is.**

*Why now and not before:* overwriting was tolerable while the only candidates
were 77 Thai provinces. With foreign rows the collision rate rises and the
consequence is a submitted request naming the wrong destination.

---

## Routes (method, path, gate, request/response shape)

### `GET /api/ors/geocode` — changed

`requireAuth()` (`geocode/route.ts:6-7`), unchanged.

| Param | Today | After |
|---|---|---|
| `q` | forwarded (`:8`) | unchanged |
| `mode` | `"search"` → `orsSearch`, else `orsGeocode` (`:10,:12`) | unchanged |
| `country` | — | **new**, optional; `resolveOrsCountry(sp.get("country"))` |

Response shape unchanged: `{ ok: true, data: OrsPlace[] }`.

The allowlist is `resolveOrsCountry` itself, not a second regex in the route.
A caller that omits the parameter gets exactly today's URL, which is what makes
`LeafletRoutePicker.tsx:67` byte-identical.

No `ROUTE_RULES` entry: `/api/ors` is not under `/api/request`.

### `GET /api/request/travel-booking/options/provinces` — response widened

`requireAuth()` (`options/provinces/route.ts:7`), unchanged. Each row gains
`countryCode: string`. Both consumers (`useTravelBookingForm.ts:405-407`,
`TravelBookingReport.tsx:321-334`) keep working without change; the form uses it,
the report ignores it for now.

### `/api/request/travel-booking/settings/provinces` — new

**Gate: `requireRole(["IT Admin", "System Admin"])` on every method** (D9).

| Method | Body | Response |
|---|---|---|
| `GET` | — | `{ ok, data: { id, nameTh, nameEn, countryCode, isActive }[] }`, all rows |
| `POST` | `{ id?, nameTh, nameEn?, countryCode }` | `{ ok: true }`; 400 invalid, 409 duplicate `NameTh` |
| `PATCH` | `{ id, isActive }` | `{ ok: true }` — the soft delete |

Three consequences in `src/lib/acc/travel-booking/settings-tabs.test.ts`, all of
which must be edited in the same commit or the suite reds:

- `handlerCount` **+3** (`:306-310`) — 14 if this spec lands first, 16 if the
  country-and-per-diem spec's two handlers are already in. Read the assertion and
  add three rather than copying an absolute number into the plan;
- `roleGated` **gains `"provinces"`** (`:298-302`) — the array is
  `["approvers"]` today, and `["approvers", "per-diem"]` if the
  country-and-per-diem spec landed first, so add rather than replace,
  with the reason written into the assertion message, because that list is
  where the next reader will look to find out why;
- nothing else — the `BOOKING_GATE` regex (`:210-211`) already admits
  `await requireRole(`.

**`provinces` must NOT become a `GrantableBookingTabKey`.** That union is
`SettingsKind | "brands"` (`settings-tabs.ts:28-31`), and `SettingsKind` is
derived from `SETTINGS_KIND_ROUTES` (`settings-route-map.ts:22-26,55-59`) — a
map of `list` / `upsert` / `reorder` triples over the four dual-written option
tables. `TravelProvince` has no `SortOrder`, so `reorder` cannot be implemented,
and its writes must not go near `writeBothPools`. Adding it there would make it
grantable (D9 says no) *and* route it through the wrong service.

No `ROUTE_RULES` entry needed: `classify-path.ts:79` already maps
`/api/request/travel-booking` → `AP-17`. The classification is inert here
anyway — every read and write on this path uses `getProductionFormPool()`.

---

## UI (components, files, states, Thai copy where it is user-visible)

### `OrsPlaceField` (`OrsPlaceField.tsx`)

New prop, appended to the fetch URL at `:65`:

```ts
/** ISO-3166-1 alpha-2 to bound the search to, or ORS_WORLDWIDE ("*"). Omit for Thailand. */
country?: string;
```

Two states, not three: omitted → no parameter → `TH`; a value → sent verbatim.
The *policy* (worldwide now, the trip's country later) lives one level up in
`TravelBookingTab`, not in the field.

**Note the existing unused `filter` prop** — `filter?: (place: OrsPlace) =>
boolean`, declared at `:35` and applied at `:112`, passed by neither
`WorkLocationList.tsx:24-30` nor `TransportSection.tsx:60-65`. It is a
client-side post-filter over results ORS already returned; `country` is a
server-side bound that changes what ORS searches. **Do not implement the country
bound with `filter`** — it would throw away most of a six- or forty-result page
and leave the dropdown looking empty. Leave `filter` where it is; it is a
different tool and it is one line.

### Pass-through

- `WorkLocationList.tsx` — add `country?: string`, forward to `OrsPlaceField`.
  Placeholder (`:12`) may gain a foreign example:
  `เช่น สาขาเชียงใหม่ / Narita International Airport`.
- `TransportSection.tsx` — same, forwarded at `:60-65`.

### `TravelBookingTab.tsx`

- pass `country={ORS_WORLDWIDE}` to both (D5). When S3 lands this becomes
  `tab.countryCode ?? ORS_WORLDWIDE` and nothing else moves.
- `provinceOptions` (`:218`) gains a country sub-label so `ลอนดอน` is not read as
  a Thai province — `subLabel` is already rendered and already searched
  (`LocalSearchSelect.tsx:42-47`), so `subLabel: p.countryCode === "TH" ? p.nameEn
  : countryNameBoth(p.countryCode)` costs nothing and makes the list typable in
  either language.
- the auto-detect at `:315-330` calls `matchProvince` and respects
  `appliedProvinceId` (§Server).
- `selectedProvinceName` (`:157`) is unchanged. Note it is also read by the
  departure default at `:198` — the line spec **S1 deletes**. Whichever of S1
  and S2 lands second rebases this file; they touch adjacent lines, not the same
  ones.

**Thai copy, ข้อ8** (`TravelBookingTab.tsx:334-345`):

| | Today | After |
|---|---|---|
| label `:336` | `จังหวัด` | `จังหวัด/เมือง` |
| placeholder `:342` | `พิมพ์ค้นหาจังหวัด...` | `พิมพ์ค้นหาจังหวัดหรือเมือง...` |
| emptyLabel `:343` | `ไม่พบจังหวัด` | `ไม่พบจังหวัดหรือเมืองนี้ — ติดต่อผู้ดูแลระบบเพื่อเพิ่ม` |

The `emptyLabel` is the one that matters. A requester travelling to a city
nobody has added is told today that it does not exist, beside a required field,
with no remedy named.

### The rest of the copy — every site, so none is missed

| File | Line | Today | After |
|---|---|---|---|
| `useTravelBookingForm.ts` | `:274` | `จังหวัด` | `จังหวัด/เมือง` |
| `request-service.ts` | `:1009` | `กรุณาเลือกจังหวัด` | `กรุณาเลือกจังหวัด/เมืองปลายทาง` |
| `derive-flags.ts` | `:160` | `จังหวัด` | `จังหวัด/เมือง` |
| `TravelBookingDetail.tsx` | `:1056` | `จังหวัด` | `จังหวัด/เมือง` |
| `BookingInfoStrip.tsx` | `:51` | `จังหวัด` | `จังหวัด/เมือง` |
| `email-templates.ts` | `:73`, `:96`, `:127` | `จังหวัด` | `จังหวัด/เมือง` |
| `TravelBookingReport.tsx` | `:95` | `จังหวัด` | `จังหวัด/เมือง` |
| `report-service.ts` | `:358` (Excel header) | `จังหวัด` | `จังหวัด/เมือง` |

Two sites need **no** change and are listed so nobody hunts for them: the Admin
queue (`queue/page.tsx:198`) and the accounting sign-off queue
(`approvals/page.tsx:509`) render `item.provinceName` bare, with no label.
`BookingInfoStrip.tsx:150` is a composed value, also unlabelled.

### The admin screen

New tab on `travel-booking-settings/page.tsx`, and it is admin-only **with no
extra code**: `visibleTabs` (`:158-162`) filters a non-admin's tabs through
`isGrantableBookingTabKey`, which returns false for a key that is not in
`GRANTABLE_BOOKING_TABS` (`settings-tabs.ts:67-71`). The same mechanism already
hides `access`.

Four edits to that page, in this order:

1. `TabKey` (`:34`) → `TravelOptionKind | "brands" | "access" | "provinces"`.
2. `TAB_ICONS` (`:42-49`) gains `provinces: <Globe size={15} />`. It is a
   `Record<TabKey, …>`, so a missing entry is a compile error — which is the
   only reason this list is safe to hand-keep.
3. `TABS` (`:51-56`) concatenates it beside `access`, label **`จังหวัด/เมือง`**.
   It cannot come from `GRANTABLE_BOOKING_TABS` because it is not grantable.
4. **The render fall-through at `:229` is a trap.** `panel` (`:173-176`) is
   `null` for `access` and `brands`, and the render then treats
   `effectiveTab === "access" || panel === null` as "show the approver roster".
   A new tab must get its **own branch before that one**, and `panel`'s ternary
   must name it too. TypeScript catches half of this — `TAB_PANELS[effectiveTab]`
   is `Record<TravelOptionKind, …>` and will not accept `"provinces"` — but it
   does **not** catch the render arm, which would silently show
   `BookingApproverSettings` under a จังหวัด/เมือง heading.

New component `src/features/travel-booking/components/settings/TravelPlaceSettings.tsx`.
Deliberately **not** `TravelOptionSettings` (`TravelOptionSettings.tsx:29`): a
different table with no `SortOrder`, no icon and no drag reorder, plus a country
field, plus a different service on a different pool. Reuse would drag the
`[kind]` route and `writeBothPools` in behind it.

Shape: a filter bar, a grid of `{ ธงชาติ · ชื่อไทย · ชื่ออังกฤษ · ประเทศ · สถานะ }`,
an add/edit dialog whose ประเทศ field is a picker over `COUNTRIES` rendered with
`countryFlag` / `countryNameBoth`, and an on/off toggle per row (never a delete).

**A standing notice on the panel, in Thai, not a tooltip:**

> รายการนี้ใช้ร่วมกับระบบ Rocks Fast — เมืองที่เพิ่มที่นี่จะไปปรากฏในแบบฟอร์มของระบบนั้นด้วย

That is the honest statement of D10 and the only mechanism available: nothing in
this repository can see the sibling's filter.

---

## Tests (what must be asserted, and which need a source-reading guard)

**Pure unit tests** — the shape this repo uses, import-free modules only:

- **`ors-scope.test.ts`** (`resolveOrsCountry`): `"*"` → null; `"gb"` → `"GB"`;
  `"GB"` → `"GB"`; `undefined` → `"TH"`; `""` → `"TH"`; `"THA"` → `"TH"`;
  `"12"` → `"TH"`; `"  gb  "` → `"GB"`. The fallback arms are the point (D2) —
  every one of them proves a malformed value narrows rather than widens.
- **`province-match.test.ts`**: `"Venice, Italy"` does **not** match a row named
  `"Nice"`; `"Nice, France"` does; `region = "เชียงใหม่"` matches the Thai name;
  longest wins between `"Nakhon"` and `"Nakhon Ratchasima"`; a country argument
  excludes an otherwise-matching row in another country; `null` country
  considers every row; no match returns `null` rather than the first row.
- **the auto-detect write rule**: with `appliedProvinceId === null` and a
  province already set, a new match does not overwrite; with
  `appliedProvinceId === tab.provinceId`, it does.
- **province input validation** (pure half of `upsertProvince`): a blank
  `nameTh`; 101 characters; an unknown `countryCode` (`"KH"` — the D11 case, and
  the test that documents the exclusion); `"th"` normalising to `"TH"`.

**Source-reading guards** — the two rules no type and no ordinary test run can
catch:

1. **`currency-pool-guard.test.ts` gains `"TravelProvince"` in
   `PRODUCTION_ONLY_TABLES` (`:64`).** The table is absent from
   `Rocks_Portal_Form_UAT`, so a read through `getAccPool()` / `getFormPool()`
   throws `Invalid object name` **for a UAT tester and for nobody else** — and
   because AP-17 and AP-1 share `AccRequest`, a failure on a shared read path
   takes both forms down. The existing loop (`:66-89`) needs no change; only
   the list does.
   **This test goes red the moment the entry is added**, and correctly: it
   catches the one existing violation, `request-service.ts` naming the table at
   `:513` while importing `getAccPool` at `:1`. Moving `resolveProvinceName` into
   `province-service.ts` is what makes it green. **Add the entry first, watch it
   fail, then move the function** — that ordering is the proof the guard works,
   and the guard is otherwise the sort of thing that is added already-passing and
   never actually exercised.
2. **A gate test for the new route.** It is free: `settings-tabs.test.ts:228-311`
   already walks every route file under `settings/` and asserts each handler has
   exactly one gate, as its first `await`, with the refusal returned. The two
   pinned numbers (`:298-302`, `:306-310`) must be updated to `["approvers",
   "provinces"]` and `14`, and the update **is** the review checkpoint — that is
   why they are pinned.

**Not tested, deliberately:** that a foreign row appears in Rocks Fast's
dropdown. It does, that is the whole coordination problem, and nothing in this
repository can assert anything about the sibling's query.

---

## Hazards (ranked, each with the concrete failure it causes)

**H1 — `TravelProvince` reached through `getAccPool()`. (Highest.)**
`request-service.ts` already does it: `getAccPool` at `:1`, `SELECT TOP 1 NameTh
FROM [dbo].[TravelProvince]` at `:513`. It is *currently* harmless only because
that particular query opens `getProductionFormPool()` explicitly at `:511` — the
file is one careless edit away from a query that does not. `TravelProvince` is
not in `currency-pool-guard.test.ts:64` today, so nothing catches it.
**Failure:** a UAT tester saving an AP-17 draft gets `Invalid object name
'TravelProvince'`; production is perfect and the people testing the feature
cannot use it. The fix is the move plus the guard entry, in that order (§Tests).

**H2 — a foreign city appears in Rocks Fast's province dropdown the moment the
row commits.**
Verified by reading the sibling:
`../RocksFast/src/lib/acc/travel-booking/province-service.ts:6-12` opens
`getDataPool()` and runs

```sql
SELECT Id, NameTh, NameEn FROM [dbo].[TravelProvince] WHERE IsActive = 1 ORDER BY NameTh
```

with **no country filter**, reaching these exact rows through the permanent
`Fast_Data` synonym (migrations 104/105). Adding the *column* is safe — no
`SELECT *` on either side. Adding *rows* is not.
**Failure:** a Rocks Fast requester filing a domestic trip is offered
"ลอนดอน" in a field labelled จังหวัด, picks it, and the row is stored with
`ProvinceName = 'ลอนดอน'` in `Fast_Form`. The remedy is one line —
`AND CountryCode = 'TH'` — **in the sibling repository, which is out of scope
for this spec** and is listed as a required coordination step in §Deployment,
not silently assumed. Migration 132 alone does not create the exposure; the
first non-`TH` row does.

**H3 — the province CRUD written into `settings-service.ts`.**
That file imports `getAccPool` *and* `writeBothPools` on its first two lines
(`:1-2`), and it is the obvious place to put a fifth settings table.
**Failure:** two at once. The guard in H1 reds, and the UAT pass at
`dual-write.ts:63` throws `Invalid object name` against a database with no such
table, rolling both transactions back (`:64-68`) — so **every** province save
fails, every time, with a message about a table the admin has never heard of.

**H4 — `npm run check:travel-province-home` reds on an index or a widened
unique constraint.**
`EXPECTED_INDEXES` (`verify-travel-province-move.ts:93-96`) is compared as one
joined name string at `:154-158`, with key-column order checked per index. D8
avoids this by adding neither.
Separately, that script's header states at `:33-38` that **"nothing writes this
table in any of the three applications"** and calls the absence of a write test
"a decision, not an oversight". After this spec that sentence is false. It must
be rewritten in the same commit, or the next reader takes it as licence to
assume the table is still read-only.

**H5 — `AccRequest.Currency` gains a second writer.**
Not from anything in this spec, but from the next reader who sees a country
appear on AP-17 and reaches for the obvious inference. `booking-currency.ts:12-22`
states the design; `admin-service.ts:547-559` is the single writer, fed by a
brand read from the database at `:477`.
**Failure:** two paths write one currency, a booking desk's correction is
overwritten by a requester's country choice, and the row a payment converts from
is wrong. D13 is the ruling; it belongs in the header of whatever touches this.

**H6 — the settings page's render fall-through.**
`page.tsx:229` reads `effectiveTab === "access" || panel === null ?
<BookingApproverSettings />`. A new tab that reaches that arm shows the approver
roster under a จังหวัด/เมือง heading, with no type error on the render itself.

**H7 — `LeafletRoutePicker` acquires a `country` parameter by copy-paste.**
The two browser callers of `/api/ors/geocode` look alike
(`LeafletRoutePicker.tsx:67`, `OrsPlaceField.tsx:65`) and one of them must never
send the parameter.
**Failure:** AP-1's route search goes worldwide and a mileage claim is computed
between the wrong two points, on a form that pays by the kilometre. D1's default
is what keeps this a one-line mistake rather than a silent one — but only for
the caller that stays silent.

**H8 — the province option list is filtered in memory.**
`LocalSearchSelect.tsx:42-47` filters the whole array on every keystroke and
`/options/provinces` has no `?q=`. 77 rows going to ~150 is fine. A bulk import
of world cities is not, and would degrade a field on the critical path of every
AP-17 submission. If the list ever needs to be large, that is a server-side
search endpoint, not a bigger array.

**H9 — three survey citations that had drifted.** Corrected here so a reader
comparing the two documents is not sent to the wrong line: `AccRequest.CountryCode`
is added at `129:73-75`, not `129:81-82`; AP-17's single currency writer is the
`UPDATE` at `admin-service.ts:547-559`, not `:551-561`; and the survey's list of
`ProvinceName` display sites includes the two queue pages, which is true but
they render the value **unlabelled** (`queue/page.tsx:198`,
`approvals/page.tsx:509`) and so need no copy change.

---

## Deployment (migration order, what must be applied before the code, what to verify after)

**2a needs no migration and can ship on its own, today.**

**2b, in this order:**

1. **Apply migration 132 to `Rocks_Portal_Form` only.** Verify with the
   post-apply query in §Schema: one group, `TH`, 77 rows. Then run
   `npm run check:travel-province-home` — it must still pass, which is what
   proves D8 (no index changed) and that the `Fast_Data` synonym still resolves.
   Confirm by hand that `Rocks_Portal_Form_UAT` still has **no**
   `dbo.TravelProvince` object of any kind; the script asserts it at `:231-245`.
2. **`npm run check:alignment` must be unaffected** — 25 tables, unchanged.
   `TravelProvince` is not one of them and must not become one.
3. **Deploy the code.** With no foreign rows yet, every surface behaves exactly
   as before except the copy and the worldwide place search. The admin screen
   appears for admins.
4. **Coordination step — required, and it belongs to the other repository.**
   Rocks Fast's `province-service.ts` needs `AND CountryCode = 'TH'` added to
   its `WHERE IsActive = 1`. Until it ships there,
   **no `CountryCode <> 'TH'` row may be added here.** There is no technical
   enforcement of that and there cannot be; it is a sequencing instruction, and
   the panel's standing notice (§UI) is the only reminder inside the product.
5. **Only then, add the first foreign city.**

**Nothing here is applied to `Rocks_Portal_Form_UAT`, and that is not an
omission.** `TravelProvince` is a single copy for two reasons that both still
hold: a synonym names exactly one database, so the sibling could never reach a
UAT twin; and the list of places does not differ by environment. A UAT tester
reads the same 77-plus rows a production user does, through
`getProductionFormPool()`, and always has.

**Rollback.** The code is revertible on its own. The column is not worth
dropping — it is nullable-by-absence-of-writers once the code is gone, and
`NOT NULL` with every row `'TH'` is exactly the state before it existed. Rows
already added are the thing that cannot be rolled back, because Rocks Fast has
by then read them; deactivate rather than delete.

---

## Out of scope (what this spec deliberately does not do, and which spec does it)

- **The country field on an AP-17 request.** `AccRequest.CountryCode CHAR(2)
  NULL` already exists in both form databases (`129:73-75`) and is written by
  AP-1 alone (`src/lib/acc/request-service.ts:1217`, `:1262`). **Spec S3 owns
  it.**
  - *If S3 lands first:* `TravelBookingTab` passes `tab.countryCode ??
    ORS_WORLDWIDE` to both place fields instead of the constant, and the same
    value as `matchProvince`'s third argument, and filters `provinceOptions` to
    that country. Three call sites, no signature changes — the parameter and the
    argument both already exist, which is the entire reason D10 puts
    `countryCode` on `ProvinceOption` before anything reads it.
  - *If S3 does not land:* everything above works. The place fields search
    worldwide with the Bangkok bias (D3/D5), the province picker offers every
    active row with a country sub-label, and `matchProvince` is called with
    `null`. Nothing is stubbed and nothing waits.
- **The booking currency.** Unchanged, and D13 says why it must stay that way.
- **The จุดขึ้นรถ/ขึ้นเครื่อง default.** Spec S1
  (`2026-08-31-ap17-departure-blank-design.md`) removes it. Both specs edit
  `TravelBookingTab.tsx` near `:198` and `:315-330`; whichever lands second
  rebases, and neither depends on the other.
- **The per-diem rate by country.** Needs the country field, so it is strictly
  after S3.
- **⚠ S3 adds a settings tab to the same page this one does.** This spec adds
  `provinces`; S3 adds `per-diem`. Both edit `TabKey` (`:34`), `TAB_ICONS`
  (`:42-49`), `TABS` (`:51-56`), the `panel` ternary (`:173-176`) and the render
  ternary whose `|| panel === null` arm at `:229` falls through to
  `<BookingApproverSettings />`. Both also raise `handlerCount` and extend
  `roleGated` in `settings-tabs.test.ts`. **Whichever lands second rebases onto a
  file that already has one extra tab** — so read the current values rather than
  the ones written in either spec, and check the render ternary has a branch for
  the new tab *before* the null arm.
- **A brand-visibility right for approvers.** Its own spec; it scopes the
  approver side only and touches none of this.
- **AP-1's map picker learning about countries.** AP-1 now has a country on the
  claim, and its `LeafletRoutePicker` could pass it. Deliberately not done here:
  it is AP-1's fuel-distance path and the money it produces is computed from the
  two picked points. D1's default keeps it byte-identical, and changing that is
  a decision with its own evidence, not a follow-on.
- **A server-side `?q=` for the province list.** Not needed at this size (H8).
