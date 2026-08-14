# UAT mode — per-session environment switch with a per-form flag

**Date:** 2026-08-14
**Status:** Approved design, not yet implemented
**Builds on:** `docs/superpowers/specs/2026-08-13-portal-form-db-split-design.md`

## Problem

`Rocks_Portal_Form` and `Rocks_Portal_Form_UAT` exist and hold identical schemas,
but the only way to reach the UAT database is to run a second deployment with a
different `MSSQL_FORM_DATABASE`. That is fine for a developer and useless for a
tester.

What is wanted: a form under development should be usable by a named set of
testers, with their data landing in the UAT database, while everyone else keeps
using the live forms — from the same application.

## Decisions

| Question | Decision |
|----------|----------|
| Where does UAT data go | `Rocks_Portal_Form_UAT`, for real — not a hidden flag over one database |
| How a user enters UAT | A mode switch in the navbar, modelled on the brand switcher. The mode is per-session, not per-form |
| What UAT mode shows | Every form, so live forms can be regression-tested against test data |
| What Production mode shows | Only forms flagged `Production` |
| Who may switch | A per-user allowlist, plus any IT Admin or System Admin |
| Which forms carry the flag | `AccFormMaster` only (AP-1, AP-15, AP-17) |
| Email and file side effects | Killed in UAT mode — included in this spec, not deferred |

### Why the mode is per-session and not per-form

Routing per form is what was asked for first, and it cannot be built safely.
`getFormPool()` and its alias `getAccPool()` are called from **134 places across
54 files**, always with no arguments. Per-form routing means threading form
identity through every one of them, and a single missed call site writes test
data into the live database with no error to reveal it.

It also has a circular dependency. Opening `/request/accounting/requests/123`
requires choosing a database before the form code is known, but the form code
lives in the row that choosing a database would let you read.

A per-session mode has neither problem. The environment is decided once per
request from a cookie, exactly as the existing `rocks-fast-brand` cookie already
scopes brand context, and `getFormPool()` keeps its signature.

## Architecture

### Environment resolution

```ts
// src/lib/db/mssql.ts
export async function getFormPool(): Promise<sql.ConnectionPool> {
  const e = await resolveFormEnvironment();
  return getNamedPool(
    e === "UAT" ? env.MSSQL_FORM_UAT_DATABASE : env.MSSQL_FORM_DATABASE,
  );
}
```

`resolveFormEnvironment()` lives in a new `src/lib/form-environment.ts`, is
memoized per request with React `cache()`, and returns `"Production"` unless
**all** of the following hold:

1. There is a request context. Outside one — scripts, the queue drainer invoked
   from a background job, `apply-sql` — `cookies()` throws; catch it and return
   `"Production"`.
2. The `form-portal-env` cookie reads exactly `UAT`. The cookie is session-only
   — no `max-age`, so closing the browser returns the user to Production —
   `Path=/`, `SameSite=Lax`, `HttpOnly` off so the switcher can read it for
   display. Any other value, including absent, means Production.
3. `auth()` returns a session.
4. That session's user is an IT Admin, a System Admin, or matches an active
   `UatTester` row. Matching is on email, case-insensitively, the same rule
   `isAccApprover` already uses (`LOWER(Email) = LOWER(@email)`). `StaffId` is
   stored for display and for joining to HR, never for the access decision —
   a TeamMember row may have no StaffId.

Condition 4 is not optional. The cookie is user-controlled, so without a
server-side re-check any signed-in user could set `form-portal-env=UAT` and
operate against the UAT database. The check reads `Fast_Core`, which never
changes with the mode, so it cannot recurse.

`getCorePool()`, `getDataPool()` and `getHrPool()` are unchanged. People,
permissions, configuration, HR and ERP lookups stay on production data in both
modes, which is what makes UAT approvals resolve to real manager chains and
therefore what makes the kill switch below necessary.

### New environment variable

`MSSQL_FORM_UAT_DATABASE`, defaulting to `Rocks_Portal_Form_UAT`.

## New tables in `Fast_Core`

Both must live in `Fast_Core` rather than the form database: they have to be
readable *before* the environment is known, and putting them behind the very
decision they inform is the circular dependency described above.

```sql
CREATE TABLE [dbo].[FormEnvironment] (
  [FormCode]    NVARCHAR(20)  NOT NULL PRIMARY KEY,
  [Environment] NVARCHAR(20)  NOT NULL CONSTRAINT [CK_FormEnvironment_Env]
                  CHECK ([Environment] IN ('Production','UAT')),
  [UpdatedBy]   INT           NULL,
  [UpdatedAt]   DATETIME2(7)  NOT NULL DEFAULT (SYSDATETIME())
);

CREATE TABLE [dbo].[UatTester] (
  [Id]          INT IDENTITY(1,1) PRIMARY KEY,
  [StaffId]     INT           NULL,
  [Email]       NVARCHAR(200) NOT NULL,
  [DisplayName] NVARCHAR(200) NULL,
  [IsActive]    BIT           NOT NULL DEFAULT (1),
  [CreatedBy]   INT           NULL,
  [CreatedAt]   DATETIME2(7)  NOT NULL DEFAULT (SYSDATETIME()),
  [UpdatedAt]   DATETIME2(7)  NOT NULL DEFAULT (SYSDATETIME())
);
CREATE UNIQUE INDEX [UX_UatTester_Email] ON [dbo].[UatTester] ([Email]);
```

`UatTester` deliberately mirrors `AccSameDayBrandStaff`, whose list / upsert /
delete service functions at `src/lib/acc/settings-service.ts:189-232` are the
template to copy.

A form with no `FormEnvironment` row is treated as `Production`, so existing
forms keep working the moment the table is created and before anything is
configured.

## Visibility rules

| Mode | Forms listed | Reads and writes |
|------|--------------|------------------|
| Production | `FormEnvironment.Environment = 'Production'`, or no row | `Rocks_Portal_Form` |
| UAT | all forms in `AccFormMaster` | `Rocks_Portal_Form_UAT` |

Because UAT mode lists everything, the flag is only ever consulted in Production
mode. Nothing has to be kept in sync between the two databases.

Two consequences follow automatically and are intended:

- `/my-request` and `/my-work` in UAT mode show only UAT requests. The user's
  real requests are in the other database and are not visible until they switch
  back. The navbar badge below is what stops this reading as data loss.
- `AccSetting.ERP_INTERFACE_ENV` is already `Sandbox` in the UAT database and
  `Production` in the live one, so switching mode also switches the Business
  Central target with no extra work.

## UI

Three additions, each modelled on something already in the codebase.

- **Mode switch in the navbar** — follows `BrandSwitcher`. Rendered only for
  users who pass the allowlist or admin check; absent entirely for everyone
  else.
- **Persistent UAT badge** — follows `src/components/layout/ErpEnvironmentNavBadge.tsx`.
  Visible on every page while the mode is UAT. It must be unmissable: a user who
  forgets they are in UAT and files a real expense claim has lost that claim.
- **`/settings/form-environment`** (IT Admin, System Admin) — a table of
  `AccFormMaster` forms with a Production/UAT toggle each, plus the tester
  allowlist with add, deactivate and remove. Reached from the Settings hub, so
  `REQUEST_CARDS` in `src/lib/constants.ts` gains one entry.

The settings page reads and writes `Fast_Core`, so an admin can edit it from
either mode and see the same values.

## Killing UAT side effects

Separating the database isolates rows. It does not isolate anything that leaves
the system, and the previous spec deferred that on the grounds that UAT was a
developer-only deployment. That is no longer true: this feature puts UAT in
front of multiple testers on the live host, and approval chains still resolve
against production `Rocks_Portal_HR`. A tester submitting a fake AP-17 would
email a real manager asking them to approve it.

Both side effects have a single choke point.

**Email** — `processQueue` in `src/lib/acc/email-queue.ts` is the only place
`sendEmail` is called for Accounting. In UAT mode:

- every recipient is replaced with a single configured address,
  `UAT_MAIL_REDIRECT` (falls back to `GRAPH_MAIL_FROM` when unset);
- the subject is prefixed `[UAT]`;
- the body gains a header line naming the address the mail would have gone to,
  so a tester can still confirm routing was correct.

The same treatment applies to `src/features/forms/email-queue.ts` for Form
Builder mail.

**Files** — `buildAccFolderPath` in `src/lib/acc/sharepoint-path.ts` is the only
place the SharePoint folder is assembled. It gains an optional `environment`
option; when `"UAT"`, a `_UAT` segment is inserted directly after the configured
base folder, so test attachments never mix with real ones. Its two callers, the
AP-1 and AP-17 file routes, pass the resolved environment.

## Failure modes

| Situation | Behaviour |
|-----------|-----------|
| No request context (script, cron, `apply-sql`) | Production. Chosen because the safe failure is reading live data, never writing test data into it |
| Forged `form-portal-env=UAT` cookie by a non-tester | Production. Condition 4 rejects it |
| A tester is removed from `UatTester` while holding a UAT cookie | Next request resolves to Production. Their UAT rows remain in the UAT database, unreachable until they are re-added |
| `Rocks_Portal_Form_UAT` unreachable | The request fails with a connection error. It does not silently fall back to Production, which would write test data into the live database |
| Queue rows written in UAT mode, drained without a request context | They stay queued. The drainer resolves to Production and never sees them. Acceptable: the queue is drained after each action inside the request that created it |

## Out of scope

- A flag on Form Builder forms. `OfficeForms.Status` (Draft / Published) already
  stages those, and a second overlapping mechanism would need a precedence rule
  nobody would remember. Form Builder data still splits by mode, because the
  tables live in the same database.
- Copying data between the two databases in either direction.
- Any change to `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` or `Rocks_Codex`
  content — they stay shared and production in both modes.
- Automatic promotion of a form from UAT to Production on any schedule. The
  toggle is manual.
