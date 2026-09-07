# UatTester and UatTesterPerDiem move out of Fast_Core

**Date:** 2026-09-07
**Status:** design agreed, not built
**Migrations:** 139 (`Rocks_Portal_Form_UAT`), 140 and 141 (`Fast_Core`)

`Fast_Core` is shared with two sibling applications. Two of its tables are
Form Portal's alone and describe only UAT: `UatTester`, the roster of who may
test and who approves their test requests, and `UatTesterPerDiem`, a per-tester
effective-dated per-diem rate added days ago by migration 138. This spec moves
both into `Rocks_Portal_Form_UAT`, this app's own UAT form database, and leaves
a permanent synonym in `Fast_Core` for `UatTester` alone.

**`FormEnvironment` deliberately does not move.** See §2.

This is the fourth application of a pattern this repo has used three times —
099/100 (`DepartmentErpMap` out of `Fast_Core`), 101/102 (five ERP tables out of
`Fast_Data`), 104/105 (`TravelProvince` out of `Fast_Data`) — and the first
whose synonym points **into** a UAT database rather than a production one.

---

## 1. Decisions taken

| Question | Decision |
|---|---|
| Which tables move | `UatTester` and `UatTesterPerDiem`. Both. |
| Does `FormEnvironment` move | **No.** It decides production availability; §2. |
| Which pool reads them afterwards | **`getUatFormPool()`** — a literal. Never `getFormPool()`, never `getAccPool()`. |
| Does `Fast_Core` keep a synonym | **For `UatTester` only.** ACC Portal reads it; nothing anywhere reads the per-diem table but this app. |
| What happens when `Rocks_Portal_Form_UAT` is unreachable | **Fail loudly.** No degrading to "not a tester". |
| The mail drain's silent redirect | **Changed to fail loudly too.** §7. |

### Why the durability argument lost

Migration 063's header states the reason `UatTester` was put in `Fast_Core`:
"readable whichever pool a request resolves to, **and it survives a rebuild of
the UAT database**." The second half was the strongest argument against this
move, and it was weighed and rejected on one measured fact: the requester
confirmed on 2026-09-07 that `Rocks_Portal_Form_UAT` is **rebuilt essentially
never**. A hazard whose trigger does not occur is not a reason.

Recorded here rather than dropped, because 063's header still says it and the
next reader will find the two in conflict.

---

## 2. Why `FormEnvironment` cannot follow

`getFormSwitchMap()` is awaited unconditionally on **every** classified-form
request, by every user, inside `resolveCurrentFormAccess`
(`form-environment/index.ts:139`), and neither it nor its caller has a
`try`/`catch`. It holds `ProductionEnabled` as well as `UatEnabled`.

Moving it into `Rocks_Portal_Form_UAT` would make **production availability
depend on the UAT database being up**. `Fast_Core` must be reachable anyway —
auth, brand configuration and the connection registries all live there — so
keeping the switches beside it adds no dependency that is not already required.

`UatTester` is different, and that difference is what makes its move safe:
`viewerIsTesting` (`index.ts:109-113`) returns `false` without touching the
database unless the `form-portal-uat-mode` cookie is present and on. A
production user who is not testing never reads it.

---

## 3. The pool rule, and the cycle one line away

After the move both modules read **`getUatFormPool()`**
(`src/lib/db/mssql.ts:118-120`), which is `getNamedPool(env.MSSQL_FORM_UAT_DATABASE)`
— a literal env name that consults no resolver and imports nothing from
`@/lib/form-environment`.

**There is no cycle.** The resolver's constraint
(`form-environment/index.ts:76-86`) is that nothing on the path deciding *which*
form database answers may be reached through `getFormPool()`. `getUatFormPool()`
satisfies that exactly as `getCorePool()` did, and `uat-tester/service.ts`
already imports `@/lib/db/mssql` statically, so no new module edge appears.

**Two wrong answers are each one line away, and they fail differently:**

- **`getFormPool()` closes the loop**: `getFormPool → resolveFormEnvironment →
  resolveCurrentFormAccess → viewerIsTesting → getActiveUatTester → getFormPool`.
  `src/lib/acc/pool.ts:4` is `export const getAccPool = getFormPool`, so an
  author reaching for "the accounting pool" out of habit closes it. No type
  error predicts this.
- **`getProductionFormPool()` resolves `Rocks_Portal_Form`**, where the tables
  do not exist — `Invalid object name` on every resolve.

A source-reading guard test pins this; §8.

---

## 4. Storage

Both tables are created in `Rocks_Portal_Form_UAT` with the **identical** shape
they have today — every column, index and constraint from
`migrations/063_core_uat_tester.sql:8-21` and
`migrations/138_core_uat_tester_per_diem.sql:47-69`, including
`UQ_UatTester_StaffId`, the non-unique `IX_UatTester_Email`,
`UQ_UatTesterPerDiem_Staff_Date` and `CK_UatTesterPerDiem_Amount`.

**One physical copy each. Not dual-written, not in `MASTER_TABLES`.**
`writeBothPools` runs its callback against *both* form databases, and these
tables exist in only one, so a production pass would fail on `Invalid object
name`. `npm run check:alignment` must stay at **27** — its loop reads both
pools, so a table present in only one is invisible to it either way.

**Ids are preserved and the identity is reseeded to the source's
`IDENT_CURRENT`, not to `MAX(Id)`.** Measured 2026-09-07 against the live
`Fast_Core`:

| Table | Rows | `MAX(Id)` | `IDENT_CURRENT` → reseed floor |
|---|--:|--:|--:|
| `UatTester` | 15 | 20 | **20** |
| `UatTesterPerDiem` | 1 | 1 | **1** |

`UatTester`'s ids are sparse — 15 rows spread over 1..20 — so a floor taken from
the row count would re-issue ids that have already been used.

**Migrations 061 and 064 do not reach these tables.** Both enumerate 23
transactional table names explicitly (`061:39-47`, `064:61-69`), and neither name
is among them, so ids 1..20 in `Rocks_Portal_Form_UAT` violate no
`CHECK (Id >= 900000)` and get no 900000 reseed. There is no database-wide
trigger anywhere in the repo.

**The low ids are safe only because a `UatTester.Id` never appears in a path the
resolver parses.** `ROUTE_RULES` covers `/api/request/*` prefixes only;
`/api/settings/uat-users` is not among them. Anyone adding a `/api/request` rule
that reaches these tables re-opens `isUatId`'s assumption.

---

## 5. The synonym — `UatTester` only

`Fast_Core.dbo.UatTester` becomes
`CREATE SYNONYM ... FOR [Rocks_Portal_Form_UAT].[dbo].[UatTester]`, and it is
**permanent**, for one named consumer.

**What ACC Portal actually needs, measured:** two read-only statements in one
file (`ACC_Portal/ACC_Portal/src/lib/uat-tester/service.ts:41-55` and `:86-98`),
both `SELECT TOP (1) Id, StaffId, Email, ManagerStaffId, ManagerEmail FROM
[dbo].[UatTester]` — **two-part names, no JOIN, no write anywhere in the
repository**, on `getFastCorePool()`, a fixed pool on `env.RF_CORE_DATABASE`
(zod default `"Fast_Core"`). A synonym satisfies every one of those
requirements. It never names `FormEnvironment` in the same query — the two meet
only in JavaScript, as separate round trips.

**Rocks Fast names `UatTester` nowhere at all** — repo-wide grep returns nothing.

**`UatTesterPerDiem` gets no synonym.** No application other than this one names
it. A synonym with no consumer is a claim that somebody depends on it, and the
next reader would have to disprove that before touching it.

**Nothing in `Fast_Core` depends on either table.** Measured 2026-09-07 against
`sys.sql_expression_dependencies`: the only referencing object is
`CK_UatTesterPerDiem_Amount`, the table's own CHECK constraint. No view,
function or procedure blocks the drop.

---

## 6. Migrations, and the guard that must be inverted

| # | Target | Contents |
|---|---|---|
| 139 | `Rocks_Portal_Form_UAT` | create both tables, copy both, reseed both identities |
| 140 | `Fast_Core` | content-check and drop `UatTester`, create its synonym |
| 141 | `Fast_Core` | content-check and drop `UatTesterPerDiem`. **No synonym.** |

139 follows 099/104's three-batch shape: guards then `CREATE TABLE`; guards
again then an id-keyed `MERGE` under `SET IDENTITY_INSERT` reading `Fast_Core`
three-part, with a `COUNT(*)` comparison inside the transaction that `ROLLBACK`s
and `RAISERROR`s on a mismatch; then, **outside any transaction** because
`DBCC CHECKIDENT` is not transactional, the reseed guarded by
`IDENT_CURRENT(...) < floor`.

140 and 141 follow 100/105's early-exit ladder — wrong database → raise; already
a synonym → skip; not a table → refuse to guess; **destination missing → "run
139 first, refusing to drop the only copy"** — then `SET XACT_ABORT ON`,
`SET LOCK_TIMEOUT 5000`, a source count under `TABLOCKX` held to the end of the
transaction, and an `EXCEPT` content check before the drop.

**The content check is a whole-row comparison, like 105's and unlike 102's.**
Neither table has an `nvarchar(MAX)` column, so every column is in the
projection and nothing is reduced to a `DATALENGTH`.

**139's database guard must be INVERTED relative to 099 and 104.** Both of those
refuse `DB_NAME() LIKE '%[_]UAT'` **first and deliberately** (`099:57-59`). 139
needs the opposite: it must *require* the name to end in `_UAT`, the way `061:20-27`
and `064:37-44` do, **and** require `OBJECT_ID('dbo.AccRequest','U')` to be
present, so a differently-named `_UAT` database cannot be hit by a mistyped
`--db`. Copying 099's ladder verbatim produces a migration that refuses the only
database it is meant to run against.

**138 cannot be repurposed as the bootstrap.** Its own guard is
`IF DB_NAME() NOT LIKE 'Fast_Core%' THROW` (`138:47-48`), so it refuses every
database except the one the table is leaving.

---

## 7. Deployment order — three steps, and why not two

**139 → 140 → deploy the code → 141.**

The order is split per table because the two have different consumers, and the
obvious two-step orders each break something:

- **139 → 140 → 141 → code** breaks the per-diem read. Between 141 and the
  deploy, `per-diem.ts` still names `getCorePool()` and `Fast_Core` no longer
  holds the table or a synonym for it — `Invalid object name` on AP-17's pricing
  path in UAT.
- **139 → code → 140** leaves a divergence window: Form Portal writes the new
  roster while ACC Portal still reads `Fast_Core`'s now-frozen copy. Nothing
  errors; the two applications simply disagree about who may test.

The three-step order has neither window, because **a synonym is transparent to
the code that predates it**. After 140, the old build's `getCorePool()` reads
*and writes* — including `upsertUatTester`'s `MERGE` — resolve through the
synonym into the new home, so ACC Portal and Form Portal keep agreeing
throughout. 141 then removes a copy nothing reads any more.

**`npm run check:alignment` after each step; it must stay at 27.**

---

## 8. Availability, and the two failure modes

**Fail loudly. Nothing degrades to "not a tester".** A caught error there would
silently drop a tester back to Production mid-session and route their UAT work
into the production database — worse than an error page.

The blast radius after the move: a viewer **holding the UAT cookie** fails every
classified-form request while `Rocks_Portal_Form_UAT` is down. A production user
without the cookie is untouched, because of the cookie gate at
`form-environment/index.ts:110`.

**The mail drain currently chooses the other direction, deliberately, and this
changes it.** `src/lib/acc/email-queue.ts:146-155` wraps
`listActiveUatTesterAddresses()` in its own `try`/`catch` and, on any error,
logs and leaves `exemptTesters = []`. Its comment states the reasoning —
everything "is redirected, which is the safe direction" — and that reasoning is
sound as far as it goes: with no way to tell who is a tester, redirecting
everything is what guarantees no real person is mailed.

**Both options satisfy that guarantee. Only one is visible.** Redirecting
silently means the tester who should have received the mail does not, their
request sits at MANAGER, and the only trace is a server log line nobody reads.
Letting the error propagate leaves the rows **queued** — nothing is mailed to
the wrong place either, the drain reports a failure, and the messages are still
there to send once the database is back.

That is also exactly what `applyUatRedirect` already does when neither
`UAT_MAIL_REDIRECT` nor `GRAPH_MAIL_FROM` is set: it throws and the row stays
queued rather than reaching a real recipient. This change makes the two halves
of the same function agree.

The failure becomes newly reachable from a UAT-database outage, which is why it
is in scope here rather than left alone.

---

## 9. Code changes

Ten lines, in two files, plus their headers:

| File | Change |
|---|---|
| `src/lib/uat-tester/service.ts` | `getCorePool` → `getUatFormPool` at six sites (`:53, :96, :235, :259, :370, :394`) |
| `src/lib/uat-tester/per-diem.ts` | `getCorePool` → `getUatFormPool` at four sites (`:55, :81, :135, :161`) |
| `src/lib/acc/email-queue.ts` | remove the swallowing `catch`; §7 |

Both headers are rewritten to state the new home, why `getUatFormPool()` and
**never** `getFormPool()`/`getAccPool()`, and that a missing table throws.

**No SQL changes.** Every statement names its table two-part, there is no
three-part reference and no cross-database JOIN anywhere in `src/`. The one
JOIN involving `UatTester` is a self-join (`service.ts:245-246`), which stays
intra-database wherever the object resolves.

---

## 10. Testing

- **A source-reading guard test**, in the shape of the existing lexical guards:
  `uat-tester/service.ts` and `per-diem.ts` must name `getUatFormPool` and must
  **not** name `getFormPool`, `getAccPool` or `getCorePool`. This is the §3
  hazard, and it is a *missing-call* failure no behavioural test would catch.
- **`npm run check:uat-tester-home`**, in the shape of
  `scripts/checks/verify-travel-province-move.ts:189-225`: open
  `getUatFormPool()` — the pool the app itself uses, not a literal database name
  — assert `Fast_Core.dbo.UatTester`'s `base_object_name` names that same
  database, and compare a count through the synonym with a direct count **in one
  round-trip**. This is what catches the env-drift hazard below.
- **`perdiem-source-guard.test.ts:165` needs updating**: its client-bundle arm
  greps for `getPerDiemEmployeeLog|getCorePool|uatPerDiemLog`, and the
  `getCorePool` arm goes stale. Add `getUatFormPool` rather than replacing —
  neither belongs in a client bundle.

**The env-drift hazard, stated plainly:** the synonym hard-codes
`[Rocks_Portal_Form_UAT]` while the app resolves `env.MSSQL_FORM_UAT_DATABASE`
(`mssql.ts:119`), which `src/env.ts:12` merely `.default(...)`s and never
asserts. Repointing that var makes Form Portal and ACC Portal read **different
tester rosters with no error anywhere** — the same shape CLAUDE.md already
records for `MSSQL_FORM_DATABASE`/migration 100 and
`MSSQL_ERP_DATA_DATABASE`/migration 102.

---

## 11. Documentation to correct

Every one of these currently asserts the opposite of what will be true:

- `src/lib/form-environment/index.ts:76-86` — the resolver invariant, verbatim
  "So `FormEnvironment` and `UatTester` stay in Fast_Core". It must now say
  `FormEnvironment` stays, and that `UatTester` moved but is still read through a
  pool the resolver never picks.
- `migrations/063_core_uat_tester.sql:3-4` — gains a "superseded by 139/140"
  header. It is applied and must not be re-run or rewritten.
- `migrations/138_core_uat_tester_per_diem.sql:14-22` — same, superseded by
  139/141.
- `CLAUDE.md` — the Parallel-UAT section, the 3-database table, and the AP-17
  per-diem bullet added days ago.
- `src/lib/uat-tester/per-diem.ts:14-31`, `src/lib/acc/email-queue.ts:133,142`,
  `src/lib/acc/travel-booking/allowance-log.ts:53`,
  `allowance-log-rule.ts:19`,
  `src/features/travel-booking/components/AllowanceHistoryModal.tsx:28`.
- `docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md` and its plan —
  dated documents; they gain a note, not a rewrite.

---

## 12. To verify during implementation, not assumed

1. **`MERGE ... WITH (HOLDLOCK)` through a synonym.** §7's order depends on the
   old build's writes resolving through `Fast_Core.dbo.UatTester` after 140.
   SQL Server permits a synonym as a MERGE target; the table hint on a synonym
   reference is the part to prove. Test it before 140 is applied, and if it does
   not hold, the order becomes 139 → code → 140 → 141 and the divergence window
   in §7 is accepted instead.
2. **ACC Portal's SQL login needs SELECT on `Rocks_Portal_Form_UAT`.** Synonyms
   do not carry permissions. Both apps use `MSSQL_USER`/`MSSQL_PASSWORD` and
   Form Portal already opens that database, so this is expected to hold — but it
   is a grant, and it must be confirmed rather than inferred.
3. **Whether production ACC Portal sets `RF_CORE_DATABASE`** to something other
   than `Fast_Core`. Only the local `.env.local` was readable, and it is
   gitignored, so production must be checked separately.
4. **Whether any consumer outside these three checkouts** — a stored procedure,
   a report, an SSIS job — names `Fast_Core.dbo.UatTester`. The synonym keeps
   two-part references working; a three-part reference to `Fast_Core` also keeps
   working. Only a schemabound object would break, and §5 shows there is none.

---

## 13. Out of scope

- **`FormEnvironment`.** §2.
- **Backfilling or a second copy.** There is one copy by design; a UAT database
  rebuild loses it, which is the accepted trade recorded in §1.
- **ACC Portal's own code.** It changes nothing: two-part reads through a
  synonym are exactly what it does today.
