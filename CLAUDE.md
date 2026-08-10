# Rocks Fast — Developer Guide

> Internal portal for Rocks Group. Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MSSQL.

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
| **Fast_Core** | `getCorePool()` | TeamMember (auth), config, Intel permissions |
| **Fast_Form** | `getFormPool()` | Form definitions, submissions, approvals, files, logs |
| **Fast_Data** | `getDataPool()` | BI reports config, dashboards (not actively used by reports — queries go direct to Foodstory) |
| **Rocks_UNO_Data** | `getFoodstoryPool("UNO")` | UNO Coffee Foodstory POS data |
| **Rocks_KSI_Data** | `getFoodstoryPool("KSI")` | KSI Foodstory POS data |
| **Rocks_PCTH_Data** | (cross-DB query) | Centralized ETL_JobLog (LocationSync status) |
| **Rocks_Codex** | (cross-DB query) | Holiday calendar (`[Rocks_Codex].[dbo].[Holiday]`) |
| **Fast_Form** (Acc* tables) | `getAccPool()` → `getFormPool()` | Accounting forms: travel expense reimbursement (AP-1) |

**IMPORTANT**: Use `new sql.ConnectionPool(config).connect()` for isolated pools. Never use `sql.connect()` (global singleton — causes cross-DB bugs). Pool max is set to 30.

### Auth

- Microsoft Entra ID (Azure AD) via NextAuth 5
- Session: `{ user: { id, name, email, role, nickname, color, photo } }`
- Roles: `Staff | IT Admin | System Admin | Viewer`
- TeamMember lookup from `Fast_Core.dbo.TeamMember`
- Profile photo fetched via client credentials (`getADUserPhoto`) instead of delegated token
- Role hierarchy: System Admin > IT Admin > Staff/Viewer

### Theme

- Light + Gold (dark luxury)
- localStorage key: `rocks-fast-theme`
- Cookie: `rocks-fast-theme` (persists across sessions)
- Default: `light`
- CSS variables: `var(--bg-card)`, `var(--text-primary)`, etc.

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
- `src/lib/storage.ts` — File storage abstraction (local backend)

**Field types:** text, textarea, number, date, select, radio, checkbox, file, route (Google Maps), section, info

**Approval flow:**
- Sequential: Step 1 → Step 2 → Step 3
- Parallel: Same StepOrder, different ParallelGroup → all must approve
- Actions: Approve, Reject, Return (request changes)
- Auto-approve conditions (JSON rules)
- Email notifications via Microsoft Graph API (queued, async)

### 2. Fast Intelligence (`/intelligence`)

BI dashboards with Recharts + interactive data tables (TanStack Table).

**Multi-brand support:** UNO and KSI are enabled, each with its own Foodstory DB. Brand is passed via `?brand=` URL param through hub → dashboards/reports. All API routes accept `?brand=` and query the correct DB via `getFoodstoryPool(brand)`.

**Hub page** has 2 phases: brand selection → workspace view (data sources, architecture modal, dashboard/report links). Phase 2 shows brand logo (no text), per-brand data freshness, and dynamic branch counts fetched from API.

**Pages (19):**
- `/intelligence` — Hub: brand selector → workspace with data sources, dashboards, reports
- `/intelligence/dashboards/master` — Executive Master Dashboard (KPI strips, dynamic view, full-data export, tour)
- `/intelligence/dashboards/master/print` — Print/PDF-ready version of Master Dashboard
- `/intelligence/dashboards/daily-sales` — Revenue trends, KPIs (Daily Sales Pulse)
- `/intelligence/dashboards/branch-performance` — Branch ranking
- `/intelligence/dashboards/top-products` — Best sellers, category mix
- `/intelligence/dashboards/hourly-products` — Hourly revenue dashboard
- `/intelligence/dashboards/product-by-hour` — Product x hour heatmap matrix
- `/intelligence/dashboards/product-option` — Product & option group analysis
- `/intelligence/reports/sales-monitor` — Daily sales by branch, channel
- `/intelligence/reports/sales-item` — Revenue by menu item
- `/intelligence/reports/transaction` — Bill-level detail (grouped by receipt)
- `/intelligence/reports/tender` — Payment breakdown (grouped by tender type)
- `/intelligence/reports/promotion` — Voucher usage & discounts
- `/intelligence/reports/void` — Voided items with reason
- `/intelligence/reports/vat` — Tax summary (7% VAT)
- `/intelligence/reports/edc` — Credit card / EDC transactions
- `/intelligence/reports/waste` — Barista quota & waste tracking
- `/intelligence/admin/permissions` — Permission management (IT Admin+)
- (Coming soon: Stock Movement, Recipe/BOM, Damage)

**Layouts:**
- `src/app/(dashboard)/intelligence/reports/layout.tsx` — Fixed positioning to fill viewport (no page scrollbar) + beta banner
- `src/app/(dashboard)/intelligence/dashboards/layout.tsx` — Beta banner for dashboards

**API Routes (37):** `/api/intelligence/*`
- `branches`, `data-freshness`, `holidays`
- `dashboards/daily-sales`, `dashboards/branch-performance`, `dashboards/top-products`, `dashboards/hourly-products`, `dashboards/product-by-hour`, `dashboards/product-option`, `dashboards/payment-mix`
- `dashboards/master/{kpi,hourly,mode-proportion,ticket-by-sale-type,sales-by/[colorBy],ads-trend,by-store,branch-map,distincts,full-data,full-data/count,export-pdf,preview-thumbnail,readiness}` — 14 routes powering the Master Dashboard
- `reports/sales-monitor`, `reports/sales-item`, `reports/transaction`, `reports/tender`, `reports/promotion`, `reports/void`, `reports/vat`, `reports/edc`, `reports/waste`
- `reports/send-email` — Email report as Excel attachment via Graph API
- `permissions` — GET: returns allowed brands for current user
- `permissions/admin` — GET/POST: CRUD for groups, members, brand permissions + user role management
- `etl/materialize` — Manual ETL trigger (materialization, not active yet)

**Other API Routes:**
- `GET /api/users/search?q=...` — Azure AD user search with photos (used by permissions admin)

**Master Dashboard (`/intelligence/dashboards/master`):**
- Self-contained namespace at `src/features/intelligence/master/`
  - `components/` — 8 export-modal files, 12 chart files, 4 filter files, LeftRail/RightRail/DashboardGrid/MasterDashboard, DashboardTour
  - `hooks/` — `useMasterFilters` (URL ↔ state), `useDistincts`/`useBranchMap` (brand-aware), `useChartTheme` (reads `[data-theme]` attribute), `useMasterData` (SWR + envelope unwrap)
  - `lib/` — `calc`, `palette`, `format`, `csv`, `exporters` (xlsx-js-style), `pdf-export` (dynamic-imported html2canvas+jspdf)
  - `types.ts` — `ViewKey`, `FilterKey`, `ColorByKey`, `MetricKey`, row types
- Brand resolution: `BrandConfig.DashboardDbConnectionId` + `DashboardDatabaseName` → `getBrandDashboardPool(brand)` from `src/lib/intelligence/brand-pool.ts`
- View: `dbo.vw_Foodstory_Clean` (apply via `npm run apply-sql -- --file sql/foodstory-views.sql`) — must exist in every brand's Dashboard DB
- API route shape: `buildMasterContext(req, route)` from `src/lib/intelligence/master-route.ts` handles auth + brand validation + cache + filter parsing; routes call `withCache(ctx, loader)` then return `jsonResponse`
- Cache: `src/lib/intelligence/api-cache.ts` — 90s TTL, brand-aware key
- Empty state when `BrandConfig` has no Dashboard DB configured — IT Admin+ sees link to `/settings/brand-config`

**Key components:**
- `src/features/intelligence/components/DataTable.tsx` — Reusable TanStack Table with search, multi-level group by, expand/collapse, column visibility toggle, Excel download, email export, schedule mockup, sticky header, footer totals, sparkline % in groups, right-aligned numbers, row hover, dynamic height measurement via useRef
- `src/features/intelligence/components/KpiCard.tsx` — Stat card with trend indicator
- `src/features/intelligence/components/DashboardLayout.tsx` — Shared dashboard wrapper with filters, brand logo in header, no brand switcher (brand set from URL)
- `src/features/intelligence/components/ReportKpiBar.tsx` — Inline KPI stat bar for reports
- `src/features/intelligence/components/ReportEmptyState.tsx` — Contextual empty state
- `src/features/intelligence/components/ReportLoading.tsx` — Logo + animated loading bar
- `src/features/intelligence/components/HourlyProducts.tsx` — Hourly revenue dashboard component
- `src/features/intelligence/components/ProductByHour.tsx` — Product x hour heatmap matrix component
- `src/features/intelligence/components/ProductOptionAnalysis.tsx` — Option group analysis component

**Key hooks:**
- `src/features/intelligence/hooks/useReportFilters.ts` — Persist report filters (brand, branch, dates) to localStorage

**Key files:**
- `src/features/intelligence/materialize.ts` — Materialization engine (built but not active yet)
- `sql/intel-materialized-tables.sql` — SQL for pre-computed tables (Intel_* tables in Fast_Data)

**Data sources:**
- Foodstory POS UNO (`Rocks_UNO_Data`) — 663K bill details, 17 branches
- Foodstory POS KSI (`Rocks_KSI_Data`) — 290K bill details, 6 branches
- Foodstory POS options (`FS_BillDetailOption`) — BillDetailId, OptionGroup, OptionValue (both UNO & KSI)
- Location Master (`Fast_Core`) — Store locations
- ETL status — `ETL_JobLog` in each Foodstory DB (per brand, status='success') + `Rocks_PCTH_Data` (centralized LocationSync, status='OK')
- Data freshness API returns separate entries per brand: `"Foodstory UNO"`, `"Foodstory KSI"`, `"Location Master"`
- Holidays — `[Rocks_Codex].[dbo].[Holiday]` cross-database query
- Business Central — Coming soon (Recipe, Inventory, Financial)
- Manual File — Coming soon (BD targets, flat files)

**Report financial formatting:**
- Revenue columns: blue (#2563eb) — `fmtRevenue()`
- Cost columns: red (#dc2626) — `fmtCost()`
- Neutral columns: default — `fmtBaht()`

**Foodstory query patterns:**
- Always filter: `void_flag != '1' AND is_revenue = '1'`
- Use `_num` columns for calculations: `quantity_num`, `price_num`, `discounted_price_num`
- Date column: `IngestDate` (business date)
- Branch filter: `CAST(b.branch_id AS NVARCHAR) = @branch`
- Branch join (deduplicated): `LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id` — **must use GROUP BY subquery** to avoid doubling SUM values from multiple sync dates
- Branch list: `GROUP BY branch_id` to deduplicate (multiple sync dates)
- Promotion (FS_VoucherUsage): filter by `branch_name` via subquery from `FS_MasterBranch`
- Option data: `FS_BillDetailOption` joined via `BillDetailId`

**Dashboard patterns:**
- Dashboard/report pages read `brand` from URL `?brand=` via `useSearchParams`, wrapped in `<Suspense>`, fallback to "UNO"
- Dashboard pages use from/to dates (not days count) for accurate period ranges
- QuickDateFilter has SDLW (Same Day Last Week) preset, mobile-hidden date inputs
- Date formatting: use local getters (e.g. `getFullYear()`, `getMonth()`), never `toISOString()` for display
- Server is Thai time — do NOT use `fixThaiDate()`
- Brand logos: `/brandlogo/{brand}-200.png` (e.g. `uno-200.png`, `ksi-200.png`)

**Report patterns:**
- Reports use `useReportFilters` hook for persisting filters to localStorage
- Reports have KPI summary bar (`ReportKpiBar`), filter chip, empty state (`ReportEmptyState`)
- Reports layout uses fixed positioning to fill viewport (no page scrollbar)
- DataTable dynamically measures available height with `useRef`
- Multi-level group by with expand/collapse and sparkline % in groups

**Permission System (Brand-level access control):**

Intelligence uses brand-level permissions. Forms + Locations have no permission check (everyone can access).

- **IT Admin / System Admin**: auto-access to all brands (no explicit permission needed)
- **Staff / Viewer**: need explicit brand permission (direct user grant or via group membership)
- **No permission**: user stays on brand selection page (cannot enter workspace)
- **Enforcement**: client-side on hub page; API routes do not enforce brand permission yet

**Permission tables (in Fast_Core):**
- `IntelPermissionGroup` — custom permission groups (e.g., "UNO Managers")
- `IntelPermissionGroupMember` — group membership by email
- `IntelBrandPermission` — grant brand access to a user (by email) or group (by GroupId)

**Admin page (`/intelligence/admin/permissions`):**
- 3-column layout: Groups | Members | Brand Access
- User Roles section (System Admin only) — add users from AD, change roles, resync from AD, deactivate
- AD search modal (Codex-style) with debounce, photos, "Already Added" indicator
- Proper confirm/role-picker modals (no native `confirm()`/`prompt()`)
- Access: IT Admin+ via profile dropdown "Permissions" link

**Key patterns:**
- AD search uses `$filter` with `startswith` (no `$orderby` — not supported on some tenants)
- Role hierarchy: System Admin > IT Admin > Staff/Viewer

### 3. Locations (`/locations`)

Brand locations map view — placeholder, coming soon.

### 4. Request → Accounting: Travel Expense Reimbursement (AP-1) (`/request/travel-expense`)

Office travel-expense reimbursement form — first form in the new **Accounting** group of the **Request** section.

**Storage:** Acc* tables live in **`Fast_Form`**, accessed via `getAccPool()` (= `getFormPool()`, `src/lib/acc/pool.ts`). Migrations: `migrations/013_portal_acc_core.sql` (shared header tables + AP-1 seed), `014_portal_acc_travel_expense.sql` (detail tables), `015_portal_acc_settings_kv.sql` (AccSetting). Apply with `npm run apply-sql -- --db Fast_Form --file <path>`.

**DB schema (Fast_Form, Acc* tables):**
- Generic header: `AccFormMaster` (form catalog), `AccRequest` (shared request header), `AccApproval`, `AccActivityLog`, `AccSequence`, `AccEmailQueue`, `AccRequestFile` — designed to support future Accounting forms
- Travel-expense detail: `AccTravelExpense` + `AccTravelExpenseItem`
- Settings: `AccApprover` (configured account approvers), `AccVehicle` (vehicle rate table), `AccFormBrand` (brand access per form)

**Running number:** `TOFyy-xxxx` (yy = 2-digit Christian year of submit date), resets per year, allocated atomically at submit via `src/lib/acc/sequence.ts`.

**Pages (4):**
- `/request/travel-expense` — Fill form + resume saved draft
- `/request/travel-expense/[id]` — Detail view: submission data, approval timeline, self-cancel (≤24 h after submit)
- `/request/accounting/approvals` — Accounting team working queue
- `/request/accounting/report` — Filter + Excel export of all requests
- `/request/accounting/settings` — IT Admin / System Admin: manage approvers, vehicles, brand access

**API Routes:** `/api/request/accounting/*`
- `requests` — list / create draft
- `requests/[id]` — GET detail, PATCH update draft, DELETE cancel
- `requests/[id]/submit` — allocate running number, trigger Manager email
- `requests/[id]/approve` — Manager or Account approval step; sets PaymentDate on Account approval
- `requests/[id]/reject` — reject with reason
- `requests/[id]/return` — return for revision
- `options/brands`, `options/vehicles` — dropdown data for form
- `payment-dates` — compute next 2nd / 4th Friday (holiday-shifted)
- `settings/approvers`, `settings/vehicles`, `settings/brands` — CRUD for admin settings
- `report`, `report/export` — filtered list + Excel download
- `email/process` — drain email queue (called opportunistically after each action)
- `files` — upload / download attached files

**Workflow:** Manager (resolved from `Rocks_Portal_HR.Employee.ManagerStaffId`) → Account (from `AccApprover` table). Email notification at every transition via Graph queue (`src/lib/acc/email-queue.ts`), drained after each action. Account approval sets `PaymentDate` = next 2nd or 4th Friday, shifted forward past holidays from `Rocks_Codex.Holiday`.

**Conditional fields:**
- `AccVehicle.IsManualEntry = true` → show fare + toll inputs; total = fare + toll
- `IsManualEntry = false` → show OpenRouteService (Leaflet/OSM) distance × rate + toll + parking inputs; rate lookup from `AccVehicle`
- **Distance picker:** `DistanceMapField` → `LeafletRoutePicker` (plain Leaflet, loaded `dynamic ssr:false`) + ORS geocoding/directions proxied via global `/api/ors/{geocode,directions}` (`src/lib/ors.ts`). Manual-km fallback when ORS is unavailable. (forms `route` field + locations still use Google Maps.)
- **OpenRouteService is a global system setting:** API key stored in `Fast_Core.AppSetting` (`src/lib/app-settings.ts`, migration 016) with `ORS_API_KEY` env fallback; resolved by `resolveOrsKey()`. Configured at **Settings → Configuration → OpenRouteService** (`/settings/openrouteservice`, IT/System Admin) via `/api/settings/ors` (+`/test`; key always masked). Reusable by any form needing maps.
- Shared calculation logic in `src/lib/acc/calc.ts`
- Travel date validation: unique per StaffId (except Rejected status), ≤1 month in the past, no future dates

**Key libs (`src/lib/acc/`):** `pool`, `sequence`, `payment-calendar`, `employee-context`, `brand-options`, `access`, `settings-service`, `request-service`, `approval-engine`, `report-service`, `email-queue`, `email-templates`, `calc`

**Feature UI:** `src/features/accounting/` — form components, approval queue, report table, settings panels

## Project Structure

```
src/
├── app/
│   ├── (auth)/login, unauthorized
│   ├── (dashboard)/
│   │   ├── forms/               # 8 pages
│   │   ├── intelligence/        # 17 pages (hub + 6 dashboards + 9 reports + 1 admin)
│   │   │   ├── dashboards/layout.tsx  # Beta banner
│   │   │   └── reports/layout.tsx     # Fixed viewport layout + beta banner
│   │   ├── locations/           # 1 page (placeholder)
│   │   └── page.tsx             # Dashboard home
│   ├── api/
│   │   ├── auth/                # NextAuth
│   │   ├── forms/               # 16 routes
│   │   ├── intelligence/        # 23 routes (branches, data-freshness, holidays, 6 dashboards, 9 reports, send-email, permissions, permissions/admin, etl/materialize)
│   │   └── users/               # 1 route (search — AD user search)
│   ├── loading.tsx              # Global loading screen (Rocks Group logo + animated bar)
│   └── layout.tsx
├── features/
│   ├── forms/                   # Types, schemas, constants, workflow-engine, email, components, hooks
│   └── intelligence/            # Types, constants, DataTable, dashboards, components, hooks, materialize.ts
├── components/
│   ├── ui/                      # Button, Badge, Avatar, Dialog, DropdownMenu, SidePanel, FullScreenModal
│   └── layout/                  # Navbar, RouteGuard, PageContainer
├── lib/
│   ├── db/mssql.ts              # Multi-DB pools (Core, Form, Data, Foodstory) + teamMemberTable(), pool max=30
│   ├── graph.ts                 # Microsoft Graph API (searchADUsers, getADUserByEmail, getADUserPhoto, sendEmail)
│   ├── storage.ts               # File storage
│   ├── auth.ts, auth.config.ts, api-auth.ts
│   └── hooks/
├── env.ts                       # Type-safe env validation
sql/
└── intel-materialized-tables.sql  # Pre-computed Intel_* tables for Fast_Data
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
- **Charts**: `recharts` for dashboards, `@tanstack/react-table` for interactive data tables
- **Excel**: `xlsx-js-style` (not `xlsx` — old SheetJS CE has vulnerabilities)
- **Components**: `"use client"` only when needed. Use existing UI components from `@/components/ui`
- **ES5 target**: Don't use `[...set]` or `[...map.values()]` — use `Array.from()` instead
- **Financial colors**: Revenue = blue `fmtRevenue()`, Cost = red `fmtCost()`, Neutral = default `fmtBaht()`
- **Date display**: Use local getters (`getFullYear()`, `getMonth()`), never `toISOString()` — server is Thai time, do NOT use `fixThaiDate()`
- **Logos**: Rocks Group logo for navbar/favicon, Codex Family logo for app loading screen
- **Report filters**: Persist to localStorage via `useReportFilters` hook

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
MSSQL_FORM_DATABASE=Fast_Form
MSSQL_DATA_DATABASE=Fast_Data

# Email
GRAPH_MAIL_FROM=noreply@rocksgroup.com

# Foodstory
FOODSTORY_DB_HOST=
FOODSTORY_BRANDS={"UNO":"Rocks_UNO_Data","KSI":"Rocks_KSI_Data"}

# Client
NEXT_PUBLIC_APP_URL=http://localhost:3020
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```
