# Per-form environment — route each form to Production or UAT

**Date:** 2026-08-14
**Status:** Approved design, not yet implemented
**Supersedes:** `docs/superpowers/specs/2026-08-14-uat-mode-design.md`
**Builds on:** `docs/superpowers/specs/2026-08-13-portal-form-db-split-design.md`

## Problem

`Rocks_Portal_Form` and `Rocks_Portal_Form_UAT` hold identical schemas but the
UAT database is only reachable by running a second deployment.

What is wanted: a System Admin marks an individual form as UAT. That form's data
goes to `Rocks_Portal_Form_UAT`. Every other form keeps running against
production, on the same server, at the same time, with no mode to switch and
nothing for ordinary users to notice.

## Decisions

| Question | Decision |
|----------|----------|
| Granularity | Per form. No session mode switch |
| Where UAT data goes | `Rocks_Portal_Form_UAT` |
| Which forms carry the flag | `AccFormMaster` — AP-1, AP-15, AP-17 |
| Who configures it | System Admin only |
| Where it works | The deployed server, not only localhost |
| Shared master data | Written to both databases in one transaction |
| Form Builder | Always Production. `OfficeForms.Status` already stages those |

### Recorded risk

A per-session switch was proposed first and rejected in favour of this. The
trade is deliberate and worth stating plainly: routing per form means the
database is chosen from the URL, so a route that is classified wrongly — or a
route added later and never classified — reads or writes the wrong database
silently, with no error. The route table in this spec is therefore load-bearing,
and §7 exists to catch drift.

## 1. Route classification

Routing is by longest-prefix match on the request path, evaluated top to bottom.
Order matters: **AP-17's admin pages live underneath AP-1's path prefix**, so a
naive `/request/accounting/*` rule sends four of them to the wrong database.

| # | Path prefix | Resolves to |
|---|-------------|-------------|
| 1 | `/request/accounting/travel-booking` (and `-report`, `-settings`, `/queue`) | AP-17 |
| 2 | `/api/request/travel-booking/`, `/request/travel-booking/` | AP-17 |
| 3 | `/api/request/accounting/settings/` | Production read, dual write (§3) |
| 4 | the aggregate endpoints listed in §4 | both databases (§4) |
| 5 | `/api/request/accounting/`, `/request/travel-expense/` | AP-1 |
| 6 | `/api/forms/`, `/forms/` | Production, always |
| 7 | anything else | Production |

AP-15 has no routes yet. When its pages are added they join the table at the
same level as AP-1 and AP-17.

## 2. Resolution mechanism

No route handler changes. `getFormPool()` and `getAccPool()` keep their
signatures, so none of their 134 call sites are touched.

A new `src/middleware.ts` copies the request path into an `x-pathname` header.
Middleware runs on the Edge runtime and cannot query SQL, so it does nothing
else — all decisions happen in Node:

```ts
// src/lib/form-environment.ts
export const resolveFormEnvironment = cache(async (): Promise<FormEnvironment> => {
  const path = (await headers()).get("x-pathname");   // throws outside a request
  const formCode = classifyPath(path);                // §1, pure function
  if (!formCode) return "Production";
  return getFormEnvironment(formCode);                // Fast_Core, cached per request
});
```

```ts
// src/lib/db/mssql.ts
export async function getFormPool(): Promise<sql.ConnectionPool> {
  const e = await resolveFormEnvironment();
  return getNamedPool(
    e === "UAT" ? env.MSSQL_FORM_UAT_DATABASE : env.MSSQL_FORM_DATABASE,
  );
}
```

Outside a request — scripts, `apply-sql`, a background drain — `headers()`
throws; catch it and return `"Production"`.

`getCorePool()`, `getDataPool()` and `getHrPool()` never vary. People,
permissions, HR and ERP lookups stay on production data for every form, which is
why §6 is required.

New environment variable: `MSSQL_FORM_UAT_DATABASE`, default
`Rocks_Portal_Form_UAT`.

## 3. Shared master data: dual write

19 of the 43 tables are configuration shared by every form — `AccApprover`,
`AccVehicle`, `AccFormBrand`, `AccTravelReason`, the six `AccBrand*` tables and
the rest. They currently hold identical rows in both databases because both were
seeded from the same source.

Under per-form routing AP-1 would read the production copy and AP-17 the UAT
copy, and the two would diverge the first time an admin edits anything: adding
an approver through the settings page would land in one database only, and AP-17
approvals would then fail for a person AP-1 can see.

Every mutation through `/api/request/accounting/settings/*` therefore writes to
both databases. Reads come from production.

A new `writeBothPools(fn)` helper in `src/lib/acc/dual-write.ts` opens a
transaction on each pool, runs the caller's statements against both, and commits
only if both succeed. If either fails, both roll back and the route returns an
error — a half-applied setting is worse than a rejected one.

Identity values must stay aligned across the two copies, so the helper inserts
into the UAT database with `SET IDENTITY_INSERT ON`, using the id production
assigned. This is why the master tables are excluded from the identity reseed in
§5.

## 4. Aggregate endpoints

Five endpoints return rows spanning both forms and so must query both pools and
merge:

- `/api/request/accounting/requests/mine`
- `/api/request/accounting/work`
- `/api/request/accounting/report` and `/report/export`
- `/api/request/accounting/erp-prep` (and `/[id]`, `/send`)
- `/api/request/accounting/requesters`

Each already returns AP-1 and AP-17 rows together — `MyRequestsPanel.tsx:184-185`
dispatches per row to the travel-booking or accounting detail route based on the
row's form — so the client needs no change beyond the badge in §5.

These endpoints call a new `queryBothPools(sql, params)` helper that runs the
same statement against both databases and concatenates the recordsets, tagging
each row with the environment it came from. Sorting and paging happen after the
merge, in JavaScript, because neither database can see the other's rows.

Endpoints in this list opt in explicitly. They are the only places in the
codebase that talk to two databases in one request.

## 5. Identity seeding so ids never collide

Merged lists and id-keyed URLs both need ids to be unambiguous across
databases.

Reseed the **23 transactional tables** in `Rocks_Portal_Form_UAT` to 900000:

```sql
DBCC CHECKIDENT ('dbo.AccRequest', RESEED, 900000);
```

New UAT rows then start at 900001 while production stays in the low thousands,
so an id in a URL identifies its database on sight, and a merged list can never
show two rows with the same id.

The **19 master tables are deliberately not reseeded** — §3 keeps their ids
aligned by inserting the production id into UAT explicitly.

A UAT row's running number already differs too: `AccSequence` in the UAT database
starts at 9000, so its requests read `TOF26-9001` rather than `TOF26-0047`.

Rows sourced from the UAT database carry an `environment: "UAT"` field through
the API, and the UI renders a `UAT` pill next to their running number wherever
requests are listed or opened.

## 6. Killing UAT side effects

Separating rows does not separate anything that leaves the system. Approval
chains resolve against production `Rocks_Portal_HR` in both environments, so a
tester submitting a UAT request would email a real manager asking them to
approve something fake. This is not deferrable now that UAT runs on the live
server.

Both side effects have a single choke point.

**Email** — `processQueue` in `src/lib/acc/email-queue.ts` is the only caller of
`sendEmail` for Accounting. When the resolved environment is UAT:

- every recipient is replaced with `UAT_MAIL_REDIRECT` (falling back to
  `GRAPH_MAIL_FROM` when unset);
- the subject gains a `[UAT]` prefix;
- the body gains a header line naming the address the mail would have reached,
  so routing can still be verified.

**Files** — `buildAccFolderPath` in `src/lib/acc/sharepoint-path.ts` is the only
place the SharePoint folder is assembled. It gains an `environment` option;
when `"UAT"` a `_UAT` segment is inserted directly after the configured base
folder. Its two callers, the AP-1 and AP-17 file routes, pass the resolved
environment.

## 7. The settings page

`/settings/form-environment`, **System Admin only** — stricter than the rest of
the Settings hub, which admits IT Admin too. `REQUEST_CARDS` in
`src/lib/constants.ts` gains one entry, gated on System Admin.

The page lists every `AccFormMaster` form with a Production/UAT toggle, showing
for each: current environment, live request count in each database, and when it
was last switched and by whom.

Switching a form to UAT does not move existing rows. Requests already filed in
production stay there and stay reachable; the form simply starts writing
elsewhere. Switching back leaves the UAT rows behind, still visible in merged
lists with their `UAT` pill. The page states this next to the toggle, because it
is the one behaviour most likely to surprise.

The page also renders a **route coverage check**: the classification table from
§1 applied to every route file found under `src/app/api/request/`, listing any
route that falls through to rule 7. A new route added without being classified
shows up here as unclassified rather than silently reading production. This is
the guard against the risk recorded at the top of this spec.

Configuration lives in one new table in `Fast_Core`, which never varies by
environment:

```sql
CREATE TABLE [dbo].[FormEnvironment] (
  [FormCode]    NVARCHAR(20)  NOT NULL PRIMARY KEY,
  [Environment] NVARCHAR(20)  NOT NULL CONSTRAINT [CK_FormEnvironment_Env]
                  CHECK ([Environment] IN ('Production','UAT')),
  [UpdatedBy]   INT           NULL,
  [UpdatedAt]   DATETIME2(7)  NOT NULL DEFAULT (SYSDATETIME())
);
```

A form with no row is Production, so nothing changes until something is
configured.

No tester allowlist is needed: a UAT form is UAT for everyone, which is the
point of this design.

## 8. Running UAT on the server

`ERP_SANDBOX_ALLOWED_HOSTS` in `src/lib/acc/erp-environment-shared.ts` restricts
the ERP UAT toggle and the `devHostOnly` management cards to `localhost:3020`.
That gate governs the Business Central target, not this feature, and it is left
alone: a UAT form reaching production Business Central would post real journal
entries.

Instead, a form resolved to UAT forces its Business Central environment to
Sandbox regardless of host, because `AccSetting.ERP_INTERFACE_ENV` is already
`Sandbox` in the UAT database and `Production` in the live one. Reading that
setting through the form's own pool gives the right answer with no new gate.

## Failure modes

| Situation | Behaviour |
|-----------|-----------|
| Route not in the §1 table | Production. Surfaced by the coverage check in §7 |
| No request context (script, cron, `apply-sql`) | Production |
| `Rocks_Portal_Form_UAT` unreachable | The request fails. No fallback to production, which would write test data into live rows |
| Aggregate endpoint when one database is down | Fails rather than silently returning half the rows |
| Dual write where one database rejects the statement | Both roll back; the route returns an error |
| Form switched UAT → Production with UAT rows already filed | Those rows stay in UAT and stay visible in merged lists, tagged `UAT` |

## Out of scope

- Moving existing rows between databases in either direction.
- A flag on Form Builder forms; `OfficeForms.Status` already stages those.
- Changing `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` or `Rocks_Codex` content.
- Relaxing `ERP_SANDBOX_ALLOWED_HOSTS` (§8).
- Automatic promotion of a form from UAT to Production.
