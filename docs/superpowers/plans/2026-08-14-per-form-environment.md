# Per-form Production/UAT Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a System Admin mark an individual form as UAT so that form reads and writes `Rocks_Portal_Form_UAT` while every other form keeps running against production, on the same server, with no mode for users to switch.

**Architecture:** A new middleware copies the request path into a header. `getFormPool()` classifies that path to a form code, looks the form's environment up in `Fast_Core`, and returns the matching pool — so none of its 134 call sites change. Shared configuration is written to both databases in one transaction; the five endpoints that already span both forms query both pools and merge.

**Tech Stack:** Next.js 16 App Router, TypeScript, `mssql`, SQL Server. Tests use Node's built-in `node:test` run through `tsx` — the repo has no test runner today and the classification table is the one thing in this feature that must not be wrong.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-14-per-form-environment-design.md`.
- A form with no `FormEnvironment` row is `Production`. Nothing changes until something is configured.
- Outside a request context (`scripts/`, `apply-sql`, cron) the environment is always `Production`.
- Never fall back to Production when the UAT database is unreachable — fail the request instead.
- `getCorePool()`, `getDataPool()` and `getHrPool()` never vary by environment.
- The settings page is **System Admin only** — stricter than the rest of the Settings hub.
- Parameterized queries only (`request().input(...)`).
- ES5 target: `Array.from()`, never `[...set]`.
- Date display uses local getters, never `toISOString()`.
- CSS uses `var(--token)`, never raw hex. Icons from `lucide-react`. Toasts via `sonner`.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/form-environment/classify-path.ts` (create) | Pure path → form code. No I/O, exhaustively tested |
| `src/lib/form-environment/classify-path.test.ts` (create) | The route table as assertions |
| `src/lib/form-environment/index.ts` (create) | `resolveFormEnvironment()` — header → classify → `Fast_Core` lookup, memoized |
| `src/lib/form-environment/service.ts` (create) | `FormEnvironment` table reads and writes, on `getCorePool()` |
| `src/proxy.ts` (modify) | Injects `x-pathname`. Nothing else — it runs on Edge |
| `src/lib/db/mssql.ts` (modify) | `getFormPool()` picks the pool from the resolved environment |
| `src/lib/acc/dual-write.ts` (create) | `writeBothPools()` — one transaction per database, commit only if both succeed |
| `src/lib/acc/query-both.ts` (create) | `queryBothPools()` — same statement on both, rows tagged with their environment |
| `migrations/060_core_form_environment.sql` (create) | `Fast_Core.dbo.FormEnvironment` |
| `migrations/061_uat_identity_reseed.sql` (create) | Reseeds the 23 transactional tables in UAT to 900000 |
| `src/app/(dashboard)/settings/form-environment/page.tsx` (create) | System-Admin-only toggle page |
| `src/app/api/settings/form-environment/route.ts` (create) | GET list, POST toggle |
| `src/app/api/settings/form-environment/coverage/route.ts` (create) | Route coverage check |

Eight service files write to the 19 shared master tables and each needs dual-write (Task 6). `AccFormMaster` has no write path in the codebase and `AccApproverSettingsTab` has no code reference at all — neither needs one.

---

### Task 1: Path classification

The one piece that must not be wrong. Pure function, no I/O, tested against the
full route table before anything depends on it.

**Files:**
- Create: `src/lib/form-environment/classify-path.ts`
- Create: `src/lib/form-environment/classify-path.test.ts`
- Modify: `package.json` (add a `test` script)

**Interfaces:**
- Consumes: nothing
- Produces: `classifyPath(path: string | null): FormCode | "BOTH" | null` where `type FormCode = "AP-1" | "AP-15" | "AP-17"`. `"BOTH"` marks the aggregate endpoints; `null` means "not form-specific, use Production". Also exports `ROUTE_RULES` so the coverage check in Task 8 can reuse the same table.

- [ ] **Step 1: Write the failing test**

Create `src/lib/form-environment/classify-path.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPath } from "./classify-path";

test("AP-17 admin pages under the accounting prefix win over AP-1", () => {
  assert.equal(classifyPath("/request/accounting/travel-booking"), "AP-17");
  assert.equal(classifyPath("/request/accounting/travel-booking/queue"), "AP-17");
  assert.equal(classifyPath("/request/accounting/travel-booking-report"), "AP-17");
  assert.equal(classifyPath("/request/accounting/travel-booking-settings"), "AP-17");
});

test("AP-17 own routes", () => {
  assert.equal(classifyPath("/api/request/travel-booking/requests/5"), "AP-17");
  assert.equal(classifyPath("/request/travel-booking/5"), "AP-17");
});

test("AP-1 routes", () => {
  assert.equal(classifyPath("/api/request/accounting/requests/5"), "AP-1");
  assert.equal(classifyPath("/request/travel-expense"), "AP-1");
  assert.equal(classifyPath("/request/travel-expense/5"), "AP-1");
});

test("aggregate endpoints span both databases", () => {
  assert.equal(classifyPath("/api/request/accounting/requests/mine"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/work"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/report"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/report/export"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/erp-prep"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/send"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/requesters"), "BOTH");
});

test("settings are production-read", () => {
  assert.equal(classifyPath("/api/request/accounting/settings/vehicles"), null);
});

test("Form Builder and everything else is production", () => {
  assert.equal(classifyPath("/api/forms/submissions"), null);
  assert.equal(classifyPath("/settings/users"), null);
  assert.equal(classifyPath("/"), null);
  assert.equal(classifyPath(null), null);
});

test("more specific rules beat less specific ones regardless of table order", () => {
  // requests/mine is BOTH even though /api/request/accounting/ maps to AP-1
  assert.equal(classifyPath("/api/request/accounting/requests/mine"), "BOTH");
  // but requests/123 is AP-1
  assert.equal(classifyPath("/api/request/accounting/requests/123"), "AP-1");
});
```

Add to `package.json` scripts:

```json
    "test": "tsx --test \"src/**/*.test.ts\"",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './classify-path'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/form-environment/classify-path.ts`:

```ts
export type FormCode = "AP-1" | "AP-15" | "AP-17";
/** "BOTH" = an aggregate endpoint that must read every database and merge. */
export type PathClass = FormCode | "BOTH" | null;

export interface RouteRule {
  prefix: string;
  result: PathClass;
}

/**
 * Longest prefix wins, so the order below is documentation rather than
 * behaviour — but it is kept in specificity order to stay readable.
 *
 * The AP-17 entries under /request/accounting/ are load-bearing: AP-17's admin
 * pages live underneath AP-1's prefix, and without them four pages route to the
 * wrong database.
 */
export const ROUTE_RULES: RouteRule[] = [
  // AP-17 admin pages that sit under AP-1's prefix
  { prefix: "/request/accounting/travel-booking", result: "AP-17" },

  // Aggregate endpoints — more specific than the AP-1 catch-all below
  { prefix: "/api/request/accounting/requests/mine", result: "BOTH" },
  { prefix: "/api/request/accounting/work", result: "BOTH" },
  { prefix: "/api/request/accounting/report", result: "BOTH" },
  { prefix: "/api/request/accounting/erp-prep", result: "BOTH" },
  { prefix: "/api/request/accounting/requesters", result: "BOTH" },

  // Settings: read production, dual-write handled in the service layer
  { prefix: "/api/request/accounting/settings", result: null },

  // AP-17 proper
  { prefix: "/api/request/travel-booking", result: "AP-17" },
  { prefix: "/request/travel-booking", result: "AP-17" },

  // AP-1 proper
  { prefix: "/api/request/accounting", result: "AP-1" },
  { prefix: "/request/travel-expense", result: "AP-1" },
];

/** Classify a request path. Returns null when the path is not form-specific. */
export function classifyPath(path: string | null | undefined): PathClass {
  if (!path) return null;
  const p = path.split("?")[0].replace(/\/+$/, "") || "/";

  let best: RouteRule | null = null;
  for (const rule of ROUTE_RULES) {
    if (p === rule.prefix || p.startsWith(rule.prefix + "/") || p.startsWith(rule.prefix + "-")) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  return best ? best.result : null;
}
```

The `+ "-"` case is what makes `/request/accounting/travel-booking-report`
match `/request/accounting/travel-booking`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 7 tests pass.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/form-environment/classify-path.ts src/lib/form-environment/classify-path.test.ts package.json
git commit -m "feat(env): pure path classification for per-form routing"
```

---

### Task 2: `FormEnvironment` table and service

**Files:**
- Create: `migrations/060_core_form_environment.sql`
- Create: `src/lib/form-environment/service.ts`

**Interfaces:**
- Consumes: `getCorePool` from `src/lib/db/mssql.ts`
- Produces: `getFormEnvironmentMap(): Promise<Record<string, "Production" | "UAT">>`, `setFormEnvironment(formCode: string, environment: "Production" | "UAT", userId: number): Promise<void>`, `listFormEnvironments(): Promise<FormEnvironmentRow[]>` where `FormEnvironmentRow = { formCode: string; formNameEn: string; formNameTh: string; environment: "Production" | "UAT"; updatedBy: number | null; updatedAt: Date | null }`

- [ ] **Step 1: Write the migration**

Create `migrations/060_core_form_environment.sql`:

```sql
-- Per-form Production/UAT flag. Lives in Fast_Core because it must be readable
-- before the form database is chosen.
IF OBJECT_ID('dbo.FormEnvironment', 'U') IS NULL
CREATE TABLE [dbo].[FormEnvironment] (
  [FormCode]    NVARCHAR(20)  NOT NULL CONSTRAINT [PK_FormEnvironment] PRIMARY KEY,
  [Environment] NVARCHAR(20)  NOT NULL CONSTRAINT [CK_FormEnvironment_Env]
                  CHECK ([Environment] IN ('Production','UAT')),
  [UpdatedBy]   INT           NULL,
  [UpdatedAt]   DATETIME2(7)  NOT NULL CONSTRAINT [DF_FormEnvironment_UpdatedAt]
                  DEFAULT (SYSDATETIME())
);
GO
```

- [ ] **Step 2: Apply it**

Run: `npm run apply-sql -- --db Fast_Core --file migrations/060_core_form_environment.sql`
Expected: `applied 060_core_form_environment.sql to Fast_Core OK`.

- [ ] **Step 3: Write the service**

Create `src/lib/form-environment/service.ts`:

```ts
import { getCorePool, sql } from "@/lib/db/mssql";
import { env } from "@/env";

export type FormEnvironmentValue = "Production" | "UAT";

export interface FormEnvironmentRow {
  formCode: string;
  formNameEn: string;
  formNameTh: string;
  environment: FormEnvironmentValue;
  updatedBy: number | null;
  updatedAt: Date | null;
}

/** Every configured flag, keyed by form code. Forms with no row are absent. */
export async function getFormEnvironmentMap(): Promise<Record<string, FormEnvironmentValue>> {
  const pool = await getCorePool();
  const r = await pool.request().query<{ FormCode: string; Environment: string }>(
    `SELECT FormCode, Environment FROM [dbo].[FormEnvironment]`,
  );
  const out: Record<string, FormEnvironmentValue> = {};
  for (const row of r.recordset) {
    out[row.FormCode] = row.Environment === "UAT" ? "UAT" : "Production";
  }
  return out;
}

export async function setFormEnvironment(
  formCode: string,
  environment: FormEnvironmentValue,
  userId: number,
): Promise<void> {
  if (environment !== "Production" && environment !== "UAT") {
    throw new Error("Invalid environment");
  }
  const pool = await getCorePool();
  await pool
    .request()
    .input("code", sql.NVarChar, formCode)
    .input("env", sql.NVarChar, environment)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[FormEnvironment]
      SET Environment = @env, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE FormCode = @code;
      IF @@ROWCOUNT = 0
        INSERT INTO [dbo].[FormEnvironment] (FormCode, Environment, UpdatedBy)
        VALUES (@code, @env, @by);
    `);
}

/**
 * Every form in the catalogue with its flag. AccFormMaster lives in the form
 * database, so this reads the production copy explicitly — the catalogue is the
 * same in both and the settings page must not vary with routing.
 */
export async function listFormEnvironments(): Promise<FormEnvironmentRow[]> {
  const core = await getCorePool();
  const { getAppPool } = await import("@/lib/db/mssql");
  const form = await getAppPool(env.MSSQL_FORM_DATABASE);

  const forms = await form.request().query<{
    FormCode: string; FormNameEn: string; FormNameTh: string;
  }>(`SELECT FormCode, FormNameEn, FormNameTh FROM [dbo].[AccFormMaster] ORDER BY SortOrder`);

  const flags = await core.request().query<{
    FormCode: string; Environment: string; UpdatedBy: number | null; UpdatedAt: Date;
  }>(`SELECT FormCode, Environment, UpdatedBy, UpdatedAt FROM [dbo].[FormEnvironment]`);

  const byCode = new Map(flags.recordset.map((f) => [f.FormCode, f]));

  return forms.recordset.map((f) => {
    const flag = byCode.get(f.FormCode);
    return {
      formCode: f.FormCode,
      formNameEn: f.FormNameEn,
      formNameTh: f.FormNameTh,
      environment: (flag?.Environment === "UAT" ? "UAT" : "Production") as FormEnvironmentValue,
      updatedBy: flag?.UpdatedBy ?? null,
      updatedAt: flag?.UpdatedAt ?? null,
    };
  });
}
```

- [ ] **Step 4: Verify the table answers**

Run:

```bash
npx tsx -e "import('./src/lib/form-environment/service').then(async m => { console.log(await m.getFormEnvironmentMap()); process.exit(0) })"
```

Expected: `{}` — the table exists and is empty, so every form is Production.

- [ ] **Step 5: Commit**

```bash
git add migrations/060_core_form_environment.sql src/lib/form-environment/service.ts
git commit -m "feat(env): FormEnvironment table and service in Fast_Core"
```

---

### Task 3: Environment resolution, middleware, and the pool switch

The change that makes routing live. After this task a form flagged UAT actually
reads the UAT database.

**Files:**
- Modify: `src/proxy.ts` — **not** a new `src/middleware.ts`. Next.js 16 deprecates the `middleware` convention in favour of `proxy`, this repo already has `src/proxy.ts` doing auth and security headers, and having both files is a hard startup error: `Both middleware file "./src\middleware.ts" and proxy file "./src\proxy.ts" are detected`
- Create: `src/lib/form-environment/index.ts`
- Modify: `src/lib/db/mssql.ts:68-70`
- Modify: `src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `classifyPath` (Task 1), `getFormEnvironmentMap` (Task 2)
- Produces: `resolveFormEnvironment(): Promise<"Production" | "UAT">` and `resolveFormClass(): Promise<PathClass>`. Task 6 uses `resolveFormClass()` to detect `"BOTH"`; Tasks 5 and 7 use `resolveFormEnvironment()`.

- [ ] **Step 1: Add the environment variable**

In `src/env.ts`, beside `MSSQL_FORM_DATABASE`:

```ts
    MSSQL_FORM_UAT_DATABASE: z.string().default("Rocks_Portal_Form_UAT"),
```

and in the `runtimeEnv` block:

```ts
    MSSQL_FORM_UAT_DATABASE: process.env.MSSQL_FORM_UAT_DATABASE,
```

In `.env.example`, after `MSSQL_FORM_DATABASE`:

```env
# UAT twin of the form database. A form flagged UAT in Settings → Form
# Environment reads and writes here; every other form uses the line above.
MSSQL_FORM_UAT_DATABASE=Rocks_Portal_Form_UAT
```

- [ ] **Step 2: Inject the pathname from the existing proxy**

In `src/proxy.ts`, replace the final `NextResponse.next()`:

```ts
  // Forward the pathname to Node-side code. Per-form routing picks the database
  // from the URL and getFormPool() has no argument to receive it, so the path
  // has to arrive as a header — Next exposes request headers to server code but
  // not the pathname. Set from nextUrl, never trusted from the client: .set()
  // overwrites any x-pathname the caller supplied.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response, isApiRoute);
  return response;
```

Leave the existing `config.matcher` alone. It already excludes `api/auth` and
static assets, and NextAuth's routes use `getCorePool()`, never `getFormPool()`,
so nothing outside the matcher can be affected by a client-supplied header.

- [ ] **Step 3: Write the resolver**

Create `src/lib/form-environment/index.ts`:

```ts
import { cache } from "react";
import { headers } from "next/headers";
import { classifyPath, type PathClass } from "./classify-path";
import { getFormEnvironmentMap, type FormEnvironmentValue } from "./service";

export type { FormEnvironmentValue } from "./service";
export { classifyPath, ROUTE_RULES } from "./classify-path";
export type { PathClass, FormCode } from "./classify-path";

/** The current request's path, or null outside a request context. */
async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get("x-pathname");
  } catch {
    // No request scope: scripts, apply-sql, background work.
    return null;
  }
}

/** What the current path maps to. Memoized for the life of one request. */
export const resolveFormClass = cache(async (): Promise<PathClass> => {
  return classifyPath(await currentPath());
});

/**
 * Which database the current request should use.
 *
 * Production unless a form-specific route resolves to a form flagged UAT.
 * Aggregate ("BOTH") routes resolve to Production here; they reach the UAT
 * database through queryBothPools instead.
 */
export const resolveFormEnvironment = cache(async (): Promise<FormEnvironmentValue> => {
  const cls = await resolveFormClass();
  if (cls === null || cls === "BOTH") return "Production";
  const map = await getFormEnvironmentMap();
  return map[cls] ?? "Production";
});
```

- [ ] **Step 4: Switch the pool**

In `src/lib/db/mssql.ts`, replace `getFormPool`:

```ts
/** Form DB — form definitions, submissions, approvals, and all Acc* tables. */
export async function getFormPool(): Promise<sql.ConnectionPool> {
  const { resolveFormEnvironment } = await import("@/lib/form-environment");
  const e = await resolveFormEnvironment();
  return getNamedPool(
    e === "UAT" ? env.MSSQL_FORM_UAT_DATABASE : env.MSSQL_FORM_DATABASE,
  );
}

/** The production form database, regardless of how the current route routes. */
export function getProductionFormPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_FORM_DATABASE);
}

/** The UAT form database, regardless of how the current route routes. */
export function getUatFormPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_FORM_UAT_DATABASE);
}
```

The dynamic `import()` breaks what would otherwise be a module cycle:
`form-environment` imports `service`, which imports `mssql`.

- [ ] **Step 5: Verify nothing regressed while every form is still Production**

Run `npm run dev`, then:

```bash
curl -s http://localhost:3020/api/health
npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form --env prod
```

Expected: health `ok`, verify `PASS`. Sign in and open `/request/accounting` —
AP-1 and AP-17 both load, because `FormEnvironment` is empty so everything
resolves to Production. Stop the dev server.

- [ ] **Step 6: Verify UAT routing actually switches**

Run:

```bash
npx tsx -e "import('./src/lib/form-environment/service').then(async m => { await m.setFormEnvironment('AP-17','UAT',1); console.log(await m.getFormEnvironmentMap()); process.exit(0) })"
```

Expected: `{ 'AP-17': 'UAT' }`. Restart `npm run dev`, sign in, open
`/request/travel-booking` and submit a draft. Then:

```bash
npx tsx -e "import('./src/lib/db/mssql').then(async m => { const p = await m.getAppPool('Rocks_Portal_Form_UAT'); console.log((await p.request().query('SELECT COUNT(*) N FROM AccRequest')).recordset); process.exit(0) })"
```

Expected: a non-zero count in the UAT database, and AP-1 at
`/request/travel-expense` still writing to production. Reset with
`setFormEnvironment('AP-17','Production',1)` before committing.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/middleware.ts src/lib/form-environment/index.ts src/lib/db/mssql.ts src/env.ts .env.example
git commit -m "feat(env): route each form to its own database"
```

---

### Task 4: Identity reseed in the UAT database

So ids can never collide in a merged list, and an id in a URL identifies its
database on sight.

**Files:**
- Create: `migrations/061_uat_identity_reseed.sql`

**Interfaces:**
- Consumes: nothing
- Produces: UAT transactional ids starting at 900001. Task 6's merge relies on it.

- [ ] **Step 1: Write the migration**

Create `migrations/061_uat_identity_reseed.sql`. Only the 23 transactional
tables — the 19 master tables keep production's ids so dual-write can insert
them verbatim.

```sql
-- Reseed UAT transactional identities to 900000 so ids never collide with
-- production. Apply ONLY to Rocks_Portal_Form_UAT.
--
-- The 19 master/config tables are deliberately absent: Task 6 keeps their ids
-- aligned with production by inserting production's id explicitly.
DECLARE @t NVARCHAR(128);
DECLARE c CURSOR FOR
  SELECT name FROM (VALUES
    ('AccRequest'), ('AccApproval'), ('AccActivityLog'), ('AccRequestFile'),
    ('AccPerDiem'), ('AccPerDiemDay'), ('AccTravelExpense'), ('AccTravelExpenseItem'),
    ('AccTravelVehicleSection'), ('AccTravelBooking'), ('AccTravelBookingDetail'),
    ('AccTravelDepartureLocation'), ('AccTravelWorkLocation'), ('AccEmailQueue'),
    ('OfficeForms'), ('OfficeFormVersions'), ('OfficeFormSubmissions'),
    ('OfficeFormApprovals'), ('OfficeFormWorkflows'), ('OfficeFormWorkflowSteps'),
    ('OfficeFormFiles'), ('OfficeFormEmailQueue'), ('OfficeFormActivityLog')
  ) AS t(name);
OPEN c;
FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = OBJECT_ID('dbo.' + @t))
     AND (SELECT COUNT(*) FROM sys.tables WHERE name = @t) = 1
  BEGIN
    DECLARE @sql NVARCHAR(400) = N'DBCC CHECKIDENT (''dbo.' + @t + ''', RESEED, 900000)';
    EXEC sp_executesql @sql;
  END
  FETCH NEXT FROM c INTO @t;
END
CLOSE c;
DEALLOCATE c;
GO
```

- [ ] **Step 2: Apply it to UAT only**

Run:

```bash
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/061_uat_identity_reseed.sql
```

Expected: `applied 061_uat_identity_reseed.sql to Rocks_Portal_Form_UAT OK`.

**Do not run this against `Rocks_Portal_Form`.** Doing so would push production
ids to 900001 and destroy the property this migration exists to create. The
migration enforces this rather than relying on the warning: it opens with
`IF DB_NAME() NOT LIKE '%[_]UAT'` and raises an error instead of running.
Verified by applying it to `Rocks_Portal_Form` first and confirming it refused.

- [ ] **Step 3: Verify the seed took**

Run:

```bash
npx tsx -e "import('./src/lib/db/mssql').then(async m => { const p = await m.getAppPool('Rocks_Portal_Form_UAT'); const r = await p.request().query(\"SELECT IDENT_CURRENT('dbo.AccRequest') AS Cur, IDENT_SEED('dbo.AccRequest') AS Seed\"); console.log(r.recordset); process.exit(0) })"
```

Expected: `Cur` is `900000`. The next inserted row will be `900001`.

- [ ] **Step 4: Commit**

```bash
git add migrations/061_uat_identity_reseed.sql
git commit -m "feat(env): reseed UAT transactional identities to 900000"
```

---

### Task 5: Dual-write for shared configuration

Without this the two copies of the 19 shared config tables diverge the first
time an admin saves anything.

**Files:**
- Create: `src/lib/acc/dual-write.ts`
- Modify: `src/lib/acc/settings-service.ts` (`upsertVehicle`, `reorderVehicles`, `upsertApprover`, `setFormBrands`, `setSetting`, `upsertSameDayBrandStaff`, `removeSameDayBrandStaff`)
- Modify: `src/lib/acc/brand-account-service.ts`
- Modify: `src/lib/acc/brand-branch-service.ts`
- Modify: `src/lib/acc/brand-journal-batch-service.ts`
- Modify: `src/lib/acc/brand-erp-interface-map-service.ts`
- Modify: `src/lib/acc/erp-target-setting-service.ts`
- Modify: `src/lib/acc/approver-interface-access.ts`
- Modify: `src/lib/acc/travel-booking/settings-service.ts`

**Interfaces:**
- Consumes: `getProductionFormPool`, `getUatFormPool` (Task 3)
- Produces: `writeBothPools<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>` — runs `fn` inside a transaction on each database, commits both or neither, and returns the production result. Also `scripts/checks/verify-master-alignment.ts`, wired as `npm run check:alignment`.

**Correction made during implementation.** The steps below were written around
capturing production's id and replaying it into UAT under `IDENTITY_INSERT`. On
reading the code, almost every mutation turned out to be a `MERGE` on a natural
key — Email, SettingKey, FormCode+BrandCode, StaffId — so splitting each one
into matched/inserted branches to thread an id would have been both invasive and
easy to get subtly wrong.

The implementation runs the identical statement against both databases instead.
The natural keys make the resulting row the same in each, and because both
databases were seeded with identity values preserved and now receive exactly the
same inserts, their identity counters stay in lockstep and assign the same id.

That is an invariant rather than a guarantee — a manual SQL edit against one
database alone would break it silently — so `npm run check:alignment` asserts it
and is the thing to run when a setting looks different between forms.

`upsertVehicle` in `travel-booking/settings-service.ts` is the one exception and
does thread the id explicitly, because its child `AccTravelVehiclePlace` rows
reference it and guessing there would corrupt the relationship rather than just
a display order.

- [ ] **Step 1: Write the helper**

Create `src/lib/acc/dual-write.ts`:

```ts
import type { ConnectionPool, Transaction } from "mssql";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";

/**
 * Run the same mutation against the production and UAT form databases.
 *
 * The 19 shared configuration tables exist in both, and per-form routing means
 * AP-1 may read one copy while AP-17 reads the other. A setting saved to only
 * one database is a bug that shows up later as an approver who exists for one
 * form and not the other, so both commit or neither does.
 *
 * `fn` receives a request-capable transaction and a flag saying which database
 * it is running against — callers that need SET IDENTITY_INSERT on the UAT side
 * use it.
 */
export async function writeBothPools<T>(
  fn: (tx: Transaction, isUat: boolean) => Promise<T>,
): Promise<T> {
  const [prod, uat] = await Promise.all([getProductionFormPool(), getUatFormPool()]);

  const prodTx = prod.transaction();
  const uatTx = uat.transaction();
  await prodTx.begin();
  try {
    await uatTx.begin();
  } catch (e) {
    await prodTx.rollback();
    throw e;
  }

  try {
    const result = await fn(prodTx, false);
    await fn(uatTx, true);
    await prodTx.commit();
    try {
      await uatTx.commit();
    } catch (e) {
      // Production is already committed; surface loudly rather than pretend.
      console.error("[dual-write] UAT commit failed after production committed", e);
      throw e;
    }
    return result;
  } catch (e) {
    await prodTx.rollback().catch(() => {});
    await uatTx.rollback().catch(() => {});
    throw e;
  }
}

/** True when the current process can reach both databases. */
export async function dualWriteAvailable(): Promise<boolean> {
  try {
    await Promise.all([getProductionFormPool(), getUatFormPool()]);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Convert `upsertVehicle` as the reference case**

Read `src/lib/acc/settings-service.ts:23-48` first. Replace its
`const pool = await getAccPool()` / `pool.request()` shape with:

```ts
export async function upsertVehicle(
  input: UpsertVehicleInput,
  userId: number,
): Promise<void> {
  // ...existing validation, unchanged...

  await writeBothPools(async (tx, isUat) => {
    const req = tx.request();
    // ...same .input(...) calls as before...
    if (isUat && input.id == null) {
      // A new row must land on the same id in both databases so AP-1 and AP-17
      // resolve the same vehicle. Production assigned it above.
      await req.query(`SET IDENTITY_INSERT [dbo].[AccVehicle] ON`);
    }
    await req.query(/* ...same SQL as before... */);
    if (isUat && input.id == null) {
      await tx.request().query(`SET IDENTITY_INSERT [dbo].[AccVehicle] OFF`);
    }
  });
}
```

For inserts the production id must be captured with `OUTPUT INSERTED.Id` on the
production pass and fed to the UAT pass. Keep the id in a variable in the
closure:

```ts
  let newId: number | null = input.id ?? null;
  await writeBothPools(async (tx, isUat) => {
    if (!isUat) {
      const r = await tx.request()./* inputs */.query(
        `INSERT INTO [dbo].[AccVehicle] (...) OUTPUT INSERTED.Id VALUES (...)`,
      );
      newId = r.recordset[0].Id as number;
      return;
    }
    const req = tx.request().input("id", sql.Int, newId);
    await req.query(`SET IDENTITY_INSERT [dbo].[AccVehicle] ON`);
    await req.query(`INSERT INTO [dbo].[AccVehicle] (Id, ...) VALUES (@id, ...)`);
    await req.query(`SET IDENTITY_INSERT [dbo].[AccVehicle] OFF`);
  });
```

- [ ] **Step 3: Verify the reference case writes both**

Run `npm run dev`, sign in as an admin, add a vehicle at
Settings → Accounting → Vehicles. Then:

```bash
npx tsx -e "import('./src/lib/db/mssql').then(async m => { for (const db of ['Rocks_Portal_Form','Rocks_Portal_Form_UAT']) { const p = await m.getAppPool(db); const r = await p.request().query('SELECT Id, Name FROM AccVehicle ORDER BY Id'); console.log(db, r.recordset); } process.exit(0) })"
```

Expected: identical id and name lists from both databases.

- [ ] **Step 4: Convert the remaining six functions in `settings-service.ts`**

`reorderVehicles`, `upsertApprover`, `setFormBrands`, `setSetting`,
`upsertSameDayBrandStaff`, `removeSameDayBrandStaff` — same transformation.
`setSetting` is the exception: `ERP_INTERFACE_ENV` must **not** be dual-written,
because it is `Production` in one database and `Sandbox` in the other by design.
Guard it:

```ts
export async function setSetting(key: string, value: string | null, userId: number) {
  if (key === "ERP_INTERFACE_ENV") {
    // Environment-specific by design — see the 2026-08-13 split spec.
    const pool = await getAccPool();
    await pool.request()/* ... */;
    return;
  }
  await writeBothPools(/* ... */);
}
```

- [ ] **Step 5: Convert the remaining seven service files**

`brand-account-service.ts`, `brand-branch-service.ts`,
`brand-journal-batch-service.ts`, `brand-erp-interface-map-service.ts`,
`erp-target-setting-service.ts`, `approver-interface-access.ts`,
`travel-booking/settings-service.ts` — each wraps its INSERT/UPDATE/DELETE in
`writeBothPools` exactly as Step 2, capturing the production id for inserts.

- [ ] **Step 6: Verify every master table matches across both databases**

Run:

```bash
npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form --env prod
npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form_UAT --env uat
```

Expected: both `PASS`. Then exercise one save on each settings page and re-run —
still both `PASS`, and the row counts moved together.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/dual-write.ts src/lib/acc/settings-service.ts src/lib/acc/brand-account-service.ts src/lib/acc/brand-branch-service.ts src/lib/acc/brand-journal-batch-service.ts src/lib/acc/brand-erp-interface-map-service.ts src/lib/acc/erp-target-setting-service.ts src/lib/acc/approver-interface-access.ts src/lib/acc/travel-booking/settings-service.ts
git commit -m "feat(env): dual-write shared configuration to both databases"
```

---

### Task 6: Merged reads for the aggregate endpoints

**Files:**
- Create: `src/lib/acc/query-both.ts`
- Modify: `src/lib/acc/report-service.ts` (`listMyRequestRows`, `listMyWorkRows`, `queryReport`)

**Interfaces:**
- Consumes: `getProductionFormPool`, `getUatFormPool` (Task 3)
- Produces: `queryBothPools<T>(fn: (pool: ConnectionPool) => Promise<T[]>): Promise<(T & { environment: "Production" | "UAT" })[]>`. `ReportRow` gains an `environment` field, which Task 8 renders as a pill.

- [ ] **Step 1: Write the helper**

Create `src/lib/acc/query-both.ts`:

```ts
import type { ConnectionPool } from "mssql";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";
import type { FormEnvironmentValue } from "@/lib/form-environment";

export type WithEnvironment<T> = T & { environment: FormEnvironmentValue };

/**
 * Run the same read against both form databases and concatenate the results,
 * tagging each row with where it came from.
 *
 * Neither database can see the other's rows, so any sorting or paging the
 * caller needs must happen after this returns. Ids cannot collide: UAT
 * transactional identities are seeded at 900000 (migration 061).
 *
 * Fails if either database is unreachable — returning half a user's requests
 * silently would be worse than an error.
 */
export async function queryBothPools<T>(
  fn: (pool: ConnectionPool) => Promise<T[]>,
): Promise<WithEnvironment<T>[]> {
  const [prod, uat] = await Promise.all([getProductionFormPool(), getUatFormPool()]);
  const [a, b] = await Promise.all([fn(prod), fn(uat)]);
  return [
    ...a.map((r) => ({ ...r, environment: "Production" as const })),
    ...b.map((r) => ({ ...r, environment: "UAT" as const })),
  ];
}
```

- [ ] **Step 2: Convert `listMyRequestRows`**

Read `src/lib/acc/report-service.ts:348-360` first. Change its body from
`const pool = await getAccPool()` to:

```ts
export async function listMyRequestRows(userId: number): Promise<ReportRow[]> {
  const rows = await queryBothPools(async (pool) => {
    const r = await pool.request().input("uid", sql.Int, userId).query(/* same SQL */);
    return r.recordset.map(mapReportRow);
  });
  return rows.sort((a, b) => b.id - a.id);
}
```

Sorting moves out of SQL and into JavaScript because neither database can order
against the other's rows.

- [ ] **Step 3: Convert `listMyWorkRows` and `queryReport`**

Same transformation. `queryReport` takes filters — build the same parameterised
statement inside the callback so both databases receive identical inputs. Its
existing `ORDER BY` moves to a JavaScript sort on the merged array; keep the
same key and direction the SQL used.

- [ ] **Step 4: Add `environment` to the row type**

In `src/features/accounting/types.ts`, add to `ReportRow`:

```ts
  /** Which database this row came from. UAT rows are test data. */
  environment?: "Production" | "UAT";
```

- [ ] **Step 5: Verify a merged list**

Set AP-17 to UAT, submit one AP-17 request and one AP-1 request as the same
user, then open `/my-request`. Expected: both appear; the AP-17 row's id is
above 900000 and the AP-1 row's is not.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/query-both.ts src/lib/acc/report-service.ts src/features/accounting/types.ts
git commit -m "feat(env): merge aggregate reads across both databases"
```

---

### Task 7: Kill UAT email and file side effects

Approval chains resolve against production HR in both environments, so without
this a tester emails a real manager asking them to approve a fake request.

**Files:**
- Modify: `src/lib/acc/email-queue.ts:24-50`
- Modify: `src/lib/acc/sharepoint-path.ts:16-33`
- Modify: `src/app/api/request/accounting/requests/[id]/files/route.ts`
- Modify: `src/app/api/request/travel-booking/requests/[id]/files/route.ts`
- Modify: `src/env.ts`, `.env.example`

**Interfaces:**
- Consumes: `resolveFormEnvironment` (Task 3)
- Produces: no new exports; `buildAccFolderPath` gains an optional `environment` option.

**Finding from Task 1's coverage run:** `/api/request/accounting/email/process`
classifies as AP-1, so it drains only the production `AccEmailQueue`. When AP-17
is flagged UAT its queued mail sits in the UAT database and this endpoint never
sees it. Per-action drains still work because they run inside the request that
queued them, so this only affects the manual/scheduled sweep. Step 6 below makes
that endpoint drain both databases.

- [ ] **Step 1: Add the redirect address**

In `src/env.ts`:

```ts
    UAT_MAIL_REDIRECT: z.string().optional(),
```

plus the matching `runtimeEnv` line, and in `.env.example`:

```env
# Every email a UAT-flagged form would send goes here instead. Falls back to
# GRAPH_MAIL_FROM when unset. Without this a tester's fake request emails a
# real manager for approval.
UAT_MAIL_REDIRECT=
```

- [ ] **Step 2: Redirect UAT mail**

In `src/lib/acc/email-queue.ts`, inside `processQueue`, replace the send call:

```ts
  const environment = await resolveFormEnvironment();
  const redirectTo = env.UAT_MAIL_REDIRECT || env.GRAPH_MAIL_FROM;

  // ...for each message m:
  if (environment === "UAT") {
    await sendEmail({
      to: redirectTo,
      subject: `[UAT] ${m.Subject}`,
      bodyHtml:
        `<p style="background:#fff4e5;padding:8px;border-left:4px solid #b5793a">` +
        `UAT test mail. In production this would have gone to <b>${esc(m.ToEmail)}</b>.` +
        `</p>` + m.BodyHtml,
    });
  } else {
    await sendEmail({ to: m.ToEmail, subject: m.Subject, bodyHtml: m.BodyHtml });
  }
```

Import `esc` from `@/features/forms/email-templates` — the recipient address is
interpolated into HTML and must be escaped.

Apply the same change to `src/features/forms/email-queue.ts`.

- [ ] **Step 3: Separate the UAT SharePoint folder**

In `src/lib/acc/sharepoint-path.ts`, add to `buildAccFolderPath`'s options:

```ts
  /** UAT attachments go under a sibling folder so they never mix with real ones. */
  environment?: "Production" | "UAT";
```

and after the `base` line:

```ts
  const parts = [base];
  if (opts.environment === "UAT") parts.push("_UAT");
  parts.push(opts.formCode ?? FORM_CODE);
```

In both file routes, pass `environment: await resolveFormEnvironment()`.

- [ ] **Step 4: Verify**

With AP-17 flagged UAT, submit an AP-17 request that triggers an approval mail
and attach a file. Expected: the mail arrives at `UAT_MAIL_REDIRECT` with a
`[UAT]` subject prefix and the intended recipient named in the body; the
attachment lands under `{SHAREPOINT_ACC_FOLDER}/_UAT/AP-17/...`. Then flag AP-17
back to Production, repeat, and confirm mail goes to the real recipient and the
file lands without `_UAT`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/email-queue.ts src/features/forms/email-queue.ts src/lib/acc/sharepoint-path.ts src/app/api/request/accounting/requests/\[id\]/files/route.ts src/app/api/request/travel-booking/requests/\[id\]/files/route.ts src/env.ts .env.example
git commit -m "feat(env): redirect UAT mail and separate UAT attachments"
```

- [ ] **Step 6: Drain both queues from the sweep endpoint**

`src/app/api/request/accounting/email/process/route.ts` currently calls
`processQueue()` once against whatever pool its route resolves to. Change it to
run the drain against both databases explicitly:

```ts
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";

  const [prod, uat] = await Promise.all([getProductionFormPool(), getUatFormPool()]);
  const results = await Promise.all([
    processQueueOn(prod, "Production", max),
    processQueueOn(uat, "UAT", max),
  ]);
```

This requires `processQueue` in `src/lib/acc/email-queue.ts` to take its pool
and environment as parameters rather than resolving them itself. Keep the
existing zero-argument `processQueue()` as a thin wrapper that resolves both and
calls `processQueueOn`, so the ~12 per-action drain call sites do not change.

Verify: with AP-17 on UAT, queue mail from an AP-17 action, then
`curl -X POST http://localhost:3020/api/request/accounting/email/process`.
Expected: the UAT message is sent (to `UAT_MAIL_REDIRECT`) and
`SELECT COUNT(*) FROM AccEmailQueue WHERE Status='Pending'` returns 0 in both
databases.

```bash
npx tsc --noEmit && npm test
git add src/app/api/request/accounting/email/process/route.ts src/lib/acc/email-queue.ts
git commit -m "fix(env): drain the email queue in both databases"
```

---

### Task 8: Settings page and route coverage check

**Files:**
- Create: `src/app/api/settings/form-environment/route.ts`
- Create: `src/app/api/settings/form-environment/coverage/route.ts`
- Create: `src/app/(dashboard)/settings/form-environment/page.tsx`
- Create: `src/features/settings/FormEnvironmentSettings.tsx`
- Modify: `src/lib/constants.ts` (`REQUEST_CARDS`)

**Interfaces:**
- Consumes: `listFormEnvironments`, `setFormEnvironment` (Task 2), `ROUTE_RULES`, `classifyPath` (Task 1)
- Produces: the page at `/settings/form-environment`

- [ ] **Step 1: Write the API routes**

Create `src/app/api/settings/form-environment/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listFormEnvironments, setFormEnvironment } from "@/lib/form-environment/service";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";

/** GET — every form with its flag and its request count in each database. */
export async function GET() {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  try {
    const forms = await listFormEnvironments();
    const [prod, uat] = await Promise.all([getProductionFormPool(), getUatFormPool()]);
    const count = async (pool: Awaited<ReturnType<typeof getProductionFormPool>>) =>
      (await pool.request().query<{ FormCode: string; N: number }>(
        `SELECT FormCode, COUNT(*) AS N FROM [dbo].[AccRequest] GROUP BY FormCode`,
      )).recordset;
    const [pc, uc] = await Promise.all([count(prod), count(uat)]);
    const byCode = (rows: { FormCode: string; N: number }[], code: string) =>
      rows.find((r) => r.FormCode === code)?.N ?? 0;
    return NextResponse.json({
      ok: true,
      data: forms.map((f) => ({
        ...f,
        productionCount: byCode(pc, f.formCode),
        uatCount: byCode(uc, f.formCode),
      })),
    });
  } catch (err) {
    console.error("[api/settings/form-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST { formCode, environment } — flip one form. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    if (body.environment !== "Production" && body.environment !== "UAT") {
      return NextResponse.json({ ok: false, error: "Invalid environment" }, { status: 400 });
    }
    await setFormEnvironment(String(body.formCode), body.environment, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings/form-environment] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
```

Create `src/app/api/settings/form-environment/coverage/route.ts`:

```ts
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireRole } from "@/lib/api-auth";
import { classifyPath } from "@/lib/form-environment/classify-path";

/**
 * Lists every API route under src/app/api/request/ that classifyPath sends to
 * the Production default. A route added later without a rule shows up here
 * instead of silently reading the wrong database.
 */
export async function GET() {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;

  const root = path.resolve(process.cwd(), "src/app/api/request");
  const found: { route: string; classification: string }[] = [];

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "route.ts") {
        const rel = full
          .slice(path.resolve(process.cwd(), "src/app").length)
          .replace(/\\/g, "/")
          .replace(/\/route\.ts$/, "");
        const cls = classifyPath(rel);
        found.push({ route: rel, classification: cls ?? "UNCLASSIFIED" });
      }
    }
  };
  walk(root);

  return NextResponse.json({
    ok: true,
    data: {
      total: found.length,
      unclassified: found.filter((f) => f.classification === "UNCLASSIFIED"),
      all: found.sort((a, b) => a.route.localeCompare(b.route)),
    },
  });
}
```

- [ ] **Step 2: Write the page**

Create `src/features/settings/FormEnvironmentSettings.tsx` as a `"use client"`
component: a table of forms with `formCode`, both names, request counts in each
database, a Production/UAT segmented toggle, and `updatedAt`/`updatedBy`. Below
it, render the coverage result — a green line when `unclassified` is empty and a
`--status-bad-bg` panel listing the routes when it is not.

Directly beside the toggle, render this warning, because it is the behaviour
most likely to surprise:

> เปลี่ยนเป็น UAT แล้ว request เดิมที่อยู่ใน Production **ไม่ย้ายตาม** — ยังอยู่ที่เดิมและเปิดดูได้ ฟอร์มแค่เริ่มเขียนที่ใหม่ สลับกลับก็เช่นกัน request ที่ทำใน UAT จะค้างอยู่ใน UAT พร้อมป้าย UAT

Create `src/app/(dashboard)/settings/form-environment/page.tsx` rendering it,
guarded so a non-System-Admin is redirected — mirror
`src/app/(dashboard)/settings/users/page.tsx`, which already does exactly this.

- [ ] **Step 3: Add the Settings hub card**

In `src/lib/constants.ts`, add to `REQUEST_CARDS` beside the Users & Roles entry:

```ts
  {
    title: "Form Environment",
    description: "กำหนดว่าฟอร์มไหนทำงานบน Production หรือ UAT",
    href: "/settings/form-environment",
    icon: "FlaskConical",
    systemAdminOnly: true,
  },
```

Follow whatever flag the Users & Roles card uses for System-Admin-only gating;
if none exists, add `systemAdminOnly?: boolean` to the card type and honour it
where the hub filters cards.

- [ ] **Step 4: Verify**

Sign in as a System Admin, open `/settings/form-environment`. Expected: three
forms listed with counts, the toggle persists across a reload, and the coverage
panel reports zero unclassified routes. Sign in as an IT Admin: the card is
absent from the hub and the page redirects.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/app/api/settings/form-environment src/app/\(dashboard\)/settings/form-environment src/features/settings/FormEnvironmentSettings.tsx src/lib/constants.ts
git commit -m "feat(env): System Admin page for per-form environment"
```

---

### Task 9: UAT badge on request rows and detail pages

**Files:**
- Modify: `src/features/accounting/components/MyRequestsPanel.tsx`
- Modify: `src/features/accounting/components/RequestDetail.tsx`
- Modify: `src/features/travel-booking/components/TravelBookingDetail.tsx`

**Interfaces:**
- Consumes: `ReportRow.environment` (Task 6)
- Produces: nothing further

- [ ] **Step 1: Render the pill in list rows**

In `MyRequestsPanel.tsx`, beside each row's running number:

```tsx
{row.environment === "UAT" && (
  <span
    className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold"
    style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
  >
    UAT
  </span>
)}
```

- [ ] **Step 2: Render a banner on detail pages**

In both detail components, when the request's id is at or above 900000, render a
banner above the header reading `ข้อมูลทดสอบ (UAT) — ไม่ใช่คำขอจริง` styled with
`--status-bad-bg` / `--status-bad-text`.

- [ ] **Step 3: Verify**

With AP-17 on UAT, open `/my-request`: AP-17 rows carry the pill, AP-1 rows do
not. Open an AP-17 request: the banner shows. Open an AP-1 request: it does not.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/features/accounting/components/MyRequestsPanel.tsx src/features/accounting/components/RequestDetail.tsx src/features/travel-booking/components/TravelBookingDetail.tsx
git commit -m "feat(env): mark UAT rows in lists and detail pages"
```

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1 Route classification, ordered | Task 1 |
| §2 Resolution: middleware, resolver, pool | Task 3 |
| §2 `MSSQL_FORM_UAT_DATABASE` | Task 3, Step 1 |
| §3 Dual write, `IDENTITY_INSERT`, transactional | Task 5 |
| §4 Five aggregate endpoints merged | Task 6 |
| §5 Identity reseed to 900000, master tables excluded | Task 4 |
| §5 `environment` field and UAT pill | Tasks 6 and 9 |
| §6 Email redirect and `_UAT` SharePoint folder | Task 7 |
| §7 System-Admin-only settings page | Task 8 |
| §7 Route coverage check | Task 8, Step 1 |
| §7 `FormEnvironment` table, absent row means Production | Task 2 |
| §8 UAT forms reach Sandbox Business Central | **Superseded 2026-08-17** — the claim that `AccSetting.ERP_INTERFACE_ENV` delivers this was wrong; nothing read that row. See `2026-08-17-erp-environment-per-form-design.md` |

**Type consistency:** `resolveFormEnvironment()` returns
`FormEnvironmentValue = "Production" | "UAT"` throughout. `classifyPath()`
returns `PathClass = FormCode | "BOTH" | null`; `resolveFormEnvironment` maps
both `null` and `"BOTH"` to `"Production"`. `writeBothPools` takes
`(tx: Transaction, isUat: boolean)`; `queryBothPools` takes
`(pool: ConnectionPool)` — different shapes on purpose, since writes need a
transaction and reads do not.

**Placeholder scan:** Task 5 Steps 4 and 5 name the exact functions and files to
convert and point at Step 2 for the transformation rather than repeating it
eight times. This is the one place the plan says "same as above"; it is
deliberate, because the transformation is mechanical and repeating ~200 lines of
near-identical code would hide the two real exceptions (`setSetting`'s
`ERP_INTERFACE_ENV` guard, and capturing the production id for inserts), both of
which are written out in full.
