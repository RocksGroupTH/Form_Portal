/* eslint-disable no-console */
/**
 * Script the live Fast_Form schema into migrations/059_portal_form_baseline.sql.
 *
 * Reads Fast_Form only. Emits CREATE TABLE for every table, then check
 * constraints, then primary/unique keys and indexes, then foreign keys — each
 * guarded by an existence check, so the file is safe to re-apply and table
 * order never matters.
 *
 * Usage: npx tsx scripts/generate-form-baseline.ts
 *
 * tsx does not auto-load .env.local or resolve the "@/" alias, so this
 * script loads env vars itself and imports the pool via a relative path.
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
    // Strip surrounding quotes to match Next.js / dotenv behaviour.
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
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

interface ColRow {
  name: string;
  TypeName: string;
  max_length: number;
  precision: number;
  scale: number;
  is_nullable: boolean;
  is_identity: boolean;
  seed_value: string | null;
  increment_value: string | null;
  DefaultDef: string | null;
}

interface IdxRow {
  TableName: string;
  IndexName: string;
  is_primary_key: boolean;
  is_unique_constraint: boolean;
  is_unique: boolean;
  type_desc: string;
  ColName: string;
  is_descending_key: boolean;
  is_included_column: boolean;
  key_ordinal: number;
}

interface FkRow {
  Name: string;
  FromTable: string;
  ToTable: string;
  FromCol: string;
  ToCol: string;
  DeleteAction: string;
  UpdateAction: string;
}

async function main() {
  loadDotEnvLocal();
  const { getAppPool } = await import("../src/lib/db/mssql");
  const pool = await getAppPool(SOURCE_DB);

  const tables = (
    await pool.request().query<{ name: string }>(`SELECT name FROM sys.tables ORDER BY name`)
  ).recordset.map((r) => r.name);

  const out: string[] = [];
  out.push(`-- Baseline schema for the Form Portal database.`);
  out.push(`-- Generated from ${SOURCE_DB} by scripts/generate-form-baseline.ts.`);
  out.push(`-- Do not edit by hand: regenerate instead.`);
  out.push(`--`);
  out.push(`-- Apply with:`);
  out.push(`--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/059_portal_form_baseline.sql`);
  out.push(`--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/059_portal_form_baseline.sql`);
  out.push("");

  /* ── Tables ── */
  for (const t of tables) {
    const cols = (
      await pool.request().input("t", t).query<ColRow>(`
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
    await pool.request().query<IdxRow>(`
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

  const grouped = new Map<string, IdxRow[]>();
  for (const r of idx) {
    const key = `${r.TableName}.${r.IndexName}`;
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = [];
      grouped.set(key, bucket);
    }
    bucket.push(r);
  }

  Array.from(grouped.values()).forEach((rows) => {
    const head = rows[0];
    const keyCols = rows
      .filter((r) => !r.is_included_column)
      .map((r) => `[${r.ColName}]${r.is_descending_key ? " DESC" : ""}`)
      .join(", ");
    const included = rows.filter((r) => r.is_included_column).map((r) => `[${r.ColName}]`);

    out.push(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${head.IndexName}' AND object_id = OBJECT_ID('dbo.${head.TableName}'))`,
    );
    if (head.is_primary_key || head.is_unique_constraint) {
      const kind = head.is_primary_key ? "PRIMARY KEY" : "UNIQUE";
      const clustered = head.type_desc === "CLUSTERED" ? "CLUSTERED" : "NONCLUSTERED";
      out.push(
        `ALTER TABLE [dbo].[${head.TableName}] ADD CONSTRAINT [${head.IndexName}] ${kind} ${clustered} (${keyCols});`,
      );
    } else {
      const unique = head.is_unique ? "UNIQUE " : "";
      const clustered = head.type_desc === "CLUSTERED" ? "CLUSTERED " : "";
      const inc = included.length ? ` INCLUDE (${included.join(", ")})` : "";
      out.push(
        `CREATE ${unique}${clustered}INDEX [${head.IndexName}] ON [dbo].[${head.TableName}] (${keyCols})${inc};`,
      );
    }
    out.push(`GO`);
    out.push("");
  });

  /* ── Foreign keys ── */
  const fks = (
    await pool.request().query<FkRow>(`
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

  const fkGroups = new Map<string, FkRow[]>();
  for (const r of fks) {
    let bucket = fkGroups.get(r.Name);
    if (!bucket) {
      bucket = [];
      fkGroups.set(r.Name, bucket);
    }
    bucket.push(r);
  }

  Array.from(fkGroups.values()).forEach((rows) => {
    const head = rows[0];
    const from = rows.map((r) => `[${r.FromCol}]`).join(", ");
    const to = rows.map((r) => `[${r.ToCol}]`).join(", ");
    const del =
      head.DeleteAction === "NO_ACTION" ? "" : ` ON DELETE ${head.DeleteAction.replace("_", " ")}`;
    const upd =
      head.UpdateAction === "NO_ACTION" ? "" : ` ON UPDATE ${head.UpdateAction.replace("_", " ")}`;
    out.push(`IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = '${head.Name}')`);
    out.push(
      `ALTER TABLE [dbo].[${head.FromTable}] ADD CONSTRAINT [${head.Name}] FOREIGN KEY (${from}) REFERENCES [dbo].[${head.ToTable}] (${to})${del}${upd};`,
    );
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
