# Moving `DepartmentErpMap` into `Rocks_Portal_Form` — design

**Status:** approved 2026-08-20. Second of the three pieces approved together on
2026-08-20; the first shipped as `2026-08-20-per-form-erp-mapping-design.md`,
and the third — moving the five ERP sync tables to `Rocks_ERP_Data` — is still
blocked on a login grant.

**Goal.** Give the department→ERP-dimension mapping a single home in the
Accounting database, without changing which rows any of the three applications
sees.

---

## 1. Why, and what this does *not* buy

The instruction was to move Accounting data out of the shared configuration
database and into the Accounting database. That is the whole benefit, and it is
worth stating plainly what it is not:

- **It does not unshare the table.** RocksFast and ACC Portal keep reading and
  writing the same physical rows, through a synonym. One source of truth —
  unchanged.
- **It does not remove the Fast_Core dependency.** `getCorePool()` has more
  than forty other call sites, two of which can never move (see CLAUDE.md,
  "Parallel Production and UAT").

What it does buy: the Accounting configuration lives in the Accounting
database, one fewer table sits in the shared configuration database, and the
data has one documented home.

## 2. Measured starting state (2026-08-20)

`Fast_Core.dbo.DepartmentErpMap`:

```
[Id]                 INT IDENTITY(1,1) NOT NULL   -- IDENT_CURRENT = 2004
[BrandCode]          NVARCHAR(20)  NOT NULL
[DepartmentCode]     NVARCHAR(50)  NOT NULL
[HrDepartmentName]   NVARCHAR(200) NULL
[ErpDimensionCode]   NVARCHAR(50)  NOT NULL
[ErpCode]            NVARCHAR(50)  NOT NULL
[MappedBy]           INT           NULL
[MappedAt]           DATETIME2(7)  NOT NULL       -- DEFAULT (sysdatetime())
[FixedGlAccountNo]   NVARCHAR(50)  NULL
[FixedGlDescription] NVARCHAR(500) NULL
[FormCode]           NVARCHAR(20)  NULL           -- added by migration 098
```

- `PK_DepartmentErpMap` CLUSTERED on `Id`
- `UQ_DepartmentErpMap_Dept` UNIQUE on `(FormCode, BrandCode, DepartmentCode)`
- `IX_DepartmentErpMap_Brand` on `(BrandCode)`
- **No inbound foreign keys**, no check constraints, one default constraint
- **3 rows**, all `BrandCode = 'PCTH'`, all `FormCode NULL` — ids 1004, 1005,
  1006. Every row is a default, so the per-form rule resolves them for every
  form.
- Neither `Rocks_Portal_Form` nor `Rocks_Portal_Form_UAT` has the table today.

Two facts make the whole design work:

- **All three applications name the table two-part** — `[dbo].[DepartmentErpMap]`
  — on a pool opened against `Fast_Core`. A synonym in `Fast_Core` therefore
  answers all three without touching a line of the siblings' code, for `SELECT`,
  `MERGE` and `DELETE` alike.
- **`saai` is `db_owner` in both `Fast_Core` and `Rocks_Portal_Form`.** A
  synonym checks permissions on the base object in the target database, so the
  siblings' writes across the database boundary succeed. Measured, not assumed.

## 3. The shape

The physical table moves to `Rocks_Portal_Form.dbo.DepartmentErpMap`, reproducing
the definition above exactly: same columns, same nullability, same PK, same two
indexes, same default. The three rows are copied with their `Id` values
preserved, and the identity is reseeded to **2004** so new inserts continue the
existing sequence rather than colliding with 1004-1006.

`Fast_Core.dbo.DepartmentErpMap` becomes a `SYNONYM` for
`[Rocks_Portal_Form].[dbo].[DepartmentErpMap]`.

**One copy. No UAT twin.** The table is *not* created in
`Rocks_Portal_Form_UAT`, is *not* added to `src/lib/acc/dual-write.ts`, and is
*not* added to `MASTER_TABLES` in `scripts/checks/verify-master-alignment.ts`.

This was the design's one real decision, taken against the alternative sketched
when the three pieces were first approved. **A twin cannot be kept aligned
here.** A synonym points at exactly one database, so a sibling's write reaches
production and nothing else, while this app's dual-write reaches both — and
`npm run check:alignment` would then go red every time ACC Portal edited a
department mapping, with nothing actually wrong. That check is already red for
an unrelated reason (form AP-3 exists only in UAT); a second permanent
false-red source would make red mean nothing at all.

The cost is that a tester cannot try a different mapping in UAT. They cannot
today either — the table is a single copy in `Fast_Core` — so this preserves
today's behaviour exactly, which is the same property the per-form work was
built to preserve. A department→ERP-dimension map is shared reference
configuration, not transactional data.

## 4. Who reads it afterwards

**Form Portal.** `src/lib/acc/department-map-service.ts` switches **all six** of
its `getCorePool()` calls to **`getProductionFormPool()`**, keeping the two-part
table name. Every one of the six was checked and every one reads or writes
`DepartmentErpMap` and nothing else in `Fast_Core`, so none of them is a call
that must stay behind: the read at `:153`, the purge at `:232`,
`saveDepartmentMappings` at `:478`, `loadDepartmentErpMapsByTarget` at `:632`,
`loadDeptGlOverridesByTarget` at `:732` and `loadAllDepartmentErpMaps` at
`:820`. The two write paths (`:232`, `:478`) touch only this table inside their
transactions, so no transaction is split across databases by the move.

The rule is the one migration 066 established for `TeamMember`:
**never `getFormPool()`**. That pool's answer varies with the viewer's
environment, and with a single physical copy there is nothing for it to select
between — a UAT posting must resolve production's mapping, which is what
happens today. `loadErpDeptDisplayNamesByTargetBrand()` keeps `getDataPool()`;
it reads `Fast_Data`, not this table.

**RocksFast and ACC Portal.** Unchanged. They open `Fast_Core` and name the
table two-part; the synonym resolves.

**A sibling transaction that now spans two databases stays atomic.** Both
databases live on the same SQL Server instance, and a transaction on one
connection that reaches a second database on the same instance is a local
transaction — MSDTC is involved only across instances or linked servers.
Migration 066 already reads `[Fast_Core].[dbo].[TeamMember]` from a
`Rocks_Portal_Form` pool, so cross-database access on this instance is
established, not hoped for.

## 5. Cutover

Two migration files, because `scripts/apply-sql.ts` opens one pool per run and
this crosses a database boundary:

- **`099_portal_form_department_erp_map.sql` → `Rocks_Portal_Form`.** Creates
  the table, copies the rows three-part from
  `[Fast_Core].[dbo].[DepartmentErpMap]` under `IDENTITY_INSERT`, reseeds the
  identity.
- **`100_core_department_erp_map_synonym.sql` → `Fast_Core`.** Drops the table
  and creates the synonym.

**Order is 099 then 100, and 100's guard is the load-bearing part of this
design.** It destroys the only copy of the data. It must refuse to run unless
`[Rocks_Portal_Form].[dbo].[DepartmentErpMap]` exists **as a table** and holds
the same number of rows as the table about to be dropped — checked inside the
same transaction as the drop, so a failed check leaves `Fast_Core` untouched.
Both migrations name their target database in their header. **099 must refuse
`%_UAT` first and only then test the name**, in that order, exactly as migration
066 does — a lone "name begins `Rocks_Portal_Form`" test admits
`Rocks_Portal_Form_UAT`, which is the one database this table must never be
created in, since a second copy is precisely what §3 exists to prevent.

**The cutover is deploy-order-independent.** Old code reaches the table through
`getCorePool()` and a two-part name, which the synonym answers; new code reaches
it through `getProductionFormPool()` directly. Both work once the synonym
exists, so the migrations may run before or after the deploy and there is no
window in which the running application is broken.

## 6. What else has to change

- **`scripts/checks/verify-045.ts` and `verify-046.ts`** call
  `COL_LENGTH('dbo.DepartmentErpMap', …)` on a `Fast_Core` pool. `COL_LENGTH`
  does not resolve synonyms, so both would fail with a false negative. Repoint
  them at `getAppPool("Rocks_Portal_Form")` — correct regardless of how
  `COL_LENGTH` treats synonyms, because that is where the table now lives.
- **Comments naming the table's home** in `src/lib/acc/department-map-guard.ts`,
  `src/lib/acc/settings-tabs.ts` and
  `src/app/api/request/accounting/settings/departments/map/route.ts` say
  "the shared configuration database". Reword.
- **CLAUDE.md** — the 3-database table, the per-form ERP configuration section
  (which lists `Fast_Core.dbo.DepartmentErpMap` as "the same kind of table
  living in the shared database"), the สิทธิ์เข้าถึง section, and migration 098's
  description all name the old home.

## 7. The trap

**`settings/departments/map` stays admin-only.** Every word of the reason
survives the move except "Fast_Core":

> A tab grant must not become write access to another application's posting
> configuration.

The rows are still shared with two sibling applications that read them to
prepare financial journal postings. Only the file cabinet changed. Someone
reading the code later will see the table in this app's own database and
conclude the grant is now safe — **it is not**, and the comment must say so in
those terms rather than by naming a database.

The write also keeps its existing bound: `claimCodesForInterfaceTarget`
(`src/lib/acc/department-map-guard.ts`) limits the `legacyClaimCodes` purge loop
to the claim brands whose interface target is this target.

## 8. Verification

A post-apply check script asserting, against the live databases:

1. `Rocks_Portal_Form.dbo.DepartmentErpMap` is a table with 3 rows, the ids
   1004-1006 intact, `IDENT_CURRENT` = 2004, and both indexes plus the PK
   present under their original names.
2. The `Fast_Core` object is in `sys.synonyms` with `base_object_name` naming
   `[Rocks_Portal_Form].[dbo].[DepartmentErpMap]`.
3. A `SELECT` through the synonym returns the same 3 rows.
4. **A write through the synonym succeeds** — a `MERGE` inside a transaction
   that is then rolled back. This proves the siblings' cross-database
   permission, which is the one runtime assumption that would otherwise only be
   discovered when ACC Portal next saved a mapping.
5. `npm run check:alignment` reports exactly the pre-existing AP-3 mismatch and
   nothing new — the table count is unchanged because this table does not join
   `MASTER_TABLES`.

`npm test` is unaffected: the unit tests for the per-form rule import nothing
and touch no database.

## 9. Out of scope

- **Moving the five ERP sync tables to `Rocks_ERP_Data`** — still blocked on a
  grant for `saai`, which currently gets `Login failed` on that database.
- **Repointing the siblings' code** at the new home. They are separate
  repositories and the synonym makes it unnecessary. The synonym is permanent,
  not a migration aid.
- **Giving the table a UAT twin**, now or later, without first solving how a
  sibling's write reaches both copies. §3 is the record of why.
