# Form Portal — own database (`Rocks_Portal_Form`) + UAT environment

**Date:** 2026-08-13
**Status:** Approved design, not yet implemented

## Problem

Form Portal was cloned from Rocks Fast and still writes to `Fast_Form`, the same
database Rocks Fast writes to. There is no data isolation between the two apps
and no environment where changes can be tested against real workflows without
touching production rows.

Two changes are wanted:

1. Form Portal gets its own database, `Rocks_Portal_Form`, and stops sharing
   `Fast_Form` with Rocks Fast.
2. A UAT environment is added, covering the Form Portal database only.

## Decisions

| Question | Decision |
|----------|----------|
| What moves | All 43 tables — `OfficeForm*` (9) and `Acc*` (34) |
| Rocks Fast | Keeps using `Fast_Form` unchanged. After the cutover the two apps no longer share data, and AP-1/AP-17 stop being usable from Rocks Fast |
| Existing data | Not migrated. Start fresh — schema plus master/config rows only (see "Seeding") |
| UAT scope | `Rocks_Portal_Form_UAT` only. `Fast_Core`, `Rocks_Portal_HR`, `Rocks_Codex` and `Fast_Data` stay production for both environments |
| PROD vs UAT separation | **Separate database**, not separate tables and not an environment column |
| How the app knows which it is | **Separate deployment** — two instances, each with its own `.env`. No runtime toggle |

### Why a separate database

`getFormPool()` already resolves its database name from an env var, and no SQL
in the repo names `Fast_Form` literally:

```ts
// src/lib/db/mssql.ts:68
export function getFormPool() {
  return getNamedPool(env.MSSQL_FORM_DATABASE);
}
```

`getAccPool` is an alias of `getFormPool` (`src/lib/acc/pool.ts:4`), so both the
Form Builder and the Accounting tables follow that one variable.

| Approach | Cost | Risk |
|----------|------|------|
| **Separate database** | One env var per deployment; migrations applied twice | Low — cross-environment reads are physically impossible |
| Separate tables (`UAT_AccRequest`) | 86 tables; 26 FK names collide; every query must build a table name at runtime | High — abandons the parameterized-query pattern used throughout and introduces an injection surface |
| `Environment` discriminator column | Column on all 43 tables; every query needs a filter; every unique key must include the environment | Highest — one missing `WHERE` leaks UAT rows into production, and `AccSequence` running numbers collide across environments |

The server already follows the separate-database convention (`Rocks_PCTH_UAT`,
`Rocks_UNO_UAT`), and refreshing UAT from production becomes a backup/restore
rather than a per-table delete script.

## Target layout

```
Rocks_Portal_Form        PROD   43 tables
Rocks_Portal_Form_UAT    UAT    43 tables, identical schema

Fast_Core                shared, production, both environments
Rocks_Portal_HR          shared, production, both environments
Rocks_Codex              shared, production, both environments
Fast_Data                shared, production, both environments

Fast_Form                left untouched for Rocks Fast
```

## Code changes

| File | Change |
|------|--------|
| `.env` of each deployment | `MSSQL_FORM_DATABASE=Rocks_Portal_Form` (PROD) / `Rocks_Portal_Form_UAT` (UAT) |
| `src/env.ts:11` | Default changes from `"Fast_Form"` to `"Rocks_Portal_Form"` |
| `src/lib/acc/pool.ts:3` | Comment says "stored in Fast_Form" — update |
| `src/lib/acc/travel-booking/request-service.ts:386` | Comment references Fast_Form — update |
| `CLAUDE.md` | Rewrite the 3-database table and the "Shared with Rocks Fast" section |

Changing the `src/env.ts` default matters beyond tidiness: while it stays
`"Fast_Form"`, a deployment with the variable missing silently writes to Rocks
Fast's database instead of failing.

No query changes. No changes to the 26 foreign keys.

## Schema creation

The 57 files in `migrations/` are incremental (013 creates `AccRequest`; 023,
024, 040 and 047 alter it later) and mix three databases in one folder. Replaying
them against a new database is error-prone and would not be verifiable against
what the code expects today.

Instead, generate a single baseline from the live `Fast_Form` schema — 43 tables,
26 foreign keys, indexes, defaults, identity settings — as
`migrations/059_portal_form_baseline.sql`, and apply it to both databases:

```bash
npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/059_portal_form_baseline.sql
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/059_portal_form_baseline.sql
```

From then on every new migration is applied to both databases.

## Seeding

"Schema only" is not sufficient on its own: 19 of the 43 tables hold
configuration rather than transactions, and the app is unusable when they are
empty. Classification is by foreign-key reachability from `AccRequest`.

### Copy from `Fast_Form` (19 tables)

| Table | Rows | Empty means |
|-------|-----:|-------------|
| `AccFormMaster` | 3 | Accounting hub lists no forms at all |
| `AccFormBrand` | 7 | No brand can reach any form |
| `AccApprover` | 5 | Nothing can pass the Account approval step |
| `AccApproverInterfaceBrand` | 0 | — |
| `AccApproverSettingsTab` | 0 | — |
| `AccVehicle` | 6 | AP-1 cannot be filled in |
| `AccTravelReason` | 9 | AP-17 dropdown empty |
| `AccTravelAccommodation` | 3 | AP-17 dropdown empty |
| `AccTravelRentVehicle` | 4 | AP-17 dropdown empty |
| `AccTravelVehicleOption` | 4 | AP-17 dropdown empty |
| `AccTravelVehiclePlace` | 2 | AP-17 dropdown empty |
| `AccBrandBankAccount` | 3 | ERP/BC settings lost |
| `AccBrandBranchCode` | 3 | ERP/BC settings lost |
| `AccBrandGlAccount` | 3 | ERP/BC settings lost |
| `AccBrandJournalBatch` | 1 | ERP/BC settings lost |
| `AccBrandErpInterface` | 5 | ERP/BC settings lost |
| `AccBrandErpTargetSetting` | 2 | ERP/BC settings lost |
| `AccSameDayBrandStaff` | 0 | — |
| `AccSetting` | 3 | `ERP_INTERFACE_ENV`, journal description template lost |

`AccSetting.ERP_INTERFACE_ENV` is currently `Sandbox`. Do not copy it as-is: set
it to `Production` in `Rocks_Portal_Form` and `Sandbox` in
`Rocks_Portal_Form_UAT`.

### Leave empty (23 tables)

Reachable from `AccRequest` by foreign key, plus the queue and the Form Builder
tables:

`AccRequest`, `AccApproval`, `AccActivityLog`, `AccRequestFile`, `AccPerDiem`,
`AccPerDiemDay`, `AccTravelExpense`, `AccTravelExpenseItem`,
`AccTravelVehicleSection`, `AccTravelBooking`, `AccTravelBookingDetail`,
`AccTravelDepartureLocation`, `AccTravelWorkLocation`, `AccEmailQueue`,
and all nine `OfficeForm*` tables.

`AccTravelWorkLocation`, `AccTravelDepartureLocation` and
`AccTravelVehicleSection` read like lookup tables from their names but each has a
foreign key to a request or booking — they are per-request rows, not master data.

### Running numbers (1 table)

`AccSequence` holds allocation state, not master data. Current values:

| Prefix | Year | LastSeq |
|--------|-----:|--------:|
| `TOF` | 2026 | 46 |
| `TRL` | 2026 | 9 |

Seed `Rocks_Portal_Form` with these values, not zero. Starting from zero would
reissue `TOF26-0001` onward — numbers already sent to Accounting from the old
system.

Seed `Rocks_Portal_Form_UAT` with `LastSeq = 9000` for both prefixes, so a UAT
number (`TOF26-9001`) is never mistaken for a production one at a glance.

19 + 23 + 1 = 43 tables.

## Accepted risks

**UAT sends real email and writes to production SharePoint.** Separating the
database isolates rows, not side effects. A UAT instance still:

- sends approval mail through the shared Graph mailbox to real managers'
  inboxes — `AccEmailQueue` is per-database, but the destination addresses are
  real;
- uploads attachments to the same `SHAREPOINT_ACC_SITE` / `SHAREPOINT_ACC_FOLDER`;
- resolves approval chains from production `Rocks_Portal_HR` employee and
  manager records.

A kill switch (redirect all UAT mail to one address, separate SharePoint folder)
was considered and deliberately deferred. It can be added later without
disturbing the database split.

## Blockers

Both must be cleared before implementation starts; neither can be done from the
application:

1. **The `saai` login cannot reach `Rocks_Portal_Form`** — it currently fails
   with `Login failed for user 'saai'`. The database exists (created 2026-08-13
   15:35) but the login has no access.
2. **`Rocks_Portal_Form_UAT` does not exist** and must be created.

## Out of scope

- Migrating existing rows in the 23 transactional tables.
- Changing Rocks Fast in any way.
- Moving `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` or `Rocks_Codex`.
- Deploying the UAT instance (host, port and `PRODUCTION_HOSTS` are a separate
  piece of work — see CLAUDE.md → Deployment).
