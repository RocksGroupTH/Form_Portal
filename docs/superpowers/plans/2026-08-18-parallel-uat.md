# Parallel UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Production and UAT at the same time — ordinary users on the live database, configured testers on the UAT twin — with the whole approval chain of a UAT request staying inside the tester group.

**Architecture:** `FormEnvironment` gains two independent boolean switches in place of its one string column, and a new `UatTester` list says who may test and who approves their test requests. One resolver answers "which database, and may this viewer use this form" from three inputs in strict order: the request id in the path, the viewer's UAT mode, then the form's switches. Everything downstream — pools, manager lookup, availability refusals, ERP target, mail — keys on that resolver's answer and never on the cookie.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MSSQL (`mssql`), NextAuth 5, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-18-parallel-uat-design.md`

## Global Constraints

- Parameterized SQL only. API responses are `{ ok: true, data }` or `{ ok: false, error }`.
- CSS uses `var(--token)`, never raw hex. Icons from `lucide-react`. Toasts via `sonner`.
- In-page copy is Thai; identifiers, comments and commit messages are English.
- ES5 target: `Array.from()`, never spread over a Set or Map.
- Dates display with local getters, never `toISOString()`.
- `npx tsc --noEmit` and `npm test` must both pass before every commit. **Never run `npm run build` or `npm run dev`** — a dev server is running and shares `.next`; ask the controller if a build is needed.
- `npm test` is an explicit file list in `package.json`, not a glob. A new `*.test.ts` that is not added there never runs.
- Migrations are applied by the controller, never by an implementer: `npm run apply-sql -- --db <database> --file <path>`.
- Every request-scoped read added to `src/lib/form-environment/` (`headers()`, `cookies()`) must sit inside the same `try/catch` shape `currentPath()` uses, or scripts and the background email drain start throwing instead of resolving Production.
- `resolveFormEnvironment()` keeps its signature `(): Promise<"Production" | "UAT">` and keeps defaulting to Production. `getFormPool()` depends on both.
- Do not import `@/lib/auth` into `src/lib/form-environment/**`. `getFormPool()` dynamically imports that module and `auth()` reads Fast_Core — the cycle risk is `getFormPool → auth → jwt → getFormPool`.

**Facts discovery established that contradict earlier assumptions — treat these as requirements:**

1. AP-1 and AP-17 do **not** share a manager resolver. AP-1 resolves the requester through `resolveRequesterForActor` (`src/lib/acc/employee-context.ts:155-194`); AP-17 uses `resolveEmployeeForActor` (`src/lib/hr/employee-lookup.ts:346-359`, manager set at `:95`). They share only `resolveManagerEmail`, a StaffId→email mapper. Overriding *that* is actively harmful: `AccApproval` would get the production manager's `AssignedTo` and the UAT manager's `AssignedEmail`.
2. `migrations/060_core_form_environment.sql:15-16` created `Environment` with a **named check constraint**. It must be dropped by name before the column, in its own batch.
3. The navbar is never server-rendered — `SessionProvider` is mounted without a `session` prop, so the whole dashboard chrome paints client-side. There is no "read the cookie in the layout to avoid a flash" option for the navbar control.
4. `getFormEnvironmentMap()` has three callers outside the settings screen (the resolver, and `report-service.ts:415` and `:469`).
5. The client-side `FormEnvironmentRow` in `FormEnvironmentSettings.tsx:14-26` is a hand-written interface that only shares a name with the server type. `tsc` will not catch payload drift here.
6. The chip at `MyRequestsPanel.tsx:474-481` is already correct — it reports the row's database of origin. Leave it alone.
7. AP-17's approve/reject/return routes gate on `staffId === AccRequest.ManagerStaffId` only, never on email. A UAT manager must therefore be a real, active HR `StaffId`.

---

### Task 1: Add the switch columns without removing anything

Expand now, contract in Task 10 — the app keeps running on `Environment` until the code has moved.

**Files:**
- Create: `migrations/062_core_form_environment_switches.sql`
- Create: `migrations/063_core_uat_tester.sql`

**Interfaces:**
- Produces: `FormEnvironment.ProductionEnabled`, `FormEnvironment.UatEnabled`, and the `UatTester` table.

- [ ] **Step 1: Write 062**

```sql
-- 062: FormEnvironment gains two independent switches.
-- Production and UAT run side by side, so one string column cannot say it.
-- The Environment column stays until the code has moved (dropped in 065).
IF COL_LENGTH('dbo.FormEnvironment', 'ProductionEnabled') IS NULL
  ALTER TABLE [dbo].[FormEnvironment] ADD [ProductionEnabled] BIT NOT NULL CONSTRAINT [DF_FormEnvironment_ProductionEnabled] DEFAULT (1);
GO
IF COL_LENGTH('dbo.FormEnvironment', 'UatEnabled') IS NULL
  ALTER TABLE [dbo].[FormEnvironment] ADD [UatEnabled] BIT NOT NULL CONSTRAINT [DF_FormEnvironment_UatEnabled] DEFAULT (0);
GO
-- Every form stays live. A literal conversion would set ProductionEnabled = 0
-- on all three configured forms — the whole catalogue invisible to everyone
-- while UatTester is still empty.
UPDATE [dbo].[FormEnvironment]
   SET [ProductionEnabled] = 1,
       [UatEnabled] = CASE WHEN [Environment] = N'UAT' THEN 1 ELSE 0 END;
GO
```

- [ ] **Step 2: Write 063**

```sql
-- 063: who may test, and who approves their test requests.
-- Fast_Core, beside FormEnvironment: readable whichever pool a request resolves
-- to, and it survives a rebuild of the UAT database.
IF OBJECT_ID('dbo.UatTester', 'U') IS NULL
CREATE TABLE [dbo].[UatTester] (
  [Id]              INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTester] PRIMARY KEY,
  [StaffId]         INT NOT NULL CONSTRAINT [UQ_UatTester_StaffId] UNIQUE,
  [Email]           NVARCHAR(200) NOT NULL,
  [ManagerStaffId]  INT NULL,
  [ManagerEmail]    NVARCHAR(200) NULL,
  [IsActive]        BIT NOT NULL CONSTRAINT [DF_UatTester_IsActive] DEFAULT (1),
  [UpdatedBy]       INT NULL,
  [UpdatedAt]       DATETIME2(7) NOT NULL CONSTRAINT [DF_UatTester_UpdatedAt] DEFAULT (SYSDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UatTester_Email')
  CREATE INDEX [IX_UatTester_Email] ON [dbo].[UatTester] ([Email]);
GO
```

- [ ] **Step 3: Hand both files to the controller to apply**

Report DONE with the two paths and the exact commands the controller must run:

```
npm run apply-sql -- --db Fast_Core --file migrations/062_core_form_environment_switches.sql
npm run apply-sql -- --db Fast_Core --file migrations/063_core_uat_tester.sql
```

Do not run them yourself.

- [ ] **Step 4: Commit**

```bash
git add migrations/062_core_form_environment_switches.sql migrations/063_core_uat_tester.sql
git commit -m "feat(env): switch columns and the tester list, added without dropping anything"
```

---

### Task 2: The tester list and the viewer's mode, server side

**Files:**
- Create: `src/lib/uat-tester/service.ts`
- Create: `src/lib/uat-mode.ts`
- Modify: `src/proxy.ts`

**Interfaces:**
- Produces:
  - `getActiveUatTester(email: string | null): Promise<UatTesterRow | null>` — react-`cache()`d
  - `listUatTesters(): Promise<UatTesterRow[]>`, `upsertUatTester(...)`, `setUatTesterActive(...)`
  - `UAT_MODE_COOKIE = "form-portal-uat-mode"`, `isUatModeCookieOn(raw)`
  - request header `x-user-email`

- [ ] **Step 1: Write the cookie module**

`src/lib/uat-mode.ts` — pure, no `next/headers`, no DB, so a client component can import the constant:

```ts
/** Per-browser UAT mode. Only a hint: membership is checked server side on every resolve. */
export const UAT_MODE_COOKIE = "form-portal-uat-mode";
export const UAT_MODE_MAX_AGE = 60 * 60 * 24 * 30;

export function isUatModeCookieOn(raw: string | null | undefined): boolean {
  return raw === "1";
}
```

- [ ] **Step 2: Write the tester service**

`src/lib/uat-tester/service.ts`, on `getCorePool()`, mirroring the shape of
`src/lib/form-environment/service.ts`:

```ts
export interface UatTesterRow {
  id: number;
  staffId: number;
  email: string;
  managerStaffId: number | null;
  managerEmail: string | null;
  isActive: boolean;
  updatedBy: number | null;
  updatedAt: Date | null;
}
```

`getActiveUatTester(email)` matches case-insensitively
(`LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@email)))` — `listMyWorkRows`
already burned on a raw comparison) and returns null for a blank email. Wrap it
in react `cache()` so the resolver, the layout and the API route share one read
per request.

- [ ] **Step 3: Inject the viewer's identity in the proxy**

The resolver needs to know who is asking, and it must not call `auth()` itself.
The proxy already decodes the token; add the email beside the pathname at
`src/proxy.ts:66-67`:

```ts
const requestHeaders = new Headers(req.headers);
requestHeaders.set("x-pathname", req.nextUrl.pathname);

// Identity for the Node-side resolver. The proxy runs on Edge and cannot reach
// the database, so it publishes who is asking and the resolver does the
// UatTester lookup. .set() overwrites anything the client sent, same trust
// argument as x-pathname.
const token = await getToken({ req, secret: env.AUTH_SECRET });
const email = typeof token?.email === "string" ? token.email : "";
requestHeaders.set("x-user-email", email);
```

Import `getToken` from `next-auth/jwt` and `env` from `@/env`. If `getToken`
throws, set an empty string and continue — an unidentified viewer resolves
Production, which is the safe direction.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/uat-mode.ts src/lib/uat-tester/service.ts src/proxy.ts
git commit -m "feat(env): the tester list, the UAT-mode cookie, and a verified viewer header"
```

---

### Task 3: Rebuild the resolver on the switches

This is the task that flips the app onto the new columns.

**Files:**
- Modify: `src/lib/form-environment/service.ts:4-102`
- Modify: `src/lib/form-environment/index.ts:23-48`
- Modify: `src/lib/form-environment/current-rows.ts:29-39` and its test
- Modify: `src/lib/acc/report-service.ts:415`, `:469`
- Modify: `src/app/api/settings/form-environment/route.ts`

**Interfaces:**
- Consumes: `pickEnvironment`, `environmentFromPath` (already shipped), `getActiveUatTester`, `UAT_MODE_COOKIE`
- Produces:
  - `getFormSwitchMap(): Promise<Record<string, FormSwitches>>` (replaces `getFormEnvironmentMap`)
  - `setFormFlag(formCode, field: "production" | "uat", value: boolean, userId)`
  - `resolveFormEnvironment(): Promise<FormEnvironmentValue>` — unchanged signature
  - `resolveFormAccess(formCode: string): Promise<{ environment: FormEnvironmentValue; available: boolean }>`
  - `resolveViewerEnvironmentMap(): Promise<Record<string, FormEnvironmentValue>>` for the list filters

- [ ] **Step 1: Move the service onto the two columns**

In `src/lib/form-environment/service.ts`: delete `normalize()`; `FormEnvironmentRow.environment` becomes `productionEnabled: boolean; uatEnabled: boolean`; `getFormEnvironmentMap` becomes `getFormSwitchMap` selecting `FormCode, ProductionEnabled, UatEnabled` and defaulting a missing row to `PRODUCTION_ONLY` (import it from `./pick-environment`); `listFormEnvironments` selects and maps both bits — **keep its explicit `getAppPool(env.MSSQL_FORM_DATABASE)`**, the settings page must show the production catalogue whoever is looking.

Replace `setFormEnvironment` with a single-field mutator, so two switches cannot
clobber each other:

```ts
export async function setFormFlag(
  formCode: string,
  field: "production" | "uat",
  value: boolean,
  userId: number,
): Promise<void> {
  const code = (formCode ?? "").trim();
  if (!code) throw new Error("formCode is required");
  const column = field === "production" ? "ProductionEnabled" : "UatEnabled";

  const pool = await getCorePool();
  await pool
    .request()
    .input("code", sql.NVarChar, code)
    .input("value", sql.Bit, value ? 1 : 0)
    .input("by", sql.Int, userId)
    .query(`
      MERGE [dbo].[FormEnvironment] WITH (HOLDLOCK) AS t
      USING (SELECT @code AS FormCode) AS s ON t.FormCode = s.FormCode
      WHEN MATCHED THEN UPDATE SET [${column}] = @value, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (FormCode, [${column}], UpdatedBy) VALUES (@code, @value, @by);
    `);
}
```

`column` is chosen from a two-value union, never interpolated from input. The
`MERGE … WITH (HOLDLOCK)` replaces the existing non-atomic UPDATE-then-INSERT.

- [ ] **Step 2: Rebuild the resolver**

In `src/lib/form-environment/index.ts`, add a `cache()`d `currentUatMode()` that
reads the cookie inside the same try/catch as `currentPath()`, a `cache()`d
`currentViewerEmail()` reading `x-user-email` the same way, and:

```ts
/** The viewer's UAT mode, only true when the cookie is set AND they are an active tester. */
const viewerIsTesting = cache(async (): Promise<boolean> => {
  if (!isUatModeCookieOn(await currentUatMode())) return false;
  const { getActiveUatTester } = await import("@/lib/uat-tester/service");
  return (await getActiveUatTester(await currentViewerEmail())) !== null;
});

export const resolveFormEnvironment = cache(async (): Promise<FormEnvironmentValue> => {
  const cls = await resolveFormClass();
  if (cls === null || cls === "BOTH") return "Production";
  const [switches, testing] = await Promise.all([getFormSwitchMap(), viewerIsTesting()]);
  const form = switches[cls] ?? PRODUCTION_ONLY;

  // The id rule is bounded: without this, an id >= 900000 would open the UAT
  // database to anybody even after UAT is switched off.
  const byId = environmentFromPath(await currentPath());
  const idEnvironment = byId === "UAT" && !(form.uatEnabled || testing) ? null : byId;

  return pickEnvironment({ idEnvironment, viewerUatMode: testing, form }).environment;
});

export async function resolveFormAccess(formCode: string) {
  const [switches, testing] = await Promise.all([getFormSwitchMap(), viewerIsTesting()]);
  return pickEnvironment({ viewerUatMode: testing, form: switches[formCode] ?? null });
}

/** What each form resolves to for this viewer — for the merged-list filters. */
export async function resolveViewerEnvironmentMap(): Promise<Record<string, FormEnvironmentValue>> {
  const [switches, testing] = await Promise.all([getFormSwitchMap(), viewerIsTesting()]);
  const out: Record<string, FormEnvironmentValue> = {};
  for (const code of Object.keys(switches)) {
    out[code] = pickEnvironment({ viewerUatMode: testing, form: switches[code] }).environment;
  }
  return out;
}
```

The dynamic import of the tester service keeps the static graph free of anything
that could reach `getFormPool()`.

- [ ] **Step 3: Feed the list filters the viewer's map**

`src/lib/acc/report-service.ts:415` and `:469` currently pass
`await getFormEnvironmentMap()`. Both become `await resolveViewerEnvironmentMap()`.
`current-rows.ts` keeps its signature (a `Record<code, "Production"|"UAT">`) —
only its doc comment changes, to say the map is what resolves for this viewer.
Update `current-rows.test.ts`'s wording likewise; its assertions still hold.

- [ ] **Step 4: Follow the compiler**

`npx tsc --noEmit` now points at the settings API route
(`src/app/api/settings/form-environment/route.ts`) and anything else reading the
old map. Change the POST body to `{ formCode, field, value }` with strict
validation of `field` against the two literals and `typeof value === "boolean"`,
calling `setFormFlag`. Leave the GET counts alone.

- [ ] **Step 5: Verify against the databases**

```bash
npx tsc --noEmit && npm test
```

Then report to the controller which reads you could not exercise without a
browser session, so it can check them.

- [ ] **Step 6: Commit**

```bash
git add src/lib/form-environment src/lib/acc/report-service.ts src/app/api/settings/form-environment/route.ts
git commit -m "feat(env): resolve from two switches, the viewer's mode, and the record's id"
```

---

### Task 4: Settings → UAT Users

**Files:**
- Create: `src/app/api/settings/uat-users/route.ts`
- Create: `src/app/(dashboard)/settings/uat-users/page.tsx`
- Create: `src/features/settings/UatUserSettings.tsx`
- Modify: `src/lib/constants.ts` (`SETTINGS_CARDS`)
- Modify: `src/app/(dashboard)/settings/page.tsx` (`ICON_MAP`)

**Interfaces:**
- Consumes: `listUatTesters`, `upsertUatTester`, `setUatTesterActive` (Task 2), `searchADUsers` via the existing `/api/users/search`
- Produces: the page at `/settings/uat-users`

- [ ] **Step 1: The API**

`GET` (System Admin) returns every tester plus two derived facts the page needs:
each row's `managerIsTester`, and a top-level `accountApproverIsTester` computed
by intersecting `AccApprover` (read through `getAppPool(env.MSSQL_FORM_DATABASE)`,
production, since the roster is dual-written and identical) with the active
tester emails.

`POST` accepts `{ action: "upsert" | "setActive" | "remove", … }`. On `upsert`,
**refuse a `managerStaffId` whose email is not an active tester** with
`"ผู้จัดการสำหรับ UAT ต้องอยู่ในรายชื่อ UAT Users ด้วย"` — the chain has to stay
inside the tester group or the request stalls at a queue no tester can see.

- [ ] **Step 2: The page**

`src/features/settings/UatUserSettings.tsx`, modelled on
`src/app/(dashboard)/settings/users/page.tsx` (which already has the AD search
modal, the confirm modal and the System-Admin redirect). A table of testers:
name, email, UAT manager, active, actions. "Add tester" opens AD search; picking
a manager opens the same search.

Above the table, when `accountApproverIsTester` is false, a
`--status-bad-bg` panel: `"ยังไม่มีผู้อนุมัติบัญชี (AccApprover) คนไหนอยู่ในรายชื่อ UAT — คำขอ UAT จะค้างที่ขั้นอนุมัติบัญชี"`.

- [ ] **Step 3: The hub card**

```ts
  {
    id: "uat-users",
    label: "UAT Users",
    icon: "FlaskConical",
    desc: "รายชื่อผู้ทดสอบ และผู้จัดการสำหรับ UAT ของแต่ละคน",
    href: "/settings/uat-users",
    systemAdminOnly: true,
  },
```

`ICON_MAP` in `src/app/(dashboard)/settings/page.tsx` already has `FlaskConical`.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/app/api/settings/uat-users src/app/\(dashboard\)/settings/uat-users src/features/settings/UatUserSettings.tsx src/lib/constants.ts
git commit -m "feat(env): Settings page for the UAT tester list"
```

---

### Task 5: Two switches on the Form Environment page

**Files:**
- Modify: `src/features/settings/FormEnvironmentSettings.tsx`
- Modify: `src/app/(dashboard)/settings/form-environment/page.tsx:36`
- Modify: `src/lib/constants.ts:138`

- [ ] **Step 1: The row interface and the mutator**

The client-local `FormEnvironmentRow` (`:14-26`) gains `productionEnabled` and
`uatEnabled` in place of `environment` — `tsc` will not catch this, so change it
by hand. `pending` becomes
`{ row: FormEnvironmentRow; field: "production" | "uat"; next: boolean } | null`,
and `setEnvironment` becomes `setFlag(formCode, field, next)` posting the Task 3
body. The toast names the switch and direction: `` `${formCode} · UAT เปิด` ``.

- [ ] **Step 2: Two switches per row**

Replace the segmented control (`:177-210`) with two independent switches in the
`Environment` cell, labelled `Production` and `UAT`, each showing on/off state
with the existing status tokens (on-production `--status-ok-*`, on-uat
`--status-bad-*`, off `--bg-badge`/`--text-muted`). `src/components/ui/Toggle.tsx`
is too large for an 11px table cell — write the switch inline in this file rather
than growing the shared component.

- [ ] **Step 3: The confirmation, split**

Typed-`Confirm` survives for exactly one transition: `field === "production" && next === false`,
because that hides a live form from everyone. The other three take a plain
confirm dialog (same `Dialog`, no text input). The dialog body must state what
the specific transition does; the current "สลับกลับ / เปลี่ยนเป็น UAT" copy at
`:91-103` is false once both can be on — with both on, nothing moves and nothing
disappears, only testers in UAT mode go elsewhere.

- [ ] **Step 4: The two stale subtitles**

`page.tsx:36` and `constants.ts:138` both describe the either/or model. Reword to
the two-switch model, e.g. `"เปิด/ปิด Production และ UAT ของแต่ละฟอร์มแยกกัน"`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/features/settings/FormEnvironmentSettings.tsx src/app/\(dashboard\)/settings/form-environment/page.tsx src/lib/constants.ts
git commit -m "feat(env): independent Production and UAT switches per form"
```

---

### Task 6: One payload the whole UI reads

**Files:**
- Modify: `src/app/api/form-environment/route.ts`
- Modify: `src/lib/hooks/useFormEnvironments.ts`
- Modify: `src/components/EnvironmentBadge.tsx`
- Modify: `src/features/home/HomeCatalogue.tsx`, `src/app/(dashboard)/request/page.tsx`
- Modify: `src/features/accounting/components/MyRequestsPanel.tsx:268-284`

**Interfaces:**
- Produces: `GET /api/form-environment` →

```ts
{
  viewer: { isTester: boolean; uatMode: boolean; anyUatForm: boolean; hasUatManager: boolean };
  forms: Record<string, { environment: "Production" | "UAT"; available: boolean }>;
}
```

- `useFormEnvironments()` returns that payload; `useViewerUat()` returns the viewer block.

- [ ] **Step 1: Widen the endpoint**

Build `forms` from `resolveFormAccess(code)` for every code in the switch map, and
`viewer` from `getActiveUatTester` + the cookie + `Object.values(switches).some(s => s.uatEnabled)`.
Any signed-in user may read it — it says only where their own forms point.

- [ ] **Step 2: Reshape the hook**

Keep the single SWR key so every chip on a page shares one request, but stop
failing silently open: expose `error`, and have availability-dependent callers
treat "unknown" as "show it" while chips render nothing rather than a false `PRO`.
Add `revalidateOnFocus: false` — this now fires on every dashboard page.

- [ ] **Step 3: Chips**

`FormEnvironmentChip` reads `forms[code].environment` from the new payload.
**Delete `ListEnvironmentChips`** and its two usages (`my-request`, `my-work`
pages): a static `PRO + UAT` label is wrong under this model — replace with the
viewer's own marker, `UAT` when `viewer.uatMode`, nothing otherwise.
**Do not touch `MyRequestsPanel.tsx:474-481`** — that chip reads the row's own
database and is already correct.

- [ ] **Step 4: Availability filtering**

`HomeCatalogue`'s `ACCOUNTING_FORMS` filter (`:177`) and the Request hub's
`visibleRequestCards` (`:170-175`) drop forms whose `available` is false. The hub
keys on `item.badge`, which doubles as the form code — leave that as-is but add a
comment saying so. When UAT mode is on and every form is filtered out, both
surfaces need a line saying why rather than rendering an empty page.
`MyRequestsPanel`'s form filter options (`:268-284`) seed from available forms.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/app/api/form-environment src/lib/hooks/useFormEnvironments.ts src/components/EnvironmentBadge.tsx src/features/home/HomeCatalogue.tsx src/app/\(dashboard\)/request/page.tsx src/features/accounting/components/MyRequestsPanel.tsx src/app/\(dashboard\)/my-request/page.tsx src/app/\(dashboard\)/my-work/page.tsx
git commit -m "feat(env): one viewer-resolved payload behind every chip and catalogue"
```

---

### Task 7: The navbar switch

**Files:**
- Create: `src/app/api/uat-mode/route.ts`
- Create: `src/components/layout/UatModeSwitch.tsx`
- Modify: `src/components/layout/Navbar.tsx:186-207` and `:244-255`

- [ ] **Step 1: The write route**

`POST /api/uat-mode { enabled: boolean }`, `requireAuth()`, refuses with 403
unless `getActiveUatTester(session.user.email)` returns a row. Sets or clears
`UAT_MODE_COOKIE` with `httpOnly: true`, `sameSite: "lax"`, `path: "/"`,
`maxAge: UAT_MODE_MAX_AGE`. A route handler rather than a server action, so the
`PRODUCTION_HOSTS` allowlist in `next.config.mjs` cannot silently reject it on a
new host.

- [ ] **Step 2: The control**

Renders only when `viewer.isTester && viewer.anyUatForm`. Two states: `PRO`
(quiet) and `UAT` (`--status-bad-*`, standing marker). Clicking opens a small
confirm — switching changes which database everything writes to — then POSTs and,
on success, calls `mutate("/api/form-environment")` **and** reloads the page.
An SWR `mutate` alone leaves every other client-fetched list stale, and
`router.refresh()` only re-renders RSC, which this app barely uses.

One exception to the render condition: when `viewer.uatMode` is true, render the
control even if `anyUatForm` has become false — otherwise an admin switching the
last form off strands a tester in UAT mode with no way back.

- [ ] **Step 3: Place it**

Desktop: first child of the right-hand group at `:186-207`, left of
`BrandSwitcher`. Mobile top bar: compact variant at `:244-255`. **Not** in the
bottom tab bar — those are `Link`s with `flex-1` and it would read as navigation.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/app/api/uat-mode src/components/layout/UatModeSwitch.tsx src/components/layout/Navbar.tsx
git commit -m "feat(env): a PRO/UAT switch in the navbar for testers"
```

---

### Task 8: The manager a UAT request routes to

The spec's claim that two functions cover both forms is wrong; this task touches
both resolvers separately.

**Files:**
- Modify: `src/lib/acc/employee-context.ts:76-117`, `:155-194`
- Modify: `src/lib/hr/employee-lookup.ts:346-359`
- Modify: `src/lib/acc/request-service.ts:422-436`, `:712-791`
- Modify: `src/lib/acc/travel-booking/request-service.ts:578-743`, `:962-971`

- [ ] **Step 1: A single override helper**

In `src/lib/uat-tester/service.ts`, add:

```ts
/**
 * The manager a UAT request routes to, or null when the requester is not a
 * tester or has no UAT manager set. Callers must refuse the submit rather than
 * fall back to HR — a real manager must never be handed test data.
 */
export async function uatManagerFor(
  requesterEmail: string | null,
  requesterStaffId: number | null,
): Promise<{ staffId: number; email: string | null } | null>
```

- [ ] **Step 2: AP-1**

In `resolveRequesterForActor` (`employee-context.ts:155-194`), after the HR
snapshot is built, when `await resolveFormEnvironment() === "UAT"` replace
`managerStaffId`/`managerEmail` with `uatManagerFor(snapshot.email, snapshot.staffId)`
— keyed on the **requester**, not the actor. When it returns null, return the
snapshot with no manager so the existing manager-less path refuses the submit.
Do the same in `resolveManagerInfo` (`:76-117`) so the form's manager card
previews the same person it will actually assign.

- [ ] **Step 3: AP-17**

`resolveEmployeeForActor` (`src/lib/hr/employee-lookup.ts:346-359`, manager set
at `:95`) needs the identical override. AP-17's approve/reject/return routes gate
on `staffId === ManagerStaffId` alone, so the UAT manager must be a real active
HR StaffId — the Task 4 API already refuses anything else.

- [ ] **Step 4: The three manager-less messages**

`request-service.ts:431-433`, `request-service.ts:924` and
`travel-booking/request-service.ts:962-971` all carry the same HR-flavoured Thai
string. In UAT each must read
`"โหมด UAT: ยังไม่ได้กำหนดผู้จัดการสำหรับ UAT — ตั้งที่ Settings → UAT Users"`.

- [ ] **Step 5: Refuse writes to a form this viewer cannot use**

In `saveDraft` and both submit paths, call `resolveFormAccess(formCode)` and
refuse when `available` is false, with
`"ฟอร์มนี้ยังไม่เปิดให้ใช้งานในสภาพแวดล้อมที่คุณอยู่"`. Check the **resolved**
environment, not the cookie: a tester editing a UAT draft with UAT mode off is
routed by the id rule and must be judged on that.

Also refuse an on-behalf submit whose requester is not an active tester while the
request resolves UAT, with
`"โหมด UAT: ส่งแทนคนที่ไม่ได้อยู่ในรายชื่อ UAT Users ไม่ได้"`.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/employee-context.ts src/lib/hr/employee-lookup.ts src/lib/acc/request-service.ts src/lib/acc/travel-booking/request-service.ts src/lib/uat-tester/service.ts
git commit -m "feat(env): UAT requests route to the tester's UAT manager"
```

---

### Task 9: Mail, ERP and the caches

**Files:**
- Modify: `src/lib/acc/email-queue.ts:40-65`
- Modify: `src/lib/acc/erp-prep-service.ts:16`, `:197-203`
- Modify: `src/app/api/request/accounting/erp-prep/route.ts`, `.../send/route.ts`
- Modify: `src/lib/acc/sequence.ts:12-18`

- [ ] **Step 1: Let UAT participants get their mail**

`applyUatRedirect` rewrites every UAT message. Add one exception: a recipient who
is an active tester or a configured UAT manager gets it at their own address,
still `[UAT]`-prefixed. Everyone else keeps the rewrite, and the loud throw when
`UAT_MAIL_REDIRECT` is unset stays. Without this the UAT manager is never told
there is anything to approve.

- [ ] **Step 2: Key the prep cache by environment**

`PREP_DEPT_CTX_CACHE_KEY` is a constant in a `globalThis` Map, and its contents
come from a form-pool read. Make it `` `acc:prep-dept-ctx:${environment}` ``.
Invariant for review: nothing derived from a form-pool read may live in a
process-global cache under a key that omits the environment.

- [ ] **Step 3: Bind the ERP send to what was displayed**

`GET /api/request/accounting/erp-prep` returns the resolved environment and the
ids it listed. `POST …/send` requires `{ interfaceTarget, environment, requestIds }`,
and returns 409 `"คิวที่คุณเห็นเป็นของอีกสภาพแวดล้อมหนึ่งแล้ว — โหลดหน้าใหม่"`
when either disagrees with the server's own resolve. Today the sender's cookie
alone decides which Business Central instance a batch reaches.

- [ ] **Step 4: Make the UAT number offset structural**

`allocateRequestNo` inserts `LastSeq = 1` for a year it has not seen, so the
seeded 2026 offset rows stop separating the databases on 1 January. Start the
sequence from an environment-derived floor inside the function instead.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/email-queue.ts src/lib/acc/erp-prep-service.ts src/app/api/request/accounting/erp-prep src/lib/acc/sequence.ts
git commit -m "feat(env): mail, ERP target and caches follow the resolved environment"
```

---

### Task 10: Contract the column, guard the floor, tell the truth

**Files:**
- Create: `migrations/064_uat_identity_floor.sql`
- Create: `migrations/065_core_drop_form_environment_column.sql`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-18-parallel-uat-design.md`

- [ ] **Step 1: The identity floor**

`064`, guarded exactly like 061 (`IF DB_NAME() NOT LIKE '%[_]UAT' … RAISERROR`),
adds `CHECK (Id >= 900000)` to the transactional tables 061 reseeded. Rule 1
makes that floor load-bearing for writes and nothing currently asserts it.

- [ ] **Step 2: Drop the old column**

`065`, in this batch order — the named constraint first, or the drop fails:

```sql
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FormEnvironment_Environment')
  ALTER TABLE [dbo].[FormEnvironment] DROP CONSTRAINT [CK_FormEnvironment_Environment];
GO
IF COL_LENGTH('dbo.FormEnvironment', 'Environment') IS NOT NULL
  ALTER TABLE [dbo].[FormEnvironment] DROP COLUMN [Environment];
GO
```

Read `migrations/060_core_form_environment.sql:15-16` for the real constraint
name and use it verbatim.

- [ ] **Step 3: Correct the record**

CLAUDE.md's per-form routing section describes one switch per form; rewrite it
for the two-switch model, the tester list, and the id rule. Its Navigation
section is also stale (it still lists a Forms tab and a Form Builder group on
Home) — fix that while you are in there. In the spec, correct the claim that
`resolveManagerInfo`/`resolveManagerEmail` are the only two manager functions:
AP-1 and AP-17 have separate resolvers.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm test
```

Then hand the controller the manual script: two browsers, a tester in UAT mode
and an ordinary user, both filing AP-1 — different databases, different
approvers, and the UAT request reaching ERP prep without ever appearing to the
production user.

- [ ] **Step 5: Commit**

```bash
git add migrations/064_uat_identity_floor.sql migrations/065_core_drop_form_environment_column.sql CLAUDE.md docs/superpowers/specs/2026-08-18-parallel-uat-design.md
git commit -m "chore(env): drop the old column, guard the identity floor, update the guide"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Two switches per form | 1 (columns), 3 (service), 5 (UI) |
| Tester list | 1 (table), 2 (service), 4 (page) |
| Chain stays inside the tester group | 4 (manager must be a tester, account-approver warning), 8 (override + refusals) |
| Resolution rule 1, bounded by `UatEnabled` | 3, Step 2 |
| Rule 2 keyed on membership, not the cookie alone | 2 (service), 3 (`viewerIsTesting`) |
| Identity via proxy header, no `auth()` in the resolver | 2, Step 3 |
| `resolveFormAccess(formCode)` | 3, Step 2 |
| Availability hiding and write refusals | 6 (hide), 8 Step 5 (refuse) |
| Manager override on the resolved environment | 8, Steps 2-3 |
| Mail redirect exception | 9, Step 1 |
| Migration turns Production on for all | 1, Step 1 |
| Identity floor CHECK | 10, Step 1 |
| Running-number offset made structural | 9, Step 4 |
| Environment-keyed caches | 9, Step 2 |
| ERP send echoes the environment | 9, Step 3 |
| Navbar control, rendered conditionally | 7 |
| Record banners disagreeing with viewer | 6, Step 3 (viewer marker) — `UatDataBanner` already labels the record |

**Ordering:** expand-then-contract keeps the running app working — Task 1 only
adds columns, Task 3 moves the code onto them, Task 10 drops the old one. Every
task ends on a green `tsc` and `npm test`.

**Type consistency:** `FormSwitches`, `PRODUCTION_ONLY`, `pickEnvironment`,
`requestIdFromPath` and `environmentFromPath` are already shipped and used with
those exact names. `getFormSwitchMap`, `setFormFlag`, `resolveFormAccess`,
`resolveViewerEnvironmentMap`, `getActiveUatTester` and `uatManagerFor` are
declared in the task that creates them and used with the same signatures later.

**Placeholder scan:** no TBD, no "handle errors appropriately", no "similar to
Task N". The two places that say "follow the compiler" (Task 3 Step 4) name the
file the compiler will point at.
