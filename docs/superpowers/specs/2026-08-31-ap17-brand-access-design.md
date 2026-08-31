# AP-17 — which brands an approver may see

**Date:** 2026-08-31
**Status:** design agreed, not built
**Scope:** the approver side of AP-17 only — the Admin booking queue, the
accounting sign-off queue, the report and its export, and every act path behind
them. The requester's brand chips are **not** touched (§Decisions D3).
**Survey:** `scratchpad/ap17-survey.md`, six agents. Every live-database figure
below was re-measured against `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`
on 2026-08-31 while writing this, because the survey's own probes were reported
as failing on `Login failed for user 'saai'`. Where a number here differs from
the survey's, this one is the measurement.

An admin can already say *who* works on AP-17 (`AccBookingApprover`) and *which
menus* they see (`AccBookingApproverTab`). They cannot say **whose work**. Every
person on the roster sees every request of every brand, in the queues, in the
report and on the act paths. This adds the third axis, with the same structure
AP-1 has used for its ERP scope since migration 038.

---

## Why

Four people are on AP-17's roster today — measured 2026-08-31, ids 1..4, all
`IsActive = 1`, **identical in both form databases** (lockstep holding). AP-17
accepts two brands, `PCTH` and `KSI`, also identical in both
(`AccFormBrand`, `FormCode = 'AP-17'`). So all four see both companies' travel
requests: the hotel bookings, the ticket prices, the per-diem figures and the
requester's name, position and department for every trip either company files.

That was tolerable while the roster was one person. It is not the shape anybody
asked for, and it is the only one of AP-17's three access questions with no
answer. AP-1 answered the equivalent question in migration 038 and the answer is
in live use: measured 2026-08-31, `AccApproverInterfaceBrand` holds **7 rows
across 6 approvers** (mostly `PCTH`; approver 3 holds `PCTH` and `UNO`). This is
that mechanism, for AP-17's own roster and AP-17's own brands.

Two facts about today's data shape everything below and are worth stating
before the decisions rather than after:

- **`Rocks_Portal_Form` holds exactly one `AccRequest` row, an AP-3.** Zero
  AP-1, zero AP-17. All live AP-17 work is in `Rocks_Portal_Form_UAT`: five
  requests, two of them sitting at `ManagerApproved`/`ACCOUNT` right now (one
  `PCTH`, one `KSI`) and two at `Submitted`/`MANAGER`. So the first real
  exercise of this filter will be a UAT one, and the UAT database is where the
  post-deploy verification in §Deployment is written to run.
- **One of those five AP-17 rows carries `BrandCode = NULL`** (a `Cancelled`
  one). A blank brand is real data here, not a hypothetical — see §Hazards H5.

---

## Decisions

### D1 — A new child table, `AccBookingApproverBrand`, not columns

Migration 124 added `CanQueue` / `CanAccount` / `CanReport` to
`AccBookingApprover` as `BIT NOT NULL DEFAULT (1)`
(`migrations/124_acc_booking_approver_areas.sql:56-87`), and its header states
the rule this decision follows: *columns when the granted set is closed and
fixed, a child table when it grows* (`124:26-34`). AP-17's brand set is
`AccFormBrand` rows an admin edits from another tab. That set is open by
construction, so it gets a child table, exactly as `AccBookingApproverTab` did
for the same reason — which 124's own header states about 096 in as many words
(`124:28-31`), and see D2.

**Cost if wrong:** a fixed column per brand means a migration against both form
databases every time somebody grants AP-17 a new company — the failure mode
`124`'s own header describes as "modelling an open set that is not open", read
backwards.

### D2 — Migration 124's three columns stay dead, and this spec does not reuse them

Verified 2026-08-31: `grep -rn "CanQueue\|CanAccount\|CanReport" src/ scripts/`
returns **zero matches**. Nothing reads them. They are not touched here, for
three reasons, and this paragraph exists because the next reader will otherwise
see three unused permission columns on exactly the right table and assume the
brand scope belongs in them:

1. They answer a different question — *which pages*, not *whose work*. A person
   can want both narrowed at once, so one cannot subsume the other.
2. They are `BIT`. A brand set is not expressible in them at any width.
3. Wiring them up would be a **second** answer to a question that already has
   one. `AccBookingApproverTab`'s `bookingQueue` / `accountApproval` menu keys
   are read (`src/app/api/request/travel-booking/access/route.ts:63-64`) and are
   what the two queue pages gate on. Two mechanisms for one question is the
   exact hazard `src/lib/acc/travel-booking/settings-tabs.ts:114-126` names.

Dropping them is a separate decision needing a migration against both databases.
This spec neither reads nor drops them.

### D3 — The scope is approver-side only

The requester's brand chips are untouched.
`GET /api/request/travel-booking/options/brands` stays bare `requireAuth()` over
`getAllowedBrands(AP17_FORM_CODE)` (`src/lib/acc/brand-options.ts:32-57`).

The two questions are different: the picker answers *which companies may this
form be filed against*, a property of the form; the scope answers *whose work is
this*, a property of a person. The precedent agrees — `AccApproverInterfaceBrand`
scopes what an approver may **act on** and nothing about what a requester may
choose.

**Cost if wrong:** scoping the requester's list would change which brand is
selected first on the form, which changes the default country
`defaultClaimCountry` derives from that brand's `BrandCurrency` rows — coupling
this feature to S3's country picker for no benefit.

### D4 — An empty grant means **every** brand (ruling R2)

No rows for an approver ⇒ `allAccess`. This is the load-bearing decision and it
inverts the usual reading, so the reasoning is recorded in full.

- **Measured 2026-08-31**: `AccBookingApproverBrand` does not exist in either
  form database (`OBJECT_ID` is `NULL` in both), and four approvers see
  everything today. "Empty = none" would blind all four the moment the code
  deploys, and the only way back would be an admin ticking every brand for every
  person — on a grid whose columns are themselves data that has to load first.
- **Migration 038 took the same decision for the same reason**, and says so in
  its first two lines: *"Empty = approver sees all groups (backward
  compatible)"* (`migrations/038_acc_approver_interface_brand.sql:1-2`). It has
  been operated that way ever since; six of AP-1's approvers hold explicit rows
  and the rest are unscoped by having none.
- **Migration 124 reached the same answer by a different mechanism** —
  `DEFAULT (1)` — and its header spells out the general rule: a grant that
  *narrows an existing permission* defaults to the permission, while a grant that
  *hands out something new* defaults to nothing (`124:36-52`).

**Do not "make this consistent" with the other grant tables.**
`AccBookingApproverTab` (096) and `AccReimburseAccess` / `AccReimburseAccessTab`
(120) are the opposite — no rows means no grants — because they hand out
something the person did not previously have. This one narrows something they
already have. That is the whole distinction.

**Cost if wrong, and it is not symmetric.** Empty-means-all makes a *failed
read* look like a grant. `src/lib/acc/approver-interface-access.ts:66-88`
records the correction that followed from getting this wrong once: the catch
there was widened at some point to any error merely *naming* the table — a
deadlock, a timeout, a permission failure — and each of those escalated a scoped
approver to every interface brand on the ERP send, the prep detail and the
report export. §Server pins the exact-match catch, and §Tests pins it in source.

### D5 — There is no representable "sees no brands"

`[]` and `null` both mean *every brand*, because both store zero rows. Rather
than leave that ambiguity in the wire format and the UI, this spec makes it
explicit at every level:

- the pure module returns a **tagged union**, `{kind:"all"} | {kind:"none"} |
  {kind:"codes"}`, so no caller can conflate "everything" with "nothing" by
  reading `.length === 0` off an array (§Server);
- the route treats a posted `[]` as *clear the scope* and logs it;
- the panel refuses to untick the last brand and says what to do instead:
  removing somebody's access entirely is what **ปิดการใช้งาน** on the roster card
  already does.

AP-1's grid does not do this, and the consequence is visible:
`ApproverInterfaceBrandTable.tsx:18-23` maps an all-unticked set to `[]`,
`approver-interface-access.ts:110` writes zero rows for it, and
`:146-148` reads that back as `allAccess: true` — so unticking every box grants
every brand and the boxes spring back to ticked on the next refetch. **Not fixed
here** (§Out of scope), but not copied either.

### D6 — Admins are unconditionally `allAccess`

`canAccessBookingArea` keeps an admin arm (`src/lib/acc/booking-access.ts:26-31`),
so an IT/System Admin who is not on the roster passes the area gate. Without a
matching admin arm here they would then be refused by the brand scope on every
single request — locked out of exactly the thing they are there to unblock, and
unable to see the queue they must use to diagnose it.

AP-1 has that property today: `resolveApproverInterfaceAccess` takes `_role` and
ignores it (`approver-interface-access.ts:127`), returning
`{allAccess:false, allowedCodes:[]}` for anyone not on `AccApprover`
(`:140-143`). Whether that is intended there is not this spec's question, and
this spec does not change it.

### D7 — No foreign key on `ApproverId`

Following `AccBookingApproverTab`, which has none and states why: *"dual-write
inserts into the two databases independently, and an FK would tie these two
tables' identity counters to each other as well as across databases"*
(`migrations/096_acc_booking_approver_tab.sql:27-30`).

Two honest notes, so nobody adds or removes an FK on a half-read:

- **038 does carry one**, `FK_AccApproverInterfaceBrand_Approver … ON DELETE
  CASCADE` (`038:12-13`), and is dual-written. So the two precedents genuinely
  disagree. `AccBookingApproverBrand` follows 096 because it hangs off the *same
  parent row* as `AccBookingApproverTab`; two sibling children of one parent
  disagreeing about whether that parent is enforced is worse than either answer.
- 096's stated reason is not literally what an FK does — an FK does not tie
  identity counters. Its real effect is that identity drift fails **loudly** at
  the child insert instead of writing an orphan. `ON DELETE CASCADE` has nothing
  to do here either way: roster rows are never deleted, only soft-deleted
  (`setBookingApproverActive`, `booking-approver-service.ts:113-137`).

### D8 — The scope hangs off the roster row, so deactivating revokes it

Keyed on `AccBookingApprover.Id`, and `resolveBookingBrandAccess` tests
`IsActive = 1` — the same rule `resolveBookingTabsByEmail` applies
(`booking-approver-tabs.ts:120-133`, the predicate at `:129`). Switching somebody
off stops their access immediately without deleting a scope row; switching them
back restores exactly the scope they held.

---

## Schema

**One migration, `134_acc_booking_approver_brand.sql`, applied to BOTH
`Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`.**

**On the number.** 131 is the highest file present, so 132 was the first free —
but two sibling specs written the same day have claimed it and the next:
**132** by *2026-08-31-ap17-worldwide-places-design*
(`132_travel_province_country.sql`) and **133** by
*2026-08-31-ap17-country-and-perdiem-design*
(`133_acc_travel_perdiem_country.sql`). Neither is applied yet, so this is a
claim rather than a fact; **134 is what this spec assumes, and if either sibling
has since been renumbered or dropped, take the first free number and change
nothing else here.** The number is a name for humans rather than a key —
`apply-sql` takes an explicit `--file` and keeps no record
(`120_acc_reimburse_access.sql:4-10`).

Read `ls migrations/` before writing the file, never a count and never
CLAUDE.md: eleven numbers are already duplicated (088, 089, 090, 091, 094, 103,
117, 118, 119, 120, 124), and CLAUDE.md stops at 123. The one rule that is not
negotiable is 124's: **never renumber a migration that has been applied
anywhere** (`124:3-11`).

```sql
-- Which brands each AP-17 approver may see.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/134_acc_booking_approver_brand.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/134_acc_booking_approver_brand.sql
--
-- Apply BEFORE the code. SQL Server binds object names at compile time, so a
-- missing table is 'Invalid object name', not an empty result.
--
-- NO ROWS FOR AN APPROVER MEANS EVERY BRAND. That is the opposite of
-- AccBookingApproverTab (096) and AccReimburseAccess (120), and deliberate:
-- this narrows a permission the four people on the roster already have, where
-- those hand out something new. Measured 2026-08-31, all four see every AP-17
-- request; "empty = none" would blind all four on deploy day. Same reading as
-- 038's header, and the same reading 124 encodes as DEFAULT (1).
--
-- Shared master table: dual-written by
-- src/lib/acc/travel-booking/booking-approver-brands.ts, asserted by
-- npm run check:alignment (MASTER_TABLES +1: 26 alone, 27 if AccTravelPerDiemCountry landed first). It carries NO identity
-- floor and must NOT be added to migrations 061/064 -- dual-write relies on the
-- two identity counters staying in lockstep, and a CHECK (Id >= 900000) in UAT
-- would reject every write.
--
-- ApproverId refers to AccBookingApprover.Id with no foreign key, following 096
-- (which has none) rather than 038 (which does) -- see the design spec's D7.
SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.AccBookingApproverBrand', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccBookingApproverBrand] (
    [Id]         INT IDENTITY(1,1) NOT NULL
                 CONSTRAINT [PK_AccBookingApproverBrand] PRIMARY KEY,
    [ApproverId] INT NOT NULL,
    -- NVARCHAR(20) to match AccFormBrand.BrandCode (013:244) and
    -- AccRequest.BrandCode (013:44) -- the two columns this is compared with.
    [BrandCode]  NVARCHAR(20) NOT NULL,
    [CreatedAt]  DATETIME2(7) NOT NULL
                 CONSTRAINT [DF_AccBookingApproverBrand_Created] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccBookingApproverBrand created.';
END
ELSE
  PRINT 'AccBookingApproverBrand already exists -- nothing to do.';
GO

-- Scoped to the object, not database-wide: an index name is unique only within
-- its table, so the unscoped form can be satisfied by a same-named index
-- elsewhere and skip this one silently. Same correction 096:48-50 records.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_AccBookingApproverBrand'
    AND object_id = OBJECT_ID('dbo.AccBookingApproverBrand')
)
  CREATE UNIQUE INDEX [UX_AccBookingApproverBrand]
    ON [dbo].[AccBookingApproverBrand] ([ApproverId], [BrandCode]);
GO
```

No seed. The table ships empty and empty is the working default (D4).

**Three list memberships change with it**, and each is a real edit, not a note:

- `MASTER_TABLES` in `scripts/checks/verify-master-alignment.ts:66-92` gains
  `"AccBookingApproverBrand"`, **+1 — 26 if this lands before the per-diem spec's `AccTravelPerDiemCountry`, 27 if after**, and the file's own doc comment
  (`:3`) and the paragraph at `:51-52` are updated to say so. (`dual-write.ts:7`
  already says "21 shared configuration tables" and is stale; this change does
  not fix it, and that number is not authority.)
- Migrations **061 and 064 are not touched** — see the migration header.
- `PRODUCTION_ONLY_TABLES` in `src/lib/acc/currency-pool-guard.test.ts:64` is
  **not** touched. That guard names the tables that exist only in
  `Rocks_Portal_Form`; this one exists in both, is read through `getAccPool()`
  like the rest of `AccBookingApprover`, and adding it there would assert the
  opposite of what is true. (For the record, that array currently holds
  `BrandSetting` and `BrandCurrency` alone — not `TravelProvince`, `TeamMember`,
  `ApiKey` or `DepartmentErpMap`, which are production-only and uncovered by it.)

---

## Server

### The pure half — `src/lib/acc/travel-booking/booking-brand-access-shared.ts`

**Imports nothing at all.** AP-1's counterpart imports `ERP_INTERFACE_BRANDS`
(`approver-interface-access-shared.ts:1`) because its vocabulary is a closed
constant; AP-17's vocabulary is `AccFormBrand` rows, so there is nothing to
import and no `allBookingBrandCodes()` to write. That difference is structural
and has one consequence worth stating: **`allAccess` must stay a boolean that
short-circuits and must never be expanded into a list**, because the list cannot
be known without a database read. There is deliberately no counterpart to
`filterInterfaceBrandCodes` (`approver-interface-access-shared.ts:14-19`).

```ts
export interface BookingBrandAccess {
  /** true = no rows for this approver (or an admin) — every brand. */
  allAccess: boolean;
  /** Uppercase brand codes, when scoped. Meaningless while allAccess. */
  allowedCodes: string[];
}

export type BookingBrandScope =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "codes"; codes: string[] };

export function normalizeBrandCode(code: string | null | undefined): string;
/** Trim, uppercase, de-duplicate, sort. `Array.from`, never `[...set]` (ES5). */
export function normalizeBrandCodes(codes: string[]): string[];

export function bookingBrandScope(access: BookingBrandAccess): BookingBrandScope;
export function canActOnBookingBrand(
  access: BookingBrandAccess,
  brandCode: string | null | undefined,
): boolean;
export function filterRowsForBookingBrandAccess<T extends { brandCode: string | null }>(
  rows: T[],
  access: BookingBrandAccess,
): T[];

/** What a scoped-out actor is told. Deliberately does not name the brand. */
export const BOOKING_BRAND_SCOPE_ERROR = "ไม่มีสิทธิ์ในแบรนด์ของคำขอนี้";
```

Three rules the implementation must hold, each with the failure it prevents:

- **`bookingBrandScope` never returns `{kind:"codes", codes: []}`.** An empty
  scoped set is `{kind:"none"}`. This is D5 made unrepresentable rather than
  merely documented: the `IN ()` a caller would otherwise build is a SQL syntax
  error, and the `codes.length === 0 ? allow : filter` a caller would otherwise
  write is the escalation D4 warns about.
- **A blank or null `brandCode` is refused while scoped and allowed while
  unscoped** — the same shape as `canActOnInterfaceTarget`
  (`approver-interface-access-shared.ts:66-69`). H5 explains why this is not
  theoretical.
- **`{allAccess:false, allowedCodes:[]}` refuses everything.** That is what a
  non-approver resolves to, and it must be a refusal rather than a wave-through;
  the comment at `approver-interface-access-shared.ts:57-60` is the same rule.

### The pool half — `src/lib/acc/travel-booking/booking-approver-brands.ts`

Structurally `booking-approver-tabs.ts` with a different column, and
`approver-interface-access.ts`'s empty-means-all reading.

```ts
/** null for an approver = UNRESTRICTED, not "no brands". */
export async function loadBookingBrandsByApproverIds(
  approverIds: number[],
): Promise<Map<number, string[] | null>>;

export async function getBookingApproverBrandCodes(
  approverId: number,
): Promise<string[] | null>;

/** `null` or `[]` clears the scope. DELETE + INSERT in one writeBothPools. */
export async function setBookingApproverBrands(
  approverId: number,
  codes: string[] | null,
): Promise<void>;

export async function resolveBookingBrandAccess(
  email: string | null | undefined,
  role: string | null | undefined,
): Promise<BookingBrandAccess>;

/** Binds @bscope0..n on `req` and returns the predicate, or null for no filter. */
export function bookingBrandScopeSql(
  scope: BookingBrandScope,
  req: sql.Request,
  column: string,
): string | null;
```

- `loadBookingBrandsByApproverIds` opens `getAccPool()` — the table is
  dual-written and lives in both databases, so it must ask the one this request
  resolved to, exactly as `loadBookingTabsByApproverIds` does
  (`booking-approver-tabs.ts:27`). Rows present ⇒ `normalizeBrandCodes(list)`;
  **rows absent ⇒ `null`**, which is `allAccess` (`approver-interface-access.ts:63`
  is the same line).
- **The missing-table catch matches both halves and nothing else**:
  `msg.includes("Invalid object name") && msg.includes("AccBookingApproverBrand")`
  degrades to `null` (unrestricted) with a `console.error`; everything else
  **rethrows**. Never `||`. Two different callers depend on that narrowness in
  opposite directions — the act paths want an unreadable scope to be a 500
  (fail closed on the action), and the admin grid must show its error state
  rather than render an unreadable scope as "all ticked", because the admin's
  next tick would then POST a widened set. That is the same reasoning
  `booking-approver-tabs.ts:40-69` gives, one level along.
- `setBookingApproverBrands` normalizes, then **validates membership against
  AP-17's own `AccFormBrand` rows** (any `IsActive`, so a temporarily-off brand
  is not silently dropped) and discards anything else — the table has no CHECK
  and no FK, so code is the only place this can be enforced, the same argument
  `settings-tabs.ts:96-101` makes for `TabKey`. Then `DELETE … WHERE ApproverId
  = @aid` followed by one parameterised `INSERT` per code, **all inside one
  `writeBothPools` callback** so a partial scope cannot commit
  (`booking-approver-tabs.ts:95-109` is the shape; `dual-write.ts:41-93` is the
  machinery). `sql.NVarChar(20)` on every `BrandCode` bind. Note
  `request-service.ts:864,884` binds `sql.NVarChar(40)` into the 20-wide
  `AccRequest.BrandCode`; that pre-existing mismatch is not changed here and
  must not be copied.
- `resolveBookingBrandAccess`: `isAdminRole(role)` ⇒ `{allAccess:true,
  allowedCodes:[]}` (D6). Otherwise resolve `AccBookingApprover.Id` by
  `LOWER(Email) = LOWER(@email) AND IsActive = 1` — one query, the same
  predicate `booking-approver-tabs.ts:129` uses — and no row ⇒
  `{allAccess:false, allowedCodes:[]}`.
  It resolves the approver id itself rather than sharing
  `canAccessBookingArea`'s lookup. That is one extra indexed read on each
  booking-area request, taken deliberately: `canAccessBookingArea` has 15 call
  sites and widening its return type would change what "may this person reach
  AP-17's approver side" means at every one of them.

### The route helper — `src/lib/acc/travel-booking/require-booking-brand-scope.ts`

```ts
/** null = allowed; a Response = the 403 to return. */
export async function requireBookingBrandScope(
  session: Session,
  requestId: number,
): Promise<Response | null>;
```

It loads the brand itself, `SELECT BrandCode FROM [dbo].[AccRequest] WHERE
Id = @rid AND FormCode = @form`, pinned to `AP17_FORM_CODE` — the query
`admin-service.ts:335-342` already writes, and whose comment says why the brand
must come from the database and never from the client (`:328-334`). Fifteen call
sites reading the brand from wherever each happens to have it is how one of them
ends up reading it from the request body.

### The two queue services

`listAdminQueue` (`admin-service.ts:76`, query `:78-89`) and `listAccountQueue`
(`:149`, query `:151-161`) take **a required `access: BookingBrandAccess`
parameter**. Not optional, and no default: an optional parameter that defaults
to unrestricted is exactly how a caller added later gets an unscoped list with
no error.

Each computes `bookingBrandScope(access)` and then:

- `{kind:"none"}` ⇒ **return `[]` before the query runs**;
- `{kind:"codes"}` ⇒ `AND r.BrandCode IN (@bscope0, …)`;
- `{kind:"all"}` ⇒ no predicate at all.

The filter is pushed into SQL rather than applied to the rows afterwards, and
that matters for `listAccountQueue` specifically: its `perDiemHistory` batch
(`:169-188`) and `loadPerDiemDependencies` (`:194`) run over the id set the
first query returned, so filtering in SQL means those two never fetch rows that
are about to be discarded.

**`loadPerDiemDependencies` itself stays unscoped, deliberately.** It reads
every sibling of a queued request's `GroupKey`
(`perdiem-dependency-load.ts:68-78`), and `AccRequest.BrandCode` is per trip —
"two rows of one group can differ" (`admin-service.ts:43`). So a scoped approver
can be shown a `PerDiemDependency` naming a `requestNo` from a brand they cannot
open (`perdiem-dependency.ts:34-41`). That is accepted: the alternative is a row
whose approve button is disabled for a reason the page cannot state, and a
per-diem dependency is a fact about the group rather than a permission over it.

### The report

`queryTravelBookingReport(f, access)` (`report-service.ts:216`) takes the same
required parameter, applies the same three-way scope through its existing
`whereIn`-style binding (`:224-232`), and returns `[]` for `{kind:"none"}`.
`BASE_CTE` already selects `r.BrandCode` (`:159`) and the report already renders
it as a column (`TravelBookingReport.tsx:86`), so nothing new is projected.

**The scope is passed as its own parameter, never merged into
`TravelBookingReportFilters`.** Filters arrive from the query string and are a
request; the scope is a decision. Merging them would put the scope one
`sp.getAll(...)` away from being widened by the caller.

AP-17 needs no counterpart to AP-1's export-by-`ids=` control: verified, both
`report/route.ts:22-34` and `report/export/route.ts:26-38` build their filters
from the same named params and neither accepts an id list, so scoping the one
query scopes the export too.

---

## Routes

**No new route file.** That is a design goal, not an accident: it keeps the
source-reading gate test's pinned handler count at **11**
(`settings-tabs.test.ts:306-310`) and means no handler has to prove its gate.
An implementer who adds one anyway must satisfy that test — one
`await requireBookingSettingsTab(<ident|"literal">)` **or** `await requireRole(`
per handler, as the handler's first await, with the refusal returned
(`settings-tabs.test.ts:210-256`) — and bump the count.

`ROUTE_RULES` needs no entry either: `/api/request/travel-booking` already
classifies `AP-17`.

### `POST /api/request/travel-booking/settings/approvers` — one new field

Gate unchanged: `requireRole(["IT Admin", "System Admin"])`
(`approvers/route.ts:79`). **It must stay there and must never move behind
`requireBookingSettingsTab`** — this is the route that hands out access, which
is why `access` is absent from `GRANTABLE_BOOKING_TABS` in the first place
(`approvers/route.ts:17-23`).

```
Body: { email, displayName?, isActive?, settingsTabs?, brandCodes? }

brandCodes  omitted             → leave the scope alone
            null                → clear it (= every brand)
            string[] non-empty  → that scope
            []                  → treated as null, with a log line (D5)
```

**Detect the three states with `"brandCodes" in body`, not `Array.isArray`** —
AP-1's shape at AP-1's `src/app/api/request/accounting/settings/approvers/route.ts:75` for the same reason. `null` is a
meaningful value here and `Array.isArray(null)` is `false`, so an
`Array.isArray` test alone would make "clear the scope" indistinguishable from
"omitted". (`settingsTabs` keeps its own `Array.isArray` test at `:128`, where
`null` has no meaning; the two fields are read differently on purpose.)

The approver id is resolved from the StaffId this route derived from HR, exactly
as the tab write does (`:133`), never from a posted id.

Response `{ ok: true }`, unchanged.

### `GET /api/request/travel-booking/settings/approvers`

`listBookingApprovers` (`booking-approver-service.ts:26-53`) gains one batch read
beside its existing `loadBookingTabsByApproverIds` call (`:51`), and
`BookingApproverRow` gains:

```ts
/** null = every brand. The rows ARE the scope; there is no "no brands". */
brandCodes: string[] | null;
```

Mirrors `AccApproverRow.interfaceBrandCodes` (`src/features/accounting/types.ts:231`).

### `GET /api/request/travel-booking/settings/brands` — reused, unchanged

The grid's brand columns come from here (`AccFormBrand` for AP-17, via
`listFormBrands`, `src/lib/acc/settings-service.ts:169-185`). It is gated by
`requireBookingSettingsTab("brands")`, whose admin arm passes
(`require-booking-settings-tab.ts:67-68`) — and only admins ever reach the
สิทธิ์เข้าถึง tab, since `access` is unrepresentable in
`GrantableBookingTabKey`.

Display names come from `/api/request/accounting/options/all-brands`
(`listAllBrands` → `listBrandRegistry`), which the AP-17 settings page already
calls today through the shared `BrandSettings` component
(`BrandSettings.tsx:90-93`, mounted at
`travel-booking-settings/page.tsx:223-228`).

### The fifteen enforcement points

Every place `canAccessBookingArea` is called from a route today — verified by
grep, 2026-08-31, 15 call sites in 14 files, none of which does any brand
filtering:

| # | File | Line | Change |
|---|---|---|---|
| 1 | `admin/queue/route.ts` | 15 | resolve access, pass it to `listAdminQueue` |
| 2 | `account/queue/route.ts` | 23 | resolve access, pass it to `listAccountQueue` |
| 3 | `report/route.ts` | 17 | resolve access, pass it to `queryTravelBookingReport` |
| 4 | `report/export/route.ts` | 21 | same |
| 5 | `admin/requests/[id]/booking/route.ts` | 17 | `requireBookingBrandScope` inside `requireAdminContext`, covering POST (`:46`) and DELETE (`:102`) at once |
| 6 | `admin/requests/[id]/complete/route.ts` | 21 | `requireBookingBrandScope` |
| 7 | `requests/[id]/account-approve/route.ts` | 33 | `requireBookingBrandScope` |
| 8 | `requests/[id]/payment-date/route.ts` | 55 | `requireBookingBrandScope` |
| 9 | `requests/[id]/exchange-rate/route.ts` | 50 | `requireBookingBrandScope` — AP-1's twin already carries `canActOnClaimBrand`, asserted at `rate-override-guard.test.ts:198` |
| 10 | `requests/[id]/return/route.ts` | 70-72 | scope **only** the `atAdminStage \|\| atAccountStage` arm |
| 11 | `requests/[id]/reject/route.ts` | 68 | same |
| 12 | `requests/[id]/files/route.ts` | 169 | scope **only** the `booking_*` branch (POST) |
| 13 | `requests/[id]/files/route.ts` | 424 | same (DELETE) |
| 14 | `requests/[id]/route.ts` | 80-83 | scope **only** the `isBookingArea` read arm |
| 15 | `files/[fileId]/route.ts` | 63 | scope **only** the `isAccountArea` arm; the SELECT at `:38-43` must add `r.BrandCode` |

Four of those say "only", and each is load-bearing:

- **10 and 11** — `return` and `reject` also serve the **manager**, whose arm is
  `isManager || isAdmin || devBypass` (`return/route.ts:70-72`). A manager is
  named on the request, not drawn from a roster, and a brand scope over a roster
  must not reach them.
- **12 and 13** — the `idcard` branch of the files route is the requester's own
  file, gated on ownership plus `Draft`/`Returned` (`files/route.ts:156-163` on
  the POST, `:414-419` on the DELETE).
- **14** — owner, manager and admin are all tested before `isBookingArea`
  (`:80-83`), and the scope belongs to the fourth arm alone. Getting this wrong
  stops a requester opening their own request.
- **15** — same shape, and note that this route serves booking evidence *and*
  the national-ID scan with no `RefType` filter. That is pre-existing and out of
  scope; the brand scope narrows it rather than widening it.

**Status codes.** Out of scope on an act path is **403** with
`BOOKING_BRAND_SCOPE_ERROR`, not 404. 404 is reserved for the cases where
confirming existence is itself the leak — a UAT record, another person's ID
card. A brand partition among approvers who all already know these requests
exist is not that, and the routes it sits behind already answer 403 to a
non-member. The queues and the report simply omit rows; nothing errors.

**An unauthorized path must not mutate.** `requireBookingBrandScope` runs
immediately after `canAccessBookingArea` and before any service call, so no
transaction opens, no file is written and no mail is queued for a refused act.

---

## UI

### A second grid, not more columns on the first

`BookingApproverSettings.tsx` gains a second card below the roster card, inside
the existing `flex flex-col gap-4` container (`:315`), fed by the **same** SWR
call (`ENDPOINT`, `:257-261`) so the two grids can never disagree about who is
on the roster.

**Why not extend `ALL_GRANT_COLUMNS`** (`BookingApproverSettings.tsx:142-145`,
`[...GRANTABLE_BOOKING_TABS, ...GRANTABLE_BOOKING_MENUS]`):

1. That array is a **closed vocabulary** whose two halves are stored in one
   column of one table and posted as one `settingsTabs` array (`:185`). Brands
   are `AccFormBrand` rows that change, and they go to a different table through
   a different field.
2. It is held as a single `Set<string>` (`:154`) with no namespace separator.
   `AccFormBrand.BrandCode` is free text `NVARCHAR(20)`; a brand code literally
   spelled `brands` or `vehicles` would collide with a tab key.
3. It is the **known-broken shape**. A concatenated tick would post brand codes
   into `settingsTabs`, where `filterStorableBookingKeys` drops unknown keys
   silently (`settings-tabs.ts:159-170`) — which is precisely the failure that
   function's own comment records having already happened once for menu keys
   (`:153-157`).

### The grid

- **Heading** `แบรนด์ที่เห็น`; sub-copy
  `จำกัดว่าผู้อนุมัติแต่ละคนเห็นคำขอของแบรนด์ใดบ้าง — ทั้งคิวจอง คิวอนุมัติของบัญชี และรายงาน · ไม่ได้จำกัด = เห็นทุกแบรนด์`
- **Columns**: ชื่อ · อีเมล · **ทุกแบรนด์** · one per brand. No สถานะ column — the
  roster card above owns that.
- **The brand columns are the union** of AP-17's `AccFormBrand` rows and every
  code any scope row names, so a scope naming a brand since removed from AP-17
  is still visible and still untickable. Orphans render their raw code with the
  title `ไม่อยู่ในแบรนด์ของ AP-17 แล้ว`.
- **`ทุกแบรนด์` ticked** ⇒ `brandCodes === null`; the per-brand boxes render
  ticked and disabled. This is the control D5 exists for: without it, an
  all-unticked row and an all-ticked row mean the same thing in the database and
  the opposite thing on screen.
- **Unticking `ทุกแบรนด์`** puts the row into scoped mode with **every brand
  pre-ticked**, so the first act is to remove rather than to build from nothing,
  and no POST can ever carry an empty set. The save fires on the first real
  change, not on entering the mode.
- **Unticking the last brand is refused** with
  `ต้องเลือกอย่างน้อย 1 แบรนด์ — ถ้าต้องการเอาสิทธิ์ออกทั้งหมด ให้ปิดการใช้งานแทน`.
- **Inactive rows show their ticks**, inert, for the reason the tab grid gives
  (`BookingApproverSettings.tsx:500-507`): `resolveBookingBrandAccess` tests
  `IsActive = 1`, so hiding them would leave an admin unable to see what a
  deactivated person still holds or to set it up before switching them on.
- **The save posts `{ email, displayName, isActive, brandCodes }` and no
  `settingsTabs`.** Echoing `displayName` and `isActive` back unchanged is what
  stops a brand tick renaming or reactivating somebody (`:173-179`); omitting
  `settingsTabs` is what stops it replacing the grants, since `Array.isArray` at
  `approvers/route.ts:128` is the only thing separating "omitted" from "[]".
- **Standing notice when AP-17 has no active brand**:
  `ยังไม่ได้เลือกแบรนด์ให้ AP-17 — ตั้งค่าที่แท็บ "แบรนด์ที่เบิก" ก่อน จึงจะจำกัดแบรนด์รายบุคคลได้`.
  Not an alarm: with no brands, no scope is expressible and everybody sees
  everything, which is the status quo. Measured 2026-08-31 this does not fire —
  PCTH and KSI are both active.
- **A failed brand-list load renders the card's error state**, never zero
  columns. Zero columns reads as "there is nothing to scope" and invites an
  admin to conclude the feature is inert — the same distinction the roster
  card's `loadError` already draws between an empty list and an unreadable one
  (`:273-285`).

### Nothing else moves

No new tab, no `TAB_ICONS` entry, no change to `BOOKING_TAB_LABELS` or
`BOOKING_TAB_ORDER`, no change to `/api/request/travel-booking/access` or to
`useBookingAccess`. Menu visibility and brand scope are different questions and
stay in different places.

---

## Tests

### Pure — `booking-brand-access-shared.test.ts`

1. `allAccess` admits every code, including `null`, `""` and `"   "`.
2. `{allAccess:false, allowedCodes:[]}` refuses every code — the state a
   non-approver resolves to, and the inversion D4 is most likely to be got wrong
   at.
3. Case and whitespace: `" ksi "` matches a stored `KSI`, both directions.
4. A scoped access refuses a null/blank request brand; an unscoped one admits it.
5. `bookingBrandScope` returns `all` / `none` / `codes` for the three inputs, and
   **there is no input for which it returns `codes` with an empty array**.
6. `filterRowsForBookingBrandAccess`: keeps everything while unscoped, returns
   `[]` for `none`, drops null-brand rows while scoped.
7. `normalizeBrandCodes(["ksi","KSI"," ksi ",""])` is `["KSI"]` — and the
   implementation uses `Array.from`, never `[...set]` (ES5 target).

### Source-reading guards — `booking-brand-scope-guard.test.ts`

Shaped like `booking-currency-guard.test.ts:34-45` (read the file, strip
comments so a comment quoting a rule neither satisfies nor trips it). None of
these is expressible as a unit test: `admin-service.ts` needs a pool and `@/env`
validates the whole environment at import.

- **G1 — coverage, and the one that matters.** Walk
  `src/app/api/request/travel-booking/**/route.ts`. Every file whose stripped
  source contains `canAccessBookingArea(` must also contain
  `requireBookingBrandScope(` or `resolveBookingBrandAccess(`. **Pin the file
  count at 14.** The failure it prevents is a fifteenth booking-area file added
  later with the area gate and no scope — which no type, no build and no unit
  test would notice, and which would be a silent hole in exactly the feature
  this spec exists to build.
- **G2 — ordering.** In each such file the scope call's index is greater than
  the area gate's. A brand refusal reaching somebody who is not an approver at
  all would answer "wrong brand" to a question that should have been "not
  yours".
- **G3 — the access parameter is required.** `listAdminQueue`,
  `listAccountQueue` and `queryTravelBookingReport` declare
  `access: BookingBrandAccess` and **not** `access?:` and not a default. An
  optional parameter defaulting to unrestricted is how a caller added later gets
  an unscoped list.
- **G4 — the option source is not `listSelectableBrands`.** Neither
  `booking-approver-brands.ts` nor the new panel may name `listSelectableBrands`
  or `/api/brands`. See H2: all six `BrandSetting.IsEnabled` are `0`, measured
  2026-08-31, so that source yields zero brands.
- **G5 — the degrade is exact.** `booking-approver-brands.ts` contains
  `msg.includes("Invalid object name") &&` and `msg.includes("AccBookingApproverBrand")`
  in the same catch, and no `||` joining them. The correction recorded at
  `approver-interface-access.ts:66-88` is what this pins, on a table whose empty
  state means *all*.

### Alignment

`npm run check:alignment` must report **26** tables — or **27**, if the per-diem spec's `AccTravelPerDiemCountry` is already in. It fails until the
migration is on both databases, which is the check working
(`verify-master-alignment.ts:66-92`).

---

## Hazards

Ranked by what each one actually costs.

**H1 — The migration reaches one form database and not the other.**
`writeBothPools` (`dual-write.ts:41-93`) runs the same statement against both, so
the first admin save fails and rolls back — loud, and recoverable. The quiet
half is the read: a UAT tester working the AP-17 queue hits the missing-object
catch and degrades to **unrestricted** (D4), so a scope configured in production
silently does not apply to them. Apply to both, then
`npm run check:alignment`.
*Not the AP-4/090 shape.* `AccBookingApproverBrand` is not named inside anything
`queryBothPools` runs — verified: the my-work query in
`src/lib/acc/report-service.ts` names `AccApprover` (`:637`) and
`AccReimburseApprover` (`:651`) and **no booking-approver table at all** — so a
one-sided
apply does **not** take `/my-work` and Home's pending count down for every user
of every form. It costs AP-17's approver side only.

**H2 — The brand columns are sourced from `listSelectableBrands`.**
Measured 2026-08-31, **all six `BrandSetting` rows are `IsEnabled = 0`** (KSI,
PAL, PCMY, PCTH, SAN, UNO) while the master holds seven active codes. So
`listSelectableBrands` (`brand-registry.ts:242-244`, `.filter(b => b.isEnabled)`)
returns `ROCKS` alone — the consequence the multi-currency spec records at its
§3 and §9.2, accepted and unchanged. Layer the grid on it and **PCTH and KSI
both disappear**, so no scope can ever be set; layer the *write validation* on
it and every posted code is dropped and every scope silently clears to "all".
The two correct sources are `listFormBrands(AP17_FORM_CODE)`
(`src/lib/acc/settings-service.ts:169-185`, reads `AccFormBrand`, no `IsEnabled` anywhere)
for membership, and `listAllBrands` (`brand-options.ts:19-26`, whose header
`:9-13` says outright that disabled brands are still returned and that
narrowing belongs at the picker) for display names. G4 pins it.

**H3 — Identity lockstep on a 26th dual-written table.**
`writeBothPools` reads no id back and relies on the two counters agreeing; SQL
Server allocates identity outside the transaction, so a production INSERT that
succeeds followed by a UAT one that throws rolls both rows back and leaves the
counters one apart, permanently and silently (`dual-write.ts:32-39`). Here the
drift is cheap — `AccBookingApproverBrand.Id` is never referenced by anything;
`(ApproverId, BrandCode)` is the real key and `check:alignment` compares business
columns as well as ids. Run it after any dual-write failure. The **parent**
counter is what matters, and it is currently sound: `AccBookingApprover` holds
ids 1..4 in both databases, measured 2026-08-31.

**H4 — A reviewer "fixes" empty-means-all.**
It reads like a hole and is not (D4). The migration header, the pure module's
doc comment and this section must all say so, because the change is one line
and would blind four people. The related trap is subtler: AP-1's grid **already**
maps an all-unticked set to `[]` (`ApproverInterfaceBrandTable.tsx:18-23`),
stores zero rows for it (`approver-interface-access.ts:110`) and reads that back
as `allAccess` (`:146-148`) — so unticking everything there grants everything,
and the boxes spring back to ticked on refetch. D5's `ทุกแบรนด์` control is what
keeps that out of AP-17. Do not port AP-1's cell component.

**H5 — A submitted AP-17 request with `BrandCode = NULL`.**
Verified: the AP-17 server-side submit validator checks reason, work detail,
province, dates, times, accommodation, vehicles, departure places, rental and
the ID-card attachment (`request-service.ts:1000-1079`) and **does not check the
brand at all** — the only gate is the client's `validateTab`
(`useTravelBookingForm.ts:260-263`), and the header write coerces a blank to
`NULL` (`request-service.ts:864,884`). One such row already exists in UAT
(`Cancelled`). After this change such a request is invisible to every *scoped*
approver and actionable only by an unscoped one or an admin — the safe
direction, and the only one available, since a blank brand belongs to no scope.
Adding a server-side brand check at submit, as AP-4 already has, is a separate
change and is deliberately not folded in here.

**H6 — A leaked request number through the per-diem dependency.**
`loadPerDiemDependencies` reads every sibling of a group regardless of brand
(`perdiem-dependency-load.ts:68-78`) and `PerDiemDependency` carries the
predecessor's `requestNo` and `status` (`perdiem-dependency.ts:34-41`), so a
KSI-scoped approver can be told their sign-off is blocked by a PCTH request
number they cannot open. Accepted: the alternative is a disabled approve button
with no stateable reason. Nothing else about the request crosses.

**H7 — The scope resolved after a mutation has begun.**
`requireBookingBrandScope` must sit immediately after `canAccessBookingArea` and
before the service call. Placed after, a refused act would still have opened a
transaction, written a file or queued mail — the rule CLAUDE.md states as *an
unauthorized or stale path must not mutate the database, storage, mail or ERP*.
G2 pins the ordering against the area gate; the service call is the part a
reviewer must check by eye.

**H8 — An orphaned scope row after a brand is removed from AP-17.**
Ticking a brand off at แบรนด์ที่เบิก sets `AccFormBrand.IsActive = 0`
(`src/lib/acc/settings-service.ts:191-197`) and leaves scope rows naming it. They match
nothing and are harmless, but a grid built from the active brand list alone
would not render a column for them, so an admin could not see or clear one. The
union rule in §UI is the fix; the write-side validation admits any `AccFormBrand`
row regardless of `IsActive`, so re-saving a scope does not silently drop a
brand that is only temporarily off.

---

## Deployment

1. **Apply the migration to both form databases, before the code.**
   `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/134_acc_booking_approver_brand.sql`
   then the same with `--db Rocks_Portal_Form_UAT`. Read `ls migrations/` first
   and confirm 134 is still free — the two sibling specs' claims on 132 and 133
   are claims, not applied files. See §Schema.
2. **`npm run check:alignment`** → 26 tables, or 27 if `AccTravelPerDiemCountry` landed first. It reds until both sides have the
   table; that is the check working, not a fault. The new table contributes zero
   rows to the comparison.
3. **`npm test` and `npm run typecheck`.** The five guard tests in §Tests are
   the ones that fail loudly if an enforcement point was missed.
4. **Deploy.** Nothing changes for anyone: the table is empty, so all four
   approvers resolve `allAccess` and every queue, report and act path answers
   exactly as it did.
5. **Verify on the live host**: Settings → ตั้งค่าแบบฟอร์มขอเดินทาง →
   สิทธิ์เข้าถึง. The second card must list **PCTH** and **KSI** as columns —
   if it lists nothing, or only `ROCKS`, the option source is wrong (H2) — and
   show `ทุกแบรนด์` ticked on all four rows.
6. **Verify the filter actually filters, in UAT**, where the data is. Scope one
   approver to `KSI`, sign in as them with UAT mode on, and confirm: the `PCTH`
   request at `ManagerApproved`/`ACCOUNT` is gone from
   `/request/accounting/travel-booking/approvals`, gone from the report and its
   Excel export, and that `POST /api/request/travel-booking/requests/{that
   id}/account-approve` answers **403** with `ไม่มีสิทธิ์ในแบรนด์ของคำขอนี้`.
   The `KSI` one at the same step must still be there and still approvable.
   Then untick the scope and confirm both come back.
7. **Nothing to commission.** Unlike AP-4's approver pool, an empty table here is
   the working default. There is no seed and no first-run configuration.

---

## Out of scope

- **The requester's brand chips** — D3. `options/brands/route.ts` and
  `getAllowedBrands` are untouched.
- **AP-1's `AccApproverInterfaceBrand`**, including the `[]`/`null` conflation in
  its grid described in H4. Fixing that is a change to AP-1's settings page and
  its route, on a table seven live rows depend on.
- **Migration 124's `CanQueue` / `CanAccount` / `CanReport`** — neither read nor
  dropped here (D2). Dropping them needs its own migration against both
  databases.
- **A server-side brand check at AP-17 submit** — H5. A real gap, on the submit
  path, with its own validation ordering to think about.
- **The `files/[fileId]` route serving the national-ID scan to the whole booking
  area with no `RefType` filter.** Pre-existing; this spec narrows that route by
  brand and changes nothing else about it.
- **Whether AP-17's country determines its booking currency.** It does not —
  `effectiveBookingCurrency` falls back to the brand's currency rather than
  baht, deliberately the opposite of AP-1, with exactly one writer
  (`src/features/travel-booking/lib/booking-currency.ts:12-23`,
  `admin-service.ts:477`). That ruling belongs to
  **S3 — country on AP-17, then per-diem-by-country**, which also owns
  `AccRequest.CountryCode`, `TravelProvince`'s new `CountryCode` column and the
  per-diem-by-country rate table. Nothing in this spec depends on S3 and nothing
  in S3 depends on this one; either may ship first.
