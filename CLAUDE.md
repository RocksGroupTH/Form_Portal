# Form Portal — Developer Guide

> Internal request/forms portal for Rocks Group. Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MSSQL.
> Cloned from the **Rocks Fast** codebase with Fast Intelligence and Locations removed — see "Shared with Rocks Fast" below before running this alongside that app.

## Quick Start

```bash
npm install
cp .env.example .env.local   # Fill in credentials
npm run dev                   # http://localhost:3081
```

`README.md` carries the same quick start plus the script table and the repo
layout; it is the file to hand someone who has never seen this app.

`npm test` **discovers** its own files: `scripts/run-tests.ts` walks `src/` for
`*.test.ts` and hands them to `tsx --test`. `package.json` used to list every
file by hand, so adding a test and forgetting to list it produced a green run
that had never executed it. Pass paths to run a subset:
`npm test -- src/lib/storage.test.ts`. `npm run typecheck` is `tsc --noEmit`.

Two things about this build that look like faults and are not:

- **`experimental.cpus: 1`** (`next.config.mjs`) holds build and static generation to a single worker instead of one per core — `next build` reports "using 1 worker". Builds are slower on purpose; raise or drop the key to get the cores back.
- **`next-env.d.ts` flip-flops and will keep dirtying your tree.** `next dev` writes `./.next/dev/types/…`, `next build` writes `./.next/types/…`, so whichever you ran last shows as an uncommitted change. Nothing depends on it: `tsconfig.json` includes both paths, and `skipLibCheck` means an unresolved import inside a `.d.ts` never fails the typecheck. Commit it or leave it, but don't go hunting for the cause.

## Architecture

### 3-Database Architecture

| Database | Pool | Purpose |
|----------|------|---------|
| **Fast_Core** | `getCorePool()` | Config, brand/DB/BC connection settings, `FormEnvironment`, `UatTester`. **No longer identity** — see "Auth" |
| **Rocks_Portal_Form** | `getFormPool()` | Form definitions, submissions, approvals, files, logs, and all `Acc*` Accounting tables. Form Portal's own database — `Rocks_Portal_Form_UAT` is the UAT twin, and which one `getFormPool()` returns depends on the form **and on who is asking** (see "Parallel Production and UAT") |
| **Rocks_Portal_Form** (`TeamMember`) | `getProductionFormPool()` via `@/lib/team-member/service` | User identity and roles (migration 066). **Production only** — never the UAT twin, and never `getFormPool()`; see "Auth" |
| **Rocks_Portal_Form** (`DepartmentErpMap`) | `getProductionFormPool()` via `@/lib/acc/department-map-service` | HR department → ERP dimension mapping (migrations 099/100). **One physical copy, production only** — never the UAT twin, and never `getFormPool()`, which resolves `Rocks_Portal_Form_UAT` for a tester in UAT mode where the object does not exist. `Fast_Core` keeps a permanent synonym so the Rocks Fast and ACC Portal siblings still reach the same rows. See "DepartmentErpMap moved out of Fast_Core" below |
| **Rocks_Portal_Form** (`TravelProvince`) | **no reader left in `src/`** — ACC Portal reads it directly | AP-17 province lookups (migration 104), until AP-17 dropped จังหวัด/เมือง on 2026-09-01 and `province-service.ts` was deleted with it. The table and its 77 rows stay, because the sibling still reads them. **One physical copy, production only** — never the UAT twin (migration 104 refuses outright if pointed at it), and never `getFormPool()`, which resolves `Rocks_Portal_Form_UAT` for a tester in UAT mode where the object does not exist. `Fast_Data` keeps a permanent synonym so the Rocks Fast and ACC Portal siblings still reach the same rows. See "TravelProvince moved out of Fast_Data" below |
| **Fast_Data** | `getDataPool()` — no caller left in `src/` | Nothing here that this app's own code still reads. `TravelProvince` was the last table it read directly; migrations 104/105 moved it to `Rocks_Portal_Form` (see the row above), completing the same move already made for `DepartmentErpMap` (`Fast_Core` → `Rocks_Portal_Form`, 099/100 — **out of** `Fast_Core`, whose synonym is the one 100 left behind) and the five Business Central sync tables (`Fast_Data` → `Rocks_ERP_Data`, 101/102, see below) — `department-map-service.ts` and both `src/lib/erp/*-sync.ts` files already had no `getDataPool()` call left either. The *database* is not empty: measured 2026-08-21 it holds 20 tables — every one of them Rocks Fast's Intelligence tables (`Intel_*`, `IntelMkt*`), which this app never touches — plus six synonyms the Rocks Fast and ACC Portal siblings still read two-part: the five `Erp*` synonyms 102 left behind, and the `TravelProvince` synonym 105 left behind. `getDataPool()` stays exported only because two scripts under `scripts/checks/` (`verify-travel-province-move.ts`, `verify-erp-data-move.ts`) read through those synonyms to confirm they still resolve to the new homes. **Not** a BI/reporting database in this app. |
| **Rocks_ERP_Data** | `getErpDataPool()` | Mirror of Business Central: `ErpAccounts`, `ErpVendors`, `ErpDimensionValue`, `ErpGeneralJournalBatch`, `ErpBankAccountCard`, `ErpSyncLog` (migrations 101/102/117). Read/written by `src/lib/erp/account-sync.ts`, `vendor-sync.ts` and `dimension-sync.ts`, plus `loadErpDeptDisplayNamesByTargetBrand()` in `src/lib/acc/department-map-service.ts`. **One physical copy, no UAT twin** — `Fast_Data` keeps permanent synonyms for the original five tables so the Rocks Fast and ACC Portal siblings still reach those rows two-part; `ErpVendors` lives only in `Rocks_ERP_Data`. See "The ERP sync tables moved out of Fast_Data" below |
| **Rocks_Portal_HR** | `getHrPool()` → `getAppPool("Rocks_Portal_HR")` | Employee master, manager chain, per-diem allowance history — cross-referenced by StaffId/email |
| **Rocks_Codex** | (cross-DB query, e.g. `[Rocks_Codex].[dbo].[Holiday]`, `[Rocks_Codex].[dbo].[Brand]`) | Holiday calendar, company brand master |
| **Rocks_Portal_Form** (Acc* tables) | `getAccPool()` → `getFormPool()` | Accounting forms: travel expense (AP-1), travel booking (AP-17) |

**IMPORTANT**: Use `new sql.ConnectionPool(config).connect()` for isolated pools. Never use `sql.connect()` (global singleton — causes cross-DB bugs). Pool max is set to 30.

#### DepartmentErpMap moved out of Fast_Core

Migrations 099 (`Rocks_Portal_Form`) and 100 (`Fast_Core`) moved
`DepartmentErpMap` off the shared configuration database and into this app's
own. `Fast_Core.dbo.DepartmentErpMap` is now
`CREATE SYNONYM ... FOR [Rocks_Portal_Form].[dbo].[DepartmentErpMap]`, and the
synonym is **permanent** — but not because this app still needs it. This app's
own `department-map-service.ts` was repointed straight at the new home —
`getProductionFormPool()` at all six call sites, and **never `getFormPool()`**.
That is the hazard worth naming, and it is not `getCorePool()`: a `getCorePool()`
read would still find the rows through the synonym, whereas `getFormPool()`
resolves `Rocks_Portal_Form_UAT` for a tester in UAT mode, where the object does
not exist at all — an `Invalid object name` on the path that builds the journal
context for a Business Central posting. Repointed, the service
no longer goes through `Fast_Core` or the synonym at all. The synonym exists,
and stays, for the **two sibling repositories, which were never touched**:
Rocks Fast and ACC Portal still open a pool on `Fast_Core` and name the table
two-part, `[dbo].[DepartmentErpMap]`, from their own `erp-prep-service.ts` —
the synonym is what lets that code go on resolving to the real rows with no
change on their side. Dropping the synonym today would break the two
siblings and nothing in this app. **The move did not unshare the rows.**
Which applications read and write them did not change — only this app's own
path to them did; the two siblings' path is exactly what it always was — see
"สิทธิ์เข้าถึง" below for why `settings/departments/map` stays admin-only
regardless.

There is deliberately **exactly one copy**. A synonym names one database, so a
sibling's write through it can only ever land in `Rocks_Portal_Form` — it could
never reach `Rocks_Portal_Form_UAT`, which holds no `DepartmentErpMap` object
at all. A second copy in the UAT twin could therefore never be kept aligned
with what the siblings write, so the table is deliberately absent from
`src/lib/acc/dual-write.ts` and from `MASTER_TABLES`
(`scripts/checks/verify-master-alignment.ts`) — there is no second side to
dual-write or align against.

**`MSSQL_FORM_DATABASE` and the synonym must agree.** `getProductionFormPool()`
resolves `env.MSSQL_FORM_DATABASE` (`src/lib/db/mssql.ts:94-96`) while migration
100 hard-codes `[Rocks_Portal_Form]` as the synonym's base object
(`migrations/100_core_department_erp_map_synonym.sql:126-127`), so repointing
that env var makes this app and the two siblings read different tables — with no
error anywhere, because both names resolve to something real.

#### The ERP sync tables moved out of Fast_Data

`ErpAccounts`, `ErpDimensionValue`, `ErpGeneralJournalBatch`, `ErpBankAccountCard`
and `ErpSyncLog` are a **mirror of Business Central** — what G/L accounts,
dimension values, journal batches and bank account cards exist over there, plus
the log of each sync run. Nothing in them is a decision anybody here made, which
is the line migrations 101 (`Rocks_ERP_Data`) and 102 (`Fast_Data`) draw: data
**synced from** Business Central now lives in its own database, `Rocks_ERP_Data`,
reached through `getErpDataPool()` (`src/lib/db/mssql.ts`). The per-brand and
per-form **choices this app makes** about where money posts —
`AccBrandGlAccount`, `AccBrandJournalBatch`, `AccBrandBankAccount`,
`AccBrandBranchCode`, `AccBrandErpInterface` — are a different thing and stay in
`Rocks_Portal_Form`; there are two journal-batch tables and that distinction is
the whole point.

`Fast_Data` keeps a synonym per table pointing at `Rocks_ERP_Data`, and the
synonyms are **permanent, not a migration aid** — Rocks Fast and ACC Portal keep
opening a pool on `Fast_Data` and naming the tables two-part, exactly as before,
with no code change on their side. **One physical copy, no UAT twin**: not
dual-written (`src/lib/acc/dual-write.ts` does not name them) and not in
`MASTER_TABLES` (`scripts/checks/verify-master-alignment.ts`) — there is no
second version of what Business Central holds to test against.

**What migration 102's content guard proves, and what it does not.** Before
dropping the five `Fast_Data` tables and replacing them with synonyms, 102 checks
row counts, then compares **every non-LOB column plus `DATALENGTH` of the LOB**
column each table carries (`RawJson` on four of the five, `ErrorMessage` on
`ErpSyncLog`) — not a whole-row comparison. A payload edited to exactly the same
byte length would pass. That is a stated trade against holding an exclusive lock
on five tables a live Business Central sync writes while diffing thousands of
JSON payloads byte-for-byte.

**Standing up a new `Rocks_ERP_Data` needs migration 101 — and 101 cannot
bootstrap once 102 has already run.** Its batch 3 tops up `Rocks_ERP_Data` by id
from `Fast_Data` under `SET IDENTITY_INSERT`, reading `Fast_Data` three-part, and
it only works while `Fast_Data` still holds the five as real tables: it raises
when `OBJECT_ID('[Fast_Data].[dbo].[ErpAccounts]', 'U')` is `NULL`, which is
exactly what that expression evaluates to once 102 has turned the name into a
synonym instead of a table. So a fresh `Rocks_ERP_Data` cannot be bootstrapped
from a `Fast_Data` that has already been cut over — there is nothing left there
to copy from.

**`MSSQL_ERP_DATA_DATABASE` and the synonyms must agree.** `getErpDataPool()`
resolves `env.MSSQL_ERP_DATA_DATABASE` (`src/lib/db/mssql.ts:125-127`) while
migration 102 hard-codes `[Rocks_ERP_Data]` as every synonym's base object
(`migrations/102_fast_data_erp_synonyms.sql:199-203`), so repointing that env var
makes this app resolve G/L accounts, bank accounts, journal batches and the DEPT
dimension from a different mirror than the one the siblings reach through
`Fast_Data` — with no error anywhere, because both names resolve to something
real, and on the path that builds journal lines for Business Central. Same shape
as the `MSSQL_FORM_DATABASE` hazard above. **`npm run check:erp-data-home` is
what catches it**: `scripts/checks/verify-erp-data-move.ts` opens
`getErpDataPool()`, so it looks exactly where the app looks, and then asserts
each `Fast_Data` synonym's `base_object_name` names that same database. It used
to open `getAppPool("Rocks_ERP_Data")` — a literal, which reported on the
migration's target no matter where the app was pointed.

#### TravelProvince moved out of Fast_Data

Migrations 104 (`Rocks_Portal_Form`) and 105 (`Fast_Data`) moved
`TravelProvince` — the 77-row Thai province lookup AP-17's booking form uses —
off the shared `Fast_Data` database and into this app's own. This is the third
application of the same pattern, after 099/100 (`DepartmentErpMap` out of
`Fast_Core`) and 101/102 (the five Business Central sync tables out of
`Fast_Data`), and **with it, no code in `src/` reads `Fast_Data` at all**:
`province-service.ts` and `request-service.ts` were its last two
`getDataPool()` callers, and both moved to `getProductionFormPool()` instead.
(`province-service.ts` has since been **deleted** outright, with AP-17's
จังหวัด/เมือง field — see "AP-17 dropped จังหวัด/เมือง" below. `TravelProvince`
itself is untouched and still read by ACC Portal, which is why the synonym and
this whole note stay.)
The `src/` qualifier is load-bearing, not a hedge — `getDataPool()` is still
exported and still called, by `scripts/checks/verify-travel-province-move.ts`
and `scripts/checks/verify-erp-data-move.ts`, which read through the synonyms
to prove they still resolve to the new homes. Do not widen it back to "no code
in this application": that is what this sentence said until 2026-08-22, and the
`Fast_Data` row in the architecture table above contradicts it.
`Fast_Data.dbo.TravelProvince` is now
`CREATE SYNONYM ... FOR [Rocks_Portal_Form].[dbo].[TravelProvince]`, and the
synonym is **permanent**, for the same reason the other two are: the Rocks
Fast and ACC Portal siblings still open a pool on `Fast_Data` and name the
table two-part, with no change needed on their side.

There is deliberately **exactly one copy** — not dual-written, not in
`MASTER_TABLES`, and migration 104 refuses outright if pointed at
`Rocks_Portal_Form_UAT`. The same two facts force that as they do for the
other two moves: a synonym names one database, so a sibling's write could
never reach a UAT twin even if one existed; and **nothing writes this table in
any of the three applications** — it was seeded once by migration 049 and has
been read-only ever since, so there is no write for dual-write to carry and
nothing that could drift between two copies.

**The content guard this time is a genuine whole-row comparison**, unlike
102's: `TravelProvince` carries no `nvarchar(MAX)` column, so migration 105's
`EXCEPT` before the drop projects all four columns (`Id`, `NameTh`, `NameEn`,
`IsActive`) with nothing reduced to a `DATALENGTH` — the compromise 102 needed
for the five ERP tables' `RawJson` / `ErrorMessage` columns.

**Migration 104 cannot bootstrap a fresh `Rocks_Portal_Form` once 105 has
already run against the shared `Fast_Data`** — the same shape as 101's
bootstrap hazard, and worse in one respect: nothing ever writes this table, so
unlike the ERP mirror it cannot self-heal on the next sync. A database rebuilt
after 105 has cut over needs its 77 rows restored by hand from a backup, then
the identity reseeded — see migration 104's own header for the recovery
steps. The old `049_fast_data_travel_province.sql` is not that recovery: its
first batch is a bare `USE [Fast_Data];` (`049:7`), and `apply-sql` runs every
batch in a file through one connection, so pointed at `--db
Rocks_Portal_Form`, 049 still acts on `Fast_Data` — not on the database the
recovery actually needs.

### Parallel Production and UAT

Production and UAT run **side by side in one deployment**. There is no app-wide UAT mode, no separate host, and no build flag. Ordinary users work against `Rocks_Portal_Form` while configured testers work against `Rocks_Portal_Form_UAT` — at the same time, on the same server.

**Two switches, one tester list, and a per-viewer toggle:**

- **Each form has two independent switches** — `ProductionEnabled` and `UatEnabled` in `Fast_Core.dbo.FormEnvironment` (`FormCode`, `ProductionEnabled`, `UatEnabled`, `UpdatedBy`, `UpdatedAt`), set at **Settings → Form Environment** (`/settings/form-environment`, System Admin). **Both can be on at once** — that is the normal pilot state. UAT-only hides the form from everyone who is not testing it; both off closes it to new work entirely. A form with no row is `PRODUCTION_ONLY` (live, not open for testing). Read through `src/lib/form-environment/service.ts` (`getFormSwitchMap`, `setFormFlag`, `listFormEnvironments`). It lives in Fast_Core on purpose: resolving the switches must not depend on which form database is selected. *(The old single `Environment` string column was dropped by migration 065.)*
- **UAT is visible only to configured testers.** `Fast_Core.dbo.UatTester` (migration 063) holds the list, managed at **Settings → UAT Users** (`/settings/uat-users`, System Admin, API `/api/settings/uat-users`). Each tester carries a UAT `ManagerStaffId`, which must itself be an active tester — a chain cannot leak out of the test group. **A tester may be their own manager**, deliberately: that is how one person rehearses the whole submit-to-approve loop, and a UAT approval only ever approves test data. Removing a tester is a soft delete (`IsActive = 0`). Service: `src/lib/uat-tester/service.ts`.
- **A tester must also turn their own UAT mode on** with the **PRO/UAT switch** in the navbar (`src/components/layout/UatModeSwitch.tsx`), which renders only when they are already in UAT mode, or are an active tester *and* at least one form has `UatEnabled`. It POSTs `/api/uat-mode` — the only writer of the `form-portal-uat-mode` cookie (`src/lib/uat-mode.ts`), httpOnly, and 403 for anyone who is not an active tester. **Confirming it always lands the browser on Home**, with a full page load rather than `router.refresh()` — the destination is `urlAfterUatSwitch` (`src/lib/form-environment/uat-switch-url.ts`), and Home is the one page that is correct in either environment. Anything softer leaves the previous page showing the database the viewer just left: nearly every list here is client-fetched through SWR, and a fill page's `?id=` re-opens on reload the very record the switch was meant to walk away from. The same module's `uatSwitchLeavesRecord` decides only whether the confirmation dialog adds a paragraph saying that record is being closed.

**Resolution order** (`src/lib/form-environment/`), in this order:

1. **The record's id wins.** UAT transactional identities start at 900000 (`isUatId`, `uat-identity.ts`), so a bare id names its own database. Bounded by `boundIdEnvironment`: a **UAT** id is honoured only while the form still has `UatEnabled`, or the viewer is a tester in UAT mode, so switching UAT off actually closes it. A **Production** id is never bounded.
   **Selecting a database is not authorization.** An id ≥ 900000 routes the request to `Rocks_Portal_Form_UAT`; whether the person asking may read or act on what it finds is then decided separately by `decideRequestRead` / `decideRequestMutate` (`src/lib/acc/request-acl-policy.ts`), which refuse **anyone who is not an active `UatTester`** on a UAT record — with a 404, so the record's existence is not confirmed either. That restores the rule the design spec states and the routes did not enforce: *the whole approval chain of a UAT request stays inside the tester group* (`docs/superpowers/specs/2026-08-18-parallel-uat-design.md`). Nothing legitimate is lost — a tester's UAT manager is already required to be an active tester — but at least one `AccApprover` must be on the tester list or UAT requests stall at the ACCOUNT step, which the UAT Users page says out loud. It is **membership, not the cookie**: a tester with UAT mode off still reaches a UAT record by id, which is what makes their own test work openable from a link.
2. **The viewer's UAT mode** — cookie **and** live `getActiveUatTester()` membership, re-checked on every resolve (`viewerIsTesting`). The cookie alone is a forgeable hint.
3. **The form's switches** — `pickEnvironment` picks the one switch that answers for this viewer.

Who is asking comes from the proxy's `x-pathname` and `x-user-email` headers, **never `auth()`** — `getFormPool()` imports `src/lib/form-environment`, so a session lookup would close the loop `getFormPool → auth → jwt → getFormPool`. Code with no request scope (scripts, background work) resolves to Production.

Since migration 066 that is a hard constraint, not a preference: `auth()` no longer reads Fast_Core, it reads `TeamMember` in the form database. Everything on the path that decides *which* form database answers must therefore come from a pool this resolver does not pick — `getFormSwitchMap()` and `getActiveUatTester()` from `getCorePool()`, identity from `getProductionFormPool()`. **`FormEnvironment` and `UatTester` must stay in Fast_Core**, and `@/lib/team-member/service` must never reach for `getFormPool()`.

- **Availability and writability are different questions.** `pickEnvironment().available` asks "may this person reach the form", and an id makes it unconditionally true so records stay readable and approvable. `environmentWritable` asks "is that database still taking new work". Use `resolveCurrentFormAccess()` + `resolveCurrentFormWritable()` on a form's own route, and `resolveFormAccess(formCode, requestId?)` + `resolveFormWritable(...)` to ask about a form from somewhere else (Home, the manager card). **`assertFormWritable()` (`src/lib/uat-tester/guards.ts`) has exactly six call sites** — a `saveDraft` and a submit for each of AP-1, AP-17 and AP-4, in the three `request-service.ts` files. AP-4's `delete-service.ts` deliberately has none, and says why: the guard asks whether the database is still taking *new work*, and withdrawing a draft from a closed form is not that.
- **The manager differs by environment.** UAT routes to the requester's `UatTester.ManagerStaffId`, re-verified at submit time (still an active tester, still active in HR — self is allowed); Production reads `Rocks_Portal_HR.Employee.ManagerStaffId`. **UAT refuses rather than falling back to HR** — a real manager must never find test data in their queue. Three resolvers, keyed on the *resolved environment* and never on the cookie: `resolveManagerInfo()` (the preview card, shared), and a separate `withUatManager` for each form's submit — `resolveRequesterForActor` in `src/lib/acc/employee-context.ts` (AP-1) and `resolveEmployeeForActor` in `src/lib/hr/employee-lookup.ts` (AP-17). `resolveManagerEmail()` is deliberately *not* overridden.
- **Mail follows the resolved environment**, with one exception: a recipient who is an **active tester gets the mail at their real address** with a `[UAT] ` subject prefix. Everyone else is redirected to `UAT_MAIL_REDIRECT` (falling back to `GRAPH_MAIL_FROM`) with a banner naming the intended recipient. If neither is set, `applyUatRedirect` (`src/lib/acc/email-queue.ts`) throws and the row stays queued rather than mailing a real person. The sweep endpoint drains both databases (`processQueueBoth`); per-action drains are single-pool.
- **Business Central follows the same resolution**: `resolveEffectiveErpEnvironment()` (`src/lib/acc/erp-environment.ts`) maps UAT → Sandbox, otherwise Production. No separate ERP toggle — the navbar chip and the global `AppSetting` switch were removed on 2026-08-17. Which BC company and connection Sandbox uses is set at Settings → ERP Interface Environment. **The send echoes and verifies both its environment and its batch**, answering 409 on either drift (`ENVIRONMENT_STALE_ERROR` in the route, `ErpQueueDriftError` from `src/lib/acc/erp-interface-send.ts`) so the client reloads instead of retrying something that cannot succeed.
- **The send claims the batch atomically, and an unknown remote outcome is never retried.** Both properties were missing until 2026-08-19 and either one costs duplicated financial journals:
  - `claimRequestsForSend` takes the whole exact id set in one conditional `UPDATE` inside a transaction and requires `rowsAffected === requestIds.length`; a partial or zero claim rolls back and answers 409 **before** any external I/O. What it replaces read the statuses, then marked rows Pending one at a time with a conditional predicate whose row count was discarded — so two clicks on the same ready batch both passed and both posted.
  - the outcome is classified rather than assumed. `BcJournalPostError.definitelyRejected` (4xx — BC refused, nothing created) releases the claim to retryable `Failed`. A 5xx, a timeout or a dropped connection, and a BC success whose local `Sent` write then fails, both go to `holdForReconciliation`: the rows stay **`Pending`** with the reason in `ErpInterfaceError` and an `erp_interface_unknown` activity row, and the pre-send check refuses `Pending` outright, so nothing posts them again until a person has looked in BC. The route answers 409 (`ErpReconciliationRequiredError`) rather than 400's retry affordance. `Pending` is used as the reconciliation state because `CK_AccRequest_ErpInterfaceStatus` permits only Pending/Sent/Failed — a new value would need a migration applied to both databases before the code could ship.
- **ERP Prep is classified `AP-1`, not `BOTH`**: it is the only path that posts to BC, and the send reads its rows from a single pool. While AP-1 resolves UAT for you, the prep queue you see is the UAT queue.
- **Process-global caches are environment-keyed, and the ERP ones are form-keyed too.** `src/lib/acc/acc-cache.ts` is a shared `Map`; anything derived from a form-pool read must carry the environment in its key — `acc:journal-ctx:{Production|Sandbox}:{formCode}` (`erp-journal-context.ts`) and `acc:prep-dept-ctx:{Production|UAT}:{formCode}` (`erp-prep-service.ts`). The `{formCode}` arm is the same argument applied to the per-form ERP configuration: both contexts are built largely from tables that now answer per form, so a key naming only the environment would serve one form's G/L accounts, journal batches, department map and claim-brand-to-target mapping to whichever form asked second — silently, on the path that posts to Business Central. Invalidation stays prefix-wide (`deleteAccCachedByPrefix`) because a settings write edits the shared default, which answers every form that has no override. Request-scoped react `cache()` memos are not global and are unkeyed by design.
- **The running number floor is a function of the environment.** `UAT_SEQUENCE_FLOOR = 9000` in `src/lib/acc/sequence.ts`: UAT's first number of a year is `09001`, Production's `00001`. Applied only when a `(Prefix, Year)` row is first created, so it never rewinds. The two series stay disjoint only while Production issues ≤ 9000 numbers per prefix per year.
- **Ids never collide**: migration 061 seeds UAT transactional identities at 900000 across 23 transactional tables, and **migration 064 adds a `CHECK (Id >= 900000)`** so a restore or an ad-hoc reseed cannot silently break the property the id rule depends on.
  - **AP-4's detail tables are deliberately not among them, and only one of them could be.** Two of the three have no identity column at all: `AccReimburse` is keyed on `RequestId`, whose PK *is* the FK to `AccRequest.Id` (migration 088), so in UAT its values are already ≥ 900000 by inheritance; and `AccReimburseRuleAck` has the composite PK `(RequestId, RuleId)` and no surrogate id — it is also created by migration **089**, not 088. That leaves `AccReimburseItem` (`Id INT IDENTITY(1,1)`, 088) as the only candidate, and it does not need a floor either: the rule is that *an id in a URL* names its own database, and an item id never appears in one. Every AP-4 route is keyed on `AccRequest.Id` or `AccRequestFile.Id`, both of which 061 and 064 do cover.
- **Attachments** land under `{SHAREPOINT_ACC_FOLDER}/_UAT/{formCode}/...` — the `_UAT` segment sits between the base folder and the form code (`buildAccFolderPath`, `src/lib/acc/sharepoint-path.ts`).
- **Every new route under `/api/request` needs a rule** in `ROUTE_RULES` (`classify-path.ts`, longest matching prefix → `AP-1 | AP-4 | AP-15 | AP-17 | "BOTH" | null`). Without one it silently falls through to Production. The coverage panel on the settings page lists any route no rule covers — `matchRule` is what tells "no rule at all" apart from "a rule that deliberately says Production".
  - **AP-4's settings routes classify `AP-4`, not `null`** — the opposite of `/api/request/accounting/settings`, deliberately. `/api/request/reimburse/settings/rules` with no query string is the **form's own** checklist source, and the ticks it produces become `AccReimburseRuleAck` rows with an FK into whichever database the form resolved to. Production treatment would have a UAT tester's form read production's rule ids while writing acknowledgements into UAT. The reason first recorded for this — that AP-4's rule and approver tables are not dual-written — is **false**; they are, and they are two of the six tables that have since taken the shared list from 19 to 25. The conclusion survives the premise, which is why the real reason is written down here and in `classify-path.ts`: the next person to notice the inconsistency will otherwise remove it.
- **Shared configuration is dual-written**, not duplicated by hand: `src/lib/acc/dual-write.ts` runs each master-table mutation against both databases in a transaction, and `npm run check:alignment` asserts the **27** shared tables still match (`scripts/checks/verify-master-alignment.ts` holds the list — read `MASTER_TABLES.length` rather than trusting a number written here; AP-17 added `AccBookingApprover` and `AccBookingApproverTab`, AP-4 added `AccReimburseRule`, `AccReimburseApprover`, `AccReimburseAccess` and `AccReimburseAccessTab`, and AP-17's per-diem-by-country and brand-scoped access added `AccTravelPerDiemCountry` (133) and `AccBookingApproverBrand` (134), to the 19 that were there before. `BrandCurrency` is **not** among them — it is production-only, for the reason `currency-pool-guard.test.ts` pins). Those tables are deliberately absent from 061/064: they are not transactional, and their ids must be **identical** in both databases rather than disjoint — which neither 061's reseed nor 064's `CHECK` would allow, for the two different reasons in the third bullet below.
  - **One path copies production's id into UAT explicitly, and it must not be deleted.** `upsertVehicle` (`src/lib/acc/travel-booking/settings-service.ts:280-346`) is the exception, and the only `SET IDENTITY_INSERT` in `src/`. `writeBothPools` runs its callback against production first, so the production pass takes the plain `INSERT … OUTPUT INSERTED.Id` and the UAT pass — `isUatPass`, true exactly when the caller supplied no id but the production pass has since set one — replays *that* id under `IDENTITY_INSERT`. Its own comment says why: `AccTravelVehiclePlace` has an FK to `AccTravelVehicleOption.Id` (migration 052), and the place rows are rewritten on both passes keyed on that id, so the two databases have to agree on the parent explicitly rather than each trusting its own counter. **A reader who believes this branch is dead code and removes it breaks a cross-database foreign key silently.** Note how narrow it is: even here only the *parent* id is copied — the `AccTravelVehiclePlace` rows themselves are inserted plainly and take their ids from each database's own counter.
  - **Everything else relies on the two identity counters staying in lockstep.** Every other dual-write runs the *same* statement against each database and reads no id back; `createRule` (`AccReimburseRule`, `src/lib/acc/reimburse/settings-service.ts`) is the plain case — both databases allocate from their own counter and the ids match only because those counters are in step. The `OUTPUT INSERTED.Id` in `brand-erp-interface-map-service.ts` is not a second copying path: it is the function's own return value, taken from the production pass and never replayed into UAT. The lockstep itself rests on the two databases having been seeded from the same source with identity preserved, and on every insert since arriving through here.
  - **So a 900000 floor breaks these tables two different ways, and only one of them is loud.** On `AccTravelVehicleOption`, 064's `CHECK (Id >= 900000)` rejects the replayed production id outright — an explicit low id fails the constraint — so saving a new vehicle would fail every time, visibly. On every lockstep table the failure is quiet and worse: 061's reseed would have UAT allocate 900001 where production allocated 42, the write would **succeed**, and the two copies would diverge on ids with no error at all. Both are why these tables are absent from 061/064; only the first is the "would reject every write" that this note used to claim for all of them.
  - **That lockstep can break with no hand-editing and no error, and it is not transactional.** SQL Server allocates an identity value outside the transaction. If the production INSERT succeeds and the UAT one throws, `writeBothPools` rolls both back correctly — but production's counter has already advanced and UAT's has not. Every id allocated afterwards differs by one, permanently and silently. `check:alignment` is what detects it, and only when somebody runs it; run it after any dual-write failure, not just when approvers or vehicles look wrong.
  - **AP-4 raised the cost of that drift.** `AccReimburseRuleAck` records which rule a requester ticked *by id*, so drifted counters re-point an acknowledgement at **different rule text** — a compliance record attributing an agreement the person never made. The other shared tables' worst case is a mismatched vehicle or approver row; this one is materially worse.
  - **Dual-writing `AccReimburseApprover` means the AP-4 approver pool is not per-environment.** Adding someone so they can rehearse the accounting steps in UAT also makes them a production approver of real reimbursement payments. `AccApprover` has had exactly this property all along and it is accepted rather than a defect — recorded here so it is read rather than discovered.
- **Only two endpoints merge both databases** through `src/lib/acc/query-both.ts`: `/api/request/accounting/requests/mine` and `/api/request/accounting/work` — what a person owns or must act on. Sorting and paging happen after the merge, each row carries an `environment` tag, and `keepRowsInCurrentEnvironment` (`current-rows.ts`) then drops rows whose database is not where that form resolves for this viewer today. Nothing is deleted; flipping the switch back brings the rows straight back. **Reports do not merge** — a report is a statement about one set of books, so `/api/request/accounting/report` and its Excel export read one database only.
- **Switching a form does not move its existing requests.** They stay in the database they were written to and stay readable; only new writes go elsewhere.

### Auth

- Microsoft Entra ID (Azure AD) via NextAuth 5
- Session: `{ user: { id, name, email, role, nickname, color, photo } }` — no `hasIntel` flag (Intelligence is gone)
- Roles: `Staff | IT Admin | System Admin | Viewer`
- TeamMember lookup from **`Rocks_Portal_Form.dbo.TeamMember`** (migration 066), never Fast_Core; a missing row is provisioned at login (`provisionTeamMember`) so drafts stay owned by their creator
- **Sign-in fails closed, and a session without a positive internal id is not a session.** Three things changed on 2026-08-19:
  - `lookupTeamMemberForLogin` (`src/lib/team-member-lookup.ts`) returns `found | not_found | unavailable` instead of collapsing a database error to `null`. `signIn` denies on `unavailable`. The old `null` was read as "not a TeamMember", which sent the callback on to ask HR — and if *that* threw too, the outer catch granted a `Staff` session and returned `true`. An enabled Entra account in neither roster signed in successfully whenever the authorization source was down.
  - the HR lookup is wrapped in its own `try`, and the outer catch no longer grants anything. Entra proves *who* someone is; whether they may use this app is a question only the roster and HR answer, and that branch runs when neither could be asked. Graph photo/display-name enrichment keeps its own inner `catch`, so it stays optional.
  - provisioning failure denies the login instead of completing it with `user.id = ""`, and an existing **inactive** row denies rather than being provisioned around.
  - `requireAuth()` / `requireRole()` now require a positive integer `session.user.id` (`isUsableUserId`, `src/lib/auth-identity.ts`), answering 401 with a sign-in-again message otherwise. `Number("")` is 0, so such a session owns nothing and stamps 0 or NULL into whatever it writes. Tokens minted before this live for 30 days, hence the check at the gate as well as at the source. A *retired* row (jwt clears `userId`) now ends in that 401, which is the intent.
- Profile photo fetched via client credentials (`getADUserPhoto`) instead of delegated token
- Role hierarchy: System Admin > IT Admin > Staff/Viewer
- **The jwt callback caches the row for 60s** (`src/lib/auth.ts`). `/api/settings/users` clears that cache after `updateRole`, `addUser` and `deleteUser`, so a role change takes effect on the next request instead of a minute later. It is an in-process Map — it invalidates nothing on a second instance.
- **A row that is retired, or missing, downgrades the token to role `Staff`.** Not a logout — `requireAuth()` only needs the email — and the next successful read restores role, id, nickname, colour and photo.
- **`userId` is cleared only for a *retired* row**, where the roster positively says the person has gone. A *missing* row keeps it and logs `[Auth] no TeamMember row for …` (throttled to once a minute per email). The asymmetry is deliberate: `findTeamMemberByEmail` swallows database errors and returns null, so "missing" means *either* the row is gone *or* the form database could not be read. `userId` authorises nothing — it only selects and stamps the caller's own rows — whereas blanking it during an outage writes `Number("") === 0` into `OfficeFormSubmissions.SubmittedBy` (`int NOT NULL`, no FK) and `CreatedBy = NULL` into `AccRequest`, rows their owner can never see again. The role downgrade *does* cost access while it lasts, including the Fast_Core-backed settings pages that stay up when the form database is down; that is accepted over carrying an unconfirmed grant for the token's 30-day life.

#### TeamMember lives in Form Portal's own database

Migration 066 copied all 17 rows out of `Fast_Core.dbo.TeamMember` — ids preserved — into `Rocks_Portal_Form.dbo.TeamMember`, and left Fast_Core's copy untouched and in service for Rocks Fast. Every read and write goes through **`src/lib/team-member/service.ts`**, the single access point; no SQL elsewhere names the table. It uses `getProductionFormPool()`, never `getFormPool()` — identity must not vary with the route's environment, and 066 is deliberately **not** applied to `Rocks_Portal_Form_UAT`.

**What this bought, and what it did not:**

- ✅ **Identity and roles are no longer shared with Rocks Fast.** A role change here no longer lands in that app, and vice versa.
- ❌ **It did not remove the Fast_Core dependency.** `getCorePool()` still has more than forty call sites across a dozen modules, and two of them cannot move: `getFormSwitchMap()` (`src/lib/form-environment/service.ts`) and `getActiveUatTester()` (`src/lib/uat-tester/service.ts`) resolve *which* form database answers, so they must read a database that resolver never picks — see "Parallel Production and UAT". The app still cannot serve a request without Fast_Core.

**The two rosters diverge from the cut onward. This was accepted, not solved:**

- Both apps provision at login independently (`provisionTeamMember` in each), so a new joiner gets an unrelated row in each database.
- Form Portal's new ids start at **100001** (066 reseeds the identity to 100000); Fast_Core carries on from **2009** (`IDENT_CURRENT` on its table is 2008). An id therefore says which app created the row, and the two ranges can never collide — but an id minted in one app matches nothing in the other. The 17 shared ids are **not** a contiguous block: they are spread across 1..2008 (1-6, 1006-1013, 2006-2008). There is no low-water mark that separates "copied from Fast_Core" from "minted here" — only being above 100000 tells you that.
- **Granting System Admin, or any role, has to be done in both apps.** `/settings/users` writes only `Rocks_Portal_Form`.
- Deactivating someone in one app leaves them active in the other. Same for a name resync.
- Anything that joins `[Fast_Core].[dbo].[TeamMember]` is now reading the other app's roster. Migrations `024` and `058` still do, and `001` creates and seeds that table outright, which is why `001`, `024` and `058` all carry a **do not re-run** header. `001` is the dangerous one: its first batch is nothing but `USE [Fast_Core];`, and `apply-sql.ts` splits on `GO` and runs every batch on one pool, so the `USE` carries into the later batches whenever the pool hands back the same connection and `--db` is quietly ignored. Its last batch seeds a **System Admin** row, a no-op today only because of an `IF NOT EXISTS` on one hard-coded email.
- **`ManagerId` is unmaintained here, and now unread.** Nothing in this app writes it — `provision()` and `addOrReactivate()` both omit the column — and 066 copied exactly one populated row out of 17. Its only reader was Form Builder's `submitter_manager` workflow step, which is gone with that feature, so `managerIdOf()` and `firstActiveWithRole()` were removed from `src/lib/team-member/service.ts` along with it. A DBA curating `ManagerId` by hand in Fast_Core reaches nothing here. AP-1 and AP-17 are unaffected: their manager comes from `Rocks_Portal_HR.Employee.ManagerStaffId`, or from `UatTester.ManagerStaffId` in UAT.

### Authorization — one policy per question

Added 2026-08-19 in response to a security review. Before it, authorization on
the Accounting routes was per-route and, on the direct-by-id paths, absent:
`GET /api/request/accounting/requests/[id]` returned a full claim to any
authenticated session, `GET .../files/[fileId]` streamed any numeric file id,
`POST .../requests/[id]/files` attached to anyone's request, and
`POST .../submit` submitted it. The list endpoints were scoped, so the data was
reachable only by guessing a small integer — which is not a control.

Five shared modules now answer five distinct questions. **Route handlers must
call them rather than inventing a weaker local rule**, and each has a pure,
import-free half so it is unit-tested without a database (`@/env` validates the
whole environment at import time, so anything reachable from a pool drags a live
configuration into the test run):

| Question | Module | Notes |
|----------|--------|-------|
| May this person see / change this request? | `src/lib/acc/request-acl-policy.ts` (pure) + `request-acl.ts` (pools) | `authorizeAccRequest(session, id, "read" \| "mutate")` is the two-line route helper. Read: owner, on-behalf requester, assigned manager, or account area. Mutate: creator only, `Draft`/`Returned` only. Plus the UAT tester barrier — see "Parallel Production and UAT". |
| Are these bytes actually a receipt? | `src/lib/acc/attachment-guard.ts` | Magic-byte allowlist (PNG/JPEG/GIF/WEBP/HEIC/PDF); `File.type` is a hint only. `attachmentResponseHeaders` re-sniffs on download and serves anything non-raster as `attachment` with `nosniff` and a `sandbox` CSP. AP-1 passes `allowedKinds: ["image"]`, AP-17 also takes PDF. |
| Whose national-ID scan is this? | `src/lib/acc/travel-booking/id-card-access.ts` | Data subject only, for granting consent, listing, downloading and reusing. Sharing a department is not consent. |
| Are these books this approver's? | `src/lib/acc/approver-interface-access-shared.ts` (`canActOnInterfaceTarget` / `canActOnClaimBrand`) | Called on the prep detail, the report export (including its `ids=` form), the ERP send and the ACCOUNT approve/reject — every path that previously relied on the list's row filter. |
| Does this booking need an Admin? | `src/lib/acc/travel-booking/derive-flags.ts` | The `needs*` flags are derived from the selected option rows, never from the posted DTO. |

Two supporting pieces:

- **`src/lib/acc/request-errors.ts`** — `AccConflictError` (409) and
  `AccForbiddenError` (403), and `statusForAccError`. The Accounting routes
  answered 400 for everything a service threw, which turned "somebody else
  already submitted this" into the dialog's retryable phase.
- **`src/lib/acc/stored-file.ts`** — `deleteStoredFile` dispatches on
  `StorageBackend`. Three delete paths selected `StoragePath` alone and passed
  SharePoint driveItem ids to `fs.unlink`, then deleted the only row recording
  where the bytes were.

**Response semantics**, used consistently: `400` invalid input, `401`
unauthenticated or no internal id, `403` unauthorized, `404` unauthorized where
confirming existence is itself the leak (UAT records, another person's ID card),
`409` stale or already processed, `413` too large, `502/503` upstream. An
unauthorized or stale path must not mutate the database, storage, mail or ERP.

**The Host header is not an authorization input.** `isManagerDevBypassHost`
(`src/lib/acc/manager-auth.ts`) used to let any signed-in user action the AP-1 /
AP-17 manager step whenever the request arrived with `Host: localhost:3081` —
and `trustHost: true` means Next takes that header as given. It now also requires
a non-production build *and* `ACC_MANAGER_DEV_BYPASS=1`, default off.

**AP-17 still lets an admin action the manager step** (AP-1 deliberately does
not), but it is now recorded: `Actor.onBehalfOfManagerStaffId` makes
`logManagerOnBehalf` write a `manager_acted_on_behalf` activity row naming the
real actor and the manager they stood in for, inside the same transaction as the
approval.

### Theme — Sky

- Palette: **Sky** — pastel cool-blue light theme (`light`) plus a dark counterpart (`dark`, formerly named `gold` in the Rocks Fast original)
- localStorage key: `form-portal-theme`
- Cookie: `form-portal-theme` (persists across sessions; read by the no-flash inline script in `src/app/layout.tsx`)
- Default: `light`
- CSS variables: `var(--bg-card)`, `var(--text-primary)`, etc. — see `src/app/globals.css` for the full token list (defined once under `:root, [data-theme="light"]` and again under `[data-theme="dark"]`)
- Shape and depth: card radius `--radius-card` (14px), tile radius `--radius-tile` (12px); `--shadow-card` rather than heavy borders; tinted icon tiles (`--nav-active-bg` background behind icons); the capsule nav uses Tailwind's `rounded-full`, not a token — `--radius-full` and `--shadow-lift` are defined in `globals.css` but nothing consumes them
- Semantic action tokens live in the `@theme` block, which is where Tailwind 4 sources `text-danger` / `text-warning` and friends: action `#4c74c4` / hover `#3d63b0`, success `#3d8560`, warning `#b5793a`, danger `#c25b5b`. They are single-valued across both themes on purpose — surfaces needing a per-theme value use `--btn-danger-bg`, `--text-danger`, `--status-*` or `--ring-*` instead
- No brand-mark gradient tokens: the navbar mark is `/brandlogo/rocks.png`, not a drawn letter
- Status pills: `--status-{pending,ok,draft,bad}-{bg,text}`
- The `.acc-theme` scope on Accounting pages (`src/app/globals.css`) was retuned from the original's rose accent to Sky; its non-colour rules (hidden scrollbars, suppressed number spinners, `overflow-x: clip`) are unchanged

## Shared with Rocks Fast — and with ACC Portal

Form Portal was cloned from the Rocks Fast codebase and **still shares live infrastructure** with it. This is not a separate environment — treat both apps as one system when operating on shared resources.

**There is a third app, and it shares more than Rocks Fast does.** `ACC_Portal` points at the same `MSSQL_HOST` and the same **`Rocks_Portal_Form`** — measured 2026-08-19 from both `.env.local` files, where its `RF_FORM_DATABASE` defaults to that name. So `AccApprover` and `AccApproverSettingsTab` rows are **the same rows** in both applications, not copies: adding or deactivating an approver here changes who can act there, and vice versa. That is intended — one roster, one source of truth — but both apps' settings pages edit those rows with no locking, so a simultaneous edit is last-write-wins. Acceptable for a roster changed a few times a year; worth knowing before assuming a change was lost. ACC Portal also reads these `DepartmentErpMap` rows from its own `erp-prep-service.ts` to prepare financial journal postings — still against a pool opened on `Fast_Core`, which has reached the real rows in `Rocks_Portal_Form` through a permanent synonym since migrations 099/100 — which is why the department-mapping write stays admin-only regardless of which database holds the table — see "สิทธิ์เข้าถึง" above.

The rest of this section is about Rocks Fast:

- **Databases are no longer shared**: Form Portal owns `Rocks_Portal_Form` (plus `Rocks_Portal_Form_UAT`). `Fast_Form` belongs to Rocks Fast and this app must not read or write it. `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` and `Rocks_Codex` are still the same shared databases both apps use, in both environments.
- **Identity is no longer shared, but Fast_Core still is.** Migration 066 gave this app its own `TeamMember` in `Rocks_Portal_Form`; `Fast_Core.dbo.TeamMember` stays exactly as it is and stays in service for Rocks Fast. The two rosters now drift apart — see "TeamMember lives in Form Portal's own database" under Auth for what that costs. Fast_Core itself is still shared: `AppSetting`, brand configuration and the DB/BC connection rows are one set of rows both apps read and write, and `FormEnvironment` / `UatTester` are Form Portal's own tables that live there (Rocks Fast has no code for either). **A query in this app that names `[Fast_Core].[dbo].[TeamMember]` is a bug** — it is reading the sibling's user list.
- **⚠️ Same SharePoint folder, and the two apps' paths collide**: Accounting file attachments (`SHAREPOINT_ACC_SITE` / `SHAREPOINT_ACC_FOLDER`) point at the same document library Rocks Fast uses. `buildAccFolderPath` / `buildAccFileName` (`src/lib/acc/sharepoint-path.ts`) carry **no per-app segment**, so since the database split — Form Portal numbering out of `Rocks_Portal_Form`, Rocks Fast out of `Fast_Form` — both apps independently mint the *same* `TOFyy-nnnn`, the same draft ids and the same `AccRequestFile` ids, and therefore write byte-identical paths. `AP-1/_DRAFT/{requestId}/{type}_draft{requestId}_{fileId}.ext` is the worst case: both id spaces start at 1, so overlap there is the norm, not the exception. Two mitigations are in place and neither is a fix: `uploadFileToSharePoint` passes `@microsoft.graph.conflictBehavior=rename` so a second upload no longer replaces the first app's bytes (Graph's default is *replace*, which also hands back the same driveItem id — one requester's ID-card scan served to the other's request), and `moveSharePointFolder` is best-effort so a submit that finds a foreign `_DRAFT` folder cannot throw. Files can still end up filed under the other app's request number. **A real fix needs a per-app folder segment plus a migration of existing rows** — do not add one casually.
- **`AccEmailQueue` is no longer shared** — each app drains the queue in its own database.
- **Form Portal runs on port 3081**, Rocks Fast on 3020, so both can run at once on the same machine. (Form Portal was on 3021, then briefly shared 3020 with Rocks Fast — a period when only one of them could start.) Running them concurrently is safe **for mail** now that `AccEmailQueue` lives in each app's own database; while the queue was shared, two running apps could drain it and send approval/payment emails twice. It is **not** safe for SharePoint attachments — see the shared-folder bullet above; the port change makes simultaneous operation normal and so makes that path collision routine rather than rare.
- **`UPLOAD_ROOT`** — local attachment storage env var, and **dead configuration in this app: leave it unset.** Attachments go to SharePoint, and local disk only ever served Accounting rows created *before* SharePoint storage existed. Those rows live in `Fast_Form`, the sibling's database — measured 2026-08-19, `Rocks_Portal_Form` holds **zero** `AccRequestFile` rows and `Rocks_Portal_Form_UAT` holds 2, all `StorageBackend = 'sharepoint'`. So no code path reaches the local branch: `files/[fileId]` dispatches on `StorageBackend` and only calls `downloadFile()` for a non-`sharepoint` row, of which there are none. Unset it resolves to `{cwd}/uploads/forms`, which is harmless precisely because nothing reads it. **Every path is still containment-checked**: `resolveStoragePath` (`src/lib/storage.ts`) resolves against the root and compares with `path.relative`, so a stored `StoragePath` that escapes it raises `StoragePathError` on read, write *and* delete rather than being followed. `path.join` alone normalised `..` away and resolved happily outside the root.
- **`ERP_SANDBOX_ALLOWED_HOSTS`** (`src/lib/acc/erp-environment-shared.ts`) — host-and-port matched allowlist (`["localhost:3081", "127.0.0.1:3081"]`) gating two things: the `devHostOnly` management/settings cards in `REQUEST_CARDS` (`src/lib/constants.ts`) and the manager-approval dev bypass in `src/lib/acc/manager-auth.ts` (`isManagerDevBypassHost`). If this app's port ever changes, this list must be updated or both gates silently disappear.
  - **The cards are also shown to a tester with UAT mode on, anywhere, including the live host** (2026-08-25). Without that, a form being piloted in UAT could not be worked from the host people actually use — the queue, the report and the settings of the form under test were all reachable only from a developer's laptop, which defeats running UAT beside Production. Two facts make it a small change rather than a hole: `viewer.uatMode` from `/api/form-environment` requires an **active `UatTester` row beside the cookie** — the same rule `viewerIsTesting()` applies inside the resolver, so a forged cookie alone does nothing — and **`devHostOnly` hides links, not data**: `/request/accounting` and its AP-17 twin each fetch their own `/access` and render "no access" for anyone the approver roster and the admin roles do not admit. **The manager-approval dev bypass is untouched** and stays host-gated; it decides who may action a step, and additionally requires a non-production build and `ACC_MANAGER_DEV_BYPASS=1`.
  - **AP-17's hub card is not `devHostOnly` at all any more** (2026-08-27), which is why the "AP-17 twin" above is now the one management card everybody can see. The accounting sign-off queue had its own `REQUEST_CARDS` entry so it would stay reachable on the live host; that link moved onto the hub, showing the queue twice on one page, so the standalone card was removed — leaving the hub as the **only** door to it. Left `devHostOnly`, the Admin desk would hand requests to a queue nobody outside localhost could open and they would pile up with no visible cause. Same trade AP-4's card already carries, and it still hides a link rather than data.
- **`src/lib/brand-config.ts` is deliberately frozen** — it still contains Dashboard-DB helper fields (`dashboardDbConnectionId`, `dashboardDatabaseName`) with no callers in this app; the Rocks Fast sibling reads them for its Intelligence dashboards. The Brand Configuration settings page hides those fields in the UI but still round-trips their values on save, so Rocks Fast keeps working. **Do not "clean up" these fields** — they are load-bearing for the sibling app even though nothing in Form Portal consumes them.

## Navigation

Top bar and mobile tabs: **Home** · **My Requests** · **My Work** · **Settings** (Settings for IT Admin/System Admin only). Labels are English; in-page copy is Thai.

Only the middle two live in `NAV` (`src/lib/constants.ts`). Home and Settings are composed onto either side of it in `Navbar.tsx`'s `visibleNav` — Home as a literal, Settings behind `canAdmin` — so **adding an entry to `NAV` puts it between them**, not at the end.

- **`Home`** (`/`) — a form catalogue: greeting and stat strip, search, "Continue where you left off" (resumable drafts and Returned requests), then the **Accounting** forms — AP-1 travel expense, AP-2 advance, AP-3 clear advance, AP-17 travel booking and AP-4 staff reimbursement, filtered to the ones available to this viewer. It is a link surface only: it creates no API of its own beyond reading `/api/form-environment` for availability. `src/features/home/HomeCatalogue.tsx`.
  - **Home's card list is its own, not a filter over `REQUEST_CARDS`.** `ACCOUNTING_FORMS` in `HomeCatalogue.tsx` and `REQUEST_CARDS` in `src/lib/constants.ts` are two hand-kept lists, and a form added to one alone appears on only one surface. Environment filtering needs nothing extra either way: `/api/form-environment` resolves every code any `REQUEST_CARDS` badge names. **Their order is not one of the hand-kept things, though**: both surfaces sort through `sortByFormCode` (`src/lib/form-code-order.ts`), which reads the number out of the badge and compares it as a number, so every list renders AP-1 · AP-4 · AP-17. A plain string sort gives AP-1 · AP-17 · AP-4 — "17" before "4", one character at a time — which is what both surfaces showed until 2026-08-22. A card with no parseable badge sorts to the end of its group, so a new form still needs one; `form-code-order.test.ts` asserts every `REQUEST_CARDS` entry has one and that each group comes out in **non-decreasing** numeric order — not strictly ascending, because one form may legitimately carry more than one card in a group and `compareFormCodes` calls equal codes a tie, held in source order by the stable sort. What must never happen is a later card sorting ahead of an earlier one's number, which `<=` still catches.
  - **"Continue where you left off" is still AP-1 and AP-17 only.** `useHomeData` fetches those two drafts endpoints and `ResumableGroup.formCode` is typed to the pair; `/api/request/reimburse/requests/drafts` exists and is not read, so an AP-4 draft is resumable from the form page but is not offered here.
- **`My Requests`** (`/my-request`) — the Accounting requests you submitted and their status. Form-agnostic: `listMyRequestRows` filters on ownership, not `FormCode`, so AP-4 rows appear alongside AP-1's and AP-17's, merged across both databases by `src/lib/acc/query-both.ts`.
- **`My Work`** (`/my-work`) — requests awaiting your approval or otherwise involving you.
- **`Settings`** (`/settings`, IT Admin+) — hub of `SETTINGS_CARDS`: **API Keys** (`/settings/api-keys`), Database Connections, Business Central, Brand Configuration, **ERP Interface Environment**, **Form Environment** (`/settings/form-environment`), **UAT Users** (`/settings/uat-users`), **Users & Roles** (`/settings/users`) — the bolded four are `systemAdminOnly` — and Accounting Admin, which points at `/request?group=Settings` rather than `/request/accounting`, because the AP-1 hub would leave out AP-17 and AP-4.

**Form Builder is gone.** Its three entry points were removed first (the nav tab, the Manage Forms settings card, Home's general-forms group), and on 2026-08-19 the feature itself was deleted: the eight pages under `/forms`, all sixteen `/api/forms` routes, and `src/features/forms`. It had never been used here — `/api/forms/[formId]/workflow/steps` writes `OfficeFormWorkflows.CreatedBy` and `OfficeFormWorkflowSteps.UpdatedAt`, neither of which exists in migration `002` or `059`, so configuring a workflow always threw — while carrying an unauthenticated-in-practice upload path, an approval-claim that failed open on a null assignee, and no server-side payload validation. Nothing else in the app referenced it: `my-request`, `my-work` and Home are Accounting-only. The `OfficeForm*` tables are **left in place and unread**; no migration drops them.

The navbar also carries the **PRO/UAT switch** (`src/components/layout/UatModeSwitch.tsx`) — see "Parallel Production and UAT" above for when it renders.

Every dashboard route is also gated by `BrandGate` (`src/components/BrandGate.tsx`), a non-dismissable modal that blocks rendering until the user picks a company brand (PCTH / KSI / PCMY / UNO — `src/lib/brand.ts`). This brand cookie (`rocks-fast-brand`) is unrelated to Intelligence (which is gone); it scopes ERP/Business Central context for Accounting.

## Features

### 1. Office Forms (`/forms`) — deleted

The configurable form builder is **gone**, along with its eight pages, its
sixteen `/api/forms` routes and `src/features/forms`. See "Navigation" above for
why. The `OfficeForm*` tables remain in `Rocks_Portal_Form` and nothing reads
them; `src/lib/graph.ts` and `src/lib/storage.ts` survive because Accounting uses
both.

If it is ever revived, these are the things that were wrong with it, all of them
still true of the deleted code in git history:

- the upload route authenticated but never authorized — no parent-submission ACL
  on upload, list or download, and it built the storage path out of a
  client-supplied `fieldKey` and file name;
- `processApprovalAction` checked the actor only when `AssignedTo` was truthy, and
  `createApprovalRows` inserted `Status='Pending', AssignedTo=NULL` whenever the
  assignee did not resolve — so any authenticated session could action those;
- submissions stored arbitrary JSON: required, min/max and file constraints lived
  only in `FormFiller.tsx`;
- workflow advancement scanned *all* historical approvals, so one `Returned` row
  stopped the workflow permanently after a resubmit;
- `/api/forms/[formId]/workflow/steps` wrote two columns that exist in no
  migration, so workflow configuration threw on first use.

### 2. Request → Accounting (`/request/accounting`)

**Five** live Accounting forms share a generic request/approval backbone, plus a Business Central ERP integration layer: AP-1, AP-2, AP-3, AP-4 and AP-17. **AP-4 is the one that never reaches Business Central** — see AP-4 below; AP-2 and AP-3 have senders of their own (`adv/advance-erp-send.ts`, `clr/clear-advance-erp-send.ts`), not AP-1's. This sentence read “three forms … only AP-1 reaches Business Central” until 2026-09-04, which had been false since the AP-2/AP-3 branch merged.

**Storage:** Acc* tables live in **`Rocks_Portal_Form`**, accessed via `getAccPool()` (= `getFormPool()`, `src/lib/acc/pool.ts`). Numbered migrations in `migrations/` (013 onward) built these up incrementally against the old `Fast_Form`; `059_portal_form_baseline.sql` is the generated full-schema baseline used to stand up a new database. Apply with `npm run apply-sql -- --db Rocks_Portal_Form --file <path>` (see `scripts/apply-sql.ts`). **Every migration names its own target database in its header — read that before running it.**

**Standing up a production form database now takes 059, 066 and then essentially every numbered migration after it — do not treat any list in this file as the recipe.** It once read “059, 066, 088–092 and 099”, which was true while AP-4 was the newest thing here; AP-2, AP-3, the multi-currency work and AP-17's per-diem-by-country have since added migrations up to 136, several of them creating tables that a query names unconditionally. **Read `ls migrations/` and each file's own header**, which states its target database — and note that eleven numbers (088, 089, 090, 091, 094, 103, 117, 118, 119, 120, 124) each exist twice, from parallel branches, so a number alone does not name a file. The paragraphs below are why 066 and 099 in particular cannot simply be re-run later; they are not a complete order of application. Since AP-4 shipped, a database built from 059 + 066 alone has no `AccReimburse*` tables at all: every AP-4 route 500s, and — worse, because it is not confined to AP-4 — `/my-work` and Home's pending count break for **every** user of **every** form, since `listMyWorkRows` names `[dbo].[AccReimburseApprover]` inside a query `queryBothPools` runs against both form databases (see the deployment checklist). 059 was generated from `Fast_Form`, which never held `TeamMember`, so a database built from 059 alone has no identity table. Since the fail-closed change this now **locks everybody out** rather than degrading them: provisioning fails, `signIn` returns false, and every login lands on `/unauthorized`. That is louder than the old behaviour — which let anyone with an active `Rocks_Portal_HR.Employee` row in as `Staff` with a blank id, leaving `/settings/users` unreachable and the roster unrepairable from the UI — but it is still a stand-up mistake with no in-app remedy, so apply 066. Grep for `[Auth] blocked login (could not provision a TeamMember row)` and `[TeamMember] provision failed for …`.

`066_portal_form_team_member.sql` creates the table and copies the roster out of Fast_Core, so it goes *after* 059. It refuses to run unless the database is named `Rocks_Portal_Form…` **and** has `dbo.AccRequest`: the name test is what keeps a mistyped `--db` out of `Fast_Form`, which has `AccRequest` too and belongs to the live sibling. **066 is a copy, not a seed** — its `INSERT` reads `[Fast_Core].[dbo].[TeamMember]`, so that table must exist and still hold the roster when 066 runs. If it did not, batch 1 would commit the empty table and batch 2 roll back under `XACT_ABORT`, leaving no indexes, no FK and identity at 1; and once anyone logs in and is provisioned, the empty-table guard on the copy blocks the re-run permanently while new ids start at 1 — straight into the range 066 exists to keep clear. **Post-apply check:** `SELECT COUNT(*) FROM dbo.TeamMember` = 17 and `SELECT IDENT_CURRENT('dbo.TeamMember')` = 100000. It is the one migration that must **not** also be applied to `Rocks_Portal_Form_UAT` — identity lives in production only, and both pools reach it three-part. A new migration that changes an `Acc*` table does have to be applied to `Rocks_Portal_Form_UAT` as well, but the parallel-UAT batch is not that shape: **060, 062, 063 and 065 are Fast_Core only** (`FormEnvironment`, `UatTester`), and **061 and 064 are `Rocks_Portal_Form_UAT` only** — they refuse to run against a database whose name does not end in `_UAT`.

**099 is on that list too, and it cannot repair a rebuilt database.** `Fast_Core.dbo.DepartmentErpMap` is a permanent synonym for `[Rocks_Portal_Form].[dbo].[DepartmentErpMap]` (migration 100), so the object resolves *into* whatever database is stood up — a form database without `DepartmentErpMap` leaves all three applications' department→ERP-dimension mapping pointing at nothing. `099_portal_form_department_erp_map.sql` is what creates it. **But 099 only works while `Fast_Core` still holds the original table**, which after 100 it never does again: its batch 2 raises on `OBJECT_ID('[Fast_Core].[dbo].[DepartmentErpMap]', 'U') IS NULL` — and `OBJECT_ID(…, 'U')` is NULL for a synonym (measured 2026-08-21 against the live `Fast_Core`: `'U'` → NULL, `'SN'` → 2114106572) — so `apply-sql` stops there and **batch 3, the `DBCC CHECKIDENT` reseed, never runs**. The result is an empty table with identity at 1, allocating ids from 1 rather than from 2004 — inside the whole 1..2004 span the source had already consumed, which is the range the reseed exists to keep clear. Standing one up again means creating the table (batch 1 alone succeeds), restoring the rows from a backup with their ids, and reseeding by hand — or repointing the synonym.

**Generic header (shared by all Accounting forms):** `AccFormMaster` (form catalog), `AccRequest` (shared request header), `AccApproval`, `AccActivityLog`, `AccSequence`, `AccEmailQueue`, `AccRequestFile`.

**Running number:** `TOFyy-xxxx`-style, allocated atomically at submit via `src/lib/acc/sequence.ts`.

#### AP-1 — Travel Expense Reimbursement (`/request/travel-expense`)

Office travel-expense reimbursement form (fuel/toll/parking against a route or manual entry).

- **Pages:** `/request/travel-expense` (fill/resume draft), `/request/travel-expense/[id]` (detail + timeline + self-cancel ≤24h after submit)
- **Detail tables:** `AccTravelExpense` + `AccTravelExpenseItem`
- **Settings tables:** `AccApprover` (configured account approvers), `AccVehicle` (vehicle rate table), `AccFormBrand` (brand access per form)
- **Workflow:** Manager (resolved from `Rocks_Portal_HR.Employee.ManagerStaffId`) → Account (from `AccApprover`). Email notification at every transition via Graph queue (`src/lib/acc/email-queue.ts`), drained after each action. Account approval sets `PaymentDate`, shifted **backward** past weekends and holidays from `Rocks_Codex.Holiday` (`shiftPaymentDay`, `src/lib/acc/payment-calendar.ts`, whose loop is `cur.setDate(cur.getDate() - 1)`). This sentence said "forward" until 2026-08-20 and the AP-4 one below was copied from it.
  - **Which round is decided by noon on the Monday of that round's own week**, measured against when the **manager** approved — not against noon on the day they happened to click, and not against "now". `payment-calendar-core.ts` owns it (`weekMondayNoon`, `defaultPaymentRound`), shared with AP-4, which had the rule first; the two forms differ only in which Fridays they pay on. Until 2026-09-03 AP-1 had no cutoff at all, `AP1_HEADER_MESSAGE_LINES` promised one to requesters, and a comment beside that copy said outright that nothing enforced it.
  - **The round is a property of the claim, fixed when the manager signs.** `paymentRoundsForApprovals` anchors on each approval, so a suggestion does not move under an accountant who left the queue open over a weekend — it used to be computed against `getPaymentDates()`, which drops rounds earlier than today, so a claim approved 03/09 read 11/09 until the 11th and then silently read 25/09. That is also why `approveAccount` validates with a **one-month backward window**: without it the queue would suggest a round the approve path refuses.
  - Still a suggestion beside an editable date, not a rule that refuses — the accountant picks, and a claim that legitimately needs a later round can have one. **ACC Portal has none of this** and still takes the next round outright, so the two apps differ here.
- **Conditional fields:** `AccVehicle.IsManualEntry = true` → fare + toll inputs; `false` → OpenRouteService distance × rate + toll + parking, via `DistanceMapField` → `LeafletRoutePicker` (plain Leaflet, `dynamic ssr:false`) + ORS geocoding/directions proxied through global `/api/ors/{geocode,directions}` (`src/lib/ors.ts`). Manual-km fallback when ORS is unavailable.
- **OpenRouteService's key comes from the API-key registry** (see below), `resolveOrsKey()` being a thin wrapper over `resolveApiKey("ORS_API_KEY")`. `/settings/openrouteservice` and `/api/settings/ors` (+`/test`) still exist for the connection test; the key itself is edited at Settings → API Keys.

### API keys — one registry, with expiry and a change log

Every credential this app calls out with — Anthropic (AP-1's receipt read, AP-17's ID-card check), Google Maps, OpenRouteService — is entered at **Settings → API Keys** (`/settings/api-keys`, IT Admin+) and read through **`resolveApiKey(code)`** (`src/lib/api-keys/service.ts`). Storage is `Rocks_Portal_Form.dbo.ApiKey` + `ApiKeyLog` (migration **116** — it was 107 until the AP-2 / AP-3 work took master to 115, so read the highest number on *master* before picking one), **production only, no UAT twin, not dual-written** — a tester calls the same providers a production user does.

- **Resolution order: registry → `Fast_Core.AppSetting` → `.env`.** The middle step is why the move needed no flag day: a key nobody has entered on the new page keeps resolving exactly where it always did. `.env` is the only source that survives a database outage, so leave the vars set. `resolveGoogleMapsKey()` / `resolveOrsKey()` report either stored source as `"db"` — that signal only ever distinguished "stored" from "in a file".
- **A stored key never reaches a browser.** `listApiKeys` returns `••••abcd`; there is no endpoint that reveals one. Editing means overwriting — a blank KEY field keeps the stored value, because "leave it alone" has to be expressible without echoing the secret out and posting it back. `resolveApiKey` returns the plaintext and is **server-side only**: never put its value in a response body.
- **Encrypted at rest, or refused.** `encryptSecret`/`decryptSecret` in `src/lib/db/connection-crypto.ts` (AES-256-GCM under `CONNECTION_ENCRYPTION_KEY`, the same envelope `DbConnection.PasswordEnc` uses — one secret to rotate, not two). **With that var unset the page refuses to save at all** rather than falling back to plaintext, and says so up front instead of on a failed save. A row that will not decrypt reports `unreadable` rather than throwing, so one bad row cannot take the page down.
- **`ExpiresAt NULL` *is* "Non expiry".** There is deliberately no boolean beside it: a flag plus a date can hold two contradictory states that then have to be defended against on every read and write; one nullable column cannot. The dialog's checkbox clears the date rather than hiding it, for the same reason.
- **The date blocks nothing.** `describeExpiry` (`src/lib/api-keys/expiry.ts`, pure and unit-tested at every boundary) drives colour and copy only — grey with no date, plain over 30 days, **yellow at 30 or fewer, red at 7 or fewer**, red once past with the days counted. `resolveApiKey` does not consult it. The date is a human's note, unconnected to what the provider enforces; refusing a key on our own typed date would close AP-17 — which cannot accept an ID card it fails to verify — for the whole company while the real credential still worked.
- **The log and the change commit together**, one transaction, the shape `logManagerOnBehalf` uses. **One row per distinct change, not per Save**, so "when was this last rotated?" is one indexed query. **It never holds any part of a secret** — not the value, not the ciphertext, not the last four. An absolute rule survives future edits; "only a masked tail" does not.
- **Removal is `IsActive = 0`; there is no hard delete**, matching `UatTester` and `AccApprover`. `ApiKeyLog` therefore carries a plain NOT NULL FK: a key's history cannot be destroyed by removing the key.
- **"ทดสอบการเชื่อมต่อ" calls the provider with that row's key**, not with whatever `resolveApiKey` would answer — including a deactivated row, which the resolver skips. A test that quietly checked a different key from the one on screen would be worse than none, which is why `testGoogleMapsKey` and `testOrsKey` take the key explicitly. Each call is the cheapest thing that proves the credential: Anthropic uses `models.list` (no tokens), the other two a single geocode. A Google key locked to HTTP referrers reports **success with an explanation** rather than failure — it genuinely cannot be called from a server, and failing it would have somebody replace a key that works.
- **Each key carries its own setup manual**, opened by "คู่มือ" on the row and shown automatically inside the Add dialog once a recognised CODE is typed — the steps are wanted while the key is being fetched, not one click away after the dialog has closed. Content is **data** in `src/lib/api-keys/guides.ts`, written in the three inline forms `guide-text.ts` parses (backtick code, `**bold**`, `[label](https://…)`), so a new provider means a new entry rather than a new slab of JSX. `{origin}` is substituted at render, so Google's HTTP-referrer step names the address the reader is actually on. Two parser rules are deliberate: an unclosed marker stays literal instead of consuming the rest of the line — swallowing the tail would silently hide a step from somebody following it — and only `http(s)` becomes an anchor, so a URL in a guide can never render as `javascript:`.
- **`src/lib/api-keys/codes.ts` imports nothing, and must stay that way.** The settings page is a client component; taking `TESTABLE_CODES` off `test-connection.ts` dragged `service.ts` → `db/mssql` → `next/headers` into the browser bundle and **broke the build**, which no type error predicted. Anything both halves need to agree on belongs in `codes.ts`.
- **"นำเข้าจากที่เก็บเดิม"** copies a key still living in `AppSetting` or `.env` into the registry server-side. It exists because the value is only ever shown masked — an admin moving Google Maps here by hand would have to already know the key, and generally does not.
- **The Maps & Routing card is gone from the hub**, along with the dialog it opened. `/settings/maps` still exists and still renders the provider-*status* view, but **nothing links to it any more** — it is reachable by URL only. Deleting it and `MapProviderSettings` is a loose end, not a decision anybody has taken. `ICON_MAP` in `src/app/(dashboard)/settings/page.tsx` is hand-kept — a card whose `icon` is not in it renders with an empty tile and no type error.
- **An expense row asks for its receipt before it asks for money.** `ExpenseRow` (`src/features/accounting/components/ExpenseRows.tsx`) shows the attach tile alone until a file is on the row; attaching reveals จำนวนเงิน and reads the image for a total to prefill, editable. That makes the server's long-standing "an amount needs a receipt" rule (`validateForSubmit`) mostly unreachable rather than replacing it — **both checks stay**, because a draft written before this still holds an amount with no image, and that is also why the field is shown regardless once `amount > 0`. It never overwrites a figure already there, including one typed while the read was running.
- **The read is Claude, not OCR, and it costs money per attach.** `POST /api/request/accounting/receipt-amount` sends the image to `claude-sonnet-5` and gets a typed `{ amount }` back through `messages.parse` + `zodOutputFormat` — no text parsing anywhere. A first cut used tesseract.js plus a regex over its output; it was replaced on 2026-08-24 because Thai thermal receipts defeat it, and its parser was deleted rather than left as dead code.
  - Auth, the rate limit and the upload guards live in `src/lib/acc/vision-guard.ts`, shared with AP-17's ID-card check — see that file and the AP-17 section for why they run in the order they do. `ROUTE_RULES` needs no entry: the `/api/request/accounting` prefix already classifies `AP-1`, and the route reads no database at all.
  - **`sanitizeReceiptAmount`** (`src/features/accounting/lib/receipt-amount.ts`, pure and unit-tested) is the last gate: it refuses 0, negatives, non-finite values and anything above `MAX_RECEIPT_AMOUNT` (1,000,000฿). A model can misread, and the tax id printed on every Thai receipt is the number most likely to come back as one. **A blank editable field beats a wrong figure on a form about to be submitted**, which is why every failure path returns null rather than a guess.
  - **The field is locked while the read is in flight, and released the moment it lands — either way.** A sweep covers the whole input and it is `disabled`; a figure or a failure both free it immediately. Typing over an answer a second away only creates a race about whose number wins. **The lock can last as long as `VISION_TIMEOUT_MS` (30s)** if the provider hangs — accepted deliberately on 2026-08-25, not overlooked. What must stay true is the *failure* half: a failure never leaves the field locked, and never leaves copy on screen telling somebody to type into a box that is not accepting typing — the reading note used to say exactly that and is gone. Re-attaching the image is the retry; the failure note clears itself the moment the field holds a figure, however it got there.
  - **The "still mounted?" ref is set on mount, not only cleared on unmount** (`aliveRef`). `useEffect(() => () => { ref.current = false }, [])` looks right and is not: `reactStrictMode` is unset in `next.config.mjs`, which means **on**, so development runs effects mount → cleanup → mount and the ref stays false for the rest of the component's life. Every read then returned early — the note sat on "กำลังอ่านยอด" forever and no amount was ever filled. The other async paths in this app use a local `let cancelled = false` **inside** the effect, which is fresh per run and has no such trap; prefer that shape.
  - **A failure says which failure.** `readReceiptAmount` returns a `ReceiptFailure` alongside the null — `not-found` (the call worked, this image has no trustworthy total), `unavailable` (503 from `statusForVisionError`: a missing or revoked key, only an operator can fix it) or `error` (upstream trouble, offline) — and `RECEIPT_FAILURE_TEXT` is a `Record` over that union, so adding a kind without copy is a compile error. One line for all three said "อ่านยอดจากใบเสร็จไม่สำเร็จ", which reads as *your receipt is no good* even when the fault is ours.
  - **`ANTHROPIC_API_KEY` is `.optional()` in `src/env.ts` on purpose.** That file validates the whole environment at import, so a required key would take the entire app down on a deploy that has not set it. Unset, the route answers 503 and the field simply opens empty. **Production needs it set on the server** — `.env.local` is one machine and gitignored.
- **`focusFirstMissing` matches `[data-field]` before its ternary chain.** That chain knew five names and **everything else fell through to `vehicleRef`**, so a missing ค่าโดยสาร — key `day-N-fare-0` — scrolled to the vehicle picker rather than the expense block that was incomplete. A new block claims its own key with a `data-field` now, not an extra arm. The lookup is deferred a frame because a `data-field` inside a per-day block does not exist in the DOM until React has rendered the day just switched to. Same mechanism AP-17's form already used.
- Shared calculation logic in `src/lib/acc/calc.ts`. Travel date validation: unique per StaffId (except Rejected status), ≤1 month in the past, no future dates.

#### AP-17 — Travel Booking (`/request/travel-booking`)

Accommodation/ticket booking requests for provincial work travel — supports multiple bookings per request, an admin booking queue, an accounting sign-off, per-diem history, and on-behalf submission.

- **Pages:** `/request/travel-booking` (fill/resume draft, multi-row), `/request/travel-booking/[id]` (detail), plus office/admin views under `/request/accounting/travel-booking*` (Admin booking queue, the accounting sign-off queue at `/request/accounting/travel-booking/approvals`, report, settings)
- **Feature code:** `src/features/travel-booking/`; service/lib code under `src/lib/acc/travel-booking/`
- **Workflow, since 2026-08-27: ผู้จัดการ → Admin จอง → บัญชี (`ACCOUNT`), ending at `Completed`.** The Admin desk used to close the request itself; `completeRequest` now only hands off — `Status` stays `ManagerApproved` and `CurrentStepCode` moves to `ACCOUNT` — and `approveByAccount` (`travel-booking/approval.ts`) is the terminal transition. Accounting works the new queue at `/request/accounting/travel-booking/approvals`, picks a **payout month** (the date is always that month's last day, re-derived server-side by `POST .../requests/[id]/payment-date` rather than trusted from the client; months run from the current one forward, because a payout already in the past is not a schedule), and signs. From there the amount is read-only — on the page *and* in the route, because a control removed from a page is not a rule. **The step needed no migration**: `CK_AccApproval_Step` has permitted `ACCOUNT` since 091, `CurrentStepCode` is `NVARCHAR(20) NULL` with no CHECK, and `AccActivityLog.Action` has none either.
  - **A trip that needs nothing booked no longer skips accounting** — `approveByManager` sends it to `ACCOUNT` instead of closing it to `Completed`. That case is per diem and nothing else, which is precisely what the accounting step and its editable payout month exist for.
  - **`Status='ManagerApproved'` stopped naming one stage**, and every predicate that tested it alone now tests `CurrentStepCode` beside it: the Admin panel and its two banners, the Admin queue's side-panel close, `requireEditableBooking`, and the booking-attachment `POST`/`DELETE` — those last were `Status`-only, so an account-area viewer could still upload or delete booking evidence on a request already handed over. `TravelBookingRequest.currentStepCode` carries the step into the read shape so the client can tell the two apart, and `travelBookingStatusLabel(status, step)` answers “รอ Admin จองให้” / “รอบัญชีตรวจสอบ” where a caller has one; the bare `ManagerApproved` label is now the stage-neutral “ผู้จัดการอนุมัติแล้ว”, which is what reaches the Excel export.
  - **Accounting has three ways out, not just approve.** `returnByAccount` steps back to `ADMIN` — a step, not a new status, so the request stays alive and re-enters the Admin queue, and `PaymentDate` is kept because nothing later would mint it again — and `rejectByAccount` ends it as `Rejected`, clearing `PaymentDate` and giving the group's per diem back. Both require a comment. The Completed email is sent by `approveByAccount`, at the point it is true; the hand-off logs `sent_to_account` and mails nobody.
- **A per-diem day taken by a trip that is later cancelled is given back.** A trip departing on the day the one before it returned drops that day as a duplicate at submit (`continuation-chain.ts`), and until 2026-08-27 nothing recomputed it, so the day simply vanished. `recomputeGroupPerDiem` now runs **inside the cancelling transaction** — `rejectRequest`, `rejectByAdmin` and `cancelByRequester` — re-derives each surviving trip's continuation flag against the group's trips *still alive*, and rewrites `PerDiemDays`/`PerDiemTotal` **and `AccRequest.TotalAmount` in the same statement batch**: the header figure was stamped once at submit and never written again, so My Requests and My Work read one number while the accounting queue and the report read another, with no way to tell which was right.
  - **The recompute window is an allow-list**, `perDiemWritable` (`perdiem-window.ts`): `Draft`, `Submitted`, `ManagerApproved`, `Returned`. A status added later is far more likely to be another terminal state than another editable one, and overwriting a figure somebody has already been paid on is the expensive direction to be wrong in.
  - **A row it may not touch still gets the audit row.** Every recompute writes `AccActivityLog` with `Action='perdiem_recalculated'`, before/after and the causing request in `MetadataJson`; a request past accounting gets one with `after == before` and `locked: true`, so the gap is visible rather than silent, and the note branches on *why* the row is frozen rather than always claiming accounting had signed it. `AuthorId` is NULL on all of them — nobody did it, a cancellation elsewhere caused it. A dedicated `AccTravelPerDiemLog` was considered and rejected: it would be a second history for one request, shown in a second place, and the timeline is where a reader already looks.
  - **Nothing backfills.** Groups submitted before this keep the per diem they were given, including a day dropped for a trip since cancelled; the recompute runs on future transitions only.
- **The accounting sign-off is blocked while the figure can still move.** `perdiem-dependency.ts` (pure, import-free) names the predecessor a row's per diem depends on — so it can be said on screen — and answers whether that request is settled, so the approve control can refuse; `perdiem-dependency-load.ts` is its one-query database half, taking a pool *or* an open transaction so the queue and the sign-off share one loader and cannot disagree about the same request. A blocked row's checkbox and approve button are disabled and it is dropped from the selection itself, and `approveByAccount` re-decides it from the database inside the transaction that just claimed the row, throwing to roll the claim back — a stale page, a replayed POST or the batch loop must not slip past an undecided predecessor.
  - **`ManagerApproved` counts as settled, and that is safe because the gate and the recompute window compose.** Signing sets `Status='Completed'`, which is absent from `perdiem-window.ts`'s `WRITABLE` — so the sign-off itself freezes the figure, and a predecessor rejected afterwards writes its log row without moving the number. `Returned` and `Draft` are deliberately **not** settled: either can still be submitted and approved into the group. That list is an allow-list too, so a status this file has never heard of counts as unsettled — refusing a sign-off that could have gone ahead costs somebody a second look, allowing one on a figure that then moves costs a wrong payment.
- **A trip cannot depart before tomorrow.** A booking desk has to actually book something, and a request naming today reaches them with the day already gone; same-day travel is a reimbursement, which is what AP-1 is for. **The boundary is the calendar, not twenty-four hours** — filling the form at 23:59 offers the same earliest date as filling it at 00:01, because a rule that slid with the clock would offer a day at one hour and refuse it the next. One pure rule, `earliest-travel-date.ts`, asserted in three places: the picker's `minDate`, the client validator — a resumed draft still holds whatever date it was saved with, including one that has since gone by — and `validateTab` at submit. A blank date is not “too soon”; the required-field check speaks to that.
- **A booking row records the invoice's full breakdown, and an AI read fills it in.** `AccTravelBookingDetail` held `BookingNo` and `PriceExVat`, so a booking recorded a number and one figure; **migration 123** adds `VatAmount`, `DiscountAmount` and `TotalAmount`, and because that one table discriminates room / ticket / rental with `BookingType`, all three kinds gain the same shape at once. **`TotalAmount` is stored, not derived**: rounding, service charges and how a supplier applies a discount mean `PriceExVat + VatAmount − DiscountAmount` does not always equal what was charged, so the invoice's own total is the fact and the arithmetic is a check on it — the form computes the suggestion and flags a mismatch. `sanitizeBookingAmount` gates every figure in the **service**, not the panel, and `sanitizeBookingNo` refuses an over-long answer rather than letting `NVARCHAR(100)` truncate the wrong thing into a booking reference.
  - **`POST /api/request/travel-booking/booking-fields`** is AP-1's `receipt-amount` with a different question. Same `vision-guard.ts`, the same per-kind content build through `sheet-text.ts` / `pdf-to-image.ts` (`allowedKinds: ["image", "pdf", "spreadsheet"]` — a confirmation arrives as a PDF far more often than as a photo, and a travel agent's statement as a workbook), the same error mapping, and **its own rate-limit bucket, `booking-fields:`**. `ROUTE_RULES` needs no entry — `/api/request/travel-booking` already classifies `AP-17` — and nothing is stored by the route; the file is uploaded separately by the attachment route.
  - **The five fields are locked until a file is attached and the read has landed — and a failure unlocks them.** This is a **deliberate divergence from the fail-closed rule stated a few bullets above, not an inconsistency to be tidied away**: the ID-card check fails closed because an unverified national ID scan is the exact thing it exists to stop, and there is no equivalent safety property here. A booking desk that cannot type a booking number because Anthropic is down is a desk that cannot work at all. The failure note names which failure and always ends in “type it in yourself”, beside fields that are by then accepting typing.
  - **The figures follow the file.** A row's *first* attachment clears whatever was there and its read owns the row — the usual “a person outranks the read” guard is skipped there, and would be wrong: the fields were blanked in the same tick, so the guard would restore exactly what the clear removed — and losing the *last* one clears them again. First and last, never any file: a second attachment is another page of the same booking. **The lock describes a row with nothing in it yet, not a row with no file**, and reads the saved row rather than the live inputs; written as `!hasFile` it stranded rows saved before it shipped behind a message telling their owner to attach a file, and a half-typed value could change whether the box being typed into was open.
  - **Attachments upload on save, not on pick.** Picking holds the `File` in component state; “บันทึกข้อมูลการจอง” persists the row and then POSTs them. `ensureDetailId` is deleted, so the row has exactly one creator and a card nobody ever saved leaves neither an `AccTravelBookingDetail` row nor bytes in SharePoint. A failed upload keeps the held files, so pressing Save again is the retry. The read still runs on the pick — the point of it is that the fields fill while the person is looking at them.
  - **เสร็จสิ้น is blocked while any row holds unsaved edits**, with the reason in Thai beside the button — signing a booking off against figures that exist only on somebody's screen is the thing that must not happen, and it used to be invisible. Each row also offers a local revert to its last save: no fetch, no DELETE, stored files stay stored, so it needs no confirm dialog, unlike the two controls beside it that delete rows and bytes.
  - **Five pure modules now carry AP-17's booking rules, each extracted because the inline version broke**: `booking-amounts` (14 tests), `booking-lock` (8), `booking-file-sync` (4), `booking-dirty` (10) and `earliest-travel-date` (6).
- **AP-17 attachments open in the shared `AttachmentViewer`, never a new tab.** A non-image was an `<a target="_blank">` pointed at the download route, which serves through `attachmentResponseHeaders` — `Content-Disposition: attachment` with `nosniff` — so the new tab downloaded the PDF and closed, and “view” did not view. The viewer AP-1 and AP-4 already use fetches the bytes and renders them from a Blob inside our own origin, precisely so no response header needs relaxing; all three AP-17 sites (`AdminBookingPanel`, `TravelBookingDetail`, `IdCardUpload`) now open it, with the kind from `attachmentKind(fileName, contentType)` in place of five hand-rolled `startsWith("image/")` checks — that helper's filename fallback is load-bearing, since SharePoint returns `application/octet-stream` often enough to mislabel an ordinary `.pdf`. `IdCardUpload` is display only: every access check, the consent flow and every upload guard are unchanged, and `id-card-access.ts` still decides whose bytes are reachable.
- Uses `Rocks_Portal_HR.EmployeeAllowanceLog` for effective-dated per-diem history. **It no longer reads `TravelProvince`**: จังหวัด/เมือง was dropped on 2026-09-01 and `province-service.ts`, its two routes and the settings editor went with it. The table stays for ACC Portal — see "TravelProvince moved out of Fast_Data" above.
- **AP-17 dropped จังหวัด/เมือง** (2026-09-01). The work location is picked from Google Places in the browser, which already names the city, so a second administrative field was a second place for the same fact to be wrong. Migration 135 added `Lat`/`Lng` to `AccTravelWorkLocation` so the detail page can pin it; **nothing can backfill them** — the Google key is HTTP-referrer restricted, so a server-side geocode answers 403, and every location filed before that date has none and renders no map rather than a wrong one.
- **The "is this a national ID card?" check is Claude, and the heuristic it replaced never worked.** `POST /api/request/travel-booking/id-card-check` sends the image to `claude-sonnet-5` for a typed `{ isIdCard, reason }`. Until 2026-08-24 the check ran tesseract in the browser and passed an image on **either** a 13-digit run **or** a Thai ID keyword — and a Thai **tax id is also exactly 13 digits**, printed on every ใบกำกับภาษี, so a receipt verified as a national ID card and got the green "ตรวจสอบแล้วเป็นบัตรประชาชน" badge. Its digit pattern allowed a space or a dot between digits too, so one line of prices (`199.00 249.00 30.00`) matched as well — measured, not inferred. **No regex over OCR text can separate a tax id from a national ID number**; do not try to bring one back.
  - **The image is a national ID scan** — the most sensitive thing this app handles, and why `id-card-access.ts` restricts it to the data subject alone. Sending it to a third party was decided deliberately. It already reaches Microsoft (SharePoint) on save; this adds a second processor, not the first. Nothing is stored by the route.
  - **It fails closed, and that is a decision with a stated cost.** Nothing is attached without a verdict of `true`: no key, rate limited, upstream down, offline and "this is not a card" all refuse the file identically. **So while the check cannot run, AP-17 cannot be filed at all** — the card is required to submit. Fail-open was built first and rejected, the trade named and accepted: a card image nobody verified is exactly what the old heuristic produced, and stopping that was the point. A `null` answer from the model is likewise never a pass. `looksLikeThaiIdCard` (`features/travel-booking/lib/idcard-check.ts`) still marks the no-verdict case `unavailable`, but only so the copy can name the right remedy — *wait* (429), *tell IT* (503), *retry*, or *attach a different photo* are not interchangeable advice once a failure blocks the requester. The green badge is unconditional again, and truthful, because nothing becomes a pending file without passing.
  - **An invalid key and a missing one are the same situation, and neither is "try again".** `statusForVisionError` (`src/lib/acc/vision-error.ts`, pure and unit-tested) maps an upstream **401/403/400** to **503** and everything else to 502 — retrying a revoked key fails identically forever, and the only remedy is an operator's. Found the hard way on 2026-08-24: a key that was present and the right length answered `401 authentication_error — API key is invalid`, and the requester was shown a dialog titled **"ไม่ใช่บัตรประชาชน"** telling them to pick a different photo. Both halves were wrong, and the dialog now reads its title and its button off `refusal.unavailable` instead of hardcoding the not-a-card wording. **When somebody reports a valid ID card being rejected, check the key before the photo.**
  - Guards, rate limit and client construction are shared with AP-1's receipt read through `src/lib/acc/vision-guard.ts` — one copy, because each step there is either a cost control or an upload guard and two copies would drift: auth, then a per-user rate limit **before the body is read**, then the uploads' own magic-byte allowlist, then a narrowing to the four media types the Messages API accepts (`allowedKinds: ["image"]` also admits HEIC, which the clients re-encode away but a direct caller could post). `ROUTE_RULES` needs no entry: `/api/request/travel-booking` already classifies `AP-17`.
  - **The rate-limit buckets are keyed per purpose (`id-card-check:` / `receipt-amount:` / `reimburse-item:` / `booking-fields:`), and fail-closed is why that matters.** Sharing one bucket would let a requester burn their allowance on AP-1 receipt reads, or on reading a booking confirmation, and then be unable to attach an ID card at all. It is an **in-process `Map`** (`src/lib/rate-limit.ts`; the pure `decideRateLimit` is unit-tested), so a second Node instance counts separately — the same caveat `auth.ts`'s jwt cache carries.
  - **Nothing in this app OCRs *in the browser* any more** — `src/features/travel-booking/lib/idcard-ocr.ts` is gone, and what survived is its decode-and-downscale half, now `src/lib/image/downscale.ts` (`toDownscaledCanvas`), which both image reads use before posting; the 1600px cap is a cost control, since image tokens scale with area, and re-encoding is what turns a phone's HEIC into a media type the API accepts. **`tesseract.js` is still a dependency and must stay one**: AP-2 / AP-3 added `src/lib/ocr.ts`, a *server-side* tesseract worker that `src/lib/clr/slip-verify.ts` reads transfer slips with. This branch uninstalled it while that code did not yet exist on master, and the merge put it back — **check `src/lib/ocr.ts` before concluding the package is unused again.**
- **จุดขึ้นรถ/ขึ้นเครื่อง has no default, since 2026-08-31.** It used to pre-fill ขาไป with `กรุงเทพมหานคร` and ขากลับ with the province being travelled to; both guesses are gone, and with them `src/features/travel-booking/lib/departure-default.ts`, its 8-case test file, `GO_DEFAULT_DEPARTURE_PLACE`, the file-local `departureDefaults`/`placeOf`/`writePlace` helpers, and the two `TabFormState` fields — `goAppliedDeparturePlace` / `returnAppliedDeparturePlace` — that existed only to tell the form's own fill apart from a place the requester typed. With nothing writing a default, that distinction stopped describing anything. `selectProvince` is now `onChange({ provinceId: id })` and nothing else. Every requester types both directions by hand. **The field is exactly as required as it was** — removing the default is not the same change as making the field optional, and nobody has made that second change: the client validator (`useTravelBookingForm.ts`) and the server validator (`request-service.ts`, `กรุณาระบุจุดขึ้นรถ/ขึ้นเครื่องขาไปอย่างน้อย 1 แห่ง`) are untouched, and both still gate on the vehicle's persisted `goNeedsDepartureLocations` / `returnNeedsDepartureLocations` flags, not on whether a default was ever written. Design: `docs/superpowers/specs/2026-08-31-ap17-departure-blank-design.md`.
- **The `เปลี่ยนผู้ขอเบิก` button is never gated on department size, on any of the three forms.** AP-1 and AP-17 rendered it only when `colleagues.length > 0` — `colleagues` being the actor's own HR department — which stopped making sense once the picker's `?q=` searched the whole roster, and hid a working feature from anyone who is the only person in their department.

#### สิทธิ์เข้าถึง — who sees, and who may

Added 2026-08-20. Two questions that look alike and are not: **who sees a menu**
and **who may act**. Getting them the same way round is what this section is
for.

- **`canAccessAccountArea` (`src/lib/acc/access.ts`) did not change and must
  not.** It is still `isAdminRole(role) || isAccApprover(email)`, and it is the
  server-side gate for the shared object ACL (`request-acl.ts`), every ERP
  route and every AP-1 account-area route — 10 call sites, and 28 mentions once
  its definition and the comments naming it are counted.
- **What changed is what `/api/request/accounting/access` *reports*.** Its
  `account` flag is now the approver roster **alone**. An IT/System Admin who
  is not an `AccApprover` no longer sees AP-1's queue or report. They keep
  ตั้งค่า, so nobody can lock themselves out — an admin can always grant
  themselves.
- **`canAccessBookingArea` (`src/lib/acc/booking-access.ts`) is AP-17's
  counterpart** and keeps its admin arm for the same reason. Its endpoint,
  `/api/request/travel-booking/access`, likewise reports the roster alone.

**AP-1's settings tabs, in ACC Portal's order:** แบรนด์ที่เบิก ·
เบิกวันซ้ำข้ามแบรนด์ · พาหนะ & เรท · แผนก (HR ↔ ERP) · Interface ERP ·
**สิทธิ์เข้าถึง** — the last being the former `ผู้อนุมัติบัญชี`, moved to the end
and renamed. The `TabKey` union kept its member names, so bookmarked `?tab=`
links still work.

**Five of the six are grantable to an individual approver**, through
`AccApproverSettingsTab`. `approvers` is deliberately not one of them: it is the
tab that hands out access, so granting it would let a non-admin grant
themselves the rest. It is unrepresentable in `requireSettingsTab`'s parameter
type, not merely filtered.

**`AccApproverSettingsTab` needed no migration.** Migration 059 created it in
both form databases and it was already one of the dual-written master tables —
ACC Portal had been its only writer anywhere.

**A grant is real, not cosmetic.** `requireSettingsTab`
(`src/lib/acc/require-settings-tab.ts`) gates the settings routes per tab:
**23 of the 28 handlers** across the 16 route files under
`/api/request/accounting/settings/**` are tab-gated, and **5 stay
`requireRole`**:

| Admin-only | Why |
|---|---|
| `settings/approvers` | the tab that hands out access |
| `settings/departments/map` | writes `DepartmentErpMap`, rows shared with two sibling applications — see below |
| `settings/departments/sync` | writes `Rocks_ERP_Data`, the Business Central mirror two sibling applications also read through `Fast_Data`'s synonyms — see "The ERP sync tables moved out of Fast_Data" above |
| `settings/erp-accounts/sync` | writes `Rocks_ERP_Data`, the Business Central mirror two sibling applications also read through `Fast_Data`'s synonyms — see "The ERP sync tables moved out of Fast_Data" above |

*(ACC Portal has the grant feature and not this gate — its settings routes are
`requireRole([...ADMIN_ROLES])` with "Account Admin" excluded, so a granted
approver there sees a tab whose data 403s. We deliberately did not copy that.)*

**`departments` is grantable for reading only.** The read
(`settings/departments`) is tab-gated; the write (`settings/departments/map`) is
not, because `saveDepartmentMappings` writes `DepartmentErpMap` — and **both
`RocksFast` and `ACC_Portal` read those same rows from their own
`erp-prep-service.ts`**, the path that prepares financial journal postings.
Since migrations 099/100 the table itself lives in `Rocks_Portal_Form`, reached
from `Fast_Core` by a permanent synonym; the siblings still read exactly what
they always read, which is the whole reason the rule below did not move with
the table. A tab grant must not become write access to another application's
posting configuration.

That route also takes a client-supplied `legacyClaimCodes` list into a
`DELETE … WHERE BrandCode = @brand` loop. It is bounded by
`claimCodesForInterfaceTarget` (`src/lib/acc/department-map-guard.ts`) to the
claim brands whose interface target is *this* target — not to every allowed
brand, which would still have let one request purge the table.

**`/api/users/search` is not part of any tab.** Two settings panels call it, but
it is the global Azure AD directory search and stays `requireRole`. A granted
approver can use the whole same-day tab, including its POST, which takes a
staff id directly or resolves an email against HR. What they cannot use is the
**Add button**, because that opens the directory search. (An earlier draft of
this sentence said adding a row needs an admin. It does not — that is the same
false claim this branch deleted from the panel itself.)

**AP-17 has its own roster: `AccBookingApprover`, migration 095**, applied to
both form databases. Numbered 095 rather than 067 because 088–094 belong to the
unmerged AP-4 branch — and 073 upward to the unmerged feat/ap-2-advance
branch, so master having only 066 is not the number to reason from. `MASTER_TABLES` in
`scripts/checks/verify-master-alignment.ts` went 19 → 20 with it.

`scripts/seed-portal-form.ts` deliberately does **not** list it, and the note in
the slot where the entry would go says why: that script copies from
`SOURCE_DB = "Fast_Form"`, the Rocks Fast sibling, which has no such table, and
`copyTable()` opens with an unguarded `SELECT *` — a list entry would abort the
seed partway. Migration 095 is what creates it.

ACC Portal gates both forms with AP-1's `AccApprover`. **We deliberately do
not**: someone who arranges hotel bookings should not thereby gain the
travel-expense approval queue, or the reverse.

**`AccBookingApproverTab` carries two vocabularies since 2026-08-27, and keeping
them apart is the design.** Beside the five settings-tab keys it now holds two
**menu** keys — `bookingQueue` and `accountApproval` — granting sight of the
Admin booking queue and the accounting sign-off queue. **No migration**: the
table has no CHECK on `TabKey`, which is what makes a second vocabulary possible
without one, and exactly what makes the code-side separation load-bearing.
`isGrantableBookingTabKey` must refuse a menu key and `isBookingMenuKey` must
refuse a tab key, or a menu tick becomes a way past `requireBookingSettingsTab`
into the configuration routes. Storage goes through `filterStorableBookingKeys`
(tabs ∪ menus) while authorization stays on the narrow grantable filter — and
that split is the whole feature, because `booking-approver-tabs.ts` applies its
filter on **both** read and write, so before it a menu tick was dropped twice
over and saved nothing at all.

**The hub filter is roster membership OR the grant, deliberately not the grant
alone.** Measured 2026-08-27, `AccBookingApproverTab` held **zero** rows while
`AccBookingApprover` held **two** active ones, one of them a Staff-role
Accounting Manager — gating on the grant alone would have taken the booking
queue away from exactly the person it exists for, on the day it shipped. A tick
therefore *adds* reach, opening a menu to somebody who is not on the roster; it
is not a second thing a roster member must also be given. Showing a card leaks
nothing either way: both pages authorize with `canAccessBookingArea`
server-side, and **roster membership is still what permits the action**.

**Do not grant `erpInterface` to a non-admin yet.** `gl-accounts`,
`bank-accounts`, `journal-batches` and `branch-codes` are tab-gated but **not**
brand-scoped: they apply only `assertClaimBrandAllowed`, which asks whether the
brand is enabled in AP-1, not whether this approver may act on it. `erp-config`
*is* scoped, through `AccApproverInterfaceBrand`. So a KSI-scoped approver
holding that grant could set PCTH's G/L account, bank account, journal batch
and branch code — the values every journal line carries — while being properly
brand-scoped when approving, sending or exporting a single PCTH claim.
`refuseOutOfInterfaceScope` drops into all four unchanged; until it does, the
grant is safe only because nobody holds it.

**Commissioning — both tables shipped empty, so the feature arrived switched
off. One of them has since been seeded; measured 2026-08-21:**

- `AccApproverSettingsTab` is still **empty**, so no non-admin sees an AP-1
  settings tab until an admin ticks one at Settings → สิทธิ์เข้าถึง.
- `AccBookingApprover` held **one active row** on 2026-08-21 —
  `sattawat.c@rocksgroup.com`, in both form databases — added outside this
  repository, and **two** when re-measured 2026-08-27, the second a Staff-role
  Accounting Manager. So AP-17's booking queue, its accounting sign-off queue
  and its report are **not** hidden from everyone: those two see them, as do
  admins, and everyone else does not until they are added at Settings →
  ตั้งค่าแบบฟอร์มขอเดินทาง → สิทธิ์เข้าถึง. `AccBookingApproverTab` is still
  empty, so neither a settings tab nor either menu key is granted to anyone —
  which is why the hub filter is roster-OR-grant rather than grant-alone; see
  สิทธิ์เข้าถึง above.
  **Growing the roster only by hand is a deliberate decision, taken
  2026-08-21** — not an unfinished commissioning step. Do not "helpfully" copy
  AP-1's four active `AccApprover` rows across; that is the exact conflation the
  two separate rosters exist to prevent.
- **Migration 095 must be applied to both form databases before this code
  deploys.**


#### AP-4 — Staff Reimbursement (`/request/reimburse`)

An employee itemises money they spent out of pocket, attaches the AP-4.1 Excel summary and the receipts, ticks every line of a compliance checklist, and three approvals later the company pays them back.

- **Pages:** `/request/reimburse` (fill/resume draft), `/request/reimburse/[id]` (detail + timeline), `/request/reimburse/settings` — four tabs in the order `REIMBURSE_SETTINGS_TAB_ORDER` declares, configuration before rosters: **แบรนด์ที่เบิกได้**, **ระเบียบการจ่าย**, **ผู้อนุมัติบัญชี** (the approval pool), and **สิทธิ์เข้าถึง** last. The page still *opens* on ผู้อนุมัติบัญชี rather than the first tab, because an empty approver pool stops every claim dead and is the one thing that has to be set before AP-4 works at all
- **Tables (seven, migrations 088–090 and 120):** `AccReimburse` + `AccReimburseItem` (the claim and its lines), `AccReimburseRuleAck` (which checklist line this requester ticked, by rule id) — all three transactional — plus `AccReimburseRule`, `AccReimburseApprover`, `AccReimburseAccess` and `AccReimburseAccessTab`, which are **shared configuration and dual-written**. 091 widened `AccApproval`'s step CHECK for the third step; 092 registers the form; 093 is its `FormEnvironment` row; **120** adds the last two — that file is `120_acc_reimburse_access.sql`, **renumbered from 106 on 2026-08-25** because master already held `106_acc_erp_journal_batch_template_key.sql`. Applying “106” today changes a journal-batch unique key and creates no access table at all.
- **สิทธิ์เข้าถึง is a second roster, not a rename of ผู้อนุมัติบัญชี, and the distinction is the whole point.** `AccReimburseApprover` is the pool that takes the ACCOUNT and ACCOUNT_FINAL steps — a row on it approves real money. `AccReimburseAccess` + `AccReimburseAccessTab` (migration **120**, renumbered from 106) decide who may *open* which of AP-4's settings tabs. AP-17 hangs its tab grants straight off `AccBookingApprover` because that roster only ever granted sight of a queue and a report; doing the same here would have made "may edit the payment rules" and "may approve a payment" the same tick, with no way to hand out the first alone.
  - **Two of the four tabs can never be granted.** `GRANTABLE_REIMBURSE_TABS` (`src/lib/acc/reimburse/settings-tabs.ts`, pure and unit-tested) is filtered from the page's own tab order down to `rules` and `brands`. `access` is excluded for the reason AP-1 and AP-17 both give — whoever opens it can grant themselves the rest — and `approvers` for the sharper one above. Neither exclusion is a database constraint: `AccReimburseAccessTab` has no CHECK on `TabKey` and is writable from more than one place, so a row naming any string can appear, and `decideReimburseTabAccess` refusing it is what makes that inert.
  - **It is a real privilege expansion.** `/api/request/reimburse/settings/rules` and `.../brands` moved from `requireRole` to `requireReimburseSettingsTab`, whose admin arm is exactly the pair `requireRole` allowed, so nobody lost anything. `settings/approvers` and `settings/access` stay on `requireRole` for every method — they are the two that hand out power. `settings-route-gates.test.ts` reads the route sources and asserts each handler's gate, that the gate is the handler's first `await`, and that its refusal is returned; it searches for `await <gate>(` rather than a bare mention, because a route's comments name the gate it used to carry.
  - **Membership alone grants nothing.** `canSettings` is `admin || settingsTabs.length > 0`, so somebody added and left with no ticks has exactly the access they had before. That also makes an empty roster a neutral state, which is why AP-4's panel carries no alarm banner where AP-17's does — an empty `AccBookingApprover` hides that form's queue and report from everyone, an empty `AccReimburseAccess` hides nothing.
  - **Deactivating revokes without deleting.** `resolveReimburseTabsByEmail` tests `IsActive = 1`, so switching someone off stops their access immediately and switching them back restores exactly the tabs they held. The grid therefore shows the ticks on inactive rows too — hiding them would leave an admin unable to see what a deactivated person still holds.
- **Feature code:** `src/features/reimburse/`; services under `src/lib/acc/reimburse/`. `src/features/reimburse/constants.ts` imports nothing and is the home for anything pure that needs a test — the form code, the step and status vocabulary, the notice copy, and `validateRuleText`'s 1,000-character bound.
- **Three approval steps**, not AP-1's two: **Manager** (`Rocks_Portal_HR.Employee.ManagerStaffId`, or `UatTester.ManagerStaffId` in UAT) → **Accounting check** (`ACCOUNT`, from `AccReimburseApprover`), which is the step that sets `PaymentDate` → **Accounting final** (`ACCOUNT_FINAL`), from the same pool but **necessarily a different person** — `canActFinalStep` (`two-person.ts`) refuses a match, and refuses when either StaffId is absent, because a missing id is not evidence of a different person.
- **There are four ways out of a submitted claim, and three of them are actions an approver takes.** Approve moves it on; **reject** ends it; **return** (`POST /api/request/reimburse/requests/[id]/return`, `returnReimburse`) sends it back to the requester as `Returned`, editable and keeping its `RBM` number; and the requester's own **self-cancel** withdraws it. Returning is available at **all three** steps, not just the manager's, and a comment is required on it — server-side, by `returnCommentOrError`. It exists because a rejection is terminal: `decideRequestMutate` admits `Draft`/`Returned` only, so without a return path a fixable typo costs a full re-key and a second running number. Do **not** route this through AP-1's `returnForEdit`; it is pinned to `AP1_FORM_CODE`, and pinning it is precisely what left AP-4 with no way back for one round of this branch.
- **Self-cancel is ≤24 h after submit and only while the manager still holds it**, like AP-1's — but the window is decided on the **server's** clock, not the browser's. `selfCancelRefusal` / `selfCancelDeadline` (`reimburse/approval-policy.ts`, pure and unit-tested at the exact boundary) name which of three conditions failed, and `claimSelfCancel` re-asserts all three in one conditional `UPDATE` against `DATEADD(HOUR, -@hours, SYSDATETIME())`. The detail page draws the bar from `approval-context`'s `selfCancel` answer; AP-1's page evaluates `Date.now() - new Date(submittedAt)` in the browser instead, which is the second copy of the rule AP-4 deliberately does not keep. A cancel closes the pending approval row as `Returned` because `CK_AccApproval_Status` has no `Cancelled`; the timeline reads the *request* status so it does not call that a return.
- **Payment rounds are the 1st and 3rd Friday** of the month — *not* AP-1's 2nd and 4th, which is why `reimburse/payment-calendar.ts` exists rather than a branch in the shared one; the pure building blocks are shared by import through `payment-calendar-core.ts`. Each round has **its own Monday-noon cutoff**, not one cutoff shared across rounds: a check at Monday 13:00 misses that week's Friday and is then measured against the *next* round's own Monday noon. Dates are shifted **backward** past `Rocks_Codex.Holiday` like AP-1's — AP-4 calls AP-1's own `shiftPaymentDay`, so it is the same loop stepping back a day at a time off a weekend or a holiday, and the form's Thai copy says so out loud (`เลื่อนกลับ 1 วันถ้าตรงวันหยุด`).
- **Running numbers are `RBMyy-xxxxx`** — the shared `AccSequence` allocator, keyed on `(Prefix, Year)`, so the series **resets each year**. UAT's first number of a year is `RBMyy-09001` (the `UAT_SEQUENCE_FLOOR`), production's `RBMyy-00001`.
- **AP-4 has on-behalf submission too, since 2026-08-24** — `เปลี่ยนผู้ขอเบิก`, backed by `/api/request/reimburse/requesters` (AP-1's and AP-17's route with `AP-4` named; the `/api/request/reimburse` prefix already covers it in `ROUTE_RULES`). The spec's §5.2 fields 1–2 predate this and the note that used to sit on `SaveInput` is gone. Two things about the wiring: the **save** takes the requester from `SaveInput.requesterStaffId`, while the **submit** takes it from the row it already read (`current.staffId`), because `submitReimburseRequest` accepts no payload — passing null in either place re-points the claim at the actor and at the actor's manager. And the reach this grants is the one AP-1 and AP-17 have always had: anyone may file for any active employee, routed to *that* person's manager. Raised and accepted rather than narrowed for AP-4 alone.
- **The `เปลี่ยนผู้ขอเบิก` button is never gated on department size, on any of the three forms.** AP-1 and AP-17 rendered it only when `colleagues.length > 0` — `colleagues` being the actor's own HR department — which stopped making sense once the picker's `?q=` searched the whole roster, and hid a working feature from anyone who is the only person in their department. That is what the report of AP-17 "not having the menu" was.
- **AP-4 never reaches Business Central, deliberately.** It is absent from AP-1's report and from the ERP prep queue because both pin `AP1_FORM_CODE` (`report-service.ts`, `erp-prep-service.ts`) — reimbursements are paid, not posted as travel journals. Adding AP-4 to either is a decision, not a bug fix.
- **AP-4 parks at `(ManagerApproved, ACCOUNT)` — the same status/step tuple AP-1 uses.** This is why **every claim in `approval-engine.ts` is pinned to `FormCode='AP-1'`** and every claim in `reimburse/approval-service.ts` is pinned to `AP-4`. Without the pins, AP-1's engine will happily claim an AP-4 request sitting on that tuple and drive it through AP-1's workflow. Removing a pin re-opens a Critical; two reviews have now spent effort rediscovering this.
- **`BrandCode` is validated against `AccFormBrand` at submit** (the submit route, before the service claims anything). The picker offers only granted brands, but a draft can hold any code — including the BrandGate cookie value every request written before the allowlist existed carries — and a client-enforced invariant is not one. A resumed request keeps a code the allowlist has since dropped rather than being silently re-pointed at another company, and is told to pick a new one before submitting. The check calls `isBrandAllowedForForm`, which reads `AccFormBrand` alone, **not** `getAllowedBrands` — that one enriches each row from the brand master in `Rocks_Codex` over `getCorePool()`, which would make an AP-4 submit fail on a Fast_Core outage over display data it never reads.

#### AP-2 — Advance (`/request/advance`) and AP-3 — Clear Advance (`/request/clear-advance`)

Money paid out **before** it is spent, and the settlement afterwards. Built on a
separate branch by a colleague and merged to master; this entry records what a
reader needs in order not to break them, and is deliberately shorter than the
sections above — the authority is the code and the migration headers, not this
summary.

- **Feature code:** `src/features/advance/` and `src/features/clear-advance/`;
  services under `src/lib/adv/` and `src/lib/clr/`. Migrations **073–091** are
  AP-2's, **109–115** and **121** are AP-3's, with 116–120 interleaved from other
  work. Numbers 088–091, 094 and 117–120 each exist **twice** — once here and
  once on the AP-4 branch — which is why `ls migrations/` is the only reliable
  way to pick the next one.
- **`src/lib/adv/pool.ts` is `getFormPool`, not a UAT pin.** AP-2 ran as a
  UAT-only pilot pinned to `getUatFormPool` while its tables lived only in the
  UAT database. Both conditions to un-pin have been met — the tables are mirrored
  into production (073–090), and `"/api/request/advance/settings" → null` in
  `ROUTE_RULES` stops a config-row id (a tier or approver id) being read as an
  `AccRequest` id. **That settings rule is load-bearing**: without it the
  per-form resolver treats a tier id as a request id and picks a database from it.
- **AP-2's approval chain is an amount matrix, not a fixed sequence.**
  `AccAdvanceApprovalTier.Steps` is an ordered CSV of `HEAD_ACC` · `DIRECTOR` ·
  `ACC_OFFICER`, chosen by the amount claimed. `HEAD_DEPT` is **retired** —
  approval starts at Head Accounting — but the type stays valid so legacy rows
  still parse; do not delete it. Only `ACC_OFFICER` picks a payment date.
- **Both reach Business Central**, through their own senders
  (`adv/advance-erp-send.ts`, `clr/clear-advance-erp-send.ts`) and their own
  payload builders, not AP-1's. So the line that used to read "only AP-1 reaches
  Business Central" is now about AP-4 alone.
- **AP-2 is the one place a rate is trusted from the browser.** Its client
  fetches the exchange rate and posts it, and nothing verifies it
  (`advance-request-service.ts`). AP-1 and AP-17 deliberately do **not** reuse
  that — see "Multi-currency" above, where `resolveRate` runs server-side only.
- **`AccAdvance.BaseAmount` is the *baht* figure.** `AccRequest.ForeignAmount`
  twelve inches away is the foreign one, and it is called `ForeignAmount`
  precisely because migration 125's original name for it — `BaseAmount` — meant
  the opposite of this one. Migration 126 renamed it.
- **AP-3 OCRs transfer slips server-side**, `clr/slip-verify.ts` over
  `src/lib/ocr.ts`, a tesseract worker. **This is why `tesseract.js` is still a
  dependency**: AP-1 and AP-17 stopped OCRing in the browser and the package
  looks unused from their side. Check `src/lib/ocr.ts` before concluding it is.

#### Multi-currency — AP-1 and AP-17 (migrations 124–131, 136)

A claim may be filed in something other than baht. Design:
`docs/superpowers/specs/2026-08-28-ap1-ap17-multi-currency-design.md`.

**The invariant that kept the blast radius small: `AccRequest.TotalAmount` is
Thai baht, always.** Every summary, report, ERP path and approval queue reads
that column and none of them changed. What is stored beside it is the
*provenance* of the conversion — `ForeignAmount`, `ExchangeRate`, `RateAsOf`,
`RateSource` — not a second unit for the same figure.

- **`null` and `"THB"` are both baht** (`src/lib/acc/currency.ts`, imports
  nothing). Absence *has* to mean baht: every row written before this feature
  has no currency and every one of them was in baht, so a design where absence
  meant "unknown" would make every historical claim unreadable.
- **`toBaht` returns null rather than the unconverted figure.** Handing back
  `amount` when the rate is missing writes a foreign number into a baht column —
  the exact failure the feature exists to prevent, and one that leaves no trace
  on screen. Callers refuse the write; the submit path refuses the submit.
  `amountInBaht` (`currency-display.ts`) answers null the same way, for display.
- **The client never posts a rate.** `resolveRate` (`src/lib/acc/fx.ts`) runs
  server-side and returns `{ rate, asOf, source }` or **null, which is a
  refusal** — not a zero and not a one. AP-2 does the opposite: its browser
  fetches the rate and posts it and nothing verifies it
  (`advance-request-service.ts`), so a requester could choose their own. That is
  the one part of AP-2's approach deliberately not reused.
- **Every rate is an ECB mid-market *reference* rate, and no screen may caption
  it as a Bank of Thailand rate.** `BOT_API_CLIENT_ID` will not be provisioned,
  so `src/lib/adv/bot-fx.ts` — AP-2's module, shared — always takes its keyless Frankfurter fallback. It is not what a
  bank settles at, which is why accounting can override it and why the copy
  reads `อัตราอ้างอิง`.
- **An FX outage cannot stop ordinary work.** `needsRate` is `!isBaht`, so the
  refuse-on-failure rule applies only to a foreign claim; the Thai claims that
  are almost all of them never call the provider.

**Where the currency sits differs per form, and the difference is not an
oversight:**

| | AP-1 | AP-17 |
|---|---|---|
| Currency on | the **expense line** (`AccTravelExpenseItem`, 129) | the **request** (`AccRequest.Currency`, 125) |
| Also stored | `AccRequest.CountryCode` (129) | `AccTravelBookingDetail.TotalAmountBaht` (136) |

AP-1 asks which **country** the trip was to and each line carries its own
currency, because one Grab section holds a 20 MYR ride and a 20 THB ride and
both belong on the same claim (129 moved it off the request for exactly that).
**Thailand offers no choice at all**: `lineCurrencyOptions`
(`features/accounting/lib/claim-currency.ts`) answers `[]`, every line resolves
to baht, and the form renders precisely the markup it rendered before any of
this existed. That promise is one predicate rather than a condition retyped per
control, because it is the one most likely to be broken by a later edit.

**Three AP-17 rules, each written down twice before it stuck, because each looks
like an oversight to a reader who has just finished AP-1** — pinned in
`booking-currency-guard.test.ts`:

1. **`AccRequest.TotalAmount` is not touched.** For AP-17 it is the *per-diem
   total alone*; the booking cost lives on `AccTravelBookingDetail` and has never
   reached the header. Summing it in would double the figure on My Requests, My
   Work and the request header for **every** AP-17 request including baht ones —
   and `recomputeGroupPerDiem` would silently rewrite it back from the per diem
   anyway.
2. **No new lock and no `Status = 'Completed'` freeze.** `AdminBookingPanel`
   renders only at `ManagerApproved`/`ADMIN`, so the currency control is already
   unreachable once accounting has signed off. `bookingFieldsLocked` is a per-row
   *emptiness* rule, deliberately not status-based; a currency arm would strand
   figures somebody had already entered.
3. **The rate is the server's.** The desk's toggle posts a currency, never a rate.

**`AccTravelBookingDetail.TotalAmountBaht` is stored, not derived** (136), and
`recomputeBookingBaht` (`travel-booking/booking-baht.ts`) is its **single
writer** — called by both `ExchangeRate` writers inside their own transactions,
rewriting every row of the request rather than the one that changed. A reader
that both converts and reads the stored column would be two answers to one
question; `booking-baht-guard.test.ts` has an arm for each of those three rules.

**`BrandSetting` (122) and `BrandCurrency` (127/128/131) are production-only —
`getProductionFormPool()`, never `getAccPool()`.** There is no UAT twin and
migrations 124 and 127 refuse to run against one, so a read through the
env-resolved pool throws `Invalid object name` **for a UAT tester and for nobody
else**, on the amount-entry path of both forms: production works perfectly while
the people testing the feature cannot use it. Same hazard `DepartmentErpMap`
carries, and `currency-pool-guard.test.ts` is what holds it.

- **A brand may claim in several currencies, not one.** 124 gave `BrandSetting`
  a single `CountryCode`/`CurrencyCode`/`CurrencyEnabled` triple; 127 replaced it
  with one `BrandCurrency` row per brand per currency (KSI needs THB *and* GBP),
  and 128 dropped the old columns — **only after the code was deployed**, since
  dropping a column out from under running code is its own outage. 131 adds
  `IsDefault`, the country AP-1's form opens on: until then Thailand was every
  claim's default *by construction*, `claimCountryOptions` putting `TH` first
  unconditionally and no brand able to switch baht off, because THB was never a
  row.
- **A configured currency cannot be removed** (the user's rule, 2026-08-29) —
  only switched off, which retires the row and keeps the brand's one slot under
  `UQ_BrandCurrency_Brand_Currency`. That unique index is also the *only*
  duplicate check: `brand-currency-input.ts` deliberately has none, because a
  check there would be a second, weaker answer that two admins on two tabs
  defeat. The parse **refuses rather than coerces** — `CHAR(2)`/`CHAR(3)` pad a
  short value silently and raise on a long one, so `"Malaysia"` must be a 400
  here and never a truncated row there.
- **The country list is filtered to what the rate source will quote**, not
  completed. `country-currency.ts` once carried Cambodia, Laos, Vietnam, Myanmar,
  Taiwan, Brunei, Qatar, Bahrain, Russia and the UAE — ten the ECB does not
  quote, several of them next door. Offering one produced a claim that could be
  started and never converted. **A country that cannot be converted must not be
  on the menu**; refresh the list from `GET https://api.frankfurter.dev/v1/currencies`.
- **A stored rate is never stored alone** (130, `rate-provenance-guard.test.ts`).
  `resolveRate` always answered three fields and every caller kept the number.
  The source publishes on **working days only**, so a line saved on a Saturday
  carries Friday's rate and one saved over a long weekend a three-day-old rate —
  correct and deliberate, since there is no rate for a day the market did not
  trade, but without `RateAsOf` nothing afterwards can tell which day a figure
  used.

**Four writers of `AccRequest.TotalAmount`, guarded in two places.**
`request-total-baht.test.ts` covers the three in `request-service.ts`; the
accounting **rate override** is the fourth and lives in `rate-override.ts`, so
that test's count stays right and says nothing about it —
`rate-override-guard.test.ts` is its guard. If either goes red the fix is to
route the new write through `toBaht`, never to relax a count. The rule itself is
pure and tested for real in `rate-override-policy.test.ts`.

**Display is its own module, and it is not cosmetic.** The baht invariant left
every summary untouched; it did not leave untouched any screen printing a
*per-day* or *per-line* figure. `AccTravelExpense.TotalAmount` and
`AccTravelBookingDetail.*` are in the claim's own currency and every surface
captioned them `บาท` unconditionally — a ringgit figure captioned as baht beside
a header that does not sum to it. On the ERP prep queue that was the last thing
an approver read before pressing Send, and its total was a sum of ringgit and
baht printed as one unitless figure for as long as the currency existed.
`currency-surface-guard.test.ts` reads the sources, because which helper a
component calls is not reachable from a behavioural test.

#### AP-17 per-diem by country (migrations 132–133) and brand-scoped access (134)

- **A per-diem rate per country, effective-dated** — `AccTravelPerDiemCountry`
  (133, **both** form databases, dual-written, in `MASTER_TABLES`). Design:
  `docs/superpowers/specs/2026-08-31-ap17-country-and-perdiem-design.md`.
  A country with at least one active rate prices every day of a trip there; a
  country with none falls back to `Rocks_Portal_HR.EmployeeAllowanceLog`, the
  per-employee allowance AP-17 has always used. **Thailand is never a per-diem
  country** — it is where the HR log applies by definition, and a `TH` row would
  be a second answer to a question that already has one.
  - **`perDiemCountryLog` answers `null`, never `[]`.** `rateForDay` returns
    **0** for a day it cannot match, so an empty log does not mean "no rate
    configured", it means "this day is worth nothing" — and the two must never be
    confused on a path that writes `AccRequest.TotalAmount`.
  - **Four things compute a per-diem figure independently** — the live estimate
    on the form, the write at submit, `recomputeGroupPerDiem` after a
    cancellation, and the rate the report prints. Before this they could not
    disagree, because there was one input. All four resolve through
    `perDiemLogFor`, and `perdiem-source-guard.test.ts` reads the source to keep
    it that way: the failure is a *missing* call, which no behavioural test of the
    four would notice a fifth consumer arriving without.
  - **Its two writes disagree about how safe they are.** `upsertPerDiemCountryRate` MERGEs on `(CountryCode, EffectiveDate)`, which is id-independent and therefore immune to the identity-lockstep drift described under “Shared configuration is dual-written”. The soft delete, `setPerDiemCountryRateActive`, is `WHERE Id = @id` in **both** databases — so drifted counters retire one country's rate in production and a different country's in UAT, with no error. Same class of hazard as `AccReimburseRuleAck`'s, and the same remedy: run `check:alignment` after any dual-write failure.
  - **The settings tab has no Add button.** It lists the configured countries and
    saves one at a time. Editing is blank-by-default rather than seeded, because
    the design says an admin who wants to change a rate adds a row rather than
    editing one — history is the point of an effective-dated table.
  - **The form shows which rates a *trip* falls under, not today's.**
    `tripRateSegments` (pure, 10 tests) walks the trip's days exactly as
    `computePerDiem` does and groups them by the rate's **effective date, not its
    amount** — `computePerDiem`'s own `groups` is a `Map` keyed on the value, so
    two dated rates at the same figure collapse into one and no entry carries a
    date at all. `TripRateHistoryModal` opens only when a trip spans **more than
    one** rate; a single rate is already stated on the card.
- **132 gives `TravelProvince` a `CountryCode`**, so it can hold somewhere other
  than Thailand. `Rocks_Portal_Form` **only** — 104's single-copy rule is
  unchanged and `Rocks_Portal_Form_UAT` still holds no such object.
- **`AccBookingApproverBrand` (134, both databases) scopes an AP-17 approver to
  brands.** Design: `docs/superpowers/specs/2026-08-31-ap17-brand-access-design.md`.
  **Scoping is only a control if it holds on the paths that act**, not merely on
  the ones that list: filtering a queue hides rows, while a scoped approver
  holding an id from a link, a bookmark or a page loaded before the scope was
  narrowed still reaches the action. `booking-brand-scope-guard.test.ts` reads the
  five routes, because the failure is a missing call and the routes are where
  somebody adds the sixth.
- **`124_acc_booking_approver_areas.sql` and `124_brand_setting_currency.sql`
  share the number 124, and stay that way.** Both are on master and both have
  been applied; 120's header sets the rule that renumbering is safe only while a
  migration has not been applied anywhere. The number is a name for humans —
  `apply-sql` takes an explicit `--file` and keeps no record — so a shared one is
  untidy rather than broken, and renaming now would make the repo disagree with
  what was run. **Eleven numbers are duplicated** (088, 089, 090, 091, 094, 103,
  117, 118, 119, 120, 124), so `ls migrations/` is the way to pick the next one;
  counting files gives the wrong answer, and so does trusting this file.

#### Business Central / ERP integration

Accounting requests can be pushed into Dynamics 365 Business Central. Configuration lives under **Settings**: Database Connections, Business Central (OAuth2 connection), Brand Configuration (per-brand BC + ERP SQL target), ERP Interface Environment (per-brand Sandbox company and connection, System Admin only — which forms use it is set at Settings → Form Environment). Sync logic in `src/lib/erp/account-sync.ts` and `src/lib/erp/dimension-sync.ts` (both query `Rocks_ERP_Data`, not `Fast_Data` — migrations 101/102, see "The ERP sync tables moved out of Fast_Data" above), OData client in `src/lib/bc/`. Data **synced from** Business Central lives in `Rocks_ERP_Data`; the per-brand and per-form **choices this app makes** about where money posts — `AccBrandGlAccount`, `AccBrandJournalBatch`, `AccBrandBankAccount`, `AccBrandBranchCode`, `AccBrandErpInterface` — stay in the form database.

##### Per-form ERP configuration — the default and override rule

Seven brand-keyed configuration tables carry a `FormCode NVARCHAR(20) NULL`
column: `AccBrandGlAccount`, `AccBrandBankAccount`, `AccBrandJournalBatch`,
`AccBrandBranchCode`, `AccBrandErpInterface`, `AccBrandErpTargetSetting` and
`DepartmentErpMap` — **all seven now live in the form database.** The seventh
is still the odd one out, in two ways rather than one: it is the table
`Fast_Core` reaches by a permanent synonym so the Rocks Fast and ACC Portal
siblings can keep writing it (see "DepartmentErpMap moved out of Fast_Core"
above), and it is the only one of the seven with **no UAT twin** —
`Rocks_Portal_Form_UAT` has no `DepartmentErpMap` object at all. **`FormCode
NULL` is the default and answers every form; a row naming a form overrides the
default for that form alone.** Most configuration is the same for every form,
so a second or third form needs no rows at all until somebody wants it to
differ — which is what this replaces, the old answer having been a whole new
table per form.

**The rule lives in exactly one place — `src/lib/acc/per-form-config.ts`**:
`perFormPredicate(alias?)`, `perFormOrderBy(alias?)`, `pickForForm`,
`pickAllForForm`, `defaultsOnly` and `perFormWriteMatch`. It **imports nothing**,
so the rule is unit-tested without a database (`per-form-config.test.ts`).
Hand-writing the predicate is how one copy loses the `IS NULL` arm and silently
reads another form's configuration, and these tables decide where money posts.
Six services consume it: `brand-account-service` (G/L and bank, whose table name
is interpolated — a sweep by literal table name misses it), `brand-branch-service`,
`brand-journal-batch-service`, `brand-erp-interface-map-service`,
`erp-target-setting-service` and `department-map-service`.

Three things about it that are not obvious. All three were found in code that
already existed:

- **Where `formCode` is optional, absent means defaults-only, never all
  rows** — without it the query is `WHERE FormCode IS NULL`. It is *not*
  optional everywhere: `loadMappings`, `loadPrepDeptContext`,
  `loadErpJournalBuildContext`, `resolveErpTargetProfile` and
  `resolveAllErpTargetProfiles` require it, because each is on a path that
  knows its form and must not silently read another one's. That is the fail-safe direction — a caller with no
  form in hand cannot be handed another form's row. `perFormOrderBy` sorts, it
  does not pick, so a read that applies the predicate and stops gets the
  override *and* the default: reduce with `TOP 1`, `pickForForm`, or
  `pickAllForForm` keyed on the unique index minus `FormCode`.
- **A value filter belongs after the pick, not in the `WHERE`.** The two
  money-path loaders in `department-map-service.ts` filtered on non-blank
  `ErpCode` / `FixedGlAccountNo` in the `WHERE`, which removes a form's
  *deliberately blank* override before the pick — so the default answers and the
  claim posts to a dimension or G/L account the form had explicitly cleared.
  Both now filter after the pick.
- **`FormCode = @formCode` never matches `NULL`.** A write bounded that way
  cannot touch the default, and a write bounded on `BrandCode` alone sweeps the
  default *and* every override for that brand together, in one statement, with
  no error. Use `perFormWriteMatch(formCode)`, which renders `FormCode IS NULL`
  for the default. Statements bounded on `BrandCode` alone were found and closed
  on `AccBrandErpInterface` (`DELETE`), `AccBrandErpTargetSetting` (`UPDATE`) and
  `DepartmentErpMap` (`purgeLegacyClaimMappings`), along with the `SELECT TOP 1
  Id` probes that pick the row a settings `UPDATE` then rewrites.

**Migrations 097 (both form databases) and 098 (`Fast_Core`).** They add the
column, **backfill every existing row to `NULL`**, and rebuild each table's
unique index to lead with `FormCode`. SQL Server treats `NULL`s as equal in a
unique index, so one brand keeps exactly one default plus at most one row per
form, with no filtered index and no extra constraint. `AccBrandGlAccount`'s
three rows already read `AP-1` and were rewritten to `NULL`: left form-specific
they would answer AP-1 and nothing else, which is the failure the rule exists to
prevent. All seven `UQ_*` objects were originally unique **constraints**, not
indexes, so `DROP INDEX` alone raises Msg 3723 — each drop reads
`sys.indexes.is_unique_constraint` and uses the verb that matches what it finds,
and all seven are plain unique indexes afterwards. 098 widens a table three
applications share; that is safe because the column is nullable with no default,
no sibling selects `*`, and both siblings upsert through a `MERGE` with an
explicit column list, so every row they write is a default. **098's target,
`Fast_Core`, is historical**: migrations 099/100 subsequently moved that table
into `Rocks_Portal_Form`, so the widened column and the rebuilt unique index
098 describes now live there, reached from `Fast_Core` by synonym — see
"DepartmentErpMap moved out of Fast_Core" above. **Do not re-run 098.** Its
`ALTER TABLE` cannot resolve the synonym and fails, but its next batch opens
with `UPDATE [dbo].[DepartmentErpMap] SET [FormCode] = NULL` — and `UPDATE`
*does* resolve synonyms, so in SSMS, which carries on past a failed batch by
default, it reaches the live form-database rows and clears every per-form
override. `021`, `045` and `046` name the same old target and all four now
carry a "do not re-run" header saying so.

**It ships inert, and there is no UI to add an override.** Every row in all
seven tables is a default, so every form resolves exactly what AP-1 resolved
before and nothing behaves differently on day one. The settings editors have no
form selector: their reads are defaults-only, and their writes are bounded to the default —
most by `perFormWriteMatch(null)`, and the three id-bounded UPDATEs by that
same predicate alongside the id, because the id arrives in the request body. **Creating an override today means a hand-written SQL
`INSERT` — and six of the seven tables are in `MASTER_TABLES`, so it must go
into `Rocks_Portal_Form` AND `Rocks_Portal_Form_UAT` with the same `Id`, or
`npm run check:alignment` reds and the two environments resolve differently.**

**Key libs (`src/lib/acc/`):** `pool`, `sequence`, `payment-calendar`, `payment-calendar-core`, `employee-context`, `brand-options`, `access`, `settings-service`, `request-service`, `approval-engine`, `report-service`, `email-queue`, `email-templates`, `calc`, `erp-environment-shared`, `per-form-config`, plus `travel-booking/*` and `reimburse/*`.

**Feature UI:** `src/features/accounting/` (AP-1), `src/features/travel-booking/` (AP-17) and `src/features/reimburse/` (AP-4) — form components, approval queues, report tables, settings panels.

## Project Structure

`README.md` is the front door — what the app is, quick start, scripts, layout.
This file is the developer guide it points at. `docs/README.md` indexes the
specs, plans and archived reviews, and explains that they are dated history
rather than current state.

```
README.md                             # Entry point — start here, then this file
CLAUDE.md                             # This guide
docs/
├── README.md                         # Index + how to read specs/plans as history
├── UI-GUIDE.md                       # The Sky design system, portable to other apps
├── superpowers/specs/                # Design specs, written before the work
├── superpowers/plans/                # Implementation plans
└── reviews/                          # Completed reviews, kept as remediation record
migrations/                           # Numbered SQL — each names its target DB in its header
scripts/                              # apply-sql, run-tests, seed, and checks/ verifiers
src/
├── app/
│   ├── (auth)/login, unauthorized
│   ├── (dashboard)/
│   │   ├── my-request/, my-work/     # Personal request tracking
│   │   ├── request/                  # Accounting hub, AP-1, AP-17, AP-4, ERP prep
│   │   ├── settings/                 # Admin settings hub — connections, BC, brand config, ERP, users
│   │   └── page.tsx                  # Home — form catalogue
│   ├── api/
│   │   ├── auth/                     # NextAuth
│   │   ├── request/accounting/       # AP-1, AP-17, ERP prep API routes
│   │   ├── request/reimburse/        # AP-4 API routes (its own prefix, not under accounting/)
│   │   ├── settings/                 # Connections, BC, brand-config, ORS, Google Maps, users
│   │   ├── form-environment/         # Per-form availability for Home
│   │   ├── uat-mode/                 # The only writer of the UAT-mode cookie
│   │   ├── health/                   # Liveness (+ /db, detail for System Admin only)
│   │   ├── me/, users/               # Own profile; AD user search
│   │   └── ors/, maps/, weather/     # Routing, Google Maps, Home weather strip
│   ├── loading.tsx                   # Global loading screen
│   └── layout.tsx                    # Root layout — theme no-flash script, providers
├── features/
│   ├── accounting/                   # AP-1 form, approvals, report, settings UI
│   ├── travel-booking/               # AP-17 form, admin queue, report, settings UI
│   ├── reimburse/                    # AP-4 form, detail, settings UI + constants.ts (pure, tested)
│   ├── advance/                      # AP-2 advance form, queue, report, settings UI
│   ├── clear-advance/                # AP-3 clear-advance form, admin queue, report
│   ├── home/                         # Home catalogue
│   ├── settings/                     # Settings panels
│   └── new-item-inventory/           # WIP — see the note below the tree
├── components/
│   ├── ui/                           # Button, Badge, Avatar, Dialog, DropdownMenu, SidePanel, FullScreenModal
│   └── layout/                       # Navbar, RouteGuard, PageContainer
├── lib/
│   ├── db/mssql.ts                   # Multi-DB pools (Core, Form, Production/UAT Form, Data, generic getAppPool), pool max=30
│   ├── team-member/                  # The only module that touches TeamMember — service.ts + mapping.ts
│   ├── acc/                          # Accounting domain logic (see above)
│   │   ├── request-acl-policy.ts      # Pure object ACL — decideRequestRead/Mutate
│   │   ├── request-acl.ts             # Pool/request-scoped half + authorizeAccRequest()
│   │   ├── attachment-guard.ts        # Magic-byte upload admission + safe download headers
│   │   ├── stored-file.ts             # Backend-dispatching delete (local vs SharePoint)
│   │   ├── request-errors.ts          # AccConflictError / AccForbiddenError -> 409 / 403
│   │   ├── travel-booking/            # + derive-flags.ts, id-card-access.ts
│   │   └── reimburse/                 # AP-4 — two-person.ts, payment-calendar.ts, approval-policy.ts
│   ├── form-environment/             # Which database answers — resolver + classify-path
│   ├── uat-tester/                   # UatTester membership + assertFormWritable guards
│   ├── adv/                          # AP-2 — services, ERP send, bot-fx.ts (the FX source)
│   ├── clr/                          # AP-3 — services, ERP send, slip-verify.ts (server OCR)
│   ├── ocr.ts                        # tesseract worker — AP-3's only, but the package's one caller
│   ├── new-item-inventory/           # WIP — lookup + sequence, no UI yet
│   ├── erp/                          # Business Central sync
│   ├── hr/                           # Rocks_Portal_HR cross-DB lookups
│   ├── graph.ts                      # Microsoft Graph API (searchADUsers, getADUserByEmail, getADUserPhoto, sendEmail)
│   ├── storage.ts                    # Local file storage (UPLOAD_ROOT)
│   ├── bc/                           # Business Central OData + bc-destination.ts allowlist
│   ├── auth.ts, auth.config.ts, api-auth.ts, auth-identity.ts
│   └── hooks/
├── env.ts                            # Type-safe env validation
```

Unit tests sit beside the code they cover as `*.test.ts`; `npm test` discovers
them. `npm run typecheck` is `tsc --noEmit`.

**`new-item-inventory` is a half-built feature, not dead code.** It has a live
lookup route (`/api/request/new-item-inventory/lookup/[resource]`), a service and
a sequence allocator under `src/lib/new-item-inventory/`, a `ROUTE_RULES` entry
pinning it to Production (it reads Fast_Core, so no request id of its own), and
test coverage in `classify-path.test.ts` / `request-id.test.ts` — but only
`constants.ts` and `types.ts` in `src/features/`, and no page. Leave the route
rule alone if you touch `classify-path.ts`.

**`/api/map-preview` was deleted on 2026-08-19.** It was a Locations remnant —
Locations was removed when this app was cloned — with zero callers anywhere in
`src/`, and it proxied Google Static Maps on the server key and cached PNGs into
`.cache/`. Recoverable from git history if the feature ever returns.

## Conventions

- **DB columns**: PascalCase (`Id`, `Name`, `Status`) — map to camelCase in API responses
- **API response**: `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`
- **Auth**: `requireAuth()` / `requireRole(["IT Admin", "System Admin"])`
- **SQL**: Parameterized queries only — `pool.request().input("name", sql.NVarChar, value).query(...)`
- **TeamMember**: never write SQL against it. Call `src/lib/team-member/service.ts`, which owns every statement and pins them to `getProductionFormPool()`. To join it from a query running on another pool, use its `teamMemberTableRef()` → `[Rocks_Portal_Form].[dbo].[TeamMember]`. `service.ts` is the only file in `src/` holding SQL that names the table — keep it that way, because a stray query pointed at Fast_Core does not error, it returns the sibling app's roster.
- **Object authorization**: any route reaching an `AccRequest` by id calls `authorizeAccRequest()` (`src/lib/acc/request-acl.ts`) before it reads or writes. `requireAuth()` proves *a* session, not a right to *this* record.
- **Attachments**: validate with `checkAttachment()` / `checkAttachmentBatch()` and serve with `attachmentResponseHeaders()`. Never trust `File.type`, never echo the stored `ContentType`, never serve an attachment `inline` without re-sniffing.
- **Storage paths**: only through `src/lib/storage.ts` (containment-checked) or `deleteStoredFile()` (backend-dispatching). Never `path.join(UPLOAD_ROOT, …)` by hand.
- **State transitions**: claim with a conditional `UPDATE … WHERE <expected state>` inside the transaction and check `rowsAffected`. Never read-then-write. Allocate a running number *after* the claim, not before.
- **CSS**: Use `var(--variable)` — never raw hex. See `globals.css` for all tokens.
- **Icons**: `lucide-react` only
- **Toasts**: `sonner` — `toast.success()`, `toast.error()`
- **Excel**: `xlsx-js-style` (not `xlsx` — old SheetJS CE has vulnerabilities)
- **Components**: `"use client"` only when needed. Use existing UI components from `@/components/ui`
- **ES5 target**: Don't use `[...set]` or `[...map.values()]` — use `Array.from()` instead
- **Dates**: every timestamp in these databases is a **Thai wall clock**, written by `SYSDATETIME()` on a SQL Server that runs at UTC+7. `src/lib/db/mssql.ts` sets **`useUTC: false`** on the shared driver options, which is the single place that is reconciled: the driver then reads and writes in the Node process's own zone, both directions agree with `SYSDATETIME()`, and an API layer serialising with `.toISOString()` plus a UI formatting with local getters (`getDate()`, `getMonth()`, `getHours()`) round-trips exactly.
  **Do not compensate by hand.** A `fixThaiDate()` helper subtracting seven hours used to exist and is deleted; with `useUTC: false` it shifts twice. Until 2026-08-27 the driver was on its default `useUTC: true`, so a row stored at 22:37 rendered as 05:37 the next day, and a JS `Date` written through `sql.DateTime2` landed seven hours behind the `SYSDATETIME()` values beside it. Twelve call sites in the AP-3 code compensated and thirty-nine did not; the fix removed the twelve rather than adding thirty-nine.
  **It depends on the Node process running in Thai time.** That is the same assumption the rest of the app makes, but if a host is ever set to UTC every timestamp shifts by seven hours and `useUTC` is the line to look at.
- **Logos**: every mark in the app is now the Rocks one. The navbar, the favicon (`src/app/layout.tsx`) and the login lockup use `/brandlogo/rocks.png`; the loading screen and `BrandGate` use `/brandlogo/rocks-200.png`. **Which of the two depends on the slot, not on taste**: `rocks.png` is **74×91**, so a square box letterboxes it and leaves the glyph looking small — the navbar renders it 20×24 for that reason, and the two square 64×64 slots take the 200×200 file instead. The Codex Family logo was used on those two until 2026-08-25 and **no component references `public/codexfamilylogo/` any more**; the folder and its `proxy.ts` matcher exclusion are a loose end nobody has decided to remove. `public/brandlogo/` holds the Rocks Group and company-brand logos only. Replace the favicon once a Form Portal icon exists, or the two apps share a tab icon

## Environment Variables

```env
# Auth
AUTH_SECRET=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=

# Database
MSSQL_HOST=
MSSQL_PORT=1433
MSSQL_DATABASE=Rocks_Codex                      # default catalogue only — see the note below
MSSQL_USER=
MSSQL_PASSWORD=
MSSQL_ENCRYPT=true
MSSQL_TRUST_CERT=true
MSSQL_CORE_DATABASE=Fast_Core
MSSQL_FORM_DATABASE=Rocks_Portal_Form
MSSQL_FORM_UAT_DATABASE=Rocks_Portal_Form_UAT   # served to configured testers in UAT mode; see "Parallel Production and UAT"
MSSQL_DATA_DATABASE=Fast_Data
MSSQL_ERP_DATA_DATABASE=Rocks_ERP_Data          # BC sync mirror; Fast_Data keeps synonyms for the two siblings

# Email
GRAPH_MAIL_FROM=noreply@rocksgroup.com
UAT_MAIL_REDIRECT=                              # UAT mail for non-testers goes here (active testers get theirs); falls back to GRAPH_MAIL_FROM

# SharePoint (Accounting file storage — shared with Rocks Fast)
SHAREPOINT_ACC_SITE=
SHAREPOINT_ACC_FOLDER=

# OpenRouteService (AP-1 distance calculation fallback)
ORS_API_KEY=

# Google Maps
GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Local attachment storage — point at the Rocks Fast sibling's uploads folder
UPLOAD_ROOT=

# Business Central destination allowlists (optional, additive to the built-in
# Microsoft defaults — see src/lib/bc/bc-destination.ts). Comma-separated hosts.
BC_ALLOWED_OAUTH_HOSTS=
BC_ALLOWED_API_HOSTS=

# Local dev only, default off — lets any signed-in user action the AP-1/AP-17
# manager step on a non-production build served from localhost:3081.
ACC_MANAGER_DEV_BYPASS=

# Client
NEXT_PUBLIC_APP_URL=http://localhost:3081
```

**`MSSQL_DATABASE` is inert.** `src/env.ts` is the only file in the repo that
reads it, and it only asserts the string is non-empty — every pool in
`src/lib/db/mssql.ts` opens an explicitly named database. It still has to name
something the login can open, because it is the connection's default catalogue.

**This repo's own `.env.local` had the broken value, and nobody noticed.** It
named **`Rocks_Codex_UAT`** — the database the next paragraph records as dropped
on 2026-06-20 — and connecting to it answers `Login failed for user 'saai'`.
Measured and changed to `Rocks_Codex` on 2026-08-19; that one is reachable. The
trap the next paragraph warns about had already been walked into here, and it
cost nothing only because `MSSQL_DATABASE` is inert and every pool names its
database explicitly. Two things follow. Being inert is *why* it stayed wrong for
months — there is no failure to notice, so it has to be read to be caught. And
**`.env.local` is gitignored, so this correction does not travel**: production's
environment holds its own copy and must be checked separately, as must any
developer machine set up before that date.

**Do not copy env values from the Rocks Fast sibling on the assumption they are
proven.** `RocksFast/.env.local` is a months-old local snapshot, not a live
config: until 2026-08-19 it still named **`Rocks_Codex_UAT`**, a database
**dropped 2026-06-20** that now answers `Login failed for user 'saai'`. Because
`MSSQL_DATABASE` is inert, nothing failed and no test caught it. The credentials
themselves (`AUTH_SECRET`, the Azure AD trio, `MSSQL_HOST`/`USER`/`PASSWORD`,
Google Maps) *are* shared and identical — it is the database names, the port and
the app URL that must differ.

## Deployment

**Live at `https://form.portal.rocksgroup.com`** since 2026-08-19. The chain is
**Cloudflare → IIS + ARR 3.0 → `next start`** (`x-powered-by: ARR/3.0`, `Server:
cloudflare`). `/api/health` reports `nodeEnv: production`.

### ⚠️ ARR must not rewrite the `Location` header

**`reverseRewriteHostInResponseHeaders` must be `false` on the ARR proxy.** It
defaults to **true**, and while true it rewrites the host of every `Location`
response header to the public host — including the redirect that starts sign-in.
Measured on the live host 2026-08-19:

```
app sends → Location: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?...
client got → Location: https://form.portal.rocksgroup.com/{tenant}/oauth2/v2.0/authorize?...
```

The path and every query parameter (`redirect_uri` included) survive untouched —
only the origin is replaced — so the browser never reaches Microsoft and sign-in
dies on a 404 at our own host. **This looks exactly like a broken app and is not
one:** the same commit serving `next start` locally with no proxy emits the
correct host, in both development and production mode. Microsoft's own ARR
reference configuration disables this setting for precisely this reason ("ARR
must return the location headers as set by the application in case of
redirects"), and pairs it with `preserveHostHeader = true`, which this app also
needs because `trustHost: true` reads the `Host` header.

Fix it in IIS Manager → server node → *Application Request Routing Cache* →
*Server Proxy Settings* → untick **Reverse rewrite host in response headers**, or
in `applicationHost.config`:

```xml
<system.webServer>
  <proxy reverseRewriteHostInResponseHeaders="false" preserveHostHeader="true" />
</system.webServer>
```

Note that `web.config` is **gitignored**, so no proxy configuration lives in this
repo — it exists only on the server, and a rebuilt server loses it.

### The rest of the deployment checklist

- **`PRODUCTION_HOSTS` in `next.config.mjs`** feeds both `allowedDevOrigins` and `experimental.serverActions.allowedOrigins`. `form.portal.rocksgroup.com` was added 2026-08-19; it was missing at first deploy, which would have rejected every server action from the live host as cross-origin — at runtime, so the build stays green and only a submit reveals it.
- **`NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`** must both match the address users actually open, including port. Both are set to `https://form.portal.rocksgroup.com` in production.
- **The Entra app registration must list the callback for every host the app answers on.** Production needs `https://form.portal.rocksgroup.com/api/auth/callback/microsoft-entra-id`; dev needs `http://localhost:3081/api/auth/callback/microsoft-entra-id` (add `http://127.0.0.1:3081/...` too if anyone opens it that way). A `redirect_uri` Entra has never seen fails with `AADSTS50011` before any app code runs.
  **Which value is sent depends on whether `NEXTAUTH_URL` is set.** `auth.config.ts` sets `trustHost: true`, but that only makes the `Host` header the *fallback*: when `NEXTAUTH_URL`/`AUTH_URL` is present it wins outright. Verified 2026-08-19 — a build served on port 3082 with `NEXTAUTH_URL=http://localhost:3081` still sent `redirect_uri=http://localhost:3081/...`. So an unset `NEXTAUTH_URL` makes the registration port-sensitive, and a set one makes it env-sensitive; either way both must agree with what Entra lists.
- **`ERP_SANDBOX_ALLOWED_HOSTS`** (`src/lib/acc/erp-environment-shared.ts`) is `localhost:3081` / `127.0.0.1:3081` — the manager-approval dev bypass (`src/lib/acc/manager-auth.ts`) disappears on any other host, which is intended for production. The `devHostOnly` management cards disappear too **unless the viewer is a tester with UAT mode on**, which is what makes a UAT pilot workable from the live host; see the fuller note under "Shared with Rocks Fast".
- **`UPLOAD_ROOT` can be left empty** — there are no pre-SharePoint `AccRequestFile` rows in this app's databases (see "Shared with Rocks Fast"). Production already runs with it blank.
- **`SHAREPOINT_ACC_SITE` and `SHAREPOINT_ACC_FOLDER` must both be set, or attachment upload fails outright.** Neither AP-1 nor AP-17 has a local fallback: `isSharePointConfigured()` false makes the route delete its placeholder `AccRequestFile` row and answer **502** with `อัปโหลดไฟล์ขึ้น SharePoint ไม่สำเร็จ`. That is deliberate — files must be reachable from every web deployment — but it means a missing env var breaks uploading rather than quietly writing to disk. Live values verified 2026-08-19 against Graph with the app's own client credentials: `rockspc.sharepoint.com:/sites/Codex-ACCPortal` → site "Codex - ACC Portal" → drive "Documents" → folder `RocksAccUpload`, which already contains `AP-1/`, `AP-17/` and `_UAT/`.
- **Parallel UAT ships in three steps, in this order: apply 062 + 063 → deploy the code → apply 065.** All three are Fast_Core. 062 adds `ProductionEnabled` / `UatEnabled` beside the old `Environment` column and backfills them, leaving that column in place so the *currently running* app keeps working; 063 creates `UatTester`. Only once the new code is live does 065 drop `Environment`. Running 065 first takes the old build down — its `setFormFlag` names that column in the MERGE INSERT. (061 and 064 target `Rocks_Portal_Form_UAT` and are independent of the deploy; 061 must precede any UAT write.)
- **065 is one-way.** After it has run, a `git revert` of the parallel-UAT branch restores a `setFormFlag` that writes to a column that no longer exists, so the first write to any form fails. Reverting past commit `54ff2d7` means re-adding `FormEnvironment.Environment` as **NULLable** first — the original was `NOT NULL` with no default, which cannot be added back to a table that already has rows without backfilling one.
- **`066_portal_form_team_member.sql` must be applied to whichever database `MSSQL_FORM_DATABASE` names.** It is already applied to the live `Rocks_Portal_Form`; a fresh stand-up needs 059 then 066, or nobody can sign in at all (see the Accounting storage note). Never apply it to `Rocks_Portal_Form_UAT`.
- **AP-4 ships in one order and it is not optional: apply 088–092 to *both* `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`, and 093 to `Fast_Core`, *before* the code deploy.** 090 is the one that gates everything: `listMyWorkRows` (`src/lib/acc/report-service.ts`) names `[dbo].[AccReimburseApprover]` inside a query `queryBothPools` runs against **both** form databases, and SQL Server binds object names at compile time — so the table missing from either side is `Invalid object name`, not an empty result, and `queryBothPools` fails rather than returning half a list. **Deploying this code before 090 is on both databases breaks `/my-work` and Home's pending count for every user of every form**, not just for AP-4. 094 corrects 089's seeded checklist rule and goes to both form databases too; it is safe to run late, since a database that has never had 089 seeds the corrected text directly. Then run `npm run check:alignment` — note it now also fails until 089, 090 and 092 have been applied symmetrically, which is the check working rather than a fault.
- **120 goes to both form databases too, before the code — and already has.** (**Renumbered from 106**; the 106 on master is an unrelated journal-batch key change.) It creates `AccReimburseAccess` and `AccReimburseAccessTab`, and both are read through `getAccPool()` on a path a non-admin hits on every settings request — a table missing from either side is `Invalid object name`, not an empty result. `loadReimburseTabsByAccessIds` degrades **only** the missing-object error to "no grants" and rethrows everything else, so the window before 120 lands costs a granted non-admin their tabs rather than handing anyone somebody else's; an admin is unaffected either way, because the access endpoint skips the read for them entirely. Then run `npm run check:alignment`, which went from 23 tables to 25 when it landed and failed until 120 was on both.
- **AP-4 has to be commissioned once, from Settings, before anybody can use it.** Two things ship deliberately unset. `AccReimburseApprover` is **empty**, so until a System Admin adds at least two people (the final approval must be a different person from the check) every claim stops dead at the `ACCOUNT` step. And migration 092 seeds `AccFormBrand` with `('AP-4','ROCKS')`, where **`ROCKS` is not one of the four brands in `src/lib/brand.ts`** (PCTH, KSI, PCMY, UNO) — so out of the box the only claimable brand is one the brand registry does not know, and it renders with no logo and its own code for a name. Neither is a bug to be patched in code: an admin grants the company brands AP-4 should accept at **Settings → ขอเบิกเงินคืนพนักงาน (ออฟฟิต) → แบรนด์ที่เบิกได้**, and the page warns about any granted code the brand master does not know. That card is deliberately **not** `devHostOnly`, unlike its AP-1 neighbour, because it is reachable on the live host that this commissioning actually happens on. AP-17's hub card dropped the flag on 2026-08-27 for the same kind of reason — see "Shared with Rocks Fast".
- **123 goes to both form databases too, before the code — and already has (2026-08-27).** `123_travel_booking_detail_amounts.sql` adds `VatAmount`, `DiscountAmount` and `TotalAmount` to `AccTravelBookingDetail`. That table is **transactional**, so it is not in `MASTER_TABLES`, not dual-written, and `check:alignment` says nothing about it — but both sides still need the columns, because SQL Server binds object names at compile time: a query naming `VatAmount` fails outright against whichever database is missing it, and AP-17 resolves either one depending on who is asking. Nullable, no default, no backfill — an existing row reads NULL, which is honest, where writing 0 would claim a booking had no VAT rather than that its VAT is unknown.
- **124–136 all shipped between 2026-08-28 and 2026-09-03 and are already applied.** They split three ways and **the target is per migration, not per batch** — read each header, because getting one wrong is silent rather than loud:
  - **Production form database only, no UAT twin:** `124_brand_setting_currency`, `127_brand_currency`, `128_brand_setting_drop_single_currency`, `131_brand_currency_default` (all `BrandCurrency`/`BrandSetting`, read through `getProductionFormPool()`), and `132_travel_province_country`. 124 and 127 **refuse to run** against a `_UAT` database, and 132 keeps 104's single-copy rule.
  - **Both form databases, before the code:** `124_acc_booking_approver_areas`, `125_request_currency`, `126_request_foreign_amount_rename`, `129_expense_item_currency`, `130_rate_provenance`, `133_acc_travel_perdiem_country`, `134_acc_booking_approver_brand`, `135_travel_work_location_coords`, `136_booking_detail_total_baht`. Only 133 and 134 move `check:alignment` (25 → 27); the rest alter **transactional** tables, so the count must **not** move — a changed count means the wrong table was altered — and a one-sided apply is therefore invisible to the checker. It is still fatal: SQL Server binds object names at compile time, so a query naming `Currency` or `TotalAmountBaht` fails outright against whichever side is missing it, and both forms resolve either database depending on who is asking.
  - **128 is the one with an ordering rule of its own: apply it only *after* the multi-currency code is deployed** (commit `15a20c5`). 127 deliberately left 124's single-currency columns in place, because dropping a column out from under running code is its own outage.
- **126 renames rather than adds, and the name it replaces was the trap.** 125 called the column `BaseAmount`, following the spec's wording; twelve inches away `AccAdvance.BaseAmount` (migration 077) means the **opposite** — the baht figure, not the foreign one. It is now `AccRequest.ForeignAmount`.
- **135's coordinates cannot be backfilled.** `Lat`/`Lng` on `AccTravelWorkLocation` are filled by the browser's Google Places pick; the key is HTTP-referrer restricted, so a server-side geocode answers 403. Every location filed before 2026-09-01 has none and renders no map, which is the honest outcome rather than a wrong pin.
- **136's backfill is exact or it refuses.** It copies `TotalAmount` into `TotalAmountBaht` only after checking that no AP-17 request carries a foreign currency, so it can never stamp an unconverted foreign figure into a baht column.
- **AP-17's accounting step needs no migration, but it does need a person.** After this deploy the Admin desk stops closing requests and hands them to `ACCOUNT`, so nothing reaches `Completed` until somebody on `AccBookingApprover` works `/request/accounting/travel-booking/approvals`. Membership is what permits the action; an `accountApproval` tick in `AccBookingApproverTab` only decides who is shown the menu, and the hub shows it to roster members regardless.
- Liveness probe: `curl http://127.0.0.1:3081/api/health` → `{"ok":true,"data":{"service":"form-portal",…}}`.
- **`/api/health/db` no longer publishes the topology.** `auth.config.ts` exempts every `/api/health*` path from authentication, and that endpoint was returning the MSSQL host, port, service-account username, database name and the raw driver error text to anyone who asked. It now answers `database: "reachable" | "unreachable"` plus a 200/503, and includes the detail only for a System Admin. The diagnostic line goes to the server log unconditionally, which is where an operator should read it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

### `npm run check:alignment` — red 2026-08-20, closed 2026-08-21 by migration 103

**Current state: passing.** Run fresh while writing this note (2026-08-21):

```
PASS — 21 configuration tables identical across Rocks_Portal_Form and
Rocks_Portal_Form_UAT (84 rows compared; datetime columns and
AccSetting.ERP_INTERFACE_ENV excluded by design)
```

What follows is kept as history, not deleted, because a note that only ever
states today's reading cannot be told apart from one nobody has checked.

First measured red on 2026-08-20 — **not caused by the access-rights work**
landing the same day; the new `AccBookingApprover` passed the check from the
start. It was recorded at the time because the verifier had just become part
of the routine, and a red result needed to be told apart from a fresh break.
Migration 097 has since closed the schema half, taking the count **from four
mismatching tables to two**:

- **Schema — closed by migration 097.** `AccBrandBankAccount` and
  `AccBrandJournalBatch` carried a `FormCode` column in `Rocks_Portal_Form_UAT`
  that did not exist in `Rocks_Portal_Form`, so every row of both compared
  unequal despite identical data. 097 added the column to both databases, so the
  two tables now match. This was a side effect, not the migration's purpose —
  see "Per-form ERP configuration" above.
- **Data — the AP-3 gap has since closed, and something smaller took its
  place.** As at 2026-08-20 `Rocks_Portal_Form_UAT` held an entire extra form,
  **AP-3**, in `AccFormMaster` (production 6 rows, UAT 7) plus its five
  `AccFormBrand` rows (production 18, UAT 23), and the open question was
  whether AP-3 belonged in production. **Re-measured 2026-08-21: it does not
  report any more.** `AccFormMaster` matches, and `AccFormBrand` is 23 rows on
  both sides. Nothing in this repository closed it — no migration and no code
  change touches either table — so it was closed outside the app, and the
  earlier text is left above because a note that only ever states today's
  reading cannot be told apart from one nobody has checked.

**Closed 2026-08-21 by migration 103. `npm run check:alignment` now passes** —
21 tables, 84 rows, identical *as measured that day*. Re-measured 2026-09-04 it
still passes, at **27 tables and 132 rows**: the list has grown six times since
(AP-4's access pair, AP-17's `AccTravelPerDiemCountry` and
`AccBookingApproverBrand`), which is why the count here is a dated reading and
not a target to match.

The last mismatch was **not** the single row the verifier printed. It reports
the first differing row and then `break`s out of the loop, so a one-line output
had been read as a one-row problem for a day:

```
AccFormBrand: 23 row(s) each side
  Rocks_Portal_Form:     {"BrandCode":"KSI","FormCode":"AP-11","Id":1014, …}
  Rocks_Portal_Form_UAT: {"BrandCode":"KSI","FormCode":"AP-11","Id":1019, …}
```

What was actually wrong is that **AP-3 and AP-11 held each other's id blocks** —
ten rows, not one. Production had AP-11 at 1011-1015 and AP-3 at 1016-1020; UAT
had them the other way round, because each block was inserted into the two
databases in the opposite order by something other than `writeBothPools`. Every
business column agreed on all twenty-three rows; only `Id` differed. A divergent
id *is* the signature of a direct SQL edit against one database, because
dual-write supplies production's id to UAT explicitly.

`103_uat_form_brand_id_realign.sql` (`Rocks_Portal_Form_UAT` only) replaces every
UAT row with production's wholesale inside one transaction — the operation whose
correctness needs no reasoning about ordering, and the only one available here,
since the two blocks occupy each other's target ids and no per-row update can be
sequenced without colliding on the primary key or on `UQ_AccFormBrand`. It is
guarded so it can only ever change ids: it refuses unless both tables hold the
same set of `(FormCode, BrandCode)` **and** every pair already agrees on
`IsActive` and `SortOrder`. Real configuration drift therefore still reports
rather than being silently overwritten by production, which is the whole point of
the verifier it exists to satisfy.

**When the verifier is red, read past the first row.** It prints one pair and
stops.
