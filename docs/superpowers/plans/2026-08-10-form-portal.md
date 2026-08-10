# Form Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up **Form Portal** — a clone of Rocks Fast with Fast Intelligence and Locations removed, restructured around a form catalogue and restyled to the "Sky" pastel theme, sharing the existing databases.

**Architecture:** Copy the Rocks Fast source tree into `c:\Users\PC\source\repos\Web\Form_Portal`, boot it on port 3021 against the same databases, then prune the two removed features, then restyle. Every retained feature keeps its existing API routes, services, and workflow logic untouched — only navigation, theme tokens, and the home page are rewritten.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS 4, NextAuth 5 (Microsoft Entra ID), `mssql`, SWR, sonner, Leaflet, `@react-google-maps/api`, `xlsx-js-style`, `tesseract.js`, `@dnd-kit/*`.

**Spec:** `docs/superpowers/specs/2026-08-10-form-portal-clone-design.md`

## Global Constraints

- **Source project** is `c:\Users\PC\source\repos\Web\RocksFast`. It is read-only for this work — never modify it.
- **Target project** is `c:\Users\PC\source\repos\Web\Form_Portal`. It already contains `.git`, `.gitignore`, and `docs/superpowers/`.
- **Shared databases.** Fast_Core, Fast_Form, Fast_Data, Rocks_Portal_HR, Rocks_Codex are shared live with Rocks Fast. **No migration may be written, run, or altered.** Do not `DROP`, `ALTER`, or `DELETE` anything.
- **Port is 3021** everywhere: `package.json` scripts, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `ecosystem.config.cjs`, `ERP_SANDBOX_ALLOWED_HOSTS`.
- **No test framework exists** in this codebase. Verification for every task is: `npx tsc --noEmit` passes, `npm run build` succeeds, plus the grep assertions and manual page checks written into each task. `npm run lint` is **not** available (no ESLint config file exists) — do not add one.
- **ES5 target.** Never use `[...set]` or `[...map.values()]`; use `Array.from()`.
- **CSS:** use `var(--token)` only, never raw hex, in `.tsx` files. Raw hex belongs in `globals.css`.
- **Icons:** `lucide-react` only. **Toasts:** `sonner`.
- **API response shape:** `{ ok: true, data }` or `{ ok: false, error }`.
- **SQL:** parameterised queries only (`pool.request().input(...)`).
- **Dates:** use local getters (`getFullYear()`, `getMonth()`), never `toISOString()` for display. The server runs on Thai time — do not use `fixThaiDate()`.
- **Menu labels are English** (`Home`, `Forms`, `My Requests`, `My Work`, `Settings`). In-page copy stays Thai.
- **Commit after every task.** Co-author trailer on every commit:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## File Structure

### Created

| File | Responsibility |
|---|---|
| `.env.local` | Local credentials + port 3021 + `UPLOAD_ROOT` (never committed) |
| `src/app/api/settings/users/route.ts` | GET team members; POST `updateRole` / `addUser` / `deleteUser` / `resyncAll` |
| `src/app/(dashboard)/settings/users/page.tsx` | Users & Roles admin UI |
| `src/features/home/HomeCatalogue.tsx` | Home page body — greeting, stat strip, search, drafts, forms by category |
| `src/features/home/useHomeData.ts` | SWR hooks that assemble home-page data from existing endpoints |

### Modified

| File | Change |
|---|---|
| `package.json` | name → `form-portal`, ports → 3021, five dependencies removed, `smoke` script removed |
| `ecosystem.config.cjs` | app name + port |
| `.env.example` | port 3021, `UPLOAD_ROOT` added, `FOODSTORY_*` removed |
| `src/lib/storage.ts` | `UPLOAD_ROOT` env override |
| `src/lib/acc/erp-environment-shared.ts` | `ERP_SANDBOX_ALLOWED_HOSTS` → 3021 |
| `src/lib/constants.ts` | `NAV`, `HOME_CARDS`, `SETTINGS_CARDS`, `NavItem` |
| `src/lib/auth.ts`, `src/lib/auth.config.ts` | `hasIntel` removed |
| `src/lib/db/mssql.ts` | `getFoodstoryPool` removed, `getDataPool` kept |
| `src/components/layout/RouteGuard.tsx` | Intel block removed |
| `src/components/layout/Navbar.tsx` | capsule nav, English labels, gradient mark |
| `src/components/ThemeProvider.tsx` | `gold` → `dark`, dead helpers removed, storage key |
| `src/app/layout.tsx` | no-flash script: key + theme name |
| `src/app/globals.css` | Sky palette, `.acc-theme` retune, `.master-scope` removed |
| `src/app/(dashboard)/page.tsx` | rewritten as the catalogue |
| `src/app/(dashboard)/settings/brand-config/page.tsx` | Dashboard DB group hidden (UI only) |
| `scripts/apply-sql.ts` | `--brand` modes removed; `--db` only |
| `src/features/travel-booking/components/ColumnToggleMenu.tsx` | stale comment |
| `CLAUDE.md`, `ROCKS-UI-GUIDE.md` | rewritten for Form Portal |

### Deleted

`src/app/(dashboard)/intelligence/`, `src/app/(dashboard)/locations/`, `src/app/api/intelligence/`, `src/app/api/locations/`, `src/features/intelligence/`, `src/features/locations/`, `src/lib/intelligence/`, `src/lib/intel-access.ts`, `sql/*.sql`, `scripts/smoke-test.ts`

---

## Task 1: Clone the tree and boot it on port 3021

**Files:**
- Copy: `c:\Users\PC\source\repos\Web\RocksFast\*` → `c:\Users\PC\source\repos\Web\Form_Portal\*`
- Create: `.env.local`
- Modify: `package.json`, `ecosystem.config.cjs`, `.env.example`, `src/lib/storage.ts`, `src/lib/acc/erp-environment-shared.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a working Form Portal tree on port 3021. Later tasks assume `Form_Portal/src/...` mirrors `RocksFast/src/...` exactly, minus the exclusion list.

- [ ] **Step 1: Copy the source tree**

Run in PowerShell. `robocopy` returns 0–7 on success, so the exit code must be normalised or the tool call reports failure.

```powershell
robocopy "c:\Users\PC\source\repos\Web\RocksFast" "c:\Users\PC\source\repos\Web\Form_Portal" /E `
  /XD node_modules .next .git uploads sampledata sampleform .superpowers .cache docs logs .claude `
  /XF .env.local tsconfig.tsbuildinfo .AutoDeploy.bat .gitignore
if ($LASTEXITCODE -le 7) { $global:LASTEXITCODE = 0; "copy ok" } else { "copy FAILED: $LASTEXITCODE" }
```

`docs` is excluded so the spec and this plan are not overwritten by Rocks Fast's own docs folder.

- [ ] **Step 2: Verify the copy landed and nothing forbidden came with it**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
find src -type f \( -name "*.ts" -o -name "*.tsx" \) | wc -l   # expect 566
ls public/brandlogo/rocks.png migrations sql scripts             # all must exist
ls -a | grep -E "^\.env\.local$|^node_modules$|^\.next$|^uploads$" || echo "clean — none of the excluded paths present"
git status --short | head                                        # spec + plan already committed; everything else untracked
```

Expected: `566`, the four paths listed, and the "clean" message.

- [ ] **Step 3: Rename the package and set the port**

Edit `package.json`:

```json
  "name": "form-portal",
  "version": "1.0.0",
  "description": "Form and request portal for Rocks Group",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3021",
    "build": "next build",
    "start": "next start -p 3021",
    "lint": "eslint src/",
    "apply-sql": "tsx scripts/apply-sql.ts"
  },
```

(The `smoke` script is dropped here — `scripts/smoke-test.ts` depends on `getBrandDashboardPool`, which Task 2 deletes.)

- [ ] **Step 4: Update the PM2 config**

In `ecosystem.config.cjs`, change the app `name` to `form-portal` and every occurrence of `3020` to `3021`. Read the file first; keep all other fields as they are.

- [ ] **Step 5: Move the ERP sandbox host gate to the new port**

`src/lib/acc/erp-environment-shared.ts:4` — replace:

```ts
export const ERP_SANDBOX_ALLOWED_HOSTS = ["localhost:3021", "127.0.0.1:3021"] as const;
```

This gate controls the `devHostOnly` management cards on `/request` and the ERP Sandbox toggle. Missing it makes them silently disappear.

- [ ] **Step 6: Make the local upload root configurable**

`src/lib/storage.ts:4` — replace the hardcoded constant:

```ts
const UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(process.cwd(), "uploads", "forms");
```

Leave `uploadFile`, `downloadFile`, and `deleteFile` untouched. Accounting attachments go to SharePoint; this path serves the Form Builder and older Accounting rows.

- [ ] **Step 7: Update `.env.example`**

- `NEXTAUTH_URL` → `http://localhost:3021`
- `NEXT_PUBLIC_APP_URL` → `http://localhost:3021`
- Delete the `FOODSTORY_DB_HOST` and `FOODSTORY_BRANDS` lines and their comment header
- Add under a `# Storage` heading:

```env
# Local attachment root (Form Builder + legacy accounting files).
# Point this at the Rocks Fast uploads folder so existing files stay downloadable.
UPLOAD_ROOT=c:/Users/PC/source/repos/Web/RocksFast/uploads/forms
```

Keep every other key, including `MSSQL_DATA_DATABASE`, `SHAREPOINT_ACC_SITE`, `SHAREPOINT_ACC_FOLDER`, `CONNECTION_ENCRYPTION_KEY`, `ORS_API_KEY`, `GOOGLE_MAPS_API_KEY`.

- [ ] **Step 8: Create `.env.local`**

Copy `c:\Users\PC\source\repos\Web\RocksFast\.env.local` to `c:\Users\PC\source\repos\Web\Form_Portal\.env.local`, then in the copy:
- set `NEXTAUTH_URL=http://localhost:3021`
- set `NEXT_PUBLIC_APP_URL=http://localhost:3021`
- append `UPLOAD_ROOT=c:/Users/PC/source/repos/Web/RocksFast/uploads/forms`
- delete `FOODSTORY_DB_HOST` and `FOODSTORY_BRANDS`

Confirm `.env.local` is ignored:

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal" && git check-ignore -v .env.local
```

Expected: a line naming `.gitignore` — **if this prints nothing, stop and fix `.gitignore` before continuing.**

- [ ] **Step 9: Install and typecheck**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
npm install
npx tsc --noEmit
```

Expected: install completes; `tsc` prints nothing (exit 0).

- [ ] **Step 10: Build**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal" && npm run build
```

Expected: "Compiled successfully" and a route list that still includes `/intelligence` and `/locations` — they are removed in Task 2.

- [ ] **Step 11: Run it and check the app answers on 3021**

Start `npm run dev` in the background, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3021/api/auth/providers
```

Expected: `200`. Then open http://localhost:3021 in a browser, sign in, and confirm the home page renders. Stop the dev server afterwards.

- [ ] **Step 12: Commit**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git add -A
git commit -m "$(cat <<'EOF'
chore: clone Rocks Fast source into Form Portal on port 3021

Shares the existing databases. UPLOAD_ROOT points at the Rocks Fast
uploads folder so attachments already in the shared DB stay readable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Remove Fast Intelligence and Locations

**Files:**
- Delete: `src/app/(dashboard)/intelligence/`, `src/app/(dashboard)/locations/`, `src/app/api/intelligence/`, `src/app/api/locations/`, `src/features/intelligence/`, `src/features/locations/`, `src/lib/intelligence/`, `src/lib/intel-access.ts`, `sql/foodstory-views.sql`, `sql/intel-materialized-tables.sql`, `sql/intel-permissions.sql`, `scripts/smoke-test.ts`
- Modify: `src/lib/constants.ts`, `src/lib/auth.ts`, `src/lib/auth.config.ts`, `src/lib/db/mssql.ts`, `src/components/layout/RouteGuard.tsx`, `src/components/layout/Navbar.tsx`, `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/settings/brand-config/page.tsx`, `src/app/globals.css`, `src/features/travel-booking/components/ColumnToggleMenu.tsx`, `scripts/apply-sql.ts`, `package.json`
- Do **not** modify: `src/lib/brand-config.ts` (shared config service Rocks Fast still reads)

**Interfaces:**
- Consumes: the tree from Task 1.
- Produces: a build with zero references to `intelligence`, `locations`, or `hasIntel`. `session.user` no longer carries `hasIntel`. `getDataPool()` and `getCorePool()`/`getFormPool()`/`getAccPool()` remain exported from `src/lib/db/mssql.ts`; `getFoodstoryPool` no longer exists.

- [ ] **Step 1: Delete the feature directories and SQL**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
rm -rf "src/app/(dashboard)/intelligence" "src/app/(dashboard)/locations" \
       src/app/api/intelligence src/app/api/locations \
       src/features/intelligence src/features/locations \
       src/lib/intelligence src/lib/intel-access.ts \
       sql/foodstory-views.sql sql/intel-materialized-tables.sql sql/intel-permissions.sql \
       scripts/smoke-test.ts
```

Keep the now-empty `sql/` directory for future use.

- [ ] **Step 2: Strip the Intelligence entries from `src/lib/constants.ts`**

In `NavItem`, delete the `requiresIntel` field and its doc comment. Replace the whole `NAV` array with:

```ts
export const NAV: NavItem[] = [
  {
    id: "forms",
    label: "Forms",
    icon: "FileText",
    desc: "ฟอร์มทั้งหมดและคำขอที่ส่งได้",
    href: "/forms",
  },
  {
    id: "my-request",
    label: "My Requests",
    icon: "Send",
    desc: "คำขอที่คุณส่งและสถานะ",
    href: "/my-request",
  },
  {
    id: "my-work",
    label: "My Work",
    icon: "ClipboardCheck",
    desc: "คำขอที่รอคุณอนุมัติหรือเกี่ยวข้อง",
    href: "/my-work",
  },
];
```

`HOME_CARDS` is no longer used by the new home page (Task 6) but other code may still import it; leave the export in place and simplify its body to:

```ts
export const HOME_CARDS: NavItem[] = NAV.filter(
  (n) => n.id !== "my-work" && n.id !== "my-request",
);
```

In `SETTINGS_CARDS`, delete the `intel-permissions` entry and append:

```ts
  {
    id: "users",
    label: "Users & Roles",
    icon: "Shield",
    desc: "จัดการผู้ใช้ บทบาท และการซิงก์จาก Active Directory",
    href: "/settings/users",
  },
  {
    id: "manage-forms",
    label: "Manage Forms",
    icon: "FileText",
    desc: "สร้างและแก้ไขฟอร์ม พร้อมตั้งค่าลำดับการอนุมัติ",
    href: "/forms/admin",
  },
  {
    id: "accounting-admin",
    label: "Accounting Admin",
    icon: "ClipboardList",
    desc: "คิวอนุมัติ รายงาน และตั้งค่าของ AP-1 / AP-17",
    href: "/request/accounting",
  },
```

Also update the `maps` card description — it mentions Locations, which no longer exists:

```ts
    desc: "Google Maps API Key (AP-1 · ฟอร์ม)",
```

- [ ] **Step 3: Remove `hasIntel` from auth**

`src/lib/auth.config.ts` — delete `hasIntel: boolean;` from the `Session["user"]` augmentation and `hasIntel?: boolean;` from the JWT augmentation.

`src/lib/auth.ts` — delete the `getCachedHasIntel` helper and its cache (around line 56), the `t.hasIntel = …` assignment and its `try/catch` in the `jwt` callback (around lines 224–227), and the `session.user.hasIntel = …` line (around line 246). Read the surrounding code before cutting so the remaining `try/catch` structure stays valid.

- [ ] **Step 4: Drop the Intel branch from `RouteGuard`**

Replace `src/components/layout/RouteGuard.tsx` with:

```tsx
"use client";

import { useSession, signIn } from "next-auth/react";
import { useIsMobile } from "@/lib/hooks/useIsMobile";

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isMobile = useIsMobile();

  if (status === "loading") return null;

  if (status === "unauthenticated") {
    if (isMobile) {
      signIn("microsoft-entra-id", { callbackUrl: "/" });
      return null;
    }
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return null;
  }

  return <>{children}</>;
}
```

- [ ] **Step 5: Remove Foodstory pools from `src/lib/db/mssql.ts`**

Delete `getFoodstoryPool` and any Foodstory brand-map parsing (`FOODSTORY_BRANDS`, `FOODSTORY_DB_HOST`) it depends on. **Keep `getCorePool`, `getFormPool`, `getDataPool`, `getAccPool`, `teamMemberTable`, and the exported `sql`.** `getDataPool` is used by `src/lib/acc/department-map-service.ts`, `src/lib/acc/travel-booking/province-service.ts`, `src/lib/acc/travel-booking/request-service.ts`, `src/lib/erp/account-sync.ts`, and `src/lib/erp/dimension-sync.ts`.

Then remove the matching keys from `src/env.ts` if they are declared there.

- [ ] **Step 6: Patch the temporary holes in Navbar and the home page**

These two files are fully rewritten in Tasks 5 and 6; here they only need to compile.

`src/components/layout/Navbar.tsx` — delete the `hasIntel` line and change `visibleNav` to `const visibleNav = NAV;`, then remove `BarChart3` and `MapPin` from the lucide import and `ICON_MAP`.

`src/app/(dashboard)/page.tsx` — delete the `hasIntel` line, change `visibleHomeCards` to `const visibleHomeCards = HOME_CARDS;`, and remove `BarChart3` / `MapPin` from the lucide import and `ICON_MAP`.

- [ ] **Step 7: Remove the Master Dashboard CSS scope**

In `src/app/globals.css`, delete the `@theme` comment block about "Dashboard-reference Tailwind tokens" and the four tokens it introduces (`--color-accent`, `--color-positive`, `--color-cardBorder`, `--color-muted`) — they exist only for the charts.

Then remove the Master Dashboard styles. **Do not delete the whole span from `.master-scope {` to the `/* ===== End Master Dashboard scoped styles ===== */` marker as one block** — that range interleaves app-wide and Accounting rules that retained components still use (`.tour-fab*`, `.acc-spin`, `.acc-ping`, `.acc-progress`, `.acc-fade-up`, `.acc-add-row`, `.acc-draft-del`, `.page-back-btn`, and the keyframes they depend on). CSS classes are not typechecked, so `tsc` and `npm run build` will pass while the UI silently breaks.

Instead, delete selector by selector: every rule whose selector is `.master-scope`-scoped, plus `.recharts-*` rules (the charts are gone), plus any rule you confirm has zero references in `src/`. For each candidate rule, grep the class name across `src/` first and keep anything still referenced.

Then confirm nothing else referenced them:

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
grep -rn "master-scope\|bg-accent\|text-muted\b\|border-cardBorder\|bg-positive" src --include=*.tsx | head
```

Expected: no matches. If a match appears, restore only the specific token that file needs.

- [ ] **Step 8: Cut the brand-pool dependency out of `scripts/apply-sql.ts`**

`scripts/apply-sql.ts` dynamically imports `../src/lib/intelligence/brand-pool` for its `--brand` mode and for enumerating every brand with a Dashboard DB. That module is gone, and this project only ever targets a named database (`npm run apply-sql -- --db Fast_Form --file <path>`).

Edit the script so `--db <name>` is the only mode:
- delete the `--brand` / `-b` argument parsing (around line 53) and the `brand` field from the `Args` type
- delete the `if (args.brand) { … }` block (around lines 110–124) and the `else` branch that enumerates brand targets (around lines 125–150), including both dynamic imports of `brand-pool`
- when `--db` is absent, exit with a usage error: `"--db <database> is required, e.g. --db Fast_Form"`
- update the file's header comment to describe the single mode

Verify:

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
grep -rn "brand-pool\|getBrandDashboardPool\|listConfiguredBrandTargets" scripts src
```

Expected: no matches.

- [ ] **Step 9: Hide the Dashboard group on the Brand Configuration page**

`BrandConfig.DashboardDbConnectionId` / `DashboardDatabaseName` only ever fed the Master Dashboard. The columns stay in the database and `src/lib/brand-config.ts` stays **completely untouched** — Rocks Fast still reads both, and editing them from here could desync it. Only the UI stops offering them.

In `src/app/(dashboard)/settings/brand-config/page.tsx`:
- delete the `getDashboardGroupStatus` helper (around line 131) and both call sites that push it into the group-status arrays (around lines 149 and 157)
- delete the `dashboard: "Dashboard"` entry from the group-label map (around line 234)
- remove the Dashboard connection/database inputs from the form JSX and the `dashboardDbList` prop threading (around line 367)
- leave the `dashboardDbConnectionId` / `dashboardDatabaseName` fields in the local types and in the payload sent on save, populated from whatever the API returned, so saving a brand does not blank out Rocks Fast's values

Verify by opening `/settings/brand-config`, editing an unrelated field on one brand, saving, and confirming with a read-only query that the two Dashboard columns kept their previous values:

```sql
SELECT BrandCode, DashboardDbConnectionId, DashboardDatabaseName FROM BrandConfig;
```

- [ ] **Step 10: Fix the stale comment in ColumnToggleMenu**

`src/features/travel-booking/components/ColumnToggleMenu.tsx:15` references `src/features/intelligence/components/DataTable.tsx`, which no longer exists. Reword the comment to describe the behaviour without the dead path — e.g. "plain absolute-positioned dropdown, no portal".

- [ ] **Step 11: Drop the Intelligence-only dependencies**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
npm uninstall recharts @tanstack/react-table openai @anthropic-ai/sdk @google/generative-ai
```

- [ ] **Step 12: Assert the removal is complete**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
grep -rn "intelligence\|hasIntel\|getFoodstoryPool\|getBrandDashboardPool\|IntelBrandPermission\|IntelPermissionGroup" src scripts --include=*.ts --include=*.tsx
grep -rni "locations" src --include=*.ts --include=*.tsx
```

Expected: the first command prints nothing. The second may print matches inside Google Maps or ORS code (`locations` is part of those APIs) — inspect each and confirm none refer to the deleted feature.

- [ ] **Step 13: Typecheck and build**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
npx tsc --noEmit && npm run build
```

Expected: both succeed, and the printed route list no longer contains `/intelligence` or `/locations`.

- [ ] **Step 14: Check every retained page still loads**

Start `npm run dev`, sign in, and open each of these. Each must render without a console error:

`/` · `/forms` · `/forms/admin` · `/forms/approvals` · `/my-request` · `/my-work` · `/request` · `/request/travel-expense` · `/request/travel-booking` · `/request/accounting` · `/request/accounting/approvals` · `/request/accounting/report` · `/settings` · `/settings/maps` · `/settings/connections` · `/settings/brand-config`

- [ ] **Step 15: Commit**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git add -A
git commit -m "$(cat <<'EOF'
feat: remove Fast Intelligence and Locations

Deletes both feature trees, their API routes, the Foodstory pools, the
hasIntel session flag, and the Master Dashboard CSS scope. Drops five
dependencies used only by Intelligence. apply-sql loses its brand modes
and now takes --db only. Brand Configuration stops offering the Dashboard
DB fields, but keeps sending their existing values on save. Intel* tables
and BrandConfig columns are left untouched — Rocks Fast still reads them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Users & Roles under Settings

**Files:**
- Create: `src/app/api/settings/users/route.ts`, `src/app/(dashboard)/settings/users/page.tsx`
- Reference (read-only, in the **source** project): `RocksFast/src/app/(dashboard)/intelligence/admin/permissions/page.tsx`, `RocksFast/src/app/api/intelligence/permissions/admin/route.ts`

**Interfaces:**
- Consumes: `requireRole` from `@/lib/api-auth`, `getCorePool` + `sql` from `@/lib/db/mssql`, `getADUserByEmail` from `@/lib/graph`, `/api/users/search` (already exists).
- Produces: `GET /api/settings/users` → `{ ok: true, data: { users: Array<{ id: number; name: string; nickname: string; email: string; role: string }> } }`; `POST /api/settings/users` accepting `{ action: "updateRole" | "addUser" | "deleteUser" | "resyncAll", ... }`.

- [ ] **Step 1: Create the API route**

Create `src/app/api/settings/users/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getCorePool, sql } from "@/lib/db/mssql";
import { getADUserByEmail } from "@/lib/graph";
import { requireRole } from "@/lib/api-auth";

const VALID_ROLES = ["Staff", "IT Admin", "System Admin", "Viewer"];

/** GET /api/settings/users — active team members for the Users & Roles page. */
export async function GET() {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const pool = await getCorePool();
    const users = await pool.request().query(`
      SELECT Id, FullName, Nickname, Email, AppRole
      FROM TeamMember WHERE IsActive = 1 ORDER BY FullName
    `);

    return NextResponse.json({
      ok: true,
      data: {
        users: users.recordset.map((u: Record<string, unknown>) => ({
          id: u.Id,
          name: u.FullName,
          nickname: u.Nickname,
          email: u.Email,
          role: u.AppRole,
        })),
      },
    });
  } catch (err) {
    console.error("[api/settings/users] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/settings/users — actions: updateRole, addUser, deleteUser, resyncAll. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const userId = Number(session.user?.id ?? 0);
    const currentRole = (session.user?.role ?? "") as string;
    if (currentRole !== "System Admin") {
      return NextResponse.json({ ok: false, error: "Only System Admin can manage users" }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body as { action: string };
    const pool = await getCorePool();

    switch (action) {
      case "updateRole": {
        const { targetUserId, newRole } = body as { targetUserId: number; newRole: string };
        if (!targetUserId || !VALID_ROLES.includes(newRole)) {
          return NextResponse.json({ ok: false, error: "Invalid userId or role" }, { status: 400 });
        }
        if (targetUserId === userId && newRole !== "System Admin") {
          return NextResponse.json({ ok: false, error: "Cannot change your own role" }, { status: 400 });
        }
        await pool.request()
          .input("id", sql.Int, targetUserId)
          .input("role", sql.NVarChar, newRole)
          .query("UPDATE TeamMember SET AppRole = @role, UpdatedAt = GETDATE() WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "addUser": {
        const { name, email, nickname, role: requestedRole } = body as {
          name: string; email: string; nickname?: string; role?: string;
        };
        if (!name || !email) {
          return NextResponse.json({ ok: false, error: "name and email required" }, { status: 400 });
        }
        const role = VALID_ROLES.includes(requestedRole ?? "") ? requestedRole! : "Staff";
        const result = await pool.request()
          .input("name", sql.NVarChar, name.trim())
          .input("nickname", sql.NVarChar, (nickname ?? name.split(" ")[0]).trim())
          .input("email", sql.NVarChar, email.toLowerCase().trim())
          .input("role", sql.NVarChar, role)
          .input("color", sql.NVarChar, "#6c757d")
          .query(`
            IF NOT EXISTS (SELECT 1 FROM TeamMember WHERE LOWER(LTRIM(RTRIM(Email))) = @email)
            INSERT INTO TeamMember (FullName, Nickname, Email, AppRole, Position, Color, IsActive)
            OUTPUT INSERTED.Id
            VALUES (@name, @nickname, @email, @role, '', @color, 1)
          `);
        return NextResponse.json({ ok: true, data: result.recordset[0] });
      }

      case "deleteUser": {
        const { targetUserId } = body as { targetUserId: number };
        if (targetUserId === userId) {
          return NextResponse.json({ ok: false, error: "Cannot delete yourself" }, { status: 400 });
        }
        await pool.request().input("id", sql.Int, targetUserId)
          .query("UPDATE TeamMember SET IsActive = 0, UpdatedAt = GETDATE() WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "resyncAll": {
        const allUsers = await pool.request()
          .query("SELECT Id, Email, FullName FROM TeamMember WHERE IsActive = 1");
        let synced = 0;
        for (const u of allUsers.recordset) {
          try {
            const adUser = await getADUserByEmail(u.Email as string);
            if (adUser && adUser.displayName !== u.FullName) {
              await pool.request()
                .input("id", sql.Int, u.Id)
                .input("name", sql.NVarChar, adUser.displayName)
                .query("UPDATE TeamMember SET FullName = @name, UpdatedAt = GETDATE() WHERE Id = @id");
              synced++;
            }
          } catch { /* skip failed lookups */ }
        }
        return NextResponse.json({ ok: true, data: { synced, total: allUsers.recordset.length } });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/settings/users] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Seed the page from the old permissions page**

Copy the source file so the modals come across intact, then trim it:

```bash
cp "c:/Users/PC/source/repos/Web/RocksFast/src/app/(dashboard)/intelligence/admin/permissions/page.tsx" \
   "c:/Users/PC/source/repos/Web/Form_Portal/src/app/(dashboard)/settings/users/page.tsx"
```

The copied file contains four helper components worth keeping verbatim — `ConfirmModal` (lines 14–33), `RolePickerModal` (34–68), `ADSearchModal` (69–189), and `ADUserSearch` (190–242) — plus `PermissionsAdminPage` from line 243, whose "User Roles" section starts at line 509.

- [ ] **Step 3: Trim the page down to Users & Roles**

In `src/app/(dashboard)/settings/users/page.tsx`:

1. Keep `ConfirmModal`, `RolePickerModal`, and `ADSearchModal` unchanged. Delete `ADUserSearch` — it exists only for the group/brand pickers.
2. Rename the default export to `SettingsUsersPage`.
3. Delete every piece of group / brand state and its JSX: `groups`, `members`, `permissions`, `newGroupName`, `newGroupDesc`, `selectedGroup`, `grantBrand`, `grantTarget`, `grantGroupId`, and the two left-hand columns. Keep `users`, `showAddUserModal`, `confirmAction`, and `rolePickerFor`.
4. Point `doAction` and the data load at the new endpoint — every `"/api/intelligence/permissions/admin"` becomes `"/api/settings/users"`.
5. The load handler now reads `json.data.users` only.
6. Replace the three-column wrapper with a single-column layout using `PageContainer` + `PageHeaderBar`, matching the other settings pages:

```tsx
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Shield } from "lucide-react";

// …inside the component's return:
<PageContainer className="py-6 px-3 sm:px-0">
  <PageHeaderBar
    icon={Shield}
    title="Users & Roles"
    subtitle="จัดการผู้ใช้ บทบาท และการซิงก์จาก Active Directory"
    backHref="/settings"
  />
  {/* the retained User Roles card, unchanged */}
</PageContainer>
```

7. Delete any now-unused imports. `npx tsc --noEmit` will name them.

- [ ] **Step 4: Typecheck and build**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
npx tsc --noEmit && npm run build
```

Expected: both pass; the route list includes `/settings/users` and `/api/settings/users`.

- [ ] **Step 5: Verify against the live database — read paths first**

Start `npm run dev`, sign in as a System Admin, open `/settings` and confirm the **Users & Roles**, **Manage Forms**, and **Accounting Admin** cards appear and the Intelligence Permissions card is gone. Open `/settings/users` and confirm the user list loads with correct names, emails, and roles.

- [ ] **Step 6: Verify the write paths**

These touch the shared production database, so use a reversible sequence on your own account:

1. **Add user** — open the AD search modal, add a user who is not yet in `TeamMember`, then immediately deactivate them with Delete. Confirm both actions report success.
2. **Change role** — change that same user's role once before deactivating. Confirm the list refreshes with the new role.
3. **Resync from AD** — run it and confirm it reports `{ synced, total }` without error.
4. **Guard rails** — attempt to change your own role to `Staff` and to delete yourself. Both must be refused with the API's error message.

Do not change roles for any other existing user.

- [ ] **Step 7: Commit**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git add -A
git commit -m "$(cat <<'EOF'
feat(settings): Users & Roles page replacing the Intelligence permissions screen

Ports the user-role management half of the old permissions admin — list,
AD search, role change, deactivate, resync — to /settings/users backed by
/api/settings/users. Group and brand-permission management is not carried
over.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Sky theme

**Files:**
- Modify: `src/app/globals.css`, `src/components/ThemeProvider.tsx`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond a compiling tree.
- Produces: `type Theme = "light" | "dark"` exported behaviour from `ThemeProvider`; `useTheme()` returns `{ theme, toggleTheme, setTheme }` unchanged. New tokens available to all components: `--radius-card`, `--radius-tile`, `--shadow-card`, `--shadow-lift`, `--status-{pending,ok,draft,bad}-{bg,text}`.

- [ ] **Step 1: Replace the light palette**

In `src/app/globals.css`, replace the whole `:root, [data-theme="light"] { … }` block (lines 94–178) with:

```css
:root,
[data-theme="light"] {
  --navbar-h: 48px;

  /* Backgrounds */
  --bg-page: #f4f7fc;
  --bg-base: #ffffff;
  --bg-card: #ffffff;
  --bg-card-hover: #f7f9fd;
  --bg-card-alt: #f4f7fc;
  --bg-elevated: #ffffff;
  --bg-input: #ffffff;
  --bg-sidebar: #1b2434;
  --bg-topbar: rgba(255, 255, 255, 0.78);
  --bg-modal: #ffffff;
  --bg-dropdown: #ffffff;
  --bg-row-stripe: #f9fbfe;
  --bg-row-hover: #eff4fb;
  --bg-selected: #e8effc;
  --bg-badge: #eef3fb;
  --bg-meta: #f7f9fd;

  /* Text */
  --text-primary: #2b3446;
  --text-secondary: #4b566b;
  --text-muted: #8b97aa;
  --text-faint: #a3aec0;
  --text-heading: #1f2735;
  --text-inverse: #ffffff;

  /* Borders */
  --border: #e7edf6;
  --border-main: #e7edf6;
  --border-light: #eff3f9;
  --border-subtle: #eff3f9;
  --border-card: rgba(59, 79, 116, 0.08);
  --border-input: #dde5f0;
  --border-accent: #dbe6f8;
  --border-elevated: rgba(59, 79, 116, 0.14);

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(59, 79, 116, 0.06);
  --shadow-md: 0 2px 8px -3px rgba(59, 79, 116, 0.16);
  --shadow-xl: 0 12px 32px -12px rgba(59, 79, 116, 0.28);
  --shadow-card: 0 2px 8px -3px rgba(59, 79, 116, 0.16);
  --shadow-lift: 0 12px 32px -12px rgba(59, 79, 116, 0.28);

  --overlay-bg: rgba(31, 39, 53, 0.38);

  /* Radii — modern treatment */
  --radius-card: 14px;
  --radius-tile: 12px;

  /* Nav */
  --nav-active-bg: rgba(76, 116, 196, 0.10);
  --nav-active-text: #4c74c4;

  /* Buttons */
  --btn-primary-bg: #4c74c4;
  --btn-primary-text: #ffffff;
  --btn-danger-bg: var(--color-danger);
  --btn-danger-text: #ffffff;
  --btn-ghost-bg: transparent;
  --btn-ghost-text: var(--text-secondary);
  --btn-ghost-hover: var(--bg-card-hover);

  /* Interactive accent */
  --accent: #4c74c4;
  --accent-hover: #3d63b0;
  --accent-subtle: rgba(76, 116, 196, 0.08);

  /* Brand mark gradient */
  --mark-from: #7fa0e0;
  --mark-to: #5b7fc9;

  /* Status pills */
  --status-pending-bg: #e8effc;
  --status-pending-text: #4c74c4;
  --status-ok-bg: #e2f3e9;
  --status-ok-text: #3d8560;
  --status-draft-bg: #fdeee0;
  --status-draft-text: #b5793a;
  --status-bad-bg: #fce9e9;
  --status-bad-text: #c25b5b;

  /* Tooltip */
  --bg-tooltip: #2b3446;

  /* Info boxes */
  --bg-info-green: #eef8f2;
  --border-info-green: #cfe9dc;
  --text-info-green: #3d8560;
  --bg-info-yellow: #fdf6ec;
  --border-info-yellow: #f3ddbd;
  --text-info-yellow: #b5793a;

  /* Focus rings */
  --ring-action: 0 0 0 3px rgba(76, 116, 196, 0.22);
  --ring-danger: 0 0 0 3px rgba(194, 91, 91, 0.22);

  /* Shadows — elevated surfaces */
  --shadow-modal: 0 16px 48px -12px rgba(31, 39, 53, 0.22);
  --shadow-popover: 0 8px 24px -8px rgba(31, 39, 53, 0.18);
  --shadow-dropdown: 0 4px 16px -6px rgba(31, 39, 53, 0.16);
}
```

- [ ] **Step 2: Replace the dark palette**

Replace the `/* ─── Gold Theme (Dark Luxury) ─── */` comment and the whole `[data-theme="gold"] { … }` block (lines 180–254) with:

```css
/* ─── Dark Theme (Sky, night) ─── */

[data-theme="dark"] {
  --navbar-h: 48px;

  --bg-page: #0f1319;
  --bg-base: #161b23;
  --bg-card: #161b23;
  --bg-card-hover: #1c222c;
  --bg-card-alt: #1a202a;
  --bg-elevated: #1a202a;
  --bg-input: #12171e;
  --bg-sidebar: #0c1015;
  --bg-topbar: rgba(22, 27, 35, 0.80);
  --bg-modal: #161b23;
  --bg-dropdown: #1a202a;
  --bg-row-stripe: #141920;
  --bg-row-hover: #1c222c;
  --bg-selected: #1b2432;
  --bg-badge: #1f2630;
  --bg-meta: #12171e;

  --text-primary: #e6ecf5;
  --text-secondary: #b9c3d1;
  --text-muted: #8592a3;
  --text-faint: #5b6675;
  --text-heading: #f1f5fb;
  --text-inverse: #0f1319;

  --border: #262e3a;
  --border-main: #262e3a;
  --border-light: #1e2530;
  --border-subtle: #1e2530;
  --border-card: rgba(127, 160, 224, 0.12);
  --border-input: #333d4c;
  --border-accent: #2c3849;
  --border-elevated: rgba(127, 160, 224, 0.20);

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 16px -6px rgba(0, 0, 0, 0.5);
  --shadow-xl: 0 12px 32px -12px rgba(0, 0, 0, 0.6);
  --shadow-card: 0 2px 8px -3px rgba(0, 0, 0, 0.45);
  --shadow-lift: 0 12px 32px -12px rgba(0, 0, 0, 0.6);

  --overlay-bg: rgba(0, 0, 0, 0.65);

  --radius-card: 14px;
  --radius-tile: 12px;

  --nav-active-bg: rgba(127, 160, 224, 0.14);
  --nav-active-text: #9fb9e8;

  --btn-primary-bg: #5b7fc9;
  --btn-primary-text: #ffffff;
  --btn-danger-bg: #8f3b3b;
  --btn-danger-text: #fbdcdc;
  --btn-ghost-bg: transparent;
  --btn-ghost-text: var(--text-secondary);
  --btn-ghost-hover: var(--bg-card-hover);

  --accent: #7fa0e0;
  --accent-hover: #9fb9e8;
  --accent-subtle: rgba(127, 160, 224, 0.14);

  --mark-from: #7fa0e0;
  --mark-to: #5b7fc9;

  --status-pending-bg: #1c2739;
  --status-pending-text: #9fb9e8;
  --status-ok-bg: #172b23;
  --status-ok-text: #7cc4a0;
  --status-draft-bg: #2e2418;
  --status-draft-text: #e8b96a;
  --status-bad-bg: #2f1d1d;
  --status-bad-text: #e29a9a;

  --bg-tooltip: #1f2630;

  --bg-info-green: #12261d;
  --border-info-green: #23503c;
  --text-info-green: #7cc4a0;
  --bg-info-yellow: #2b2113;
  --border-info-yellow: #5c451f;
  --text-info-yellow: #e8b96a;

  --ring-action: 0 0 0 3px rgba(127, 160, 224, 0.30);
  --ring-danger: 0 0 0 3px rgba(226, 154, 154, 0.30);

  --shadow-modal: 0 16px 48px -12px rgba(0, 0, 0, 0.6);
  --shadow-popover: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  --shadow-dropdown: 0 4px 16px -6px rgba(0, 0, 0, 0.45);
}
```

- [ ] **Step 3: Rename the remaining `gold` selectors**

Still in `globals.css`, replace every remaining `[data-theme="gold"]` with `[data-theme="dark"]` (the badge glow rule, focus rules, `.btn-lift` hover, and the four scrollbar rules around lines 298–320). Retune the two colour values in those rules:

```css
[data-theme="dark"] .gold-badge-glow:hover {
  box-shadow: 0 0 8px rgba(127, 160, 224, 0.25), 0 0 2px rgba(127, 160, 224, 0.15);
}
[data-theme="dark"] ::-webkit-scrollbar-thumb { background: #2a3340; border-radius: 4px; }
[data-theme="dark"] ::-webkit-scrollbar-thumb:hover { background: #38434f; }
```

Leave the class name `gold-badge-glow` alone — renaming it would mean touching every component that uses it.

- [ ] **Step 4: Retune the `.acc-theme` scope to Sky**

Replace the colour overrides in the `.acc-theme { … }` rule (around line 980) with:

```css
.acc-theme {
  --color-action:       #4c74c4;
  --color-action-hover: #3d63b0;
  --nav-active-bg:      #e8effc;
  --nav-active-text:    #4c74c4;
  --btn-primary-bg:     #4c74c4;
  --btn-primary-text:   #ffffff;
  --accent:             #4c74c4;
  --accent-hover:       #3d63b0;
  --accent-subtle:      rgba(76, 116, 196, 0.10);
  --ring-action:        0 0 0 3px rgba(76, 116, 196, 0.22);
}
```

Do **not** touch the rules that follow it — hidden scrollbars, suppressed number spinners, and `html:has(.acc-theme) { overflow-x: clip }` all stay exactly as they are.

- [ ] **Step 5: Rewrite `ThemeProvider`**

Replace `src/components/ThemeProvider.tsx` with:

```tsx
"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "form-portal-theme";

function persistTheme(t: Theme) {
  localStorage.setItem(STORAGE_KEY, t);
  document.cookie = `${STORAGE_KEY}=${t};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === "light" || stored === "dark") {
      setThemeState(stored);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute("data-theme", theme);
      persistTheme(theme);
    }
  }, [theme, mounted]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );

  if (!mounted) {
    return <div style={{ visibility: "hidden" }}>{children}</div>;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

`GOLD_CLR`, `THEME_ACCENT`, `useThemeAccent`, `useThemeRemap`, and `useGoldRemap` are deleted — nothing outside this file imported them.

- [ ] **Step 6: Update the no-flash script**

In `src/app/layout.tsx` (around line 82), replace the inline script's `__html` string with:

```js
(function(){try{var t=localStorage.getItem("form-portal-theme");if(!t){var m=document.cookie.match(/form-portal-theme=(light|dark)/);if(m)t=m[1]}if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.setAttribute("data-theme","light")}}catch(e){document.documentElement.setAttribute("data-theme","light")}})()
```

- [ ] **Step 7: Fix the remaining `gold` references in components**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
grep -rn '"gold"' src --include=*.tsx
```

Expected hits in `Navbar.tsx`, `UserProfileModal.tsx`, `Badge.tsx`, and `FullScreenModal.tsx`. In each, change the comparison `theme === "gold"` to `theme === "dark"` and any `aria-label` wording from "gold mode" to "dark mode". Re-run the grep until it prints nothing.

- [ ] **Step 8: Typecheck and build**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
npx tsc --noEmit && npm run build
```

Expected: both pass.

- [ ] **Step 9: Check both themes render**

Start `npm run dev`. On `/`, `/forms`, `/my-work`, `/request/travel-expense`, and `/settings`:
- confirm the light theme shows the Sky palette — pale blue page, white cards, blue primary buttons
- toggle to dark and confirm text stays readable and no element keeps a gold or rose accent
- reload while dark and confirm there is no white flash before paint (the no-flash script)
- confirm the Accounting pages' primary buttons are blue, not pink

- [ ] **Step 10: Commit**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git add -A
git commit -m "$(cat <<'EOF'
feat(theme): Sky palette replacing Rocks maroon and gold

Light theme becomes pastel cool-blue with soft layered shadows and larger
radii; the gold dark theme is renamed to `dark` and retuned as its night
counterpart. The Accounting .acc-theme scope drops its rose accent so the
whole app reads as one system. Theme storage key is now form-portal-theme.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Navbar

**Files:**
- Modify: `src/components/layout/Navbar.tsx`

**Interfaces:**
- Consumes: `NAV` from `@/lib/constants` (Task 2), `--mark-from` / `--mark-to` / `--radius-card` (Task 4), `useRole` from `@/lib/hooks/useRole`.
- Produces: no new exports. `Navbar` continues to be imported by `src/app/(dashboard)/layout.tsx`.

- [ ] **Step 1: Read the current file**

Read `src/components/layout/Navbar.tsx` in full before editing. Preserve these behaviours exactly: the `ResizeObserver` icon-only collapse, `hrefWithBrand`, the `TRAVEL_FROM_PARAM` nav-context resolution, `ErpEnvironmentNavBadge`, `BrandSwitcher`, `UserProfileModal`, and the mobile bottom tab bar.

- [ ] **Step 2: Swap the brand mark and title**

Replace both logo blocks (desktop around line 108, mobile around line 206) with a gradient mark:

```tsx
<Link href={hrefWithBrand("/")} className="flex items-center gap-2 no-underline">
  <span
    className="flex items-center justify-center rounded-[7px] font-extrabold text-white"
    style={{
      width: 22,
      height: 22,
      fontSize: 12,
      background: "linear-gradient(140deg, var(--mark-from), var(--mark-to))",
    }}
  >
    F
  </span>
  <span className="text-[14px] font-bold whitespace-nowrap" style={{ color: "var(--text-heading)" }}>
    Form Portal
  </span>
</Link>
```

Use `width: 20, height: 20, fontSize: 11` and `text-[13px]` for the mobile copy. Remove the `<img src="/brandlogo/rocks.png" …>` tags and update the `alt`/title text.

- [ ] **Step 3: Make the desktop nav a capsule group**

Replace the `<nav>` element (around line 117) with:

```tsx
<nav
  className="flex items-center gap-0.5 flex-nowrap min-w-0 rounded-full p-[3px]"
  style={{ background: "var(--bg-badge)" }}
>
  {visibleNav.map((item) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.id}
        href={hrefWithBrand(item.href)}
        title={iconOnlyNav ? item.label : undefined}
        aria-label={iconOnlyNav ? item.label : undefined}
        className={`flex items-center rounded-full text-[13px] no-underline transition-colors shrink-0 ${
          iconOnlyNav ? "justify-center p-2" : "gap-1.5 px-3 py-1.5"
        }`}
        style={{
          background: active ? "var(--bg-card)" : "transparent",
          color: active ? "var(--nav-active-text)" : "var(--text-muted)",
          fontWeight: active ? 700 : 500,
          boxShadow: active ? "var(--shadow-sm)" : "none",
        }}
      >
        <NavIcon icon={item.icon} size={iconOnlyNav ? 17 : 15} />
        {!iconOnlyNav && <span className="whitespace-nowrap">{item.label}</span>}
      </Link>
    );
  })}
</nav>
```

- [ ] **Step 4: Add Home and Settings to the nav list**

`NAV` holds only the three feature items. Build the rendered list inside the component so Home always leads and Settings appears for admins only:

```tsx
import { useRole } from "@/lib/hooks/useRole";
import { Home, Settings2 } from "lucide-react";

// …inside the component, replacing `const visibleNav = NAV;`
const { canAdmin } = useRole();
const visibleNav = [
  { id: "home", label: "Home", icon: "Home", desc: "", href: "/" },
  ...NAV,
  ...(canAdmin
    ? [{ id: "settings", label: "Settings", icon: "Settings2", desc: "", href: "/settings" }]
    : []),
];
```

Add `Home` and `Settings2` to `ICON_MAP`. Because Home is now part of `visibleNav`, delete the separate hardcoded Home tab from the mobile bottom bar (around line 239) so it is not rendered twice — the `visibleNav.map` below it now covers it.

- [ ] **Step 5: Give the top bar its glass treatment**

On both `<header>` elements, keep `backdrop-blur-md` on desktop and add it to the mobile header, and set the border to the token:

```tsx
style={{
  background: "var(--bg-topbar)",
  borderBottom: "1px solid var(--border-main)",
}}
```

(The desktop header already does this; apply the same to the mobile header and add `backdrop-blur-md` to its className.)

- [ ] **Step 6: Typecheck and build**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
npx tsc --noEmit && npm run build
```

- [ ] **Step 7: Verify the navigation**

Start `npm run dev`:
- desktop: the capsule nav shows `Home · Forms · My Requests · My Work` (plus `Settings` when signed in as IT/System Admin); the active item is a white pill
- click each item and confirm it routes correctly and the active pill follows
- narrow the window until labels collapse to icons — no overlap with the logo or the right-hand controls
- open `/request/travel-expense?from=my-work` and confirm `My Work` stays highlighted (the `TRAVEL_FROM_PARAM` behaviour)
- mobile width: the bottom bar shows each tab exactly once, Home included
- confirm the theme toggle, brand switcher, ERP badge, and avatar still work

- [ ] **Step 8: Commit**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git add -A
git commit -m "$(cat <<'EOF'
feat(nav): capsule navbar with English labels and gradient Form Portal mark

Home and Settings join the nav list, so the mobile bottom bar no longer
hardcodes its own Home tab.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Home page as the form catalogue

**Files:**
- Create: `src/features/home/useHomeData.ts`, `src/features/home/HomeCatalogue.tsx`
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes, all existing endpoints — no new API route is written:
  - `GET /api/forms` → `Array<{ id: number; name: string; slug: string; description: string | null; category: string | null; icon: string | null; status: string }>`
  - `GET /api/request/accounting/requests/mine` → `ReportRow[]` (**excludes drafts** — `r.Status <> 'Draft'`)
  - `GET /api/request/accounting/work` → `ReportRow[]`
  - `GET /api/request/accounting/requests/drafts` → `Array<{ id: number; status: string; updatedAt: string; totalAmount: number | null; workDetail: string | null }>` (AP-1)
  - `GET /api/request/travel-booking/requests/drafts` → `Array<{ groupKey: string; tabCount: number; updatedAt: string; provinceName: string | null; workDetail: string | null }>` (AP-17)
- Produces: `useHomeData()` returning `{ pendingCount, monthCount, draftCount, drafts, forms, isLoading }`; `HomeCatalogue` as the default page body.

**Note on drafts:** neither form supports deep-linking to a specific draft — both form pages fetch their own draft list and show a resume picker. So the "continue" rows link to `/request/travel-expense` and `/request/travel-booking`, carrying only a count and a last-edited time.

- [ ] **Step 1: Write the data hook**

Create `src/features/home/useHomeData.ts`:

```ts
"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface CatalogueForm {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
}

export interface DraftGroup {
  /** Stable key for React lists. */
  key: string;
  formCode: "AP-1" | "AP-17";
  label: string;
  href: string;
  count: number;
  /** ISO string of the most recently touched draft in this group. */
  updatedAt: string | null;
}

interface Row {
  status?: string;
  submittedAt?: string | null;
}

interface Ap1Draft {
  id: number;
  updatedAt: string;
}

interface Ap17Draft {
  groupKey: string;
  updatedAt: string;
}

function latest(items: Array<{ updatedAt: string }>): string | null {
  let best: string | null = null;
  for (const it of items) {
    if (it.updatedAt && (best === null || it.updatedAt > best)) best = it.updatedAt;
  }
  return best;
}

function isThisMonth(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function useHomeData() {
  const forms = useSWR<{ ok: boolean; data?: CatalogueForm[] }>("/api/forms", fetcher);
  const mine = useSWR<{ ok: boolean; data?: Row[] }>("/api/request/accounting/requests/mine", fetcher);
  const work = useSWR<{ ok: boolean; data?: Row[] }>("/api/request/accounting/work", fetcher);
  const ap1 = useSWR<{ ok: boolean; data?: Ap1Draft[] }>("/api/request/accounting/requests/drafts", fetcher);
  const ap17 = useSWR<{ ok: boolean; data?: Ap17Draft[] }>("/api/request/travel-booking/requests/drafts", fetcher);

  const ap1Rows = ap1.data?.data ?? [];
  const ap17Rows = ap17.data?.data ?? [];

  const drafts: DraftGroup[] = [];
  if (ap1Rows.length > 0) {
    drafts.push({
      key: "ap1",
      formCode: "AP-1",
      label: "เบิกค่าเดินทาง",
      href: "/request/travel-expense",
      count: ap1Rows.length,
      updatedAt: latest(ap1Rows),
    });
  }
  if (ap17Rows.length > 0) {
    drafts.push({
      key: "ap17",
      formCode: "AP-17",
      label: "จองที่พัก/ตั๋วโดยสาร",
      href: "/request/travel-booking",
      count: ap17Rows.length,
      updatedAt: latest(ap17Rows),
    });
  }

  return {
    pendingCount: (work.data?.data ?? []).length,
    monthCount: (mine.data?.data ?? []).filter((r) => isThisMonth(r.submittedAt)).length,
    draftCount: ap1Rows.length + ap17Rows.length,
    drafts,
    forms: (forms.data?.data ?? []),
    isLoading: forms.isLoading || mine.isLoading || work.isLoading || ap1.isLoading || ap17.isLoading,
  };
}
```

- [ ] **Step 2: Write the catalogue component**

Create `src/features/home/HomeCatalogue.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useBrand } from "@/components/BrandProvider";
import {
  getBrandFromSearchParams,
  replaceSearchParams,
  setBrandInSearchParams,
} from "@/lib/brand-url";
import { useHomeData } from "@/features/home/useHomeData";
import { Search, FileText, Route, Luggage, ClipboardCheck, FilePen, ArrowRight } from "lucide-react";

const ACCOUNTING_FORMS = [
  {
    code: "AP-1",
    name: "เบิกค่าเดินทาง",
    desc: "ค่าน้ำมัน · ทางด่วน · ที่จอดรถ",
    href: "/request/travel-expense",
    Icon: Route,
  },
  {
    code: "AP-17",
    name: "จองที่พัก/ตั๋วโดยสาร",
    desc: "ไปทำงานต่างจังหวัด",
    href: "/request/travel-booking",
    Icon: Luggage,
  },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "สวัสดีตอนเช้า";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "เมื่อสักครู่";
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

function StatCard({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div
      className="p-3.5"
      style={{
        background: "var(--bg-card)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        border: "1px solid var(--border-card)",
      }}
    >
      <div className="text-[19px] font-extrabold leading-none tabular-nums" style={{ color: tone }}>
        {value}
      </div>
      <div className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}

function SectionLabel({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2.5">
      <h2 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
        {title}
      </h2>
      {action}
    </div>
  );
}

export function HomeCatalogue() {
  const { data: session } = useSession();
  const { brand } = useBrand();
  const sp = useSearchParams();
  const [query, setQuery] = useState("");
  const { pendingCount, monthCount, draftCount, drafts, forms } = useHomeData();

  const hrefWithBrand = (href: string) => {
    const current = new URLSearchParams(sp.toString());
    const urlBrand = getBrandFromSearchParams(current) ?? brand;
    if (!urlBrand) return href;
    return replaceSearchParams(href, setBrandInSearchParams(current, urlBrand));
  };

  const q = query.trim().toLowerCase();
  const matches = (...parts: Array<string | null | undefined>) =>
    q === "" || parts.some((p) => (p ?? "").toLowerCase().includes(q));

  const accounting = ACCOUNTING_FORMS.filter((f) => matches(f.code, f.name, f.desc));
  const general = useMemo(
    () => forms.filter((f) => matches(f.name, f.slug, f.description, f.category)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forms, q],
  );

  const name = session?.user?.nickname || session?.user?.name || "";

  return (
    <div>
      {/* Greeting + stats */}
      <div className="mb-1">
        <h1 className="text-[20px] font-extrabold tracking-tight" style={{ color: "var(--text-heading)" }}>
          {greeting()}{name ? `, ${name}` : ""} 👋
        </h1>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          มีงานรออนุมัติ {pendingCount} รายการ และฉบับร่างค้างไว้ {draftCount} ฉบับ
        </p>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 mt-4"
        style={{
          background: "var(--bg-card)",
          borderRadius: 999,
          boxShadow: "var(--shadow-card)",
          border: "1px solid var(--border-card)",
        }}
      >
        <Search size={15} style={{ color: "var(--text-faint)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='ค้นหาฟอร์ม… ลอง "เบิกค่าเดินทาง" หรือ "AP-17"'
          className="flex-1 bg-transparent border-none outline-none text-[13px]"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-2.5 mt-4">
        <StatCard value={pendingCount} label="รออนุมัติจากคุณ" tone="var(--status-pending-text)" />
        <StatCard value={monthCount} label="คำขอเดือนนี้" tone="var(--status-ok-text)" />
        <StatCard value={draftCount} label="ฉบับร่าง" tone="var(--status-draft-text)" />
      </div>

      {/* Continue where you left off */}
      {(drafts.length > 0 || pendingCount > 0) && (
        <>
          <SectionLabel title="ทำต่อจากที่ค้างไว้" />
          <div className="flex flex-col gap-2">
            {drafts.map((d) => (
              <Link
                key={d.key}
                href={hrefWithBrand(d.href)}
                className="flex items-center gap-3 px-3.5 py-3 no-underline"
                style={{
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 30, height: 30,
                    borderRadius: 10,
                    background: "var(--status-draft-bg)",
                    color: "var(--status-draft-text)",
                  }}
                >
                  <FilePen size={15} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {d.formCode} · {d.label}
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {d.count} ฉบับร่าง · แก้ไขล่าสุด {timeAgo(d.updatedAt)}
                  </span>
                </span>
                <span
                  className="text-[10px] font-bold px-2.5 py-1 shrink-0"
                  style={{
                    borderRadius: 999,
                    background: "var(--status-draft-bg)",
                    color: "var(--status-draft-text)",
                  }}
                >
                  ฉบับร่าง
                </span>
              </Link>
            ))}

            {pendingCount > 0 && (
              <Link
                href={hrefWithBrand("/my-work")}
                className="flex items-center gap-3 px-3.5 py-3 no-underline"
                style={{
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 30, height: 30,
                    borderRadius: 10,
                    background: "var(--status-ok-bg)",
                    color: "var(--status-ok-text)",
                  }}
                >
                  <ClipboardCheck size={15} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-bold" style={{ color: "var(--text-primary)" }}>
                    รออนุมัติจากคุณ
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    ไปที่ My Work เพื่อตรวจและอนุมัติ
                  </span>
                </span>
                <span
                  className="text-[10px] font-bold px-2.5 py-1 shrink-0"
                  style={{
                    borderRadius: 999,
                    background: "var(--status-pending-bg)",
                    color: "var(--status-pending-text)",
                  }}
                >
                  {pendingCount} รายการ
                </span>
              </Link>
            )}
          </div>
        </>
      )}

      {/* Accounting forms */}
      {accounting.length > 0 && (
        <>
          <SectionLabel
            title="บัญชี"
            action={
              <Link
                href={hrefWithBrand("/request")}
                className="text-[11.5px] font-medium no-underline flex items-center gap-1"
                style={{ color: "var(--nav-active-text)" }}
              >
                ดูทั้งหมด <ArrowRight size={12} />
              </Link>
            }
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {accounting.map(({ code, name: formName, desc, href, Icon }) => (
              <Link
                key={code}
                href={hrefWithBrand(href)}
                className="flex gap-3 items-start p-3.5 no-underline"
                style={{
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 34, height: 34,
                    borderRadius: "var(--radius-tile)",
                    background: "var(--status-pending-bg)",
                    color: "var(--status-pending-text)",
                  }}
                >
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span
                    className="inline-block text-[9.5px] font-extrabold px-1.5 py-0.5 mb-1"
                    style={{
                      borderRadius: 6,
                      background: "var(--bg-badge)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {code}
                  </span>
                  <span className="block text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {formName}
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {desc}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Form Builder forms */}
      {general.length > 0 && (
        <>
          <SectionLabel
            title="ฟอร์มทั่วไป"
            action={
              <Link
                href={hrefWithBrand("/forms")}
                className="text-[11.5px] font-medium no-underline flex items-center gap-1"
                style={{ color: "var(--nav-active-text)" }}
              >
                ดูทั้งหมด <ArrowRight size={12} />
              </Link>
            }
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {general.map((f) => (
              <Link
                key={f.id}
                href={hrefWithBrand(`/forms/${f.slug}`)}
                className="flex gap-3 items-start p-3.5 no-underline"
                style={{
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 34, height: 34,
                    borderRadius: "var(--radius-tile)",
                    background: "var(--status-ok-bg)",
                    color: "var(--status-ok-text)",
                  }}
                >
                  <FileText size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {f.name}
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {f.description || f.category || "ฟอร์มทั่วไป"}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {q !== "" && accounting.length === 0 && general.length === 0 && (
        <p className="text-[12px] mt-8 text-center" style={{ color: "var(--text-muted)" }}>
          ไม่พบฟอร์มที่ตรงกับ &ldquo;{query}&rdquo;
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Replace the home page**

Replace `src/app/(dashboard)/page.tsx` with:

```tsx
"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { HomeCatalogue } from "@/features/home/HomeCatalogue";

export default function DashboardPage() {
  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <HomeCatalogue />
    </PageContainer>
  );
}
```

If `npx tsc --noEmit` reports that `useSearchParams` needs a Suspense boundary at build time, wrap `<HomeCatalogue />` in `<Suspense fallback={null}>` — the other pages in this codebase use the same pattern.

- [ ] **Step 4: Typecheck and build**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Verify the catalogue against real data**

Start `npm run dev` and sign in:
- the greeting matches the time of day and shows your nickname
- the three stat numbers are plausible; cross-check "รออนุมัติจากคุณ" against the row count on `/my-work`
- if you have an AP-1 or AP-17 draft, a "ทำต่อจากที่ค้างไว้" row appears with the right count; click it and confirm the form page opens its resume picker
- both Accounting tiles appear and route correctly
- Form Builder forms appear under "ฟอร์มทั่วไป" and each links to `/forms/<slug>`; if there are no published forms, the section is absent (not an empty heading)
- typing `AP-17` filters to one tile; typing nonsense shows the empty message
- the "ดูทั้งหมด" links reach `/request` and `/forms`
- if a brand is selected, confirm `?brand=` is carried through on every link

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git add -A
git commit -m "$(cat <<'EOF'
feat(home): form catalogue replacing the portal card grid

Greeting, stat strip, search, resumable drafts, and forms grouped into
Accounting and Form Builder. Reads only existing endpoints — no new API
and no merging of the two request systems.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Documentation and release readiness

**Files:**
- Modify: `CLAUDE.md`, `ROCKS-UI-GUIDE.md`
- Verify: `.gitignore`, working tree

**Interfaces:**
- Consumes: the finished app from Tasks 1–6.
- Produces: a repository ready for `git remote add origin …` and a first push.

- [ ] **Step 1: Rewrite `CLAUDE.md`**

Start from the copied Rocks Fast version and rewrite it for Form Portal:
- title and intro → Form Portal, port 3021
- delete the entire "Fast Intelligence" and "Locations" feature sections and every Intelligence row from the database, route, and project-structure tables
- keep the "3-Database Architecture" table but drop the Foodstory rows; add a note that `getDataPool()` (Fast_Data) is used by Accounting and ERP sync, not by BI
- document the new IA: `Home` (catalogue) · `Forms` (Form Builder) · `My Requests` · `My Work` · `Settings`
- document the Sky theme tokens, the `light` / `dark` theme names, and the `form-portal-theme` storage key
- add a "Shared with Rocks Fast" section: same databases, same SharePoint folder, same `AccEmailQueue`; warn that running both dev servers at once risks duplicate email sends
- document `UPLOAD_ROOT` and `ERP_SANDBOX_ALLOWED_HOSTS`
- update the environment-variable block: port 3021, `UPLOAD_ROOT` added, `FOODSTORY_*` removed

- [ ] **Step 2: Trim `ROCKS-UI-GUIDE.md`**

Remove the dashboard- and report-specific guidance (charts, `DataTable`, KPI bars, financial column colours) — none of those components exist any more. Replace the colour section with the Sky palette from Task 4 and the modern treatment rules: radius `14px` cards / `12px` tiles / `999px` pills, `--shadow-card` rather than heavy borders, tinted icon tiles, capsule nav.

- [ ] **Step 3: Scan for secrets before the first push**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git ls-files | xargs grep -lniE "password|secret|api[_-]?key|client[_-]?secret|connectionstring" 2>/dev/null
git check-ignore -v .env.local
git ls-files | grep -iE "\.env|\.pfx|\.pem|\.key$" || echo "no credential files tracked"
```

Expected: the first command returns only `.env.example` (placeholder values) and documentation that *names* the variables; open each hit and confirm no real value is present. `.env.local` must be reported as ignored. No credential files tracked.

- [ ] **Step 4: Confirm the assets the repo needs are tracked**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git ls-files public | head
git ls-files migrations | wc -l
git ls-files | wc -l
```

Expected: `public/` assets are tracked (Rocks Fast's `.gitignore` excluded them — this repo must not), migrations are tracked, and the total file count is in the expected range for the pruned tree.

- [ ] **Step 5: Final build from clean**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
rm -rf .next && npm run build
```

Expected: a clean successful build with no `/intelligence` or `/locations` routes.

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git add -A
git commit -m "$(cat <<'EOF'
docs: rewrite CLAUDE.md and the UI guide for Form Portal

Removes the Intelligence and Locations documentation, documents the new
navigation, the Sky theme, UPLOAD_ROOT, the 3021 port, and the resources
shared live with Rocks Fast.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Report readiness**

Tell the user the repository is ready to push, and give them the commands — do **not** run them, and do not create a GitHub repository:

```bash
cd "c:/Users/PC/source/repos/Web/Form_Portal"
git remote add origin <their-repo-url>
git push -u origin master
```
