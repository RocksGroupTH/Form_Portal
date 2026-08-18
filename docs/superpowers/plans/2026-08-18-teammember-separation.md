# TeamMember Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task.

**Goal:** Form Portal keeps its own user identity and roles in `Rocks_Portal_Form.dbo.TeamMember`
instead of sharing `Fast_Core.dbo.TeamMember` with the live Rocks Fast app.

**Architecture:** Copy the table and its 17 rows into this app's own database with ids preserved,
funnel every access through one service module, and pin identity reads to the production form pool.
`Fast_Core.dbo.TeamMember` is left completely untouched — Rocks Fast keeps using it, and the two
role lists diverge from the cut onward, which the owner has accepted.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (ES5 target), MSSQL via `mssql`,
NextAuth 5 (jwt strategy), numbered SQL migrations applied with `npm run apply-sql`.

## Owner decisions already made

1. **No UAT copy.** One table, in `Rocks_Portal_Form`, reached three-part from either pool.
   Accepted trade: `Rocks_Portal_Form_UAT` is no longer self-contained.
2. **New ids start at 100001.** The 17 existing rows keep their exact ids (1..2008); the identity is
   reseeded to 100000 so Form Portal's new users can never collide with Fast_Core's, which keep
   allocating from 18.
3. **One service module.** `teamMemberTable()` is deleted and every access goes through
   `src/lib/team-member/service.ts`, so a future stray query is greppable.
4. **Nothing in Fast_Core or Fast_Data is deleted, dropped or altered.** Copy only.

## Global Constraints

- `npx tsc --noEmit && npm test` must pass. 103 tests pass at `d07abee`. New test files must be
  added to the explicit list in `package.json`'s test script.
- **Never** run `npm run build` or `npm run dev` — a dev server holds port 3020 and `.next`.
- **Never** issue DELETE, DROP, TRUNCATE or ALTER against `Fast_Core` or `Fast_Data`. Reads only.
- Migrations are numbered files in `migrations/`, split on `GO`, applied with
  `npm run apply-sql -- --db <name> --file <path>`. The implementer writes them; the controller
  applies them.
- Parameterized SQL only. `{ ok: true, data }` / `{ ok: false, error }`. Thai user-facing copy,
  English identifiers and comments. ES5 target (`Array.from`, never `[...set]`).
- `var(--token)` for CSS, `lucide-react` icons, `sonner` toasts.

## Verified facts the implementation depends on

Live `Fast_Core.dbo.TeamMember`, read by the controller:

| Column | Type | Null | Default |
|---|---|---|---|
| Id | int IDENTITY | NOT NULL | PK, clustered |
| FullName | nvarchar(200) | NOT NULL | |
| Nickname | nvarchar(100) | NOT NULL | |
| Email | nvarchar(200) | NOT NULL | `UQ_TeamMember_Email` |
| AppRole | nvarchar(30) | NOT NULL | `'Staff'` |
| Position | nvarchar(200) | NULL | |
| Color | nvarchar(20) | NOT NULL | `'#6c757d'` |
| Photo | nvarchar(500) | NULL | |
| ManagerId | int | NULL | self-FK |
| IsActive | bit | NOT NULL | `1` |
| CreatedAt | datetime2(7) | NOT NULL | `getdate()` |
| UpdatedAt | datetime2(7) | NOT NULL | `getdate()` |

- Indexes: `UQ_TeamMember_Email` (unique), `IX_TeamMember_Email`, `IX_TeamMember_IsActive`,
  `IX_TeamMember_ManagerId`.
- `CK_TeamMember_AppRole`: `AppRole IN ('Staff','IT Admin','System Admin','Viewer')`.
- `FK_TeamMember_Manager`: self-FK on `ManagerId`, trusted, `NO_ACTION`. **One row populates it**,
  so the copy must not check the FK mid-insert.
- 17 rows, ids 1..2008, `IDENT_CURRENT` 2008. Roles: 3 System Admin, 6 IT Admin (5 active), 8 Staff.
- No row has a `Photo`. Longest `Color` is 7 chars.
- No other table inside Fast_Core points at TeamMember.
- Next migration number is **066**.

---

### Task 1: Migration 066 — create the table and copy the rows

**Files:**
- Create: `migrations/066_portal_form_team_member.sql`

Both databases live on the same server, so the copy is a cross-database `INSERT ... SELECT` inside
the same migration. Batches separated by `GO`.

- [ ] **Step 1: Refuse to run anywhere but the production form database**

The table must exist in exactly one place (owner decision 1). Guard like
`migrations/061_uat_identity_reseed.sql:20-27`, but inverted — refuse when the database name *does*
end in `_UAT`:

```sql
IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @wrong NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 066 must not be applied to the UAT form database. Identity lives only in production. Current database is %s.',
    16, 1, @wrong
  );
END
```

Put the rest in the matching `ELSE BEGIN ... END`, exactly as 061 and 064 do, so severity-16's
non-terminating behaviour cannot let the DDL through.

- [ ] **Step 2: Create the table, without the self-FK**

All twelve columns as tabulated above. Name the primary key and every default explicitly
(`PK_TeamMember`, `DF_TeamMember_AppRole`, `DF_TeamMember_Color`, `DF_TeamMember_IsActive`,
`DF_TeamMember_CreatedAt`, `DF_TeamMember_UpdatedAt`) — Fast_Core's copy carries auto-generated
names like `PK__TeamMemb__3214EC07F1D2705A`, which is not worth reproducing.

Add `CK_TeamMember_AppRole` and all four indexes. **Do not add `FK_TeamMember_Manager` yet** — one
row references another and a row-by-row check can fail on insert order.

Guard creation with `IF OBJECT_ID('dbo.TeamMember', 'U') IS NULL` so the migration is re-runnable.

- [ ] **Step 3: Copy the 17 rows with their ids**

Only when the table is empty, so a re-run cannot double-insert:

```sql
IF NOT EXISTS (SELECT 1 FROM [dbo].[TeamMember])
BEGIN
  SET IDENTITY_INSERT [dbo].[TeamMember] ON;
  INSERT INTO [dbo].[TeamMember]
    (Id, FullName, Nickname, Email, AppRole, Position, Color, Photo, ManagerId, IsActive, CreatedAt, UpdatedAt)
  SELECT Id, FullName, Nickname, Email, AppRole, Position, Color, Photo, ManagerId, IsActive, CreatedAt, UpdatedAt
  FROM [Fast_Core].[dbo].[TeamMember];
  SET IDENTITY_INSERT [dbo].[TeamMember] OFF;
END
```

A single set-based `INSERT` so the self-reference resolves within one statement. This is a **read**
of Fast_Core — the only contact this migration has with it, and it must stay that way.

- [ ] **Step 4: Add the self-FK, validated**

```sql
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TeamMember_Manager'
               AND parent_object_id = OBJECT_ID('dbo.TeamMember'))
  ALTER TABLE [dbo].[TeamMember] WITH CHECK
    ADD CONSTRAINT [FK_TeamMember_Manager] FOREIGN KEY ([ManagerId]) REFERENCES [dbo].[TeamMember]([Id]);
```

`WITH CHECK` validates the copied rows — if the one populated `ManagerId` did not come across, this
fails loudly, which is what you want.

- [ ] **Step 5: Reseed the identity into a disjoint range**

```sql
IF (SELECT IDENT_CURRENT('dbo.TeamMember')) < 100000
  DBCC CHECKIDENT ('dbo.TeamMember', RESEED, 100000) WITH NO_INFOMSGS;
```

Owner decision 2: Form Portal's new users get 100001 up while Fast_Core keeps allocating from 18, so
an id says which app created it. The guard makes the reseed re-runnable without ever lowering a
counter that has already moved past it.

- [ ] **Step 6: Header comment**

Follow `migrations/065_core_drop_form_environment_column.sql`'s shape: what it does, why, the
`npm run apply-sql -- --db Rocks_Portal_Form --file ...` line, and — importantly — that Fast_Core is
read and never written, and that its copy stays in service for Rocks Fast.

- [ ] **Step 7: Commit**

```bash
git add migrations/066_portal_form_team_member.sql
git commit -m "feat(auth): create Form Portal's own TeamMember and copy the roster"
```

**Do not apply the migration.** The controller applies it and verifies the result.

---

### Task 2: The service module

**Files:**
- Create: `src/lib/team-member/service.ts`
- Create: `src/lib/team-member/service.test.ts` (for whatever pure logic you extract)
- Modify: `src/lib/db/mssql.ts` (delete `teamMemberTable()`)
- Modify: `package.json` (register the new test file)

**Interfaces produced** — later tasks call these, so the names and shapes are fixed here:

```ts
export interface TeamMemberRow {
  id: number; fullName: string; nickname: string; email: string;
  appRole: string; position: string | null; color: string;
  photo: string | null; managerId: number | null; isActive: boolean;
}

export function teamMemberTableRef(): string;          // three-part name, for JOINs
export async function findByEmail(email: string): Promise<TeamMemberRow | null>;
export async function findById(id: number): Promise<TeamMemberRow | null>;
export async function listActive(): Promise<TeamMemberRow[]>;
export async function resolveNames(ids: number[]): Promise<Map<number, { fullName: string; nickname: string }>>;
export async function provision(input: { email: string; fullName: string; nickname: string; position: string | null }): Promise<number>;
export async function updateRole(id: number, appRole: string): Promise<void>;
export async function setActive(id: number, isActive: boolean): Promise<void>;
export async function managerIdOf(userId: number): Promise<number | null>;
export async function firstActiveWithRole(appRole: string): Promise<number | null>;
```

Add whatever `src/app/api/settings/users/route.ts` needs for its directory sync (an upsert and a
name refresh); shape it to the existing behaviour rather than inventing a new one.

- [ ] **Step 1: Pin the pool, and say why in the code**

Every function uses `getProductionFormPool()` (`src/lib/db/mssql.ts:87`) — **never** `getFormPool()`.
Write the reason in the module docblock, because it is the whole safety argument:

`getFormPool()` resolves per request URL, so with `requireAuth()` on 285 endpoints the same person
would read their identity from `Rocks_Portal_Form` on one route and `Rocks_Portal_Form_UAT` on an
AP-1 route flagged UAT — a different id, possibly a different role, depending on which page they are
on. It would also close the loop `getFormPool → auth → jwt → getFormPool` that
`src/lib/form-environment/index.ts:67-72` exists to keep open.

- [ ] **Step 2: `teamMemberTableRef()` returns a three-part name**

`[${env.MSSQL_FORM_DATABASE}].[dbo].[TeamMember]` — three-part, not bare, because
`src/app/api/forms/approvals/route.ts:27` runs its join on `getFormPool()`, which may one day resolve
to the UAT database. A bare name would silently read the wrong table there.

- [ ] **Step 3: Delete `teamMemberTable()` from `src/lib/db/mssql.ts:123-126`**

Follow the compiler to every caller. Do not leave a re-export shim — the point of this task is that
`grep -rn "TeamMember" src/` ends up naming only this module.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/team-member/ src/lib/db/mssql.ts package.json
git commit -m "feat(auth): one module owns every TeamMember access"
```

---

### Task 3: Move every caller onto the service

**Files:**
- Modify: `src/lib/team-member-lookup.ts`
- Modify: `src/app/api/settings/users/route.ts`
- Modify: `src/features/forms/workflow-engine.ts`
- Modify: `src/app/api/settings/form-environment/route.ts`
- Modify: `src/app/api/forms/submissions/[submissionId]/route.ts`
- Modify: `src/app/api/forms/approvals/route.ts`
- Modify: `src/features/forms/email-queue.ts`

This is the task that decides whether the cut actually happened. Every site below currently reads or
writes `Fast_Core` and will **keep doing so silently** if missed — the old table still exists, so
there is no "invalid object name" to catch a miss.

- [ ] **Step 1: The auth lookup**

`src/lib/team-member-lookup.ts:20` and `:59` hold `getCorePool()`. Route both through the service.
`:71` is `provisionTeamMember`, which runs inside the NextAuth `signIn` callback
(`src/lib/auth.ts:109`) on every first login — it must write to the new table.

- [ ] **Step 2: Users & Roles — all eight statements**

`src/app/api/settings/users/route.ts` lines **23, 72, 111, 116, 126, 157, 163, 172** each name a bare
`TeamMember` while holding `getCorePool()`. Miss this file and the app reads roles from the new table
while its own admin UI edits the old one: every role change reports success and does nothing.
Convert all eight.

- [ ] **Step 3: Workflow approver resolution**

`src/features/forms/workflow-engine.ts:56` (`SELECT ManagerId ... WHERE Id = @userId`) and `:66`
(`SELECT TOP 1 Id ... WHERE AppRole = @role`) → `managerIdOf` and `firstActiveWithRole`. Line 66 is
where the accepted role divergence bites: `AssigneeValue` holds a role *string*, so the wrong roster
means the wrong approver, with no error.

- [ ] **Step 4: The two-part name nobody greps for**

`src/app/api/settings/form-environment/route.ts:35` is
`SELECT Id, FullName, Nickname FROM [dbo].[TeamMember] WHERE Id IN (...)` on `getCorePool()` (`:28`).
It matches neither a `teamMemberTable(` search nor a bare `FROM TeamMember` search. Move it to
`resolveNames`. The ids come from `Fast_Core.FormEnvironment.UpdatedBy`, which stays in Fast_Core —
that is fine, ids are preserved verbatim so they resolve to the same people.

- [ ] **Step 5: Three queries that are broken today**

`src/app/api/forms/submissions/[submissionId]/route.ts:75`, `:83` and `:90` use **double quotes**
around `${teamMemberTable()}`, so the literal text `${teamMemberTable()}` is sent to SQL Server.
Submitter name, approval-timeline names and activity-log author names on that page do not resolve
today. Convert to template literals as part of the move; expect the page to start showing names it
never showed.

- [ ] **Step 6: The remaining two**

`src/app/api/forms/approvals/route.ts:27` (joins on `getFormPool()` — keep it three-part) and
`src/features/forms/email-queue.ts:17` (holds `getCorePool()`; it would read the new table
cross-database through a Fast_Core connection — correct results, but it keeps Fast_Core on the
identity path for no reason).

- [ ] **Step 7: Prove the sweep is complete**

```bash
grep -rn "TeamMember" src/ --include=*.ts --include=*.tsx | grep -v "src/lib/team-member/"
```

Every remaining hit must be a type name, an import, or a comment. Paste the output into your report.

- [ ] **Step 8: Verify and commit**

```bash
npx tsc --noEmit && npm test
git commit -m "feat(auth): every TeamMember read and write goes to Form Portal's own table"
```

---

### Task 4: Role cache, and the documentation that is now wrong

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/app/api/settings/users/route.ts`
- Modify: `src/lib/form-environment/index.ts`
- Modify: `CLAUDE.md`
- Modify: `migrations/024_acc_approval_hr_staffid.sql`, `migrations/058_acc_backfill_null_createdby.sql`

- [ ] **Step 1: Wire up the role cache invalidation**

`clearTeamMemberRoleCache` (`src/lib/auth.ts:38`) has **zero callers**, and the cache TTL is 60s
(`src/lib/auth.ts:14`). Call it from `updateRole`, `addUser` and `deleteUser` in
`src/app/api/settings/users/route.ts`. Without this, the first thing anyone testing the cut hits is a
role change that appears not to work for a minute, and they will misdiagnose it as the migration.

- [ ] **Step 2: A missing row must not freeze the token**

`src/lib/auth.ts:184-189` has no `else` for `member === null`: the token keeps its previous role and
userId indefinitely. After the cut that turns a botched read into "existing sessions look fine, new
logins fail" — the worst possible signal. Add the `else` branch and decide explicitly what it does
(clear the role, or leave it and log loudly); say which you chose and why in the report.

- [ ] **Step 3: Record the new hard constraint**

Extend the comment at `src/lib/form-environment/index.ts:67-72`. Today the
`getFormPool → auth → jwt → getFormPool` loop stays open only because `getFormSwitchMap()`
(`src/lib/form-environment/service.ts:62`) and `getActiveUatTester` (`src/lib/uat-tester/service.ts:53`)
both use `getCorePool()`. Once identity lives in the form database, that is no longer tidiness —
**`FormEnvironment` and `UatTester` must stay in Fast_Core**.

- [ ] **Step 4: CLAUDE.md**

Three places say Fast_Core owns TeamMember: the 3-database table row, the Auth section, and the
Cross-DB convention line about `teamMemberTable()`. Rewrite all three. State plainly what this change
does and does not buy: identity and roles are no longer shared with Rocks Fast, but the app still
cannot serve a request without Fast_Core — `getCorePool()` has 53 call sites, and `FormEnvironment`
and `UatTester` are pinned there by the loop above.

Also document the divergence: both apps provision at login independently, Form Portal's new ids start
at 100001 while Fast_Core's continue from 18, and granting System Admin now has to be done in both
apps.

- [ ] **Step 5: The stale comment and the two historical migrations**

`src/app/api/settings/users/route.ts:91-99` justifies its reactivate-over-insert behaviour by saying
the Rocks Fast sibling reads those columns. After the cut it reads a different table. The behaviour
is probably still right — this app's own `AccRequest.CreatedBy` history depends on stable ids — but
the stated reason is wrong. Fix the reason, keep the behaviour.

`migrations/024_acc_approval_hr_staffid.sql:21` and `migrations/058_acc_backfill_null_createdby.sql:28`
hard-code `[Fast_Core].[dbo].[TeamMember]`. 058 documents itself as re-runnable (`:46`, "have them log
in, then re-run"). Add a note to both that they are historical and must not be re-run after 066.

Finally: `migrations/059_portal_form_baseline.sql` is generated from `Fast_Form` and has never held
TeamMember, so a database stood up from 059 alone now has **no login**. Document 066 as part of the
stand-up sequence next to 059.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit && npm test
git commit -m "docs(auth): record what the TeamMember split does and does not change"
```
