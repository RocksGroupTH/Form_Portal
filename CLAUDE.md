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
| **Fast_Core** | `getCorePool()` | TeamMember (auth), config, brand/DB/BC connection settings |
| **Rocks_Portal_Form** | `getFormPool()` | Form definitions, submissions, approvals, files, logs, and all `Acc*` Accounting tables. Form Portal's own database — `Rocks_Portal_Form_UAT` is the UAT twin, and which one `getFormPool()` returns depends on the form being used (see "Per-form Production/UAT routing") |
| **Fast_Data** | `getDataPool()` | Used by Accounting and ERP sync — department maps, travel-booking province lookups, ERP account/dimension sync (`src/lib/acc/department-map-service.ts`, `src/lib/acc/travel-booking/province-service.ts`, `src/lib/acc/travel-booking/request-service.ts`, `src/lib/erp/account-sync.ts`, `src/lib/erp/dimension-sync.ts`). **Not** a BI/reporting database in this app. |
| **Rocks_Portal_HR** | `getHrPool()` → `getAppPool("Rocks_Portal_HR")` | Employee master, manager chain, per-diem allowance history — cross-referenced by StaffId/email |
| **Rocks_Codex** | (cross-DB query, e.g. `[Rocks_Codex].[dbo].[Holiday]`, `[Rocks_Codex].[dbo].[Brand]`) | Holiday calendar, company brand master |
| **Rocks_Portal_Form** (Acc* tables) | `getAccPool()` → `getFormPool()` | Accounting forms: travel expense (AP-1), travel booking (AP-17) |

**IMPORTANT**: Use `new sql.ConnectionPool(config).connect()` for isolated pools. Never use `sql.connect()` (global singleton — causes cross-DB bugs). Pool max is set to 30.

### Per-form Production/UAT routing

Each Accounting form is flagged Production or UAT independently at **Settings → Form Environment** (`/settings/form-environment`, System Admin only). A form flagged UAT reads and writes `Rocks_Portal_Form_UAT`; every other form keeps using `Rocks_Portal_Form`. There is no app-wide UAT mode and no separate deployment.

- **The flag** lives in `Fast_Core.dbo.FormEnvironment` (`FormCode`, `Environment`, `UpdatedBy`, `UpdatedAt`), read through `src/lib/form-environment/service.ts`. A missing row means Production. It is in Fast_Core on purpose: resolving the flag must not depend on which form database is selected.
- **Resolution** — the proxy injects `x-pathname`; `classifyPath` (`src/lib/form-environment/classify-path.ts`) maps that path to `AP-1 | AP-15 | AP-17 | "BOTH" | null` by longest matching prefix in `ROUTE_RULES`; `resolveFormEnvironment()` maps `BOTH` and `null` to Production; `getFormPool()` returns the matching pool. Code with no request scope (scripts, background work) resolves to Production.
- **Every new route under `/api/request` needs a rule.** Without one it silently falls through to Production. The coverage panel on the settings page lists any route no rule covers — `matchRule` is what tells "no rule at all" apart from "a rule that deliberately says Production".
- **Shared configuration is dual-written**, not duplicated by hand: `src/lib/acc/dual-write.ts` runs each master-table mutation against both databases in a transaction, and `npm run check:alignment` asserts the 19 shared tables still match.
- **Business Central follows the same flag**: `resolveEffectiveErpEnvironment()` (`src/lib/acc/erp-environment.ts`) maps the form's environment to the BC instance — UAT → Sandbox, otherwise Production. There is no separate ERP toggle; the navbar chip and the global `AppSetting` switch that used to own this were removed on 2026-08-17. Which BC company and connection Sandbox uses is configured at Settings → ERP Interface Environment.
- **ERP Prep is classified `AP-1`, not `BOTH`**: it is the only path that posts to BC, and the send reads its rows from a single pool. While AP-1 is flagged UAT the prep queue is the UAT queue, and real payments cannot be processed through it.
- **Aggregate endpoints read both databases** through `src/lib/acc/query-both.ts` (My Requests, My Work, report, ERP prep, requesters). Sorting and paging must happen after the merge, and each row carries an `environment` tag.
- **Ids never collide**: migration 061 seeds UAT transactional identities at 900000, so `isUatId` (`src/lib/form-environment/uat-identity.ts`) can badge a detail page that only has the row itself to go on.
- **UAT side effects are contained**: mail is redirected to `UAT_MAIL_REDIRECT` with a `[UAT]` subject and the intended recipient named in the body, attachments land under `{SHAREPOINT_ACC_FOLDER}/_UAT/...`, and the email sweep endpoint drains the queue in both databases.
- **Switching a form does not move its existing requests.** They stay in the database they were written to and stay readable; only new writes go elsewhere.

### Auth

- Microsoft Entra ID (Azure AD) via NextAuth 5
- Session: `{ user: { id, name, email, role, nickname, color, photo } }` — no `hasIntel` flag (Intelligence is gone)
- Roles: `Staff | IT Admin | System Admin | Viewer`
- TeamMember lookup from `Fast_Core.dbo.TeamMember`; a missing row is provisioned at login (`provisionTeamMember`) so drafts stay owned by their creator
- Profile photo fetched via client credentials (`getADUserPhoto`) instead of delegated token
- Role hierarchy: System Admin > IT Admin > Staff/Viewer

### Theme — Sky

- Palette: **Sky** — pastel cool-blue light theme (`light`) plus a dark counterpart (`dark`, formerly named `gold` in the Rocks Fast original)
- localStorage key: `form-portal-theme`
- Cookie: `form-portal-theme` (persists across sessions; read by the no-flash inline script in `src/app/layout.tsx`)
- Default: `light`
- CSS variables: `var(--bg-card)`, `var(--text-primary)`, etc. — see `src/app/globals.css` for the full token list (defined once under `:root, [data-theme="light"]` and again under `[data-theme="dark"]`)
- Shape and depth: card radius `--radius-card` (14px), tile radius `--radius-tile` (12px); `--shadow-card` rather than heavy borders; tinted icon tiles (`--nav-active-bg` background behind icons); the capsule nav uses Tailwind's `rounded-full`, not a token — `--radius-full` and `--shadow-lift` are defined in `globals.css` but nothing consumes them
- Semantic action tokens live in the `@theme` block, which is where Tailwind 4 sources `text-danger` / `text-warning` and friends: action `#4c74c4` / hover `#3d63b0`, success `#3d8560`, warning `#b5793a`, danger `#c25b5b`. They are single-valued across both themes on purpose — surfaces needing a per-theme value use `--btn-danger-bg`, `--text-danger`, `--status-*` or `--ring-*` instead
- Brand mark gradient: `--mark-from` → `--mark-to`
- Status pills: `--status-{pending,ok,draft,bad}-{bg,text}`
- The `.acc-theme` scope on Accounting pages (`src/app/globals.css`) was retuned from the original's rose accent to Sky; its non-colour rules (hidden scrollbars, suppressed number spinners, `overflow-x: clip`) are unchanged

## Shared with Rocks Fast

Form Portal was cloned from the Rocks Fast codebase and **still shares live infrastructure** with it. This is not a separate environment — treat both apps as one system when operating on shared resources:

- **Databases are no longer shared**: Form Portal owns `Rocks_Portal_Form` (plus `Rocks_Portal_Form_UAT`). `Fast_Form` belongs to Rocks Fast and this app must not read or write it. `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` and `Rocks_Codex` are still the same shared databases both apps use, in both environments.
- **Same SharePoint folder**: Accounting file attachments (`SHAREPOINT_ACC_SITE` / `SHAREPOINT_ACC_FOLDER`) point at the same document library Rocks Fast uses.
- **`AccEmailQueue` is no longer shared** — each app drains the queue in its own database.
- **⚠️ Both apps use port 3020** — Form Portal was moved off 3021 onto the same port Rocks Fast uses, so only one of them can run at a time on a given machine; the second to start fails with `EADDRINUSE`. This also removes the previous risk of both apps polling/draining the same `AccEmailQueue` concurrently and sending approval/payment emails twice.
- **`UPLOAD_ROOT`** — local attachment storage env var. Points at the sibling Rocks Fast repo's `uploads/forms` directory (`c:/Users/PC/source/repos/Web/RocksFast/uploads/forms` in dev) so files already recorded in the shared DB stay downloadable from either app. Accounting attachments primarily use SharePoint now; local disk serves the Form Builder and older Accounting rows created before SharePoint storage existed. See `src/lib/storage.ts`.
- **`ERP_SANDBOX_ALLOWED_HOSTS`** (`src/lib/acc/erp-environment-shared.ts`) — host-and-port matched allowlist (`["localhost:3020", "127.0.0.1:3020"]`) gating two things: the `devHostOnly` management/settings cards in `REQUEST_CARDS` (`src/lib/constants.ts`) and the manager-approval dev bypass in `src/lib/acc/manager-auth.ts` (`isManagerDevBypassHost`). If this app's port ever changes, this list must be updated or both gates silently disappear.
- **`src/lib/brand-config.ts` is deliberately frozen** — it still contains Dashboard-DB helper fields (`dashboardDbConnectionId`, `dashboardDatabaseName`) with no callers in this app; the Rocks Fast sibling reads them for its Intelligence dashboards. The Brand Configuration settings page hides those fields in the UI but still round-trips their values on save, so Rocks Fast keeps working. **Do not "clean up" these fields** — they are load-bearing for the sibling app even though nothing in Form Portal consumes them.

## Navigation

Top bar and mobile tabs: **Home** · **Forms** · **My Requests** · **My Work** · **Settings** (Settings for IT Admin/System Admin only). Labels are English; in-page copy is Thai. Defined in `NAV` (`src/lib/constants.ts`).

- **`Home`** (`/`) — a form catalogue: greeting, stat strip, search, resumable drafts, then forms grouped into **Accounting** (AP-1 travel expense, AP-17 travel booking) and **Form Builder**. It is a link surface only — it creates no API of its own and does not merge the two request systems (Office Forms and Accounting remain separate data models). `src/features/home/HomeCatalogue.tsx`.
- **`Forms`** (`/forms`) — the Form Builder catalog + "My Submissions", back in the top nav after being orphaned in the Rocks Fast sibling.
- **`My Requests`** (`/my-request`) — requests you submitted and their status, across both Office Forms and Accounting.
- **`My Work`** (`/my-work`) — requests awaiting your approval or otherwise involving you.
- **`Settings`** (`/settings`, admin only) — hub linking to: Maps & Routing, Database Connections, Business Central, Brand Configuration, ERP Interface Environment, **Form Environment** (`/settings/form-environment`, System Admin only), **Users & Roles** (`/settings/users`, System Admin only), Manage Forms (`/forms/admin`), Accounting Admin (`/request/accounting`).

Every dashboard route is also gated by `BrandGate` (`src/components/BrandGate.tsx`), a non-dismissable modal that blocks rendering until the user picks a company brand (PCTH / KSI / PCMY / UNO — `src/lib/brand.ts`). This brand cookie (`rocks-fast-brand`) is unrelated to Intelligence (which is gone); it scopes ERP/Business Central context for Accounting.

## Features

### 1. Office Forms (`/forms`)

Configurable form builder with approval workflows.

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

**Storage:** Acc* tables live in **`Rocks_Portal_Form`**, accessed via `getAccPool()` (= `getFormPool()`, `src/lib/acc/pool.ts`). Numbered migrations in `migrations/` (013 onward) built these up incrementally against the old `Fast_Form`; `059_portal_form_baseline.sql` is the generated full-schema baseline used to stand up a new database. Apply with `npm run apply-sql -- --db Rocks_Portal_Form --file <path>` (see `scripts/apply-sql.ts`), and run every new migration against `Rocks_Portal_Form_UAT` as well.

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
│   ├── db/mssql.ts                   # Multi-DB pools (Core, Form, Data, generic getAppPool) + teamMemberTable(), pool max=30
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
- **Cross-DB**: Use `teamMemberTable()` helper for `[Fast_Core].[dbo].[TeamMember]` references
- **CSS**: Use `var(--variable)` — never raw hex. See `globals.css` for all tokens.
- **Icons**: `lucide-react` only
- **Toasts**: `sonner` — `toast.success()`, `toast.error()`
- **Excel**: `xlsx-js-style` (not `xlsx` — old SheetJS CE has vulnerabilities)
- **Components**: `"use client"` only when needed. Use existing UI components from `@/components/ui`
- **ES5 target**: Don't use `[...set]` or `[...map.values()]` — use `Array.from()` instead
- **Date display**: Use local getters (`getFullYear()`, `getMonth()`), never `toISOString()` — server is Thai time, do NOT use `fixThaiDate()`
- **Logos**: the navbar mark is a CSS gradient `F` (`--mark-from` → `--mark-to`), not an image. `public/brandlogo/` holds only the Rocks Group and company-brand logos, so the favicon and the login lockup still use `/brandlogo/rocks.png` and the loading screen uses the Codex Family logo — replace the favicon in `src/app/layout.tsx` once a Form Portal icon exists, or the two apps share a tab icon

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
MSSQL_FORM_UAT_DATABASE=Rocks_Portal_Form_UAT   # used by forms flagged UAT in Settings → Form Environment
MSSQL_DATA_DATABASE=Fast_Data

# Email
GRAPH_MAIL_FROM=noreply@rocksgroup.com
UAT_MAIL_REDIRECT=                              # every mail from a UAT form goes here; falls back to GRAPH_MAIL_FROM

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
- Liveness probe: `curl http://127.0.0.1:3020/api/health` → `{"ok":true,"data":{"service":"form-portal",…}}`.
