# UatTesterPerDiem moves out of Fast_Core — and UatTester does not

**Date:** 2026-09-07
**Status:** design agreed; the first version was built and then partly reverted — see §12
**Migrations:** 139 (`Rocks_Portal_Form_UAT`), 140 (`Fast_Core`), 141
(`Fast_Core`, the realign 140's guard needed), and — 2026-09-08, after this
document was written — 142 and 143 (`Rocks_Portal_Form_UAT`), which renamed the
table to `TesterPerDiem` and dropped its `IsActive` column. **Everything below
is as written on 2026-09-07 and still says `UatTesterPerDiem` throughout.** The
architecture it argues for is unchanged; only the object's name and one column
are.

`Fast_Core` is shared with two sibling applications, Rocks Fast and ACC Portal.
`UatTesterPerDiem` — a per-tester effective-dated per-diem rate, created days ago
by migration 138 — is Form Portal's alone, describes only UAT, and is named by no
other application. It moves into `Rocks_Portal_Form_UAT`, this app's own UAT form
database. **No synonym is left behind**: nothing outside this repository names it.

**`UatTester` stays where it is, and so does `FormEnvironment`.** See §2. An
earlier version of this design moved `UatTester` too; §12 records why that was
wrong and how it was caught.

The filename says "uat-tester-move" because that is what this document was when
it was created. It is left alone so the branch's history reads straight.

---

## 1. Decisions taken

| Question | Decision |
|---|---|
| Which table moves | **`UatTesterPerDiem` only.** |
| Does `UatTester` move | **No** — reversed on 2026-09-07. §2, §12. |
| Does `FormEnvironment` move | **No.** Same reason, and it was never in doubt. |
| Which pool reads the moved table | **`getUatFormPool()`** — a literal. Never `getFormPool()`, never `getAccPool()`. |
| Does `Fast_Core` keep a synonym | **No.** Nothing outside this app names the table. §5. |
| What happens when `Rocks_Portal_Form_UAT` is unreachable | **Fail loudly.** No degrading to "no override". §8. |

---

## 2. What may leave `Fast_Core`, and the test that decides it

One question decides it: **is this table read on a path that runs for a user who
is not testing?** If yes, moving it makes ordinary availability depend on the UAT
database, which exists to be disposable. If no, it may go.

**`FormEnvironment` fails the test.** `getFormSwitchMap()` is awaited
unconditionally on every classified-form request, by every user, inside
`resolveCurrentFormAccess` (`src/lib/form-environment/index.ts`), with no
`try`/`catch` anywhere on that path. It holds `ProductionEnabled` as well as
`UatEnabled`.

**`UatTester` also fails the test, and this is what the first draft missed.** The
resolver's own read *is* cookie-gated — `viewerIsTesting` returns `false` without
touching a database unless the UAT-mode cookie is on. But the resolver is not the
only reader:

- `src/app/api/form-environment/route.ts` calls `getActiveUatTester(email)` in a
  `Promise.all` with **no cookie gate**, and there cannot be one:
  `viewer.isTester` is precisely what decides whether the PRO/UAT switch is
  *offered* to a tester who does not yet hold the cookie.
- That endpoint is fetched on **every dashboard page by every signed-in user** —
  `UatModeSwitch` is mounted unconditionally in `Navbar.tsx` (twice) and reaches
  it through `useFormEnvironments`.
- ACC Portal does the same thing, harder: its `(app)/layout.tsx` awaits
  `buildFormEnvironmentPayload(...)` with **no `try`/`catch`**, in the layout that
  wraps every page of that group, and its payload builder calls
  `getActiveUatTester` unconditionally too.

So moving `UatTester` would put a UAT database on the page-render path of two
production applications, for all users. `Fast_Core` must be reachable anyway —
auth, brand configuration and the connection registries live there — so leaving
the roster beside them adds no dependency that is not already required.

**`UatTesterPerDiem` passes the test.** Every one of its readers is already
inside UAT before it reads:

| Reader | Gate |
|---|---|
| `withUatOverrides` (`src/lib/hr/employee-lookup.ts`) | `resolveFormEnvironment() === "UAT"`, early return otherwise |
| `getPerDiemEmployeeLogMap` (`src/lib/acc/travel-booking/allowance-log.ts`) | builds `uatStaffIds` only from subjects with `uat: true`; `uatPerDiemLogsByStaffIds([])` returns before opening a pool |
| `/api/settings/uat-users/per-diem` | System Admin settings page |

No production request path reaches it. That asymmetry is the whole justification
for moving one table and not the other.

---

## 3. The pool rule, and the cycle one line away

`src/lib/uat-tester/per-diem.ts` reads **`getUatFormPool()`**
(`src/lib/db/mssql.ts:118-120`), which is
`getNamedPool(env.MSSQL_FORM_UAT_DATABASE)` — a literal env name that consults no
resolver.

`per-diem.ts` is reached from inside a `getAccPool()` transaction — AP-17's
per-diem recompute — so the wrong pool here does not merely read the wrong
database, it recurses:

- **`getFormPool()` closes the loop** `getFormPool → resolveFormEnvironment →
  resolveCurrentFormAccess → …`. `src/lib/acc/pool.ts:4` is
  `export const getAccPool = getFormPool`, so reaching for "the accounting pool"
  out of habit closes it. No type error predicts this.
- **`getProductionFormPool()` resolves `Rocks_Portal_Form`**, where the table does
  not exist — `Invalid object name` on every UAT read.
- **`getCorePool()` resolves `Fast_Core`**, where it no longer exists after
  migration 140.

A source-reading guard test pins this; §10.

**`src/lib/uat-tester/service.ts` keeps `getCorePool()`.** `UatTester` is not
moving and that file is not touched by this work.

---

## 4. Storage

`UatTesterPerDiem` is created in `Rocks_Portal_Form_UAT` with the **identical**
shape it has today — every column and constraint from
`migrations/138_core_uat_tester_per_diem.sql:47-69`, including
`UQ_UatTesterPerDiem_Staff_Date` and `CK_UatTesterPerDiem_Amount`.

**One physical copy. Not dual-written, not in `MASTER_TABLES`.** `writeBothPools`
runs its callback against *both* form databases and this table exists in only one,
so a production pass would fail on `Invalid object name`.
`npm run check:alignment` must stay at **27** — its loop reads both pools, so a
table present in only one is invisible to it either way.

**Ids are preserved and the identity is reseeded to the source's
`IDENT_CURRENT`.** Measured 2026-09-07 against the live `Fast_Core`: 1 row,
`MAX(Id)` = 1, `IDENT_CURRENT` = 1, so the floor is **1**.

The floor is belt-and-braces rather than load-bearing: `SET IDENTITY_INSERT`
already advances the identity to the highest id inserted, and the guard is
`IDENT_CURRENT(...) < floor`, so `DBCC CHECKIDENT` can only ever raise it, never
lower it below `MAX(Id)`.

**Migrations 061 and 064 do not reach this table.** Both enumerate 23
transactional table names explicitly and it is not among them, so a low id in
`Rocks_Portal_Form_UAT` violates no `CHECK (Id >= 900000)` and gets no 900000
reseed.

**No FK to `UatTester`.** Migration 138 deliberately created none (`138:43-45`),
which is exactly why the two tables can end up in different databases with
nothing to reconcile.

---

## 5. No synonym, and why none is needed

Migrations 100, 102 and 105 each left a synonym behind because a named sibling
still read the table two-part. **This move has no such consumer.**

Measured 2026-09-07 across all three checkouts: `UatTesterPerDiem` appears in
`Form_Portal` only. ACC Portal and Rocks Fast contain zero references — not in
`src/`, not in `scripts/`, not in `sql/`. Nothing in `Fast_Core` depends on it
either: `sys.sql_expression_dependencies` names only `CK_UatTesterPerDiem_Amount`,
the table's own CHECK constraint.

A synonym with no consumer is a claim that somebody depends on it, and the next
person to consider removing it would have to disprove that first.

**This also removes a hazard the earlier design carried.** A `Fast_Core` synonym
pointing into a UAT database would have been the first of its kind in this repo,
and would have inherited the env-drift shape CLAUDE.md records for
`MSSQL_FORM_DATABASE` and `MSSQL_ERP_DATA_DATABASE` — the migration hard-codes a
database name while the app resolves an env var. With no synonym there is nothing
to drift.

---

## 6. Migrations

| # | Target | Contents |
|---|---|---|
| 139 | `Rocks_Portal_Form_UAT` | create `UatTesterPerDiem`, copy it, reseed its identity |
| 140 | `Fast_Core` | content-check and drop `UatTesterPerDiem`. No synonym. |

139 follows 099/104's three-batch shape: guards then `CREATE TABLE`; guards again
then an id-keyed `MERGE` under `SET IDENTITY_INSERT` reading `Fast_Core`
three-part, with a `COUNT(*)` comparison inside the transaction that `ROLLBACK`s
and `RAISERROR`s on a mismatch; then, **outside any transaction** because
`DBCC CHECKIDENT` is not transactional, the reseed guarded by
`IDENT_CURRENT(...) < 1`.

140 follows 100/105's early-exit ladder — wrong database → raise; already gone →
skip; not a table → refuse to guess; **destination missing → "run 139 first,
refusing to drop the only copy"** — then `SET XACT_ABORT ON`,
`SET LOCK_TIMEOUT 5000`, a source count under `TABLOCKX` held to the end of the
transaction, and an `EXCEPT` content check before the drop.

**The content check is a whole-row comparison, like 105's and unlike 102's.** The
table has no `nvarchar(MAX)` column, so all ten columns are in the projection and
nothing is reduced to a `DATALENGTH`.

**139's database guard is INVERTED relative to 099 and 104.** Both of those refuse
`DB_NAME() LIKE '%[_]UAT'` **first and deliberately** (`099:57-59`). 139 needs the
opposite: it must *require* the name to end in `_UAT`, the way `061:20-27` and
`064:37-44` do, **and** require `OBJECT_ID('dbo.AccRequest','U')` to be present,
so a differently-named `_UAT` database cannot be hit by a mistyped `--db`.
Copying 099's ladder verbatim produces a migration that refuses the only database
it is meant to run against.

**138 cannot be repurposed as the bootstrap.** Its guard is
`IF DB_NAME() NOT LIKE 'Fast_Core%' THROW` (`138:47-48`), so it refuses every
database except the one the table is leaving.

---

## 7. Deployment order — 139 → deploy the code → 140

Two steps, and the order matters in one direction only.

- **139 first.** It creates a second copy and changes nothing about how the
  running build reads the table: `per-diem.ts` still names `getCorePool()` until
  the deploy, and `Fast_Core` still holds the original.
- **140 last.** The table gets **no synonym**, so there is nothing to be
  transparent through: running 140 before the deploy would give the running build
  `Invalid object name` on AP-17's pricing path in UAT.

Neither gap opens a divergence window, and the reason is stronger than it looks:
**the per-diem feature itself is not on `master`.** `per-diem.ts`, the settings
route and migration 138 all arrive in the same merge, so between 139 and the
deploy there is no writer of `Fast_Core.UatTesterPerDiem` anywhere in the running
build — nothing can diverge because nothing can write. Do not read this as a
general property of the two-step: it would **not** hold for a two-stage release
where the feature was already live, and 138 having been applied to `Fast_Core`
already makes that misreading easy.

**`npm run check:alignment` after each step; it must stay at 27.**

---

## 8. Availability

**Fail loudly. Nothing degrades to "no override".** A caught error would price a
UAT tester at their real HR allowance with no error — the exact failure the AP-17
per-diem feature exists to prevent, on a path that writes
`AccRequest.TotalAmount`.

The blast radius is narrow by construction, and that is §2's asymmetry paying
off: every reader is already inside UAT before it reads, so a
`Rocks_Portal_Form_UAT` outage costs a UAT tester their AP-17 pricing path and
costs a production user nothing, because no production path reaches this table.

**The mail drain is not touched by this work.** An earlier version of this design
changed `src/lib/acc/email-queue.ts` to rethrow instead of swallowing a
tester-lookup failure, on the reasoning that the move made that path newly
reachable. `listActiveUatTesterAddresses` reads `UatTester`, which is staying in
`Fast_Core`, so that reasoning no longer holds and the change is reverted. The
original swallow stands, and so does the `console.error` beside it — which was
always there, and was the thing the change nearly cost.

---

## 9. Code changes

Four lines in one file, plus its header:

| File | Change |
|---|---|
| `src/lib/uat-tester/per-diem.ts` | `getCorePool` → `getUatFormPool` at its four pool acquisitions — one per exported function that opens one. Line numbers are deliberately not cited: this row named `:55, :81, :135, :161` and was stale twice over by the time the work landed, because the file's own header grew. |

Its header states the new home, and why `getUatFormPool()` and **never**
`getFormPool()`/`getAccPool()`.

**No SQL changes.** Every statement names the table two-part; there is no
three-part reference and no cross-database JOIN.

**`src/lib/uat-tester/service.ts` and `src/lib/acc/email-queue.ts` are not
touched.**

---

## 10. Testing

- **A source-reading guard test** asserting `per-diem.ts` names `getUatFormPool`
  and **not** `getFormPool`, `getAccPool`, `getProductionFormPool` or
  `getCorePool`. The failure mode is a swapped identifier that typechecks, whose
  symptom is either recursion or `Invalid object name` at runtime — neither
  reachable by a unit test of a function that opens a pool. It also pins that
  `getAccPool` really is `getFormPool`, since that is the premise the
  `getAccPool` prohibition rests on.
- **`npm run check:uat-tester-home`**: `UatTesterPerDiem` is a table in the
  database `getUatFormPool()` actually opens — the name taken from
  `SELECT DB_NAME()` on that connection and validated against
  `/^[A-Za-z0-9_]+$/` before any interpolation, following
  `verify-travel-province-move.ts:116-122` — and `Fast_Core` holds **no object of
  that name**, since a leftover table there would be a second copy that silently
  stops being written.
- `perdiem-source-guard.test.ts`'s client-bundle arm keeps `getUatFormPool`
  alongside `getCorePool`: neither belongs in a browser bundle.

---

## 11. Documentation to correct

- `migrations/138_core_uat_tester_per_diem.sql` — a "superseded by 139/140"
  header above its intact existing text. It is applied and must not be re-run.
- `CLAUDE.md` — the 3-database table, the Parallel-UAT section, and a deployment
  bullet for 139/140. **`UatTester` and `FormEnvironment` are described as staying
  in `Fast_Core`, because that is what they do.**
- `src/lib/uat-tester/per-diem.ts`, `per-diem-rule.ts`,
  `src/lib/acc/travel-booking/allowance-log.ts`, `allowance-log-rule.ts`,
  `src/features/travel-booking/components/AllowanceHistoryModal.tsx` — each names
  the table's home in a comment.
- `docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md` and its plan —
  one line each; they are dated history and are not rewritten.

---

## 12. What this design got wrong, and how it was caught

Recorded because the error is instructive and the filename still carries it.

**The first version moved `UatTester` as well**, on the argument that it was
"different" from `FormEnvironment` because `viewerIsTesting` is cookie-gated. That
version was built in full — three migrations, the application repointed, a guard
test, a check script and a documentation pass — reviewed task by task, and
reached a whole-branch review before the flaw surfaced.

**The flaw:** the cookie gate is a property of the *resolver*, and the resolver is
not the only reader. `/api/form-environment` reads the roster for every signed-in
user on every dashboard page, and ACC Portal's app-shell layout does the same with
no `try`/`catch`. Moving `UatTester` would therefore have put a UAT database on
two production applications' page-render path — the exact property that had
already disqualified `FormEnvironment`, which this design named and then failed to
apply to the second table.

**How it was caught:** not by the author. A reviewer traced the readers instead of
accepting §2's claim, and the requester then asked the question that settled it —
whether `UatTester` should have stayed in `Fast_Core` after all.

**What it cost:** nothing irreversible. No migration had been applied when the
reversal was taken, so the correction was code and documentation only.

**What to take from it:** "is this read cookie-gated?" was the wrong question. The
right one is **"is this table read on any path that runs for a user who is not
testing?"** — a question about every reader, not about the resolver. §2 is written
that way now.
