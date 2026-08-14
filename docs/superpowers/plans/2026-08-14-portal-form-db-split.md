# Form Portal own-database + UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Form Portal's 43 tables off the shared `Fast_Form` database onto its own `Rocks_Portal_Form`, with an identical `Rocks_Portal_Form_UAT` twin, without migrating transactional data.

**Architecture:** The app already resolves its form-database name from `env.MSSQL_FORM_DATABASE` and no SQL in the repo names `Fast_Form` literally, so environment separation is a config change plus two new databases. Schema comes from a generator that scripts the live `Fast_Form` into one baseline SQL file; master/config rows are copied by a seed script; transactional tables start empty.

**Tech Stack:** TypeScript, `tsx` for scripts, `mssql` driver, SQL Server. No test framework in this repo — verification follows the existing `scripts/checks/verify-*.ts` idiom, run with `npx tsx`.

## Global Constraints

- Source of truth for the design: `docs/superpowers/specs/2026-08-13-portal-form-db-split-design.md`.
- 43 tables total: 19 seeded from `Fast_Form`, 23 left empty, 1 (`AccSequence`) seeded with explicit values.
- `Fast_Form` is **read-only** for the whole of this plan. Rocks Fast keeps using it. No writes, no drops, no schema changes.
- Never use `sql.connect()` — use `getAppPool(name)` from `src/lib/db/mssql.ts`.
- Parameterized queries only (`request().input(...)`), except for generated DDL which has no user input.
- Scripts load `.env.local` themselves and import the pool by relative path — `tsx` resolves neither `.env.local` nor the `@/` alias.
- ES5 target: use `Array.from()`, not `[...set]`.
- `AccSequence` in PROD seeds to `TOF/2026/46` and `TRL/2026/9`; in UAT both prefixes seed to `9000`.
- `AccSetting.ERP_INTERFACE_ENV` is `Production` in PROD and `Sandbox` in UAT — never copied verbatim.

## Blocker

Tasks 4 and 5 cannot run until a DBA grants the `saai` login access to both databases. As of 2026-08-14 both fail with `Login failed for user 'saai'`. Tasks 1–3 and 6 have no such dependency; Task 6's verification step does.

Required grant, run by someone with server-level rights:

```sql
USE [Rocks_Portal_Form];
CREATE USER [saai] FOR LOGIN [saai];
ALTER ROLE [db_owner] ADD MEMBER [saai];
GO
USE [Rocks_Portal_Form_UAT];
CREATE USER [saai] FOR LOGIN [saai];
ALTER ROLE [db_owner] ADD MEMBER [saai];
```

`db_owner` is needed because the baseline creates tables, constraints and indexes.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/env.ts` (modify) | Default for `MSSQL_FORM_DATABASE` becomes `Rocks_Portal_Form` |
| `.env.example` (modify) | Documents `MSSQL_FORM_DATABASE` per environment |
| `src/lib/acc/pool.ts` (modify) | Comment no longer claims Fast_Form |
| `src/lib/acc/travel-booking/request-service.ts:386` (modify) | Same |
| `CLAUDE.md` (modify) | Database table + "Shared with Rocks Fast" rewritten |
| `scripts/generate-form-baseline.ts` (create) | Scripts the live `Fast_Form` schema into one idempotent SQL file |
| `migrations/059_portal_form_baseline.sql` (create, generated) | The baseline applied to both new databases |
| `scripts/seed-portal-form.ts` (create) | Copies the 19 master/config tables and seeds `AccSequence` + `AccSetting` |
| `scripts/checks/verify-059.ts` (create) | Asserts a target database matches the expected 43-table shape and seed state |

---

### Task 1: Point the app at `Rocks_Portal_Form`

Config and documentation only. Safe to land before the databases exist, because
`.env.local` still names `Fast_Form` explicitly until Task 6 — the default only
applies when the variable is absent.

**Files:**
- Modify: `src/env.ts:11`
- Modify: `.env.example`
- Modify: `src/lib/acc/pool.ts:3`
- Modify: `src/lib/acc/travel-booking/request-service.ts:386`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing
- Produces: `env.MSSQL_FORM_DATABASE` defaulting to `"Rocks_Portal_Form"`. Every later task assumes a deployment without that variable set reaches the new database, never `Fast_Form`.

- [ ] **Step 1: Change the env default**

In `src/env.ts`, line 11:

```ts
    MSSQL_FORM_DATABASE: z.string().default("Rocks_Portal_Form"),
```

- [ ] **Step 2: Document the variable in `.env.example`**

Replace the `MSSQL_FORM_DATABASE=Fast_Form` line with:

```env
# Form Portal's own database. PROD deployments use Rocks_Portal_Form; the UAT
# deployment uses Rocks_Portal_Form_UAT. Fast_Form belongs to the Rocks Fast
# sibling — pointing this at it makes both apps write to the same rows again.
MSSQL_FORM_DATABASE=Rocks_Portal_Form
```

- [ ] **Step 3: Fix the two stale comments**

`src/lib/acc/pool.ts` line 3:

```ts
/** Pool for the Accounting form tables (stored in the Form Portal database). */
```

`src/lib/acc/travel-booking/request-service.ts` line 386:

```ts
/** Fast_Data.dbo.TravelProvince is cross-database from the form DB — resolved via its own pool. */
```

- [ ] **Step 4: Update CLAUDE.md**

In the 3-Database Architecture table, replace the `Fast_Form` row with:

```markdown
| **Rocks_Portal_Form** | `getFormPool()` | Form definitions, submissions, approvals, files, logs, and all `Acc*` Accounting tables. Form Portal's own database — `Rocks_Portal_Form_UAT` is the UAT twin, selected by `MSSQL_FORM_DATABASE` |
```

and replace the `Fast_Form` (Acc* tables) row with:

```markdown
| **Rocks_Portal_Form** (Acc* tables) | `getAccPool()` → `getFormPool()` | Accounting forms: travel expense (AP-1), travel booking (AP-17) |
```

In "Shared with Rocks Fast", replace the "Same databases" and "Same `AccEmailQueue`" bullets with:

```markdown
- **Databases are no longer shared**: Form Portal owns `Rocks_Portal_Form` (plus `Rocks_Portal_Form_UAT`). `Fast_Form` belongs to Rocks Fast and this app must not read or write it. `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` and `Rocks_Codex` are still the same shared databases both apps use.
- **`AccEmailQueue` is no longer shared** — each app drains the queue in its own database.
```

- [ ] **Step 5: Verify nothing still resolves to Fast_Form in code**

Run:

```bash
npx tsc --noEmit
grep -rn "Fast_Form" src/ --include="*.ts" --include="*.tsx"
```

Expected: `tsc` exits 0. The grep returns nothing.

- [ ] **Step 6: Commit**

```bash
git add src/env.ts .env.example src/lib/acc/pool.ts src/lib/acc/travel-booking/request-service.ts CLAUDE.md
git commit -m "chore(db): default the form database to Rocks_Portal_Form"
```

---

### Task 2: Baseline schema generator

Produces one SQL file describing all 43 tables. Emits every `CREATE TABLE`
first, then constraints, then indexes — so table order never matters and the 26
foreign keys cannot fail on a missing target.

**Files:**
- Create: `scripts/generate-form-baseline.ts`
- Create (generated): `migrations/059_portal_form_baseline.sql`

**Interfaces:**
- Consumes: `getAppPool` from `src/lib/db/mssql.ts`
- Produces: `migrations/059_portal_form_baseline.sql`, applied by Tasks 4 and 5. Every statement is guarded by an existence check, so re-applying is a no-op.

- [ ] **Step 1: Write the generator**

Create `scripts/generate-form-baseline.ts`:

```ts
/* eslint-disable no-console */
/**
 * Script the live Fast_Form schema into migrations/059_portal_form_baseline.sql.
 *
 * Reads Fast_Form only. Emits CREATE TABLE for every table, then check
 * constraints, then primary/unique keys, then foreign keys, then remaining
 * indexes — each guarded so the file is safe to re-apply.
 *
 * Usage: npx tsx scripts/generate-form-baseline.ts
 */
import fs from "node:fs";
import path from "node:path";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const SOURCE_DB = "Fast_Form";
const OUT = path.resolve(process.cwd(), "migrations/059_portal_form_baseline.sql");

/** Render a column's type with the right length/precision suffix. */
function renderType(
  typeName: string,
  maxLength: number,
  precision: number,
  scale: number,
): string {
  const t = typeName.toLowerCase();
  if (t === "nvarchar" || t === "nchar") {
    return maxLength === -1 ? `${typeName}(MAX)` : `${typeName}(${maxLength / 2})`;
  }
  if (t === "varchar" || t === "char" || t === "varbinary" || t === "binary") {
    return maxLength === -1 ? `${typeName}(MAX)` : `${typeName}(${maxLength})`;
  }
  if (t === "decimal" || t === "numeric") return `${typeName}(${precision}, ${scale})`;
  if (t === "datetime2" || t === "time" || t === "datetimeoffset") return `${typeName}(${scale})`;
  return typeName;
}

async function main() {
  loadDotEnvLocal();
  const { getAppPool } = await import("../src/lib/db/mssql");
  const pool = await getAppPool(SOURCE_DB);

  const tables = (
    await pool.request().query<{ name: string }>(
      `SELECT name FROM sys.tables ORDER BY name`,
    )
  ).recordset.map((r) => r.name);

  const out: string[] = [];
  out.push(`-- Baseline schema for the Form Portal database.`);
  out.push(`-- Generated from ${SOURCE_DB} by scripts/generate-form-baseline.ts.`);
  out.push(`-- Do not edit by hand: regenerate instead.`);
  out.push(`-- Apply with:`);
  out.push(`--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/059_portal_form_baseline.sql`);
  out.push("");

  /* ── Tables ── */
  for (const t of tables) {
    const cols = (
      await pool.request().input("t", t).query<{
        name: string; TypeName: string; max_length: number; precision: number;
        scale: number; is_nullable: boolean; is_identity: boolean;
        seed_value: string | null; increment_value: string | null;
        DefaultDef: string | null;
      }>(`
        SELECT c.name, ty.name AS TypeName, c.max_length, c.precision, c.scale,
               c.is_nullable, c.is_identity,
               CAST(ic.seed_value AS NVARCHAR(50)) AS seed_value,
               CAST(ic.increment_value AS NVARCHAR(50)) AS increment_value,
               dc.definition AS DefaultDef
        FROM sys.columns c
        JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        LEFT JOIN sys.identity_columns ic
          ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
        WHERE c.object_id = OBJECT_ID(@t)
        ORDER BY c.column_id
      `)
    ).recordset;

    const lines = cols.map((c) => {
      const parts = [`  [${c.name}] ${renderType(c.TypeName, c.max_length, c.precision, c.scale)}`];
      if (c.is_identity) parts.push(`IDENTITY(${c.seed_value ?? 1},${c.increment_value ?? 1})`);
      if (c.DefaultDef) parts.push(`DEFAULT ${c.DefaultDef}`);
      parts.push(c.is_nullable ? "NULL" : "NOT NULL");
      return parts.join(" ");
    });

    out.push(`IF OBJECT_ID('dbo.${t}', 'U') IS NULL`);
    out.push(`CREATE TABLE [dbo].[${t}] (`);
    out.push(lines.join(",\n"));
    out.push(`);`);
    out.push(`GO`);
    out.push("");
  }

  /* ── Check constraints ── */
  const checks = (
    await pool.request().query<{ Name: string; TableName: string; definition: string }>(`
      SELECT cc.name AS Name, OBJECT_NAME(cc.parent_object_id) AS TableName, cc.definition
      FROM sys.check_constraints cc ORDER BY TableName, Name
    `)
  ).recordset;
  for (const c of checks) {
    out.push(`IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = '${c.Name}')`);
    out.push(`ALTER TABLE [dbo].[${c.TableName}] ADD CONSTRAINT [${c.Name}] CHECK ${c.definition};`);
    out.push(`GO`);
    out.push("");
  }

  /* ── Primary keys, unique constraints, indexes ── */
  const idx = (
    await pool.request().query<{
      TableName: string; IndexName: string; is_primary_key: boolean;
      is_unique_constraint: boolean; is_unique: boolean; type_desc: string;
      ColName: string; is_descending_key: boolean; is_included_column: boolean;
      key_ordinal: number;
    }>(`
      SELECT OBJECT_NAME(i.object_id) AS TableName, i.name AS IndexName,
             i.is_primary_key, i.is_unique_constraint, i.is_unique, i.type_desc,
             c.name AS ColName, ic.is_descending_key, ic.is_included_column,
             ic.key_ordinal
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      JOIN sys.tables t ON t.object_id = i.object_id
      WHERE i.type_desc <> 'HEAP' AND i.name IS NOT NULL
      ORDER BY TableName, i.index_id, ic.is_included_column, ic.key_ordinal
    `)
  ).recordset;

  const grouped = new Map<string, typeof idx>();
  for (const r of idx) {
    const key = `${r.TableName}.${r.IndexName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  Array.from(grouped.values()).forEach((rows) => {
    const head = rows[0];
    const keyCols = rows
      .filter((r) => !r.is_included_column)
      .map((r) => `[${r.ColName}]${r.is_descending_key ? " DESC" : ""}`)
      .join(", ");
    const included = rows.filter((r) => r.is_included_column).map((r) => `[${r.ColName}]`);

    if (head.is_primary_key || head.is_unique_constraint) {
      const kind = head.is_primary_key ? "PRIMARY KEY" : "UNIQUE";
      const clustered = head.type_desc === "CLUSTERED" ? "CLUSTERED" : "NONCLUSTERED";
      out.push(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${head.IndexName}' AND object_id = OBJECT_ID('dbo.${head.TableName}'))`);
      out.push(`ALTER TABLE [dbo].[${head.TableName}] ADD CONSTRAINT [${head.IndexName}] ${kind} ${clustered} (${keyCols});`);
    } else {
      const unique = head.is_unique ? "UNIQUE " : "";
      const clustered = head.type_desc === "CLUSTERED" ? "CLUSTERED " : "";
      const inc = included.length ? ` INCLUDE (${included.join(", ")})` : "";
      out.push(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${head.IndexName}' AND object_id = OBJECT_ID('dbo.${head.TableName}'))`);
      out.push(`CREATE ${unique}${clustered}INDEX [${head.IndexName}] ON [dbo].[${head.TableName}] (${keyCols})${inc};`);
    }
    out.push(`GO`);
    out.push("");
  });

  /* ── Foreign keys ── */
  const fks = (
    await pool.request().query<{
      Name: string; FromTable: string; ToTable: string; FromCol: string;
      ToCol: string; DeleteAction: string; UpdateAction: string;
    }>(`
      SELECT fk.name AS Name,
             OBJECT_NAME(fk.parent_object_id) AS FromTable,
             OBJECT_NAME(fk.referenced_object_id) AS ToTable,
             pc.name AS FromCol, rc.name AS ToCol,
             fk.delete_referential_action_desc AS DeleteAction,
             fk.update_referential_action_desc AS UpdateAction
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
      JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      ORDER BY fk.name, fkc.constraint_column_id
    `)
  ).recordset;

  const fkGroups = new Map<string, typeof fks>();
  for (const r of fks) {
    if (!fkGroups.has(r.Name)) fkGroups.set(r.Name, []);
    fkGroups.get(r.Name)!.push(r);
  }

  Array.from(fkGroups.values()).forEach((rows) => {
    const head = rows[0];
    const from = rows.map((r) => `[${r.FromCol}]`).join(", ");
    const to = rows.map((r) => `[${r.ToCol}]`).join(", ");
    const del = head.DeleteAction === "NO_ACTION" ? "" : ` ON DELETE ${head.DeleteAction.replace("_", " ")}`;
    const upd = head.UpdateAction === "NO_ACTION" ? "" : ` ON UPDATE ${head.UpdateAction.replace("_", " ")}`;
    out.push(`IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = '${head.Name}')`);
    out.push(`ALTER TABLE [dbo].[${head.FromTable}] ADD CONSTRAINT [${head.Name}] FOREIGN KEY (${from}) REFERENCES [dbo].[${head.ToTable}] (${to})${del}${upd};`);
    out.push(`GO`);
    out.push("");
  });

  fs.writeFileSync(OUT, out.join("\n"), "utf8");
  console.log(`Wrote ${OUT}`);
  console.log(`  tables:            ${tables.length}`);
  console.log(`  check constraints: ${checks.length}`);
  console.log(`  keys/indexes:      ${grouped.size}`);
  console.log(`  foreign keys:      ${fkGroups.size}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("generate-form-baseline failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the generator**

Run: `npx tsx scripts/generate-form-baseline.ts`

Expected: `tables: 43`, `foreign keys: 26`, and a non-empty
`migrations/059_portal_form_baseline.sql`.

- [ ] **Step 3: Sanity-check the generated SQL**

Run:

```bash
grep -c "^CREATE TABLE" migrations/059_portal_form_baseline.sql
grep -c "FOREIGN KEY" migrations/059_portal_form_baseline.sql
grep -n "CK_AccRequest_Status" migrations/059_portal_form_baseline.sql
```

Expected: `43`, `26`, and one line for the status check constraint. If the check
constraint is missing, the generator dropped it and the file is not usable —
stop and fix Step 1 before continuing.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-form-baseline.ts migrations/059_portal_form_baseline.sql
git commit -m "feat(db): generate the Form Portal baseline schema from Fast_Form"
```

---

### Task 3: Seed script

Copies the 19 master/config tables from `Fast_Form` into a target database and
sets the two environment-specific values. Never touches the 23 transactional
tables.

**Files:**
- Create: `scripts/seed-portal-form.ts`

**Interfaces:**
- Consumes: `migrations/059_portal_form_baseline.sql` must already be applied to the target — the script copies rows, it does not create tables.
- Produces: CLI `npx tsx scripts/seed-portal-form.ts --db <name> --env <prod|uat> [--dry-run]`. Tasks 4 and 5 call it.

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-portal-form.ts`:

```ts
/* eslint-disable no-console */
/**
 * Seed a Form Portal database with master/config rows copied from Fast_Form.
 *
 * Copies the 19 configuration tables listed in the design spec. The 23
 * transactional tables are deliberately left empty. AccSequence and
 * AccSetting.ERP_INTERFACE_ENV are set per environment rather than copied.
 *
 * Usage:
 *   npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form     --env prod
 *   npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form_UAT --env uat
 *   npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form     --env prod --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import type { ConnectionPool } from "mssql";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const SOURCE_DB = "Fast_Form";

/** The 19 master/config tables, in foreign-key-safe order. */
const MASTER_TABLES = [
  "AccFormMaster",
  "AccFormBrand",
  "AccApprover",
  "AccApproverInterfaceBrand",
  "AccApproverSettingsTab",
  "AccVehicle",
  "AccTravelReason",
  "AccTravelAccommodation",
  "AccTravelRentVehicle",
  "AccTravelVehicleOption",
  "AccTravelVehiclePlace",
  "AccBrandBankAccount",
  "AccBrandBranchCode",
  "AccBrandGlAccount",
  "AccBrandJournalBatch",
  "AccBrandErpInterface",
  "AccBrandErpTargetSetting",
  "AccSameDayBrandStaff",
  "AccSetting",
];

interface Args { db: string; env: "prod" | "uat"; dryRun: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let db = "", envName = "", dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") db = argv[++i] ?? "";
    else if (argv[i] === "--env") envName = argv[++i] ?? "";
    else if (argv[i] === "--dry-run") dryRun = true;
  }
  if (!db) throw new Error("--db <database> is required");
  if (envName !== "prod" && envName !== "uat") throw new Error("--env must be prod or uat");
  if (db === SOURCE_DB) throw new Error(`Refusing to seed ${SOURCE_DB} — it belongs to Rocks Fast`);
  return { db, env: envName, dryRun };
}

/** Copy every row of one table, preserving identity values. */
async function copyTable(src: ConnectionPool, dst: ConnectionPool, table: string, dryRun: boolean) {
  const rows = (await src.request().query(`SELECT * FROM [dbo].[${table}]`)).recordset;
  const existing = (await dst.request().query(`SELECT COUNT(*) AS N FROM [dbo].[${table}]`))
    .recordset[0].N as number;

  if (existing > 0) {
    console.log(`  ${table}: skipped — target already has ${existing} row(s)`);
    return;
  }
  if (rows.length === 0) {
    console.log(`  ${table}: nothing to copy (source empty)`);
    return;
  }
  if (dryRun) {
    console.log(`  ${table}: would copy ${rows.length} row(s)`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const hasIdentity = (
    await dst.request().input("t", table).query(
      `SELECT COUNT(*) AS N FROM sys.identity_columns WHERE object_id = OBJECT_ID(@t)`,
    )
  ).recordset[0].N as number;

  const colList = cols.map((c) => `[${c}]`).join(", ");
  if (hasIdentity) await dst.request().batch(`SET IDENTITY_INSERT [dbo].[${table}] ON`);
  try {
    for (const row of rows) {
      const req = dst.request();
      cols.forEach((c, i) => req.input(`p${i}`, (row as Record<string, unknown>)[c]));
      const params = cols.map((_, i) => `@p${i}`).join(", ");
      await req.query(`INSERT INTO [dbo].[${table}] (${colList}) VALUES (${params})`);
    }
  } finally {
    if (hasIdentity) await dst.request().batch(`SET IDENTITY_INSERT [dbo].[${table}] OFF`);
  }
  console.log(`  ${table}: copied ${rows.length} row(s)`);
}

async function main() {
  loadDotEnvLocal();
  const args = parseArgs();
  const { getAppPool, sql } = await import("../src/lib/db/mssql");
  const src = await getAppPool(SOURCE_DB);
  const dst = await getAppPool(args.db);

  console.log(`Seeding ${args.db} (${args.env})${args.dryRun ? " — DRY RUN" : ""}`);

  console.log("\nMaster/config tables:");
  for (const t of MASTER_TABLES) await copyTable(src, dst, t, args.dryRun);

  /* ── Environment-specific values ── */
  const erpEnv = args.env === "prod" ? "Production" : "Sandbox";
  console.log(`\nERP_INTERFACE_ENV -> ${erpEnv}`);
  if (!args.dryRun) {
    await dst
      .request()
      .input("v", sql.NVarChar, erpEnv)
      .query(`
        UPDATE AccSetting SET SettingValue = @v, UpdatedAt = GETDATE()
        WHERE SettingKey = 'ERP_INTERFACE_ENV';
        IF @@ROWCOUNT = 0
          INSERT INTO AccSetting (SettingKey, SettingValue, UpdatedAt)
          VALUES ('ERP_INTERFACE_ENV', @v, GETDATE());
      `);
  }

  const seqs = args.env === "prod"
    ? [{ prefix: "TOF", year: 2026, last: 46 }, { prefix: "TRL", year: 2026, last: 9 }]
    : [{ prefix: "TOF", year: 2026, last: 9000 }, { prefix: "TRL", year: 2026, last: 9000 }];

  console.log("\nAccSequence:");
  for (const s of seqs) {
    console.log(`  ${s.prefix}/${s.year} -> LastSeq ${s.last}`);
    if (args.dryRun) continue;
    await dst
      .request()
      .input("p", sql.NVarChar, s.prefix)
      .input("y", sql.Int, s.year)
      .input("n", sql.Int, s.last)
      .query(`
        UPDATE AccSequence SET LastSeq = @n, UpdatedAt = GETDATE()
        WHERE Prefix = @p AND Year = @y;
        IF @@ROWCOUNT = 0
          INSERT INTO AccSequence (Prefix, Year, LastSeq, UpdatedAt)
          VALUES (@p, @y, @n, GETDATE());
      `);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-portal-form failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the guard rails without a database**

Run:

```bash
npx tsx scripts/seed-portal-form.ts --db Fast_Form --env prod
npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form --env staging
```

Expected: the first fails with `Refusing to seed Fast_Form — it belongs to Rocks
Fast`; the second fails with `--env must be prod or uat`. Both exit non-zero.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-portal-form.ts
git commit -m "feat(db): seed script for the Form Portal master/config tables"
```

---

### Task 4: Build `Rocks_Portal_Form` (PROD)

**Requires the blocker to be cleared.** Every step here fails with `Login failed
for user 'saai'` until the grant is run.

**Files:** none — this task only runs commands.

**Interfaces:**
- Consumes: `migrations/059_portal_form_baseline.sql` (Task 2), `scripts/seed-portal-form.ts` (Task 3)
- Produces: a populated `Rocks_Portal_Form` that Task 6 points the app at

- [ ] **Step 1: Apply the baseline**

Run:

```bash
npm run apply-sql -- --db Rocks_Portal_Form --file migrations/059_portal_form_baseline.sql
```

Expected: `applied 059_portal_form_baseline.sql to Rocks_Portal_Form OK`.

- [ ] **Step 2: Dry-run the seed**

Run:

```bash
npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form --env prod --dry-run
```

Expected: `AccFormMaster: would copy 3 row(s)`, `AccApprover: would copy 5
row(s)`, `AccVehicle: would copy 6 row(s)`, and `ERP_INTERFACE_ENV -> Production`.

- [ ] **Step 3: Seed for real**

Run:

```bash
npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form --env prod
```

Expected: the same tables reported as `copied`, then `Done.`

- [ ] **Step 4: Verify**

Run: `npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form --env prod`
Expected: `PASS` (script written in Task 6, Step 1 — write that step first if
working out of order).

---

### Task 5: Build `Rocks_Portal_Form_UAT`

Same as Task 4 against the UAT database, with the UAT environment values.
**Requires the blocker to be cleared.**

**Files:** none.

**Interfaces:**
- Consumes: the same two artifacts as Task 4
- Produces: a populated `Rocks_Portal_Form_UAT`

- [ ] **Step 1: Apply the baseline**

Run:

```bash
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/059_portal_form_baseline.sql
```

Expected: `applied 059_portal_form_baseline.sql to Rocks_Portal_Form_UAT OK`.

- [ ] **Step 2: Seed with UAT values**

Run:

```bash
npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form_UAT --env uat
```

Expected: the same master tables copied, `ERP_INTERFACE_ENV -> Sandbox`, and
both sequences at `LastSeq 9000`.

- [ ] **Step 3: Verify**

Run: `npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form_UAT --env uat`
Expected: `PASS`.

---

### Task 6: Verification script and cutover

**Files:**
- Create: `scripts/checks/verify-059.ts`
- Modify: `.env.local` (not tracked)

**Interfaces:**
- Consumes: a database built by Task 4 or 5
- Produces: `npx tsx scripts/checks/verify-059.ts --db <name> --env <prod|uat>`, printing `PASS` or `FAIL` with the specific mismatch

- [ ] **Step 1: Write the verification script**

Create `scripts/checks/verify-059.ts`:

```ts
/* eslint-disable no-console */
/**
 * Verify a Form Portal database matches the design spec:
 *   - 43 tables, 26 foreign keys
 *   - the 19 master/config tables are populated where the source has rows
 *   - the 23 transactional tables are empty
 *   - AccSetting.ERP_INTERFACE_ENV and AccSequence match the environment
 *
 * Usage: npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form --env prod
 */
import fs from "node:fs";
import path from "node:path";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const MUST_HAVE_ROWS = [
  "AccFormMaster", "AccFormBrand", "AccApprover", "AccVehicle",
  "AccTravelReason", "AccTravelAccommodation", "AccTravelRentVehicle",
  "AccTravelVehicleOption", "AccTravelVehiclePlace", "AccBrandBankAccount",
  "AccBrandBranchCode", "AccBrandGlAccount", "AccBrandJournalBatch",
  "AccBrandErpInterface", "AccBrandErpTargetSetting", "AccSetting",
];

const MUST_BE_EMPTY = [
  "AccRequest", "AccApproval", "AccActivityLog", "AccRequestFile",
  "AccPerDiem", "AccPerDiemDay", "AccTravelExpense", "AccTravelExpenseItem",
  "AccTravelVehicleSection", "AccTravelBooking", "AccTravelBookingDetail",
  "AccTravelDepartureLocation", "AccTravelWorkLocation", "AccEmailQueue",
  "OfficeForms", "OfficeFormVersions", "OfficeFormSubmissions",
  "OfficeFormApprovals", "OfficeFormWorkflows", "OfficeFormWorkflowSteps",
  "OfficeFormFiles", "OfficeFormEmailQueue", "OfficeFormActivityLog",
];

async function main() {
  loadDotEnvLocal();
  const argv = process.argv.slice(2);
  let db = "", envName = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") db = argv[++i] ?? "";
    else if (argv[i] === "--env") envName = argv[++i] ?? "";
  }
  if (!db || (envName !== "prod" && envName !== "uat")) {
    throw new Error("Usage: --db <database> --env <prod|uat>");
  }

  const { getAppPool } = await import("../../src/lib/db/mssql");
  const pool = await getAppPool(db);
  const failures: string[] = [];

  const tableCount = (await pool.request().query("SELECT COUNT(*) AS N FROM sys.tables"))
    .recordset[0].N as number;
  if (tableCount !== 43) failures.push(`expected 43 tables, found ${tableCount}`);

  const fkCount = (await pool.request().query("SELECT COUNT(*) AS N FROM sys.foreign_keys"))
    .recordset[0].N as number;
  if (fkCount !== 26) failures.push(`expected 26 foreign keys, found ${fkCount}`);

  for (const t of MUST_HAVE_ROWS) {
    const n = (await pool.request().query(`SELECT COUNT(*) AS N FROM [dbo].[${t}]`))
      .recordset[0].N as number;
    if (n === 0) failures.push(`${t} is empty but should hold config rows`);
  }

  for (const t of MUST_BE_EMPTY) {
    const n = (await pool.request().query(`SELECT COUNT(*) AS N FROM [dbo].[${t}]`))
      .recordset[0].N as number;
    if (n !== 0) failures.push(`${t} should be empty, found ${n} row(s)`);
  }

  const expectedErp = envName === "prod" ? "Production" : "Sandbox";
  const erp = (
    await pool.request().query(
      "SELECT SettingValue AS V FROM AccSetting WHERE SettingKey = 'ERP_INTERFACE_ENV'",
    )
  ).recordset[0]?.V as string | undefined;
  if (erp !== expectedErp) failures.push(`ERP_INTERFACE_ENV is ${erp ?? "missing"}, expected ${expectedErp}`);

  const expectedSeq = envName === "prod" ? { TOF: 46, TRL: 9 } : { TOF: 9000, TRL: 9000 };
  const seqs = (await pool.request().query("SELECT Prefix, Year, LastSeq FROM AccSequence")).recordset;
  for (const prefix of ["TOF", "TRL"] as const) {
    const row = seqs.find((r) => r.Prefix === prefix && r.Year === 2026);
    if (!row) failures.push(`AccSequence has no ${prefix}/2026 row`);
    else if (row.LastSeq !== expectedSeq[prefix]) {
      failures.push(`AccSequence ${prefix}/2026 is ${row.LastSeq}, expected ${expectedSeq[prefix]}`);
    }
  }

  if (failures.length) {
    console.error(`FAIL — ${db} (${envName})`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS — ${db} (${envName}): 43 tables, 26 FKs, config seeded, transactional tables empty`);
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-059 failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck and commit the script**

Run: `npx tsc --noEmit`
Expected: exits 0.

```bash
git add scripts/checks/verify-059.ts
git commit -m "test(db): verify a Form Portal database matches the split spec"
```

- [ ] **Step 3: Point local dev at the new database**

In `.env.local` (not tracked), change:

```env
MSSQL_FORM_DATABASE=Rocks_Portal_Form
```

- [ ] **Step 4: Confirm the app runs against it**

Run `npm run dev`, then:

```bash
curl -s http://localhost:3020/api/health
```

Expected: `{"ok":true,...}`. Then sign in and confirm the Accounting hub at
`/request/accounting` lists AP-1 and AP-17 — that proves `AccFormMaster` and
`AccFormBrand` were seeded correctly. Stop the dev server afterwards.

- [ ] **Step 5: Confirm Rocks Fast still works**

Rocks Fast must be unaffected. Confirm `Fast_Form` still has its original row
counts:

```bash
npx tsx scripts/checks/verify-059.ts --db Fast_Form --env prod
```

Expected: `FAIL`, listing `AccRequest should be empty, found 52 row(s)` among
others. That failure is the desired result — it proves `Fast_Form` was left
untouched with its transactional data intact.

- [ ] **Step 6: Commit the documentation update**

```bash
git add CLAUDE.md
git commit -m "docs: record the Rocks_Portal_Form cutover"
```

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Separate database decision | Task 1 (env default), Tasks 4–5 (build both) |
| Code changes table (5 files) | Task 1, Steps 1–4 |
| Schema creation from baseline | Task 2 |
| Seeding: 19 master/config tables | Task 3, Step 1 (`MASTER_TABLES`) |
| Seeding: 23 tables left empty | Task 6, Step 1 (`MUST_BE_EMPTY`) — enforced, never written |
| `AccSetting.ERP_INTERFACE_ENV` per environment | Task 3, Step 1; verified Task 6, Step 1 |
| `AccSequence` PROD 46/9, UAT 9000 | Task 3, Step 1; verified Task 6, Step 1 |
| Accepted risk: UAT sends real mail | Not implemented by design — deferred in the spec |
| Blocker: `saai` grant | "Blocker" section; Tasks 4 and 5 depend on it |
| Blocker: UAT database missing | Cleared 2026-08-14 — the database now exists |
| Out of scope: Rocks Fast untouched | Task 6, Step 5 verifies it |

**Type consistency:** `copyTable(src, dst, table, dryRun)` is called with that
signature in Task 3. `MASTER_TABLES` (19 entries) and `MUST_HAVE_ROWS` (16
entries) differ deliberately — the three omitted from the latter
(`AccApproverInterfaceBrand`, `AccApproverSettingsTab`, `AccSameDayBrandStaff`)
have zero rows in the source, so requiring rows would fail a correct database.

**Placeholder scan:** no TBD/TODO. Every step names a command and its expected
output.
