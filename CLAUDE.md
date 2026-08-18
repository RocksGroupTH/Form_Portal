# Form Portal — Developer Guide

> Internal request/forms portal for Rocks Group. Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MSSQL.
> Cloned from the **Rocks Fast** codebase with Fast Intelligence and Locations removed — see "Shared with Rocks Fast" below before running this alongside that app.

## Quick Start

```bash
npm install
cp .env.example .env.local   # Fill in credentials
npm run dev                   # http://localhost:3020
```

## Architecture

### 3-Database Architecture

| Database | Pool | Purpose |
|----------|------|---------|
| **Fast_Core** | `getCorePool()` | Config, brand/DB/BC connection settings, `FormEnvironment`, `UatTester`. **No longer identity** — see "Auth" |
| **Rocks_Portal_Form** | `getFormPool()` | Form definitions, submissions, approvals, files, logs, and all `Acc*` Accounting tables. Form Portal's own database — `Rocks_Portal_Form_UAT` is the UAT twin, and which one `getFormPool()` returns depends on the form **and on who is asking** (see "Parallel Production and UAT") |
| **Rocks_Portal_Form** (`TeamMember`) | `getProductionFormPool()` via `@/lib/team-member/service` | User identity and roles (migration 066). **Production only** — never the UAT twin, and never `getFormPool()`; see "Auth" |
| **Fast_Data** | `getDataPool()` | Used by Accounting and ERP sync — department maps, travel-booking province lookups, ERP account/dimension sync (`src/lib/acc/department-map-service.ts`, `src/lib/acc/travel-booking/province-service.ts`, `src/lib/acc/travel-booking/request-service.ts`, `src/lib/erp/account-sync.ts`, `src/lib/erp/dimension-sync.ts`). **Not** a BI/reporting database in this app. |
| **Rocks_Portal_HR** | `getHrPool()` → `getAppPool("Rocks_Portal_HR")` | Employee master, manager chain, per-diem allowance history — cross-referenced by StaffId/email |
| **Rocks_Codex** | (cross-DB query, e.g. `[Rocks_Codex].[dbo].[Holiday]`, `[Rocks_Codex].[dbo].[Brand]`) | Holiday calendar, company brand master |
| **Rocks_Portal_Form** (Acc* tables) | `getAccPool()` → `getFormPool()` | Accounting forms: travel expense (AP-1), travel booking (AP-17) |

**IMPORTANT**: Use `new sql.ConnectionPool(config).connect()` for isolated pools. Never use `sql.connect()` (global singleton — causes cross-DB bugs). Pool max is set to 30.

### Parallel Production and UAT

Production and UAT run **side by side in one deployment**. There is no app-wide UAT mode, no separate host, and no build flag. Ordinary users work against `Rocks_Portal_Form` while configured testers work against `Rocks_Portal_Form_UAT` — at the same time, on the same server.

**Two switches, one tester list, and a per-viewer toggle:**

- **Each form has two independent switches** — `ProductionEnabled` and `UatEnabled` in `Fast_Core.dbo.FormEnvironment` (`FormCode`, `ProductionEnabled`, `UatEnabled`, `UpdatedBy`, `UpdatedAt`), set at **Settings → Form Environment** (`/settings/form-environment`, System Admin). **Both can be on at once** — that is the normal pilot state. UAT-only hides the form from everyone who is not testing it; both off closes it to new work entirely. A form with no row is `PRODUCTION_ONLY` (live, not open for testing). Read through `src/lib/form-environment/service.ts` (`getFormSwitchMap`, `setFormFlag`, `listFormEnvironments`). It lives in Fast_Core on purpose: resolving the switches must not depend on which form database is selected. *(The old single `Environment` string column was dropped by migration 065.)*
- **UAT is visible only to configured testers.** `Fast_Core.dbo.UatTester` (migration 063) holds the list, managed at **Settings → UAT Users** (`/settings/uat-users`, System Admin, API `/api/settings/uat-users`). Each tester carries a UAT `ManagerStaffId`, which must itself be an active tester — a chain cannot leak out of the test group. **A tester may be their own manager**, deliberately: that is how one person rehearses the whole submit-to-approve loop, and a UAT approval only ever approves test data. Removing a tester is a soft delete (`IsActive = 0`). Service: `src/lib/uat-tester/service.ts`.
- **A tester must also turn their own UAT mode on** with the **PRO/UAT switch** in the navbar (`src/components/layout/UatModeSwitch.tsx`), which renders only when they are already in UAT mode, or are an active tester *and* at least one form has `UatEnabled`. It POSTs `/api/uat-mode` — the only writer of the `form-portal-uat-mode` cookie (`src/lib/uat-mode.ts`), httpOnly, and 403 for anyone who is not an active tester.

**Resolution order** (`src/lib/form-environment/`), in this order:

1. **The record's id wins.** UAT transactional identities start at 900000 (`isUatId`, `uat-identity.ts`), so a bare id names its own database — that is what lets a non-tester manager open and approve a tester's UAT request. Bounded by `boundIdEnvironment`: a **UAT** id is honoured only while the form still has `UatEnabled`, or the viewer is a tester in UAT mode, so switching UAT off actually closes it. A **Production** id is never bounded.
2. **The viewer's UAT mode** — cookie **and** live `getActiveUatTester()` membership, re-checked on every resolve (`viewerIsTesting`). The cookie alone is a forgeable hint.
3. **The form's switches** — `pickEnvironment` picks the one switch that answers for this viewer.

Who is asking comes from the proxy's `x-pathname` and `x-user-email` headers, **never `auth()`** — `getFormPool()` imports `src/lib/form-environment`, so a session lookup would close the loop `getFormPool → auth → jwt → getFormPool`. Code with no request scope (scripts, background work) resolves to Production.

Since migration 066 that is a hard constraint, not a preference: `auth()` no longer reads Fast_Core, it reads `TeamMember` in the form database. Everything on the path that decides *which* form database answers must therefore come from a pool this resolver does not pick — `getFormSwitchMap()` and `getActiveUatTester()` from `getCorePool()`, identity from `getProductionFormPool()`. **`FormEnvironment` and `UatTester` must stay in Fast_Core**, and `@/lib/team-member/service` must never reach for `getFormPool()`.

- **Availability and writability are different questions.** `pickEnvironment().available` asks "may this person reach the form", and an id makes it unconditionally true so records stay readable and approvable. `environmentWritable` asks "is that database still taking new work". Use `resolveCurrentFormAccess()` + `resolveCurrentFormWritable()` on a form's own route, and `resolveFormAccess(formCode, requestId?)` + `resolveFormWritable(...)` to ask about a form from somewhere else (Home, the manager card). **`assertFormWritable()` (`src/lib/uat-tester/guards.ts`) has exactly four call sites** — the two `saveDraft` functions and the two submits, one pair per form.
- **The manager differs by environment.** UAT routes to the requester's `UatTester.ManagerStaffId`, re-verified at submit time (still an active tester, still active in HR — self is allowed); Production reads `Rocks_Portal_HR.Employee.ManagerStaffId`. **UAT refuses rather than falling back to HR** — a real manager must never find test data in their queue. Three resolvers, keyed on the *resolved environment* and never on the cookie: `resolveManagerInfo()` (the preview card, shared), and a separate `withUatManager` for each form's submit — `resolveRequesterForActor` in `src/lib/acc/employee-context.ts` (AP-1) and `resolveEmployeeForActor` in `src/lib/hr/employee-lookup.ts` (AP-17). `resolveManagerEmail()` is deliberately *not* overridden.
- **Mail follows the resolved environment**, with one exception: a recipient who is an **active tester gets the mail at their real address** with a `[UAT] ` subject prefix. Everyone else is redirected to `UAT_MAIL_REDIRECT` (falling back to `GRAPH_MAIL_FROM`) with a banner naming the intended recipient. If neither is set, `applyUatRedirect` (`src/lib/acc/email-queue.ts`) throws and the row stays queued rather than mailing a real person. The sweep endpoint drains both databases (`processQueueBoth`); per-action drains are single-pool.
- **Business Central follows the same resolution**: `resolveEffectiveErpEnvironment()` (`src/lib/acc/erp-environment.ts`) maps UAT → Sandbox, otherwise Production. No separate ERP toggle — the navbar chip and the global `AppSetting` switch were removed on 2026-08-17. Which BC company and connection Sandbox uses is set at Settings → ERP Interface Environment. **The send echoes and verifies both its environment and its batch**, answering 409 on either drift (`ENVIRONMENT_STALE_ERROR` in the route, `ErpQueueDriftError` from `src/lib/acc/erp-interface-send.ts`) so the client reloads instead of retrying something that cannot succeed.
- **ERP Prep is classified `AP-1`, not `BOTH`**: it is the only path that posts to BC, and the send reads its rows from a single pool. While AP-1 resolves UAT for you, the prep queue you see is the UAT queue.
- **Process-global caches are environment-keyed.** `src/lib/acc/acc-cache.ts` is a shared `Map`; anything derived from a form-pool read must carry the environment in its key — `acc:journal-ctx:{Production|Sandbox}` (`erp-journal-context.ts`) and `acc:prep-dept-ctx:{Production|UAT}` (`erp-prep-service.ts`). Request-scoped react `cache()` memos are not global and are unkeyed by design.
- **The running number floor is a function of the environment.** `UAT_SEQUENCE_FLOOR = 9000` in `src/lib/acc/sequence.ts`: UAT's first number of a year is `09001`, Production's `00001`. Applied only when a `(Prefix, Year)` row is first created, so it never rewinds. The two series stay disjoint only while Production issues ≤ 9000 numbers per prefix per year.
- **Ids never collide**: migration 061 seeds UAT transactional identities at 900000 across 23 transactional tables, and **migration 064 adds a `CHECK (Id >= 900000)`** so a restore or an ad-hoc reseed cannot silently break the property the id rule depends on.
- **Attachments** land under `{SHAREPOINT_ACC_FOLDER}/_UAT/{formCode}/...` — the `_UAT` segment sits between the base folder and the form code (`buildAccFolderPath`, `src/lib/acc/sharepoint-path.ts`).
- **Every new route under `/api/request` needs a rule** in `ROUTE_RULES` (`classify-path.ts`, longest matching prefix → `AP-1 | AP-15 | AP-17 | "BOTH" | null`). Without one it silently falls through to Production. The coverage panel on the settings page lists any route no rule covers — `matchRule` is what tells "no rule at all" apart from "a rule that deliberately says Production".
- **Shared configuration is dual-written**, not duplicated by hand: `src/lib/acc/dual-write.ts` runs each master-table mutation against both databases in a transaction, and `npm run check:alignment` asserts the 19 shared tables still match. Those tables are deliberately absent from 061/064 — dual-write inserts production's id into UAT explicitly, so an identity floor there would reject every write.
- **Only two endpoints merge both databases** through `src/lib/acc/query-both.ts`: `/api/request/accounting/requests/mine` and `/api/request/accounting/work` — what a person owns or must act on. Sorting and paging happen after the merge, each row carries an `environment` tag, and `keepRowsInCurrentEnvironment` (`current-rows.ts`) then drops rows whose database is not where that form resolves for this viewer today. Nothing is deleted; flipping the switch back brings the rows straight back. **Reports do not merge** — a report is a statement about one set of books, so `/api/request/accounting/report` and its Excel export read one database only.
- **Switching a form does not move its existing requests.** They stay in the database they were written to and stay readable; only new writes go elsewhere.

### Auth

- Microsoft Entra ID (Azure AD) via NextAuth 5
- Session: `{ user: { id, name, email, role, nickname, color, photo } }` — no `hasIntel` flag (Intelligence is gone)
- Roles: `Staff | IT Admin | System Admin | Viewer`
- TeamMember lookup from **`Rocks_Portal_Form.dbo.TeamMember`** (migration 066), never Fast_Core; a missing row is provisioned at login (`provisionTeamMember`) so drafts stay owned by their creator
- Profile photo fetched via client credentials (`getADUserPhoto`) instead of delegated token
- Role hierarchy: System Admin > IT Admin > Staff/Viewer
- **The jwt callback caches the row for 60s** (`src/lib/auth.ts`). `/api/settings/users` clears that cache after `updateRole`, `addUser` and `deleteUser`, so a role change takes effect on the next request instead of a minute later. It is an in-process Map — it invalidates nothing on a second instance.
- **A row that is retired, or missing, downgrades the token to role `Staff`.** Not a logout — `requireAuth()` only needs the email — and the next successful read restores role, id, nickname, colour and photo.
- **`userId` is cleared only for a *retired* row**, where the roster positively says the person has gone. A *missing* row keeps it and logs `[Auth] no TeamMember row for …` (throttled to once a minute per email). The asymmetry is deliberate: `findTeamMemberByEmail` swallows database errors and returns null, so "missing" means *either* the row is gone *or* the form database could not be read. `userId` authorises nothing — it only selects and stamps the caller's own rows — whereas blanking it during an outage writes `Number("") === 0` into `OfficeFormSubmissions.SubmittedBy` (`int NOT NULL`, no FK) and `CreatedBy = NULL` into `AccRequest`, rows their owner can never see again. The role downgrade *does* cost access while it lasts, including the Fast_Core-backed settings pages that stay up when the form database is down; that is accepted over carrying an unconfirmed grant for the token's 30-day life.

#### TeamMember lives in Form Portal's own database

Migration 066 copied all 17 rows out of `Fast_Core.dbo.TeamMember` — ids preserved — into `Rocks_Portal_Form.dbo.TeamMember`, and left Fast_Core's copy untouched and in service for Rocks Fast. Every read and write goes through **`src/lib/team-member/service.ts`**, the single access point; no SQL elsewhere names the table. It uses `getProductionFormPool()`, never `getFormPool()` — identity must not vary with the route's environment, and 066 is deliberately **not** applied to `Rocks_Portal_Form_UAT`.

**What this bought, and what it did not:**

- ✅ **Identity and roles are no longer shared with Rocks Fast.** A role change here no longer lands in that app, and vice versa.
- ❌ **It did not remove the Fast_Core dependency.** `getCorePool()` still has more than forty call sites across a dozen modules, and two of them cannot move: `getFormSwitchMap()` (`src/lib/form-environment/service.ts`) and `getActiveUatTester()` (`src/lib/uat-tester/service.ts`) resolve *which* form database answers, so they must read a database that resolver never picks — see "Parallel Production and UAT". The app still cannot serve a request without Fast_Core.

**The two rosters diverge from the cut onward. This was accepted, not solved:**

- Both apps provision at login independently (`provisionTeamMember` in each), so a new joiner gets an unrelated row in each database.
- Form Portal's new ids start at **100001** (066 reseeds the identity to 100000); Fast_Core carries on from **2009** (`IDENT_CURRENT` on its table is 2008). An id therefore says which app created the row, and the two ranges can never collide — but an id minted in one app matches nothing in the other. The 17 shared ids are **not** a contiguous block: they are spread across 1..2008 (1-6, 1006-1013, 2006-2008). There is no low-water mark that separates "copied from Fast_Core" from "minted here" — only being above 100000 tells you that.
- **Granting System Admin, or any role, has to be done in both apps.** `/settings/users` writes only `Rocks_Portal_Form`.
- Deactivating someone in one app leaves them active in the other. Same for a name resync.
- Anything that joins `[Fast_Core].[dbo].[TeamMember]` is now reading the other app's roster. Migrations `024` and `058` still do, and `001` creates and seeds that table outright, which is why `001`, `024` and `058` all carry a **do not re-run** header. `001` is the dangerous one: its first batch is nothing but `USE [Fast_Core];`, and `apply-sql.ts` splits on `GO` and runs every batch on one pool, so the `USE` carries into the later batches whenever the pool hands back the same connection and `--db` is quietly ignored. Its last batch seeds a **System Admin** row, a no-op today only because of an `IF NOT EXISTS` on one hard-coded email.
- **`ManagerId` is unmaintained here, and the split makes that permanent.** Nothing in this app writes it — `provision()` and `addOrReactivate()` both omit the column — and 066 copied exactly one populated row out of 17. Form Builder's `submitter_manager` step therefore resolves to null for the other 16 and for every future joiner, inserting an approval with `AssignedTo = NULL, Status = 'Pending'` and no email (`createApprovalRows`, `src/features/forms/workflow-engine.ts`; grep `[Workflow] Could not resolve assignee`). **This is not a regression** — the null path is byte-for-byte the pre-branch behaviour — but a DBA curating `ManagerId` by hand in Fast_Core no longer reaches this app at all. `managerIdOf()` (`src/lib/team-member/service.ts`) is the only reader, and it is reading a column only a migration has ever filled. AP-1 is unaffected: its manager comes from `Rocks_Portal_HR.Employee.ManagerStaffId`.

### Theme — Sky

- Palette: **Sky** — pastel cool-blue light theme (`light`) plus a dark counterpart (`dark`, formerly named `gold` in the Rocks Fast original)
- localStorage key: `form-portal-theme`
- Cookie: `form-portal-theme` (persists across sessions; read by the no-flash inline script in `src/app/layout.tsx`)
- Default: `light`
- CSS variables: `var(--bg-card)`, `var(--text-primary)`, etc. — see `src/app/globals.css` for the full token list (defined once under `:root, [data-theme="light"]` and again under `[data-theme="dark"]`)
- Shape and depth: card radius `--radius-card` (14px), tile radius `--radius-tile` (12px); `--shadow-card` rather than heavy borders; tinted icon tiles (`--nav-active-bg` background behind icons); the capsule nav uses Tailwind's `rounded-full`, not a token — `--radius-full` and `--shadow-lift` are defined in `globals.css` but nothing consumes them
- Semantic action tokens live in the `@theme` block, which is where Tailwind 4 sources `text-danger` / `text-warning` and friends: action `#4c74c4` / hover `#3d63b0`, success `#3d8560`, warning `#b5793a`, danger `#c25b5b`. They are single-valued across both themes on purpose — surfaces needing a per-theme value use `--btn-danger-bg`, `--text-danger`, `--status-*` or `--ring-*` instead
- No brand-mark gradient tokens: the navbar mark is `/brandlogo/rocks.png`, not a drawn letter
- Status pills: `--status-{pending,ok,draft,bad}-{bg,text}`
- The `.acc-theme` scope on Accounting pages (`src/app/globals.css`) was retuned from the original's rose accent to Sky; its non-colour rules (hidden scrollbars, suppressed number spinners, `overflow-x: clip`) are unchanged

## Shared with Rocks Fast

Form Portal was cloned from the Rocks Fast codebase and **still shares live infrastructure** with it. This is not a separate environment — treat both apps as one system when operating on shared resources:

- **Databases are no longer shared**: Form Portal owns `Rocks_Portal_Form` (plus `Rocks_Portal_Form_UAT`). `Fast_Form` belongs to Rocks Fast and this app must not read or write it. `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` and `Rocks_Codex` are still the same shared databases both apps use, in both environments.
- **Identity is no longer shared, but Fast_Core still is.** Migration 066 gave this app its own `TeamMember` in `Rocks_Portal_Form`; `Fast_Core.dbo.TeamMember` stays exactly as it is and stays in service for Rocks Fast. The two rosters now drift apart — see "TeamMember lives in Form Portal's own database" under Auth for what that costs. Fast_Core itself is still shared: `AppSetting`, brand configuration and the DB/BC connection rows are one set of rows both apps read and write, and `FormEnvironment` / `UatTester` are Form Portal's own tables that live there (Rocks Fast has no code for either). **A query in this app that names `[Fast_Core].[dbo].[TeamMember]` is a bug** — it is reading the sibling's user list.
- **Same SharePoint folder**: Accounting file attachments (`SHAREPOINT_ACC_SITE` / `SHAREPOINT_ACC_FOLDER`) point at the same document library Rocks Fast uses.
- **`AccEmailQueue` is no longer shared** — each app drains the queue in its own database.
- **⚠️ Both apps use port 3020** — Form Portal was moved off 3021 onto the same port Rocks Fast uses, so only one of them can run at a time on a given machine; the second to start fails with `EADDRINUSE`. This also removes the previous risk of both apps polling/draining the same `AccEmailQueue` concurrently and sending approval/payment emails twice.
- **`UPLOAD_ROOT`** — local attachment storage env var. Points at the sibling Rocks Fast repo's `uploads/forms` directory (`c:/Users/PC/source/repos/Web/RocksFast/uploads/forms` in dev) so files already recorded in the shared DB stay downloadable from either app. Accounting attachments primarily use SharePoint now; local disk serves the Form Builder and older Accounting rows created before SharePoint storage existed. See `src/lib/storage.ts`.
- **`ERP_SANDBOX_ALLOWED_HOSTS`** (`src/lib/acc/erp-environment-shared.ts`) — host-and-port matched allowlist (`["localhost:3020", "127.0.0.1:3020"]`) gating two things: the `devHostOnly` management/settings cards in `REQUEST_CARDS` (`src/lib/constants.ts`) and the manager-approval dev bypass in `src/lib/acc/manager-auth.ts` (`isManagerDevBypassHost`). If this app's port ever changes, this list must be updated or both gates silently disappear.
- **`src/lib/brand-config.ts` is deliberately frozen** — it still contains Dashboard-DB helper fields (`dashboardDbConnectionId`, `dashboardDatabaseName`) with no callers in this app; the Rocks Fast sibling reads them for its Intelligence dashboards. The Brand Configuration settings page hides those fields in the UI but still round-trips their values on save, so Rocks Fast keeps working. **Do not "clean up" these fields** — they are load-bearing for the sibling app even though nothing in Form Portal consumes them.

## Navigation

Top bar and mobile tabs: **Home** · **My Requests** · **My Work** · **Settings** (Settings for IT Admin/System Admin only). Labels are English; in-page copy is Thai.

Only the middle two live in `NAV` (`src/lib/constants.ts`). Home and Settings are composed onto either side of it in `Navbar.tsx`'s `visibleNav` — Home as a literal, Settings behind `canAdmin` — so **adding an entry to `NAV` puts it between them**, not at the end.

- **`Home`** (`/`) — a form catalogue: greeting and stat strip, search, "Continue where you left off" (resumable drafts and Returned requests), then the **Accounting** forms — AP-1 travel expense and AP-17 travel booking, filtered to the ones available to this viewer. It is a link surface only: it creates no API of its own beyond reading `/api/form-environment` for availability, and it does not merge the two request systems (Office Forms and Accounting remain separate data models). `src/features/home/HomeCatalogue.tsx`.
- **`My Requests`** (`/my-request`) — requests you submitted and their status, across both Office Forms and Accounting.
- **`My Work`** (`/my-work`) — requests awaiting your approval or otherwise involving you.
- **`Settings`** (`/settings`, IT Admin+) — hub of `SETTINGS_CARDS`: Maps & Routing, Database Connections, Business Central, Brand Configuration, **ERP Interface Environment**, **Form Environment** (`/settings/form-environment`), **UAT Users** (`/settings/uat-users`), **Users & Roles** (`/settings/users`) — the bolded four are `systemAdminOnly` — and Accounting Admin, which points at `/request?group=Settings` rather than `/request/accounting`, because the AP-1 hub would leave out AP-17.

**There is no Forms tab, and no Form Builder section on Home.** The feature is unused, so its three entry points — the nav tab, the Manage Forms settings card, and Home's general-forms group — were deliberately removed. The pages under `/forms` and all 16 `/api/forms` routes still exist and still work if reached by URL; see the doc comment above `NAV`. Do not describe Form Builder as reachable from the navigation.

The navbar also carries the **PRO/UAT switch** (`src/components/layout/UatModeSwitch.tsx`) — see "Parallel Production and UAT" above for when it renders.

Every dashboard route is also gated by `BrandGate` (`src/components/BrandGate.tsx`), a non-dismissable modal that blocks rendering until the user picks a company brand (PCTH / KSI / PCMY / UNO — `src/lib/brand.ts`). This brand cookie (`rocks-fast-brand`) is unrelated to Intelligence (which is gone); it scopes ERP/Business Central context for Accounting.

## Features

### 1. Office Forms (`/forms`)

Configurable form builder with approval workflows.

> **Unused, and unreachable from the navigation** — see "Navigation" above. Every page and route below still exists and still works when opened by URL; none of them is linked from the nav, Home or the Settings hub. Treat this section as a description of dormant code, not of a live feature.

**Pages (8):**
- `/forms` — Catalog + My Submissions
- `/forms/[slug]` — Fill & submit form
- `/forms/submissions/[id]` — View submission + approval timeline
- `/forms/approvals` — Approver queue
- `/forms/admin` — Manage forms (IT Admin+)
- `/forms/admin/new` — Create form
- `/forms/admin/[formId]` — Drag-and-drop form builder
- `/forms/admin/[formId]/workflow` — Configure approval workflow

**API Routes (16):** `/api/forms/*`

**Key files:**
- `src/features/forms/workflow-engine.ts` — Sequential + parallel approval engine
- `src/features/forms/email-queue.ts` — Async email notification queue
- `src/features/forms/email-templates.ts` — HTML email templates (XSS-safe with `esc()`)
- `src/lib/graph.ts` — Microsoft Graph API (token cached with promise lock): `searchADUsers`, `getADUserByEmail`, `getADUserPhoto`, `sendEmail` (with attachments)
- `src/lib/storage.ts` — File storage abstraction (local backend, rooted at `UPLOAD_ROOT`)

**Field types:** text, textarea, number, date, select, radio, checkbox, file, route (Google Maps), section, info

**Approval flow:**
- Sequential: Step 1 → Step 2 → Step 3
- Parallel: Same StepOrder, different ParallelGroup → all must approve
- Actions: Approve, Reject, Return (request changes)
- Auto-approve conditions (JSON rules)
- Email notifications via Microsoft Graph API (queued, async)

### 2. Request → Accounting (`/request/accounting`)

Two live Accounting forms share a generic request/approval backbone, plus a Business Central ERP integration layer.

**Storage:** Acc* tables live in **`Rocks_Portal_Form`**, accessed via `getAccPool()` (= `getFormPool()`, `src/lib/acc/pool.ts`). Numbered migrations in `migrations/` (013 onward) built these up incrementally against the old `Fast_Form`; `059_portal_form_baseline.sql` is the generated full-schema baseline used to stand up a new database. Apply with `npm run apply-sql -- --db Rocks_Portal_Form --file <path>` (see `scripts/apply-sql.ts`). **Every migration names its own target database in its header — read that before running it.**

**Standing up a production form database takes 059 *and* 066.** 059 was generated from `Fast_Form`, which never held `TeamMember`, so a database built from 059 alone has no identity table. That does **not** lock everybody out, which is what makes it easy to miss: anyone with an active `Rocks_Portal_HR.Employee` row logs in **successfully**, downgraded to role `Staff` with a blank id — so `/settings/users` (System Admin) is unreachable and the roster cannot be repaired from the UI. Anyone *without* an active HR row is refused outright at the `signIn` callback (`src/lib/auth.ts`). Grep for `[Auth] no TeamMember row for …` and `[TeamMember] provision failed for …`.

`066_portal_form_team_member.sql` creates the table and copies the roster out of Fast_Core, so it goes *after* 059. It refuses to run unless the database is named `Rocks_Portal_Form…` **and** has `dbo.AccRequest`: the name test is what keeps a mistyped `--db` out of `Fast_Form`, which has `AccRequest` too and belongs to the live sibling. **066 is a copy, not a seed** — its `INSERT` reads `[Fast_Core].[dbo].[TeamMember]`, so that table must exist and still hold the roster when 066 runs. If it did not, batch 1 would commit the empty table and batch 2 roll back under `XACT_ABORT`, leaving no indexes, no FK and identity at 1; and once anyone logs in and is provisioned, the empty-table guard on the copy blocks the re-run permanently while new ids start at 1 — straight into the range 066 exists to keep clear. **Post-apply check:** `SELECT COUNT(*) FROM dbo.TeamMember` = 17 and `SELECT IDENT_CURRENT('dbo.TeamMember')` = 100000. It is the one migration that must **not** also be applied to `Rocks_Portal_Form_UAT` — identity lives in production only, and both pools reach it three-part. A new migration that changes an `Acc*` table does have to be applied to `Rocks_Portal_Form_UAT` as well, but the parallel-UAT batch is not that shape: **060, 062, 063 and 065 are Fast_Core only** (`FormEnvironment`, `UatTester`), and **061 and 064 are `Rocks_Portal_Form_UAT` only** — they refuse to run against a database whose name does not end in `_UAT`.

**Generic header (shared by all Accounting forms):** `AccFormMaster` (form catalog), `AccRequest` (shared request header), `AccApproval`, `AccActivityLog`, `AccSequence`, `AccEmailQueue`, `AccRequestFile`.

**Running number:** `TOFyy-xxxx`-style, allocated atomically at submit via `src/lib/acc/sequence.ts`.

#### AP-1 — Travel Expense Reimbursement (`/request/travel-expense`)

Office travel-expense reimbursement form (fuel/toll/parking against a route or manual entry).

- **Pages:** `/request/travel-expense` (fill/resume draft), `/request/travel-expense/[id]` (detail + timeline + self-cancel ≤24h after submit)
- **Detail tables:** `AccTravelExpense` + `AccTravelExpenseItem`
- **Settings tables:** `AccApprover` (configured account approvers), `AccVehicle` (vehicle rate table), `AccFormBrand` (brand access per form)
- **Workflow:** Manager (resolved from `Rocks_Portal_HR.Employee.ManagerStaffId`) → Account (from `AccApprover`). Email notification at every transition via Graph queue (`src/lib/acc/email-queue.ts`), drained after each action. Account approval sets `PaymentDate` = next 2nd or 4th Friday, shifted forward past holidays from `Rocks_Codex.Holiday` (`src/lib/acc/payment-calendar.ts`).
- **Conditional fields:** `AccVehicle.IsManualEntry = true` → fare + toll inputs; `false` → OpenRouteService distance × rate + toll + parking, via `DistanceMapField` → `LeafletRoutePicker` (plain Leaflet, `dynamic ssr:false`) + ORS geocoding/directions proxied through global `/api/ors/{geocode,directions}` (`src/lib/ors.ts`). Manual-km fallback when ORS is unavailable.
- **OpenRouteService is a global system setting:** API key stored in `Fast_Core.AppSetting` (`src/lib/app-settings.ts`) with `ORS_API_KEY` env fallback; resolved by `resolveOrsKey()`. Configured at **Settings → Maps & Routing → OpenRouteService** (`/settings/openrouteservice`, IT/System Admin) via `/api/settings/ors` (+`/test`; key always masked).
- Shared calculation logic in `src/lib/acc/calc.ts`. Travel date validation: unique per StaffId (except Rejected status), ≤1 month in the past, no future dates.

#### AP-17 — Travel Booking (`/request/travel-booking`)

Accommodation/ticket booking requests for provincial work travel — supports multiple bookings per request, an admin booking queue, per-diem history, and on-behalf submission.

- **Pages:** `/request/travel-booking` (fill/resume draft, multi-row), `/request/travel-booking/[id]` (detail), plus office/admin views under `/request/accounting/travel-booking*` (queue, report, settings)
- **Feature code:** `src/features/travel-booking/`; service/lib code under `src/lib/acc/travel-booking/`
- Uses `Rocks_Portal_HR.EmployeeAllowanceLog` for effective-dated per-diem history and `Fast_Data` for province lookups (`province-service.ts`)

#### Business Central / ERP integration

Accounting requests can be pushed into Dynamics 365 Business Central. Configuration lives under **Settings**: Database Connections, Business Central (OAuth2 connection), Brand Configuration (per-brand BC + ERP SQL target), ERP Interface Environment (per-brand Sandbox company and connection, System Admin only — which forms use it is set at Settings → Form Environment). Sync logic in `src/lib/erp/account-sync.ts` and `src/lib/erp/dimension-sync.ts` (both query `Fast_Data`), OData client in `src/lib/bc/`.

**Key libs (`src/lib/acc/`):** `pool`, `sequence`, `payment-calendar`, `employee-context`, `brand-options`, `access`, `settings-service`, `request-service`, `approval-engine`, `report-service`, `email-queue`, `email-templates`, `calc`, `erp-environment-shared`, plus `travel-booking/*`.

**Feature UI:** `src/features/accounting/` (AP-1) and `src/features/travel-booking/` (AP-17) — form components, approval queues, report tables, settings panels.

## Project Structure

```
src/
├── app/
│   ├── (auth)/login, unauthorized
│   ├── (dashboard)/
│   │   ├── forms/                    # Form Builder — 8 pages
│   │   ├── my-request/, my-work/     # Personal request tracking
│   │   ├── request/                  # Accounting hub, AP-1, AP-17, ERP prep
│   │   ├── settings/                 # Admin settings hub — connections, BC, brand config, ERP, users
│   │   └── page.tsx                  # Home — form catalogue
│   ├── api/
│   │   ├── auth/                     # NextAuth
│   │   ├── forms/                    # 16 routes
│   │   ├── request/accounting/       # AP-1, AP-17, ERP prep API routes
│   │   ├── settings/                 # Connections, BC, brand-config, ORS, Google Maps, users
│   │   └── users/                    # AD user search
│   ├── loading.tsx                   # Global loading screen
│   └── layout.tsx                    # Root layout — theme no-flash script, providers
├── features/
│   ├── forms/                        # Types, schemas, constants, workflow-engine, email, components, hooks
│   ├── accounting/                   # AP-1 form, approvals, report, settings UI
│   ├── travel-booking/               # AP-17 form, admin queue, report, settings UI
│   └── home/                         # Home catalogue
├── components/
│   ├── ui/                           # Button, Badge, Avatar, Dialog, DropdownMenu, SidePanel, FullScreenModal
│   └── layout/                       # Navbar, RouteGuard, PageContainer
├── lib/
│   ├── db/mssql.ts                   # Multi-DB pools (Core, Form, Production/UAT Form, Data, generic getAppPool), pool max=30
│   ├── team-member/                  # The only module that touches TeamMember — service.ts + mapping.ts
│   ├── acc/                          # Accounting domain logic (see above)
│   ├── erp/                          # Business Central sync
│   ├── hr/                           # Rocks_Portal_HR cross-DB lookups
│   ├── graph.ts                      # Microsoft Graph API (searchADUsers, getADUserByEmail, getADUserPhoto, sendEmail)
│   ├── storage.ts                    # Local file storage (UPLOAD_ROOT)
│   ├── auth.ts, auth.config.ts, api-auth.ts
│   └── hooks/
├── env.ts                            # Type-safe env validation
```

## Conventions

- **DB columns**: PascalCase (`Id`, `Name`, `Status`) — map to camelCase in API responses
- **API response**: `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`
- **Auth**: `requireAuth()` / `requireRole(["IT Admin", "System Admin"])`
- **SQL**: Parameterized queries only — `pool.request().input("name", sql.NVarChar, value).query(...)`
- **TeamMember**: never write SQL against it. Call `src/lib/team-member/service.ts`, which owns every statement and pins them to `getProductionFormPool()`. To join it from a query running on another pool, use its `teamMemberTableRef()` → `[Rocks_Portal_Form].[dbo].[TeamMember]`. `service.ts` is the only file in `src/` holding SQL that names the table — keep it that way, because a stray query pointed at Fast_Core does not error, it returns the sibling app's roster.
- **CSS**: Use `var(--variable)` — never raw hex. See `globals.css` for all tokens.
- **Icons**: `lucide-react` only
- **Toasts**: `sonner` — `toast.success()`, `toast.error()`
- **Excel**: `xlsx-js-style` (not `xlsx` — old SheetJS CE has vulnerabilities)
- **Components**: `"use client"` only when needed. Use existing UI components from `@/components/ui`
- **ES5 target**: Don't use `[...set]` or `[...map.values()]` — use `Array.from()` instead
- **Date display**: Use local getters (`getFullYear()`, `getMonth()`), never `toISOString()` — server is Thai time, do NOT use `fixThaiDate()`
- **Logos**: the navbar mark, the favicon (`src/app/layout.tsx`) and the login lockup all use `/brandlogo/rocks.png`; the loading screen uses the Codex Family logo. `public/brandlogo/` holds the Rocks Group and company-brand logos only. Replace the favicon once a Form Portal icon exists, or the two apps share a tab icon

## Environment Variables

```env
# Auth
AUTH_SECRET=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=

# Database
MSSQL_HOST=
MSSQL_PORT=1433
MSSQL_DATABASE=
MSSQL_USER=
MSSQL_PASSWORD=
MSSQL_ENCRYPT=true
MSSQL_TRUST_CERT=true
MSSQL_CORE_DATABASE=Fast_Core
MSSQL_FORM_DATABASE=Rocks_Portal_Form
MSSQL_FORM_UAT_DATABASE=Rocks_Portal_Form_UAT   # served to configured testers in UAT mode; see "Parallel Production and UAT"
MSSQL_DATA_DATABASE=Fast_Data

# Email
GRAPH_MAIL_FROM=noreply@rocksgroup.com
UAT_MAIL_REDIRECT=                              # UAT mail for non-testers goes here (active testers get theirs); falls back to GRAPH_MAIL_FROM

# SharePoint (Accounting file storage — shared with Rocks Fast)
SHAREPOINT_ACC_SITE=
SHAREPOINT_ACC_FOLDER=

# OpenRouteService (AP-1 distance calculation fallback)
ORS_API_KEY=

# Google Maps
GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Local attachment storage — point at the Rocks Fast sibling's uploads folder
UPLOAD_ROOT=

# Client
NEXT_PUBLIC_APP_URL=http://localhost:3020
```

## Deployment

Not yet done — Form Portal has no host of its own. Before it is deployed:

- **`PRODUCTION_HOSTS` in `next.config.mjs` must be updated.** It currently lists only the Rocks Fast sibling's hosts (`fast.rocksgroup.com`, `test.m-group.com`, `www.test.m-group.com`) and feeds both `allowedDevOrigins` and `experimental.serverActions.allowedOrigins`. Server actions issued from an unlisted host are rejected as cross-origin, so a Form Portal host that is missing from this list fails at runtime, not at build.
- **`NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`** must both match the address users actually open, including port.
- **`ERP_SANDBOX_ALLOWED_HOSTS`** (`src/lib/acc/erp-environment-shared.ts`) is `localhost:3020` / `127.0.0.1:3020` — the `devHostOnly` management cards and the manager-approval dev bypass (`src/lib/acc/manager-auth.ts`) disappear on any other host, which is intended for production but worth knowing.
- **`UPLOAD_ROOT`** must resolve on the target machine to the files the `AccRequestFile` / `OfficeFormFiles` rows point at (see "Shared with Rocks Fast").
- **Parallel UAT ships in three steps, in this order: apply 062 + 063 → deploy the code → apply 065.** All three are Fast_Core. 062 adds `ProductionEnabled` / `UatEnabled` beside the old `Environment` column and backfills them, leaving that column in place so the *currently running* app keeps working; 063 creates `UatTester`. Only once the new code is live does 065 drop `Environment`. Running 065 first takes the old build down — its `setFormFlag` names that column in the MERGE INSERT. (061 and 064 target `Rocks_Portal_Form_UAT` and are independent of the deploy; 061 must precede any UAT write.)
- **065 is one-way.** After it has run, a `git revert` of the parallel-UAT branch restores a `setFormFlag` that writes to a column that no longer exists, so the first write to any form fails. Reverting past commit `54ff2d7` means re-adding `FormEnvironment.Environment` as **NULLable** first — the original was `NOT NULL` with no default, which cannot be added back to a table that already has rows without backfilling one.
- **`066_portal_form_team_member.sql` must be applied to whichever database `MSSQL_FORM_DATABASE` names.** It is already applied to the live `Rocks_Portal_Form`; a fresh stand-up needs 059 then 066, or every session degrades to `Staff` with a blank id and `/settings/users` becomes unreachable (see the Accounting storage note). Never apply it to `Rocks_Portal_Form_UAT`.
- Liveness probe: `curl http://127.0.0.1:3020/api/health` → `{"ok":true,"data":{"service":"form-portal",…}}`.
