# Form Portal — Design Spec

**Date:** 2026-08-10
**Source project:** `c:\Users\PC\source\repos\Web\RocksFast` (Rocks Fast)
**Target project:** `c:\Users\PC\source\repos\Web\Form_Portal`

---

## 1. Goal

Create **Form Portal** — a standalone Next.js 16 portal cloned from Rocks Fast that keeps every
function *except* Fast Intelligence and Locations, restructured and restyled around forms and
requests. Internal behaviour of every retained feature stays byte-for-byte identical; only
navigation, theme, and the home page change.

The new repo gets a clean `git init` and will be pushed to GitHub later.

## 2. Decisions (agreed during brainstorming)

| Question | Decision |
|---|---|
| Database | **Share the existing databases** — Fast_Core, Fast_Form, Rocks_Portal_HR, Rocks_Codex. No new DB, no new migrations. |
| Clone method | Copy source files only, then `git init` fresh. No history carried over. |
| App name | **Form Portal** (package `form-portal`) |
| Nav + home layout | Slim top bar + home page as a **form catalogue** (search, drafts, pending work, forms by category) |
| Visual style | **Sky** — pastel cool-blue, modern treatment (large radii, soft layered shadows, glass top bar, capsule nav, tinted icon tiles) |
| Legacy Form Builder (`/forms`) | **Keep it and put it back in the menu** (it is orphaned in Rocks Fast — no inbound links) |
| Overlap between Accounting requests and Form Builder submissions | **Unify the entry point only** — one catalogue on the home page; lists and approval queues stay separate per system. No data-layer merge. |
| User role management | **Move to Settings → Users & Roles**; drop the Intel group / brand-permission UI |
| Menu language | **English** labels (`Home`, `Forms`, `My Requests`, `My Work`, `Settings`); in-page content stays Thai |
| Build strategy | Copy → prune → restyle, in **four verifiable phases** |

## 3. What is removed

### Routes and features
- `src/app/(dashboard)/intelligence/**` (19 pages)
- `src/app/(dashboard)/locations/**`
- `src/app/api/intelligence/**` (37 routes)
- `src/app/api/locations/**`
- `src/features/intelligence/**` (73 files, ~16.3k lines)
- `src/features/locations/**` (5 files, ~1.3k lines)
- `src/lib/intelligence/**`
- `src/lib/intel-access.ts`
- `sql/intel-materialized-tables.sql`, `sql/foodstory-views.sql`, `sql/intel-permissions.sql`
  (`sql/` is otherwise empty afterwards — the directory is kept for future use)

### Auth surface
- `hasIntel` removed from JWT, session, `auth.config.ts` type augmentation, and `auth.ts` lookup
- `RouteGuard` loses the `blockedByIntel` branch
- `NAV` loses `requiresIntel`; `NavItem.requiresIntel` field deleted

### Dependencies dropped from `package.json`
`recharts`, `@tanstack/react-table`, `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`

*(Verified: each is imported only from within `features/intelligence` or `api/intelligence`.)*

### Dependencies that must stay
`leaflet` + `@types/leaflet` (AP-1 distance picker), `@react-google-maps/api` (Form Builder `route`
field), `tesseract.js` (AP-17 ID-card OCR), `xlsx-js-style` (Accounting reports), `sharp`, `swr`,
`sonner`, `@dnd-kit/*` (Form Builder drag-and-drop), `mssql`, `zod`, `react-hook-form`.

### Database pools — what stays
`getFoodstoryPool()` and `getBrandDashboardPool()` are Intelligence-only and are removed from
`src/lib/db/mssql.ts` and `src/lib/intelligence/brand-pool.ts`.

**`getDataPool()` (Fast_Data) must stay.** Despite what `CLAUDE.md` claims, it is used well outside
Intelligence:
- `src/lib/acc/department-map-service.ts`
- `src/lib/acc/travel-booking/province-service.ts`
- `src/lib/acc/travel-booking/request-service.ts`
- `src/lib/erp/account-sync.ts`
- `src/lib/erp/dimension-sync.ts`

`MSSQL_DATA_DATABASE` therefore remains a required environment variable.

### Database tables — explicitly NOT touched
`IntelPermissionGroup`, `IntelPermissionGroupMember`, `IntelBrandPermission`, `BrandConfig`
dashboard columns, and all Foodstory databases remain in place. Rocks Fast still uses them.
Form Portal simply stops reading them. **No destructive migration may be written.**

## 4. Information architecture

### Navigation (desktop top bar / mobile bottom tabs)

| Label | Href | Visibility |
|---|---|---|
| Home | `/` | everyone |
| Forms | `/forms` | everyone |
| My Requests | `/my-request` | everyone |
| My Work | `/my-work` | everyone |
| Settings | `/settings` | IT Admin / System Admin |

**How `Home` and `Forms` differ.** `Home` is the unified launcher across both systems — it links
outward and owns no list. `Forms` is the existing Form Builder area unchanged: the published-form
catalogue plus *My Submissions*, with `/forms/approvals` and `/forms/admin` beneath it.

**Keeping `/request` reachable.** `Request` disappears as a top-level nav item, so the Request hub
must be linked from elsewhere or it becomes orphaned the way `/forms` is in Rocks Fast:
- the *Accounting* section header on Home carries a "ดูทั้งหมด →" link to `/request`
- Settings gains an **Accounting Admin** card linking to `/request/accounting`

The `devHostOnly` management cards inside `/request` keep their existing host gate; they are not
duplicated into Settings.

### Home page (`/`) — the catalogue

Replaces the current card grid. Sections, top to bottom:

1. **Greeting** — time-aware greeting + one-line summary
2. **Stat strip** — three numbers: pending approvals, requests this month, drafts
3. **Search** — full-width pill input; client-side filter over the loaded form list
4. **Continue where you left off** — drafts and items awaiting the user's approval
5. **Forms by category**
   - *Accounting* — AP-1 (`/request/travel-expense`), AP-17 (`/request/travel-booking`)
   - *General forms* — published forms from the Form Builder, via the existing `/api/forms`

Clicking any form enters that form's existing flow untouched. The catalogue is a **link surface
only** — it does not merge submissions, approvals, or any API.

Data sources for the stat strip and "continue" section are the existing endpoints already used by
`/my-request` and `/my-work` (`MyRequestsPanel` / `kind: "mine" | "work"`) plus `/api/forms`. If a
count is not directly available, it is derived client-side from those responses — no new
aggregation service.

### Settings hub (`/settings`)

| Card | Href | Note |
|---|---|---|
| Maps & Routing | `/settings/maps` | unchanged |
| Database Connections | `/settings/connections` | unchanged |
| Business Central | `/settings/bc-connections` | unchanged |
| Brand Configuration | `/settings/brand-config` | dashboard-DB fields hidden in UI; columns untouched |
| ERP Interface Environment | `/settings/erp-interface` | System Admin only, unchanged |
| **Users & Roles** | `/settings/users` | **new** — ported from `/intelligence/admin/permissions` |
| **Manage Forms** | `/forms/admin` | link to existing Form Builder admin |
| **Accounting Admin** | `/request/accounting` | link to the existing AP-1 / AP-17 management hub |

`Intelligence Permissions` card is deleted.

### Users & Roles page

Port only the **User Roles** column of the old permissions page:
- list team members from `Fast_Core.dbo.TeamMember`
- AD search modal (debounced, with photos, "Already Added" indicator)
- change role, deactivate, resync-from-AD

Backing API: new `/api/settings/users` exposing the `updateRole`, `addUser`, `deleteUser`,
`resyncAll` actions lifted verbatim from `src/app/api/intelligence/permissions/admin/route.ts`.
The group / brand-permission actions (`createGroup`, `deleteGroup`, `addMember`, `removeMember`,
`grantBrand`, `revokeBrand`) are **not** ported.

## 5. Visual design — "Sky"

All colour lives in CSS variables in `src/app/globals.css`; components read `var(--…)` only, so the
palette swap requires no component rewrites.

### Light palette

| Token | Value |
|---|---|
| `--bg-page` | `#f4f7fc` |
| `--bg-base`, `--bg-card`, `--bg-elevated`, `--bg-modal`, `--bg-dropdown` | `#ffffff` |
| `--bg-card-hover` | `#f7f9fd` |
| `--bg-topbar` | `rgba(255, 255, 255, 0.78)` (with `backdrop-blur`) |
| `--bg-input` | `#ffffff` |
| `--bg-row-stripe` | `#f9fbfe` |
| `--bg-row-hover` | `#eff4fb` |
| `--bg-selected` | `#e8effc` |
| `--text-primary` | `#2b3446` |
| `--text-secondary` | `#4b566b` |
| `--text-muted` | `#8b97aa` |
| `--text-faint` | `#a3aec0` |
| `--border-main` | `#e7edf6` |
| action / action-hover | `#4c74c4` / `#3d63b0` |
| success (text / bg) | `#3d8560` / `#e2f3e9` |
| warning (text / bg) | `#b5793a` / `#fdeee0` |
| danger (text / bg) | `#c25b5b` / `#fce9e9` |
| info (text / bg) | `#4c74c4` / `#e8effc` |
| brand mark gradient | `#7fa0e0` → `#5b7fc9` |

### Shape and depth

- Card radius `14px`, tile radius `12px`, pill `999px`
- Card shadow `0 2px 8px -3px rgba(59, 79, 116, 0.16)`; lifted `0 12px 32px -12px rgba(59, 79, 116, 0.28)`
- Cards use shadow + hairline border, not heavy borders
- Body text stays dark slate — pastels are used for surfaces, status pills, and buttons only, so
  long forms and report tables remain readable

### Structural component changes

- **Navbar** — capsule-shaped nav group with a white pill on the active item; gradient `F` mark
  replacing the Rocks logo; notification-style icon button slot; glass background
- **Home page** — rebuilt as the catalogue described above
- **Form tiles** — each form gets a tinted icon tile
- Everything else (form pages, approval queues, report tables, settings panels) inherits the new
  tokens without structural edits

### Dark theme

The existing `gold` theme is renamed to `dark` (21 references across 6 files, one of which —
`features/intelligence/master/hooks/useMasterTheme.tsx` — is deleted anyway) and re-tuned as a cool
dark counterpart of Sky. The persistence key changes from `rocks-fast-theme` to
`form-portal-theme` in both `ThemeProvider.tsx` and the inline no-flash script in `layout.tsx`
(localStorage **and** cookie, plus the cookie regex `(light|gold)` → `(light|dark)`).

## 6. Environment and repository

| Item | Value |
|---|---|
| Dev / start port | **3021** (`next dev -p 3021`, `next start -p 3021`) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3021` |
| `ERP_SANDBOX_ALLOWED_HOSTS` | `["localhost:3021", "127.0.0.1:3021"]` in `src/lib/acc/erp-environment-shared.ts` |
| package name | `form-portal` |
| PM2 config | `ecosystem.config.cjs` renamed app + port |

### File storage

Attachments use two backends:
- **SharePoint** — the primary backend for Accounting (AP-1) and Travel Booking (AP-17) files, via
  `src/lib/sharepoint.ts` + `src/lib/acc/sharepoint-path.ts`. `AccRequestFile.StorageBackend`
  records which backend a row used. The `SHAREPOINT_ACC_SITE` / `SHAREPOINT_ACC_FOLDER` env vars
  stay and need no change — SharePoint is shared automatically.
- **Local disk** — used by the Form Builder (`/api/forms/files`) and by older Accounting rows
  written before the SharePoint switch, through `src/lib/storage.ts`, which hardcodes
  `path.join(process.cwd(), "uploads", "forms")`.

Change `storage.ts` to read an optional `UPLOAD_ROOT` env var, defaulting to current behaviour:

```ts
const UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(process.cwd(), "uploads", "forms");
```

Form Portal's `.env.local` points `UPLOAD_ROOT` at Rocks Fast's `uploads/forms` directory so that
locally-stored attachments already recorded in the shared database remain downloadable.

### Not copied from Rocks Fast

`.git/`, `.env.local`, `node_modules/`, `.next/`, `uploads/`, `sampledata/`, `.superpowers/`,
`.cache/`, `tsconfig.tsbuildinfo`, `.AutoDeploy.bat`

`.env.local` is created fresh in Form Portal from `.env.example`, with the same credentials, the new
port, and `UPLOAD_ROOT`.

`.env.example` is updated: `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` → port 3021, `UPLOAD_ROOT`
added, and the Intelligence-only keys `FOODSTORY_DB_HOST` / `FOODSTORY_BRANDS` removed. All other
keys — including `MSSQL_DATA_DATABASE`, `SHAREPOINT_*`, `ORS_API_KEY`, `GOOGLE_MAPS_API_KEY`,
`CONNECTION_ENCRYPTION_KEY` — stay.

### .gitignore

Rocks Fast's `.gitignore` excludes `public/`, `sql/`, and `docs/` — all of which the new GitHub repo
needs. The new `.gitignore` keeps them and instead ignores:

```
node_modules/
.next/
out/
.env*.local
.env
uploads/
.cache/
.superpowers/
logs/
*.log
tsconfig.tsbuildinfo
.vscode/
.cursor/
web.config
.DS_Store
Thumbs.db
```

`.claude/` stays ignored. Before the first GitHub push, the working tree is scanned for secrets.

## 7. Risks and constraints

1. **Shared database.** Form Portal is a second UI over the same data. Anything written in one app
   appears in the other. No migration may drop or alter a column Rocks Fast depends on.
2. **Shared email queue.** `AccEmailQueue` is drained opportunistically after each action in both
   apps. Running both simultaneously in development risks duplicate sends — run one at a time.
3. **`DataTable.tsx`** lives in `features/intelligence/` and is referenced by
   `features/travel-booking/components/ColumnToggleMenu.tsx` **in a comment only**. Deleting it is
   safe; the stale comment must be updated.
4. **`ERP_SANDBOX_ALLOWED_HOSTS`** is host-and-port matched. Missing the port change silently hides
   the management cards (`devHostOnly` in `REQUEST_CARDS`) and the ERP sandbox toggle.
5. **Documentation.** `CLAUDE.md` and `ROCKS-UI-GUIDE.md` are rewritten for Form Portal; the
   Intelligence sections are removed and the new IA, theme, and port are documented.

## 8. Phases

Each phase ends with a build that passes and an app that runs.

### Phase 1 — Copy and run
Copy source tree (respecting the exclusion list), `git init`, write `.gitignore`, create
`.env.local` (port 3021, `UPLOAD_ROOT`), rename package, set ports in `package.json` and
`ecosystem.config.cjs`.
**Exit:** `npm install` and `npm run build` succeed; app starts on 3021; login works; AP-1, AP-17,
Form Builder, My Requests, My Work, Settings all load.

### Phase 2 — Prune
Delete Intelligence and Locations routes, features, libs, and SQL. Remove `hasIntel` from auth,
session, and `RouteGuard`. Remove `requiresIntel` from `NAV`/`NavItem`. Drop the five dependencies.
Add `/settings/users` + `/api/settings/users` and remove the Intelligence Permissions card. Update
`ERP_SANDBOX_ALLOWED_HOSTS` and `storage.ts`. Fix the stale `DataTable` comment.
**Exit:** build passes with zero references to `intelligence`/`locations`/`hasIntel`; every retained
page still loads; role management works from Settings.

### Phase 3 — Restyle
Apply the Sky palette to `globals.css`, rename `gold` → `dark` and re-tune it, change the theme
storage key, rebuild `Navbar` (capsule nav, gradient mark, glass bar), rebuild the home page as the
catalogue, add English nav labels, add form tiles with tinted icons.
**Exit:** build passes; both themes render correctly; catalogue links reach every form; mobile
bottom tabs still work.

### Phase 4 — Finish
Rewrite `CLAUDE.md` and `ROCKS-UI-GUIDE.md`, scan for secrets, verify `.gitignore` coverage, commit.
**Exit:** repository is clean and ready for `git remote add` + push.

## 9. Out of scope

- Merging Accounting requests and Form Builder submissions into one data model
- Any change to approval workflow, email templates, running-number allocation, ERP interface, or
  report logic
- New database tables, columns, or migrations
- Deploying Form Portal to a server, or pushing to GitHub (the user does this later)
