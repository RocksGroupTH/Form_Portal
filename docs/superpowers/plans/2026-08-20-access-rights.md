# สิทธิ์เข้าถึง (Access Rights) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring AP-1's settings in line with ACC Portal — tab order, the `ผู้อนุมัติบัญชี` → `สิทธิ์เข้าถึง` rename, and per-approver settings-tab grants — and give AP-17 an access list of its own so its queue and report disappear for anyone not on it.

**Architecture:** AP-1 reuses `AccApproverSettingsTab`, which already exists in both form databases (migration 059) and is already dual-written; only wiring is needed. AP-17 gets a new `AccBookingApprover` table modelled on `AccApprover`, its own access endpoint, and its own server-side gate function. Menu visibility is derived from server-computed capability flags, never from a role check duplicated in the client.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (ES5 target), Tailwind 4, SWR, MSSQL via `mssql`, `node:test` through `tsx`.

## Global Constraints

- **`canAccessAccountArea` (`src/lib/acc/access.ts`) must not change.** It has 40+ call sites including the shared object ACL (`src/lib/acc/request-acl.ts:80`) and every ERP route. This plan changes what the *access endpoint reports for menu visibility*, never what the server uses to authorize. Any task that edits `access.ts` beyond adding a new function is wrong.
- **The URL prefix decides the database.** `ROUTE_RULES` (`src/lib/form-environment/classify-path.ts`) maps `/api/request/accounting/**` → AP-1, `/api/request/travel-booking/**` → AP-17, `/api/request/accounting/settings` → `null` (Production). Put each new route under the prefix of the form it serves.
- **Master-table writes go through `writeBothPools`** (`src/lib/acc/dual-write.ts`), never a bare pool. A new shared table must also be added to `MASTER_TABLES` in `scripts/checks/verify-master-alignment.ts` and to `scripts/seed-portal-form.ts`.
- **Migration numbering starts at 095.** Master's highest is 066, but 088–094 are claimed by the unmerged `feat/ap-4-reimbursement` branch. Do not reuse them.
- Parameterized SQL only — `pool.request().input("name", sql.NVarChar, value).query(...)`.
- ES5 target: `Array.from()`, never `[...set]` or `[...map.values()]`.
- CSS variables only, never raw hex. `lucide-react` for icons, `sonner` for toasts, `@/components/ui` for primitives.
- In-page copy is Thai. Nav labels are English.
- Dates via local getters (`getFullYear()`, `getMonth()`), never `toISOString()`.
- Response shape `{ ok: true, data }` / `{ ok: false, error }`. Status codes: 400 invalid input, 401 unauthenticated, 403 unauthorized, 500 server error.
- Never write `Fast_Core` or `Fast_Data` from this feature.
- **ACC Portal shares this database.** `AccApprover` and `AccApproverSettingsTab` rows are the same rows that app reads. Do not rename columns, drop rows, or change their meaning.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/lib/acc/settings-tabs.ts` | The grantable tab keys and their Thai labels. Pure, no imports. |
| `src/lib/acc/settings-tabs.test.ts` | Tests for the above. |
| `src/lib/acc/approver-settings-tabs.ts` | Read/write `AccApproverSettingsTab`, dual-written. |
| `src/lib/acc/booking-approver-service.ts` | Read/write `AccBookingApprover`, dual-written. |
| `src/lib/acc/booking-access.ts` | `isBookingApprover` / `canAccessBookingArea` — AP-17's server-side gate. |
| `migrations/095_acc_booking_approver.sql` | The AP-17 roster table, both form databases. |
| `src/app/api/request/travel-booking/access/route.ts` | AP-17's capability endpoint. |
| `src/app/api/request/travel-booking/settings/approvers/route.ts` | AP-17 roster CRUD. |
| `src/features/travel-booking/hooks/useBookingAccess.ts` | Client hook for the above. |
| `src/features/travel-booking/components/settings/BookingApproverSettings.tsx` | AP-17's สิทธิ์เข้าถึง panel. |

**Modify:**

| File | Change |
|---|---|
| `src/app/api/request/accounting/access/route.ts` | Return `admin`, `settingsTabs`, `canSettings`; `account` becomes approver-only. |
| `src/features/accounting/hooks/useAccountingAccess.ts` | Expose the three new fields. |
| `src/app/api/request/accounting/settings/approvers/route.ts` | Accept and return `settingsTabs`. |
| `src/lib/acc/settings-service.ts` | `listApprovers` returns each approver's granted tabs. |
| `src/features/accounting/types.ts` | `AccApproverRow` gains `settingsTabs`. |
| `src/features/accounting/components/settings/ApproverSettings.tsx` | Per-approver tab checkboxes. |
| `src/app/(dashboard)/request/accounting/settings/page.tsx` | Tab order, `สิทธิ์เข้าถึง` label, grant filtering. |
| `src/app/(dashboard)/request/accounting/page.tsx` | Hub card gating. |
| `src/app/(dashboard)/request/accounting/travel-booking/page.tsx` | Hub card gating from AP-17's roster. |
| `src/app/(dashboard)/request/accounting/travel-booking-settings/page.tsx` | Fifth tab. |
| `src/app/(dashboard)/request/accounting/travel-booking/queue/page.tsx` | Page guard uses AP-17's roster. |
| `src/app/(dashboard)/request/accounting/travel-booking-report/page.tsx` | Page guard uses AP-17's roster. |
| 11 AP-17 API routes | Swap `canAccessAccountArea` → `canAccessBookingArea`. |
| `scripts/checks/verify-master-alignment.ts` | 19 → 20 tables. |
| `scripts/seed-portal-form.ts` | Add the new table. |
| `CLAUDE.md`, `README.md` | Document all of it. |

---

## Task 1: The grantable tabs, and the grant store

**Files:**
- Create: `src/lib/acc/settings-tabs.ts`, `src/lib/acc/settings-tabs.test.ts`, `src/lib/acc/approver-settings-tabs.ts`

**Interfaces produced:**
- `GRANTABLE_SETTINGS_TABS: readonly { key: string; label: string }[]`
- `isGrantableSettingsTabKey(key: string): boolean`
- `filterGrantableTabKeys(keys: string[]): string[]`
- `loadSettingsTabsByApproverIds(ids: number[]): Promise<Map<number, string[]>>`
- `getApproverSettingsTabs(approverId: number): Promise<string[]>`
- `setApproverSettingsTabs(approverId: number, keys: string[]): Promise<void>`
- `resolveApproverSettingsTabsByEmail(email: string | null | undefined): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/acc/settings-tabs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRANTABLE_SETTINGS_TABS,
  isGrantableSettingsTabKey,
  filterGrantableTabKeys,
} from "./settings-tabs";

test("exactly five tabs are grantable", () => {
  assert.equal(GRANTABLE_SETTINGS_TABS.length, 5);
  assert.deepEqual(
    GRANTABLE_SETTINGS_TABS.map((t) => t.key),
    ["brands", "sameDayBrand", "vehicles", "departments", "erpInterface"],
  );
});

test("the approvers tab is never grantable", () => {
  assert.equal(isGrantableSettingsTabKey("approvers"), false);
  assert.deepEqual(filterGrantableTabKeys(["approvers"]), []);
});

test("filterGrantableTabKeys trims, drops unknowns and de-duplicates", () => {
  assert.deepEqual(
    filterGrantableTabKeys([" brands ", "brands", "nope", "vehicles"]),
    ["brands", "vehicles"],
  );
});

test("filterGrantableTabKeys preserves the caller's order", () => {
  assert.deepEqual(
    filterGrantableTabKeys(["vehicles", "brands"]),
    ["vehicles", "brands"],
  );
});

test("an empty list stays empty", () => {
  assert.deepEqual(filterGrantableTabKeys([]), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/acc/settings-tabs.test.ts`
Expected: FAIL — cannot find module `./settings-tabs`.

- [ ] **Step 3: Write `src/lib/acc/settings-tabs.ts`**

```ts
/**
 * Which AP-1 settings tabs an admin may hand to an individual approver.
 *
 * `approvers` — the สิทธิ์เข้าถึง tab itself — is deliberately absent. Granting
 * it would let a non-admin approver grant themselves the rest.
 *
 * This module imports nothing so it can be unit-tested: anything reachable from
 * a database pool drags `@/env` in, which validates the whole environment at
 * import time and throws in the test runner.
 */
export const GRANTABLE_SETTINGS_TABS: readonly { key: string; label: string }[] = [
  { key: "brands", label: "แบรนด์ที่เบิก" },
  { key: "sameDayBrand", label: "เบิกวันซ้ำข้ามแบรนด์" },
  { key: "vehicles", label: "พาหนะ & เรท" },
  { key: "departments", label: "แผนก (HR ↔ ERP)" },
  { key: "erpInterface", label: "Interface ERP" },
];

export function isGrantableSettingsTabKey(key: string): boolean {
  const k = key.trim();
  for (const t of GRANTABLE_SETTINGS_TABS) if (t.key === k) return true;
  return false;
}

/** Keep only known keys, trimmed, de-duplicated, in the caller's order. */
export function filterGrantableTabKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isGrantableSettingsTabKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- src/lib/acc/settings-tabs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write `src/lib/acc/approver-settings-tabs.ts`**

```ts
import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { filterGrantableTabKeys } from "@/lib/acc/settings-tabs";

/**
 * Per-approver AP-1 settings-tab grants, stored in `AccApproverSettingsTab`.
 *
 * That table has existed in both form databases since migration 059 and is one
 * of the dual-written master tables — ACC Portal, which shares this database,
 * has been its only writer until now. No migration is needed here.
 *
 * The rows ARE the granted set: no rows means no grants, never "all".
 */
export async function loadSettingsTabsByApproverIds(
  approverIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (approverIds.length === 0) return map;

  const pool = await getAccPool();
  const placeholders = approverIds.map((_, i) => `@id${i}`).join(", ");
  const req = pool.request();
  approverIds.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
  const r = await req.query(`
    SELECT ApproverId, TabKey FROM [dbo].[AccApproverSettingsTab]
    WHERE ApproverId IN (${placeholders}) ORDER BY TabKey
  `);

  const byApprover = new Map<number, string[]>();
  for (const row of r.recordset as { ApproverId: number; TabKey: string }[]) {
    const list = byApprover.get(row.ApproverId) ?? [];
    list.push(row.TabKey);
    byApprover.set(row.ApproverId, list);
  }
  for (const id of approverIds) {
    map.set(id, filterGrantableTabKeys(byApprover.get(id) ?? []));
  }
  return map;
}

export async function getApproverSettingsTabs(approverId: number): Promise<string[]> {
  const map = await loadSettingsTabsByApproverIds([approverId]);
  return map.get(approverId) ?? [];
}

/** Replace an approver's granted tabs. The list IS the granted set — [] clears it. */
export async function setApproverSettingsTabs(
  approverId: number,
  keys: string[],
): Promise<void> {
  const wanted = filterGrantableTabKeys(keys);
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("aid", sql.Int, approverId)
      .query(`DELETE FROM [dbo].[AccApproverSettingsTab] WHERE ApproverId = @aid`);
    for (const key of wanted) {
      await tx
        .request()
        .input("aid", sql.Int, approverId)
        .input("key", sql.NVarChar(40), key)
        .query(
          `INSERT INTO [dbo].[AccApproverSettingsTab] (ApproverId, TabKey) VALUES (@aid, @key)`,
        );
    }
  });
}

/** Tabs this email may open; [] when they are not an active approver. */
export async function resolveApproverSettingsTabsByEmail(
  email: string | null | undefined,
): Promise<string[]> {
  if (!email) return [];
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT Id FROM [dbo].[AccApprover] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  const approverId = r.recordset[0]?.Id as number | undefined;
  if (!approverId) return [];
  return getApproverSettingsTabs(approverId);
}
```

- [ ] **Step 6: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean under `src/`; the suite green with 5 new tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/acc/settings-tabs.ts src/lib/acc/settings-tabs.test.ts src/lib/acc/approver-settings-tabs.ts
git commit -m "feat(access): grantable settings tabs and their per-approver store"
```

---

## Task 2: What the AP-1 access endpoint reports

**Files:**
- Modify: `src/app/api/request/accounting/access/route.ts`, `src/features/accounting/hooks/useAccountingAccess.ts`

**Interfaces consumed:** `resolveApproverSettingsTabsByEmail` from Task 1.

**Interfaces produced:** `GET /api/request/accounting/access` → `{ ok, data: { account, approver, admin, settingsTabs: string[], canSettings: boolean } }`; `useAccountingAccess()` → `{ loading, error, isApprover, canAccount, isAdmin, settingsTabs, canSettings }`.

**The one thing to get right:** `account` stops including the admin arm. **Do not achieve this by editing `canAccessAccountArea`** — that function is the server-side authorization gate for 40+ call sites including the object ACL, and it must keep its current meaning. This endpoint simply stops calling it.

- [ ] **Step 1: Rewrite the route**

Replace the body of `src/app/api/request/accounting/access/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAccApprover } from "@/lib/acc/access";
import { isAdminRole } from "@/lib/roles";
import { resolveApproverSettingsTabsByEmail } from "@/lib/acc/approver-settings-tabs";

/* ── GET /api/request/accounting/access — viewer's AP-1 capabilities ──
 *
 * These flags drive which menus render. They are NOT the authorization gate:
 * every account-area route still calls `canAccessAccountArea` itself, and that
 * function deliberately keeps its admin arm.
 *
 * `account` here is the approver roster alone, so an admin who is not an
 * approver no longer sees the approval queue or the report. They keep ตั้งค่า,
 * so nobody can lock themselves out — an admin can always grant themselves.
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const admin = isAdminRole(session.user.role);
    const approver = await isAccApprover(email);
    // Admins see every tab; the grant list only governs non-admin approvers.
    const settingsTabs = admin ? [] : await resolveApproverSettingsTabsByEmail(email);
    const canSettings = admin || settingsTabs.length > 0;
    return NextResponse.json({
      ok: true,
      data: { account: approver, approver, admin, settingsTabs, canSettings },
    });
  } catch (err) {
    console.error("[api/request/accounting/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Widen the hook**

In `src/features/accounting/hooks/useAccountingAccess.ts`, extend the interface and the return:

```ts
interface AccountingAccessData {
  account: boolean;
  approver: boolean;
  admin: boolean;
  settingsTabs: string[];
  canSettings: boolean;
}
```

and in the returned object, after `canAccount`:

```ts
    /** IT Admin or System Admin. */
    isAdmin: access?.admin ?? false,
    /** Grantable tabs this non-admin approver may open; [] for admins. */
    settingsTabs: access?.settingsTabs ?? [],
    /** admin OR at least one granted tab. */
    canSettings: access?.canSettings ?? false,
```

Leave `loading`, `error`, `isApprover` and `canAccount` exactly as they are.

- [ ] **Step 3: Verify no other consumer breaks**

Run: `grep -rn "useAccountingAccess" src/`
Every existing consumer destructures only `loading`, `canAccount`, `isApprover` or `error`. Adding fields cannot break them — but confirm none reads `data` directly.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean, suite unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/request/accounting/access/route.ts src/features/accounting/hooks/useAccountingAccess.ts
git commit -m "feat(access): report admin, granted tabs and canSettings"
```

---

## Task 3: The AP-1 สิทธิ์เข้าถึง tab

**Files:**
- Modify: `src/app/(dashboard)/request/accounting/settings/page.tsx`, `src/features/accounting/components/settings/ApproverSettings.tsx`, `src/features/accounting/types.ts`, `src/lib/acc/settings-service.ts`, `src/app/api/request/accounting/settings/approvers/route.ts`

**Interfaces consumed:** everything from Tasks 1 and 2.

- [ ] **Step 1: Reorder and rename the tabs**

In `src/app/(dashboard)/request/accounting/settings/page.tsx`, replace the `TABS` array with ACC Portal's order and labels, and import `ShieldCheck` from `lucide-react`:

```tsx
const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "brands", label: "แบรนด์ที่เบิก", icon: <Building2 size={15} /> },
  { key: "sameDayBrand", label: "เบิกวันซ้ำข้ามแบรนด์", icon: <CalendarDays size={15} /> },
  { key: "vehicles", label: "พาหนะ & เรท", icon: <Car size={15} /> },
  { key: "departments", label: "แผนก (HR ↔ ERP)", icon: <GitBranch size={15} /> },
  { key: "erpInterface", label: "Interface ERP", icon: <Link2 size={15} /> },
  { key: "approvers", label: "สิทธิ์เข้าถึง", icon: <ShieldCheck size={15} /> },
];
```

The `TabKey` union keeps its existing member names, so no bookmarked `?tab=` link breaks. Change `parseTabKey`'s fallback from `"approvers"` to `"brands"`, matching the new first tab. Update the page `subtitle` to `"จัดการแบรนด์ พาหนะ Interface ERP และสิทธิ์เข้าถึง"`.

- [ ] **Step 2: Filter the tabs by grant**

Still in that page, take `isAdmin`, `settingsTabs` and `canSettings` from `useAccountingAccess()` and render only the tabs the viewer may open:

```tsx
const visibleTabs = isAdmin
  ? TABS
  : TABS.filter((t) => settingsTabs.indexOf(t.key) !== -1);
```

`approvers` is not in `GRANTABLE_SETTINGS_TABS`, so a non-admin never sees it — that is the property that stops a granted approver granting themselves more. If `visibleTabs` is empty, render the page's existing `ไม่มีสิทธิ์เข้าถึง` state rather than an empty tab strip. When the active tab is not in `visibleTabs`, fall back to `visibleTabs[0]`.

Keep the page's existing admin check as the outer guard, widened to `isAdmin || canSettings`.

- [ ] **Step 3: Return each approver's grants**

In `src/lib/acc/settings-service.ts`, after `listApprovers` builds its rows, attach the grants:

```ts
import { loadSettingsTabsByApproverIds } from "@/lib/acc/approver-settings-tabs";

// …inside listApprovers, after the query:
const rows = r.recordset as AccApproverRow[];
const grants = await loadSettingsTabsByApproverIds(rows.map((x) => x.id));
for (const row of rows) row.settingsTabs = grants.get(row.id) ?? [];
return rows;
```

Add `settingsTabs: string[]` to `AccApproverRow` in `src/features/accounting/types.ts`.

- [ ] **Step 4: Accept grants on save**

In `src/app/api/request/accounting/settings/approvers/route.ts`'s `POST`, after the existing `upsertApprover` call resolves an approver id, persist the tabs when the body carries them:

```ts
if (Array.isArray(body.settingsTabs)) {
  await setApproverSettingsTabs(approverId, body.settingsTabs.map(String));
}
```

Import `setApproverSettingsTabs` from `@/lib/acc/approver-settings-tabs`. Leave every existing field's handling untouched — `interfaceBrandCodes` in particular.

- [ ] **Step 5: Checkboxes in the panel**

In `ApproverSettings.tsx`, render `GRANTABLE_SETTINGS_TABS` as a checkbox row per approver, checked from `row.settingsTabs`, and include the selected keys in the POST body as `settingsTabs`. Match the file's existing table styling; use `var(--text-muted)` for the labels. Add a one-line note above the table: `ผู้อนุมัติที่ไม่ใช่แอดมินจะเห็นเฉพาะแท็บที่ติ๊กให้`.

- [ ] **Step 6: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean, suite unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/request/accounting/settings/page.tsx src/features/accounting/components/settings/ApproverSettings.tsx src/features/accounting/types.ts src/lib/acc/settings-service.ts src/app/api/request/accounting/settings/approvers/route.ts
git commit -m "feat(access): the AP-1 สิทธิ์เข้าถึง tab and per-approver grants"
```

---

## Task 4: AP-1 hub gating

**Files:**
- Modify: `src/app/(dashboard)/request/accounting/page.tsx`

- [ ] **Step 1: Re-gate the three cards**

Take `canAccount`, `isAdmin` and `canSettings` from `useAccountingAccess()` and apply:

| Card | Was | Becomes |
|---|---|---|
| อนุมัติ (บัญชี) | `approverOnly` | `canAccount` |
| รายงาน | `accountOnly` (admin **or** approver) | `canAccount` (approver only) |
| ตั้งค่า | `adminOnly` | `isAdmin \|\| canSettings` |

Replace the three boolean props on `HubCard` with a single `show: (a: { canAccount: boolean; isAdmin: boolean; canSettings: boolean }) => boolean`, as ACC Portal does, so the rule lives beside the card.

- [ ] **Step 2: Say why the page is empty**

When the filtered list is empty and access has loaded, render:

```
ไม่มีสิทธิ์เข้าถึงโมดูลนี้ — กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ผู้อนุมัติบัญชี
```

Keep the existing loading state: while access is loading, show no cards rather than flashing cards that then vanish.

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/request/accounting/page.tsx
git commit -m "feat(access): gate the AP-1 hub on the approver roster"
```

---

## Task 5: AP-17's own roster

**Files:**
- Create: `migrations/095_acc_booking_approver.sql`, `src/lib/acc/booking-approver-service.ts`, `src/lib/acc/booking-access.ts`
- Modify: `scripts/checks/verify-master-alignment.ts`, `scripts/seed-portal-form.ts`

**Interfaces produced:**
- `listBookingApprovers(activeOnly?: boolean): Promise<BookingApproverRow[]>`
- `upsertBookingApprover(a: { staffId: number; email: string; displayName: string; isActive?: boolean; createdBy?: number | null }): Promise<void>`
- `setBookingApproverActive(staffId: number, isActive: boolean): Promise<void>`
- `isBookingApprover(email: string | null | undefined): Promise<boolean>`
- `canAccessBookingArea(email: string | null | undefined, role: string | null | undefined): Promise<boolean>`

- [ ] **Step 1: Write the migration**

Create `migrations/095_acc_booking_approver.sql`:

```sql
-- AP-17's own access list.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/095_acc_booking_approver.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/095_acc_booking_approver.sql
--
-- ACC Portal gates AP-17 with AP-1's AccApprover. Form Portal deliberately does
-- not: someone who arranges hotel bookings should not thereby gain the
-- travel-expense approval queue, or the reverse.
--
-- This is a shared master table: it is dual-written by
-- src/lib/acc/booking-approver-service.ts and asserted by
-- npm run check:alignment. It carries no identity floor, exactly as the other
-- master tables do not — dual-write relies on the two identity counters staying
-- in lockstep, and a CHECK (Id >= 900000) in UAT would reject every write.
--
-- Numbered 095 rather than 067: 088-094 are claimed by the unmerged AP-4 branch.
SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.AccBookingApprover', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccBookingApprover] (
    [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccBookingApprover] PRIMARY KEY,
    [StaffId]     INT NOT NULL CONSTRAINT [UQ_AccBookingApprover_StaffId] UNIQUE,
    [Email]       NVARCHAR(200) NOT NULL,
    [DisplayName] NVARCHAR(200) NOT NULL,
    [IsActive]    BIT NOT NULL CONSTRAINT [DF_AccBookingApprover_Active] DEFAULT (1),
    [CreatedBy]   INT NULL,
    [CreatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccBookingApprover_Created] DEFAULT (SYSDATETIME()),
    [UpdatedBy]   INT NULL,
    [UpdatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccBookingApprover_Updated] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccBookingApprover created.';
END
ELSE
  PRINT 'AccBookingApprover already exists — nothing to do.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBookingApprover_Email')
  CREATE INDEX [IX_AccBookingApprover_Email] ON [dbo].[AccBookingApprover] ([Email]);
GO
```

- [ ] **Step 2: Write the service**

Create `src/lib/acc/booking-approver-service.ts`:

```ts
import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";

export interface BookingApproverRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
}

/**
 * AP-17's access list. Deliberately separate from AP-1's `AccApprover`: a
 * booking admin is not an expense approver, and the reverse.
 *
 * A shared master table, so every write goes through `writeBothPools` and the
 * pair is asserted by `npm run check:alignment`.
 */
export async function listBookingApprovers(
  activeOnly = false,
): Promise<BookingApproverRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive
    FROM [dbo].[AccBookingApprover]
    ${activeOnly ? "WHERE IsActive = 1" : ""}
    ORDER BY DisplayName, StaffId
  `);
  return (r.recordset as Array<{
    Id: number; StaffId: number; Email: string; DisplayName: string; IsActive: boolean;
  }>).map((x) => ({
    id: x.Id,
    staffId: x.StaffId,
    email: x.Email,
    displayName: x.DisplayName,
    isActive: !!x.IsActive,
  }));
}

/** Add or update by StaffId — the natural key, so both databases agree. */
export async function upsertBookingApprover(a: {
  staffId: number;
  email: string;
  displayName: string;
  isActive?: boolean;
  createdBy?: number | null;
}): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staffId", sql.Int, a.staffId)
      .input("email", sql.NVarChar(200), a.email)
      .input("name", sql.NVarChar(200), a.displayName)
      .input("active", sql.Bit, a.isActive === undefined ? true : a.isActive)
      .input("by", sql.Int, a.createdBy ?? null)
      .query(`
        MERGE [dbo].[AccBookingApprover] WITH (HOLDLOCK) AS t
        USING (SELECT @staffId AS StaffId) AS s ON t.StaffId = s.StaffId
        WHEN MATCHED THEN UPDATE SET
          Email = @email, DisplayName = @name, IsActive = @active,
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (StaffId, Email, DisplayName, IsActive, CreatedBy)
          VALUES (@staffId, @email, @name, @active, @by);
      `);
  });
}

/** Soft delete / restore. Rows are never removed — history stays readable. */
export async function setBookingApproverActive(
  staffId: number,
  isActive: boolean,
): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staffId", sql.Int, staffId)
      .input("active", sql.Bit, isActive)
      .query(`
        UPDATE [dbo].[AccBookingApprover]
        SET IsActive = @active, UpdatedAt = SYSDATETIME()
        WHERE StaffId = @staffId
      `);
  });
}
```

- [ ] **Step 3: Write the gate**

Create `src/lib/acc/booking-access.ts`:

```ts
import { getAccPool, sql } from "@/lib/acc/pool";
import { isAdminRole } from "@/lib/roles";

/**
 * AP-17's server-side gate, the counterpart to `canAccessAccountArea` for AP-1.
 *
 * Kept separate on purpose: `canAccessAccountArea` reads AP-1's `AccApprover`
 * and is wired into the shared object ACL and every ERP route, so widening it
 * to know about bookings would change AP-1's authorization too.
 */
export async function isBookingApprover(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT TOP 1 1 AS ok FROM [dbo].[AccBookingApprover]
       WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  return r.recordset.length > 0;
}

export async function canAccessBookingArea(
  email: string | null | undefined,
  role: string | null | undefined,
): Promise<boolean> {
  return isAdminRole(role) || (await isBookingApprover(email));
}
```

- [ ] **Step 4: Register it as a shared table**

In `scripts/checks/verify-master-alignment.ts`, add `"AccBookingApprover"` to `MASTER_TABLES` (19 → 20) and update the count in the file's header comment. In `scripts/seed-portal-form.ts`, add it to the copied-table list **only if** `SOURCE_DB` can supply it — read the script first; if its source is `Fast_Form`, which has no such table, add a comment saying the table is absent by design and that migration 095 creates it, rather than a list entry that would make the copy fail.

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean; suite unchanged (this task adds no tests — its two pure branches are one-line delegations and its SQL cannot be unit-tested without a pool).

- [ ] **Step 6: Commit**

```bash
git add migrations/095_acc_booking_approver.sql src/lib/acc/booking-approver-service.ts src/lib/acc/booking-access.ts scripts/checks/verify-master-alignment.ts scripts/seed-portal-form.ts
git commit -m "feat(access): AP-17's own approver roster"
```

**Do not apply the migration.** The controller applies it to both databases and verifies.

---

## Task 6: Gate AP-17 on its own roster

**Files:**
- Create: `src/app/api/request/travel-booking/access/route.ts`, `src/features/travel-booking/hooks/useBookingAccess.ts`
- Modify: 11 AP-17 API routes, `src/app/(dashboard)/request/accounting/travel-booking/page.tsx`, `.../travel-booking/queue/page.tsx`, `.../travel-booking-report/page.tsx`

**Interfaces consumed:** `canAccessBookingArea`, `isBookingApprover` from Task 5.

**Interfaces produced:** `GET /api/request/travel-booking/access` → `{ ok, data: { account, approver, admin } }`; `useBookingAccess()` → `{ loading, error, isApprover, canAccount, isAdmin }`.

- [ ] **Step 1: The endpoint**

Create `src/app/api/request/travel-booking/access/route.ts`, mirroring AP-1's shape but reading AP-17's roster:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isBookingApprover } from "@/lib/acc/booking-access";
import { isAdminRole } from "@/lib/roles";

/* ── GET /api/request/travel-booking/access — viewer's AP-17 capabilities ──
 *
 * Its own endpoint rather than a field on AP-1's, so the two forms' access
 * questions never have to be asked together.
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const admin = isAdminRole(session.user.role);
    const approver = await isBookingApprover(email);
    return NextResponse.json({ ok: true, data: { account: approver, approver, admin } });
  } catch (err) {
    console.error("[api/request/travel-booking/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: The hook**

Create `src/features/travel-booking/hooks/useBookingAccess.ts` as a copy of `useAccountingAccess`'s shape, fetching `/api/request/travel-booking/access` and returning `{ loading, error, isApprover, canAccount, isAdmin }`.

- [ ] **Step 3: Swap the server-side gate on AP-17's routes**

In each of these, replace the `canAccessAccountArea` import and call with `canAccessBookingArea` from `@/lib/acc/booking-access`. Change nothing else — not the message, not the status, not the surrounding logic:

```
src/app/api/request/travel-booking/admin/queue/route.ts
src/app/api/request/travel-booking/admin/requests/[id]/booking/route.ts
src/app/api/request/travel-booking/admin/requests/[id]/complete/route.ts
src/app/api/request/travel-booking/files/[fileId]/route.ts
src/app/api/request/travel-booking/report/route.ts
src/app/api/request/travel-booking/report/export/route.ts
src/app/api/request/travel-booking/requests/[id]/files/route.ts        (two call sites)
src/app/api/request/travel-booking/requests/[id]/reject/route.ts
src/app/api/request/travel-booking/requests/[id]/return/route.ts
```

Then run `grep -rn "canAccessAccountArea" src/app/api/request/travel-booking/` and confirm it returns nothing. **This is the load-bearing half of the feature** — hiding a card is not authorization.

- [ ] **Step 4: The hub and the two page guards**

In `travel-booking/page.tsx`, swap `useAccountingAccess` for `useBookingAccess`. Keep the existing card rules — `accountOnly` now means AP-17's roster, `adminOnly` stays. Do the same in `travel-booking/queue/page.tsx` and `travel-booking-report/page.tsx`, whose doc comments both name `canAccessAccountArea` as the backing gate; update those comments to name `canAccessBookingArea`.

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/request/travel-booking/ src/features/travel-booking/hooks/ src/app/\(dashboard\)/request/accounting/travel-booking/ src/app/\(dashboard\)/request/accounting/travel-booking-report/
git commit -m "feat(access): gate AP-17 on its own roster, server and client"
```

---

## Task 7: The AP-17 สิทธิ์เข้าถึง tab

**Files:**
- Create: `src/app/api/request/travel-booking/settings/approvers/route.ts`, `src/features/travel-booking/components/settings/BookingApproverSettings.tsx`
- Modify: `src/app/(dashboard)/request/accounting/travel-booking-settings/page.tsx`

- [ ] **Step 1: The route**

Create `src/app/api/request/travel-booking/settings/approvers/route.ts`. `GET` returns `listBookingApprovers(false)` behind `requireRole(["IT Admin", "System Admin"])`. `POST` takes `{ email, displayName, isActive? }`, resolves `staffId` from HR by email with `findActiveEmployeeByEmail` (`@/lib/hr/employee-lookup`) exactly as AP-1's approvers route does, refuses with a named Thai message when HR has no active row, and calls `upsertBookingApprover`. `PATCH` takes `{ staffId, isActive }` and calls `setBookingApproverActive`. All three are System Admin / IT Admin.

- [ ] **Step 2: The panel**

Create `BookingApproverSettings.tsx`, mirroring `src/features/settings/UatUserSettings.tsx` for the table shape: one status column where the badge reports state and a round button beside it performs the one available action, plus the AD search modal for adding people. Deactivation is a soft delete.

Add a standing note when no approver is active: `ยังไม่มีผู้มีสิทธิ์เข้าถึง — คิวจองและรายงานจะไม่แสดงกับใครเลย`. That state is reachable the moment the migration lands, and it is the one an admin needs explained.

- [ ] **Step 3: The fifth tab**

In `travel-booking-settings/page.tsx`, widen `TabKey` from `TravelOptionKind` to `TravelOptionKind | "access"` and append:

```tsx
  { key: "access", label: "สิทธิ์เข้าถึง", icon: <ShieldCheck size={15} /> },
```

Render `BookingApproverSettings` for that key and `TravelOptionSettings` for the other four. The tab is admin-only, matching the page's existing guard — AP-17 has no per-tab grants, which mirrors ACC Portal.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/request/travel-booking/settings/ src/features/travel-booking/components/settings/BookingApproverSettings.tsx src/app/\(dashboard\)/request/accounting/travel-booking-settings/page.tsx
git commit -m "feat(access): the AP-17 สิทธิ์เข้าถึง tab"
```

---

## Task 8: Write it down

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: CLAUDE.md — a สิทธิ์เข้าถึง section**

Under the Accounting feature section, record:

- AP-1's settings tab order and that `สิทธิ์เข้าถึง` is the former `ผู้อนุมัติบัญชี`.
- Five tabs are grantable per approver through `AccApproverSettingsTab`; `approvers` is deliberately not one of them, because granting it would let a non-admin grant themselves the rest.
- **`AccApproverSettingsTab` needed no migration** — 059 created it and it was already dual-written; ACC Portal had been its only writer.
- **AP-17 has its own roster, `AccBookingApprover` (migration 095), applied to both form databases** — deliberately not AP-1's `AccApprover`, which is what ACC Portal uses for both forms. `MASTER_TABLES` goes 19 → 20.
- **`canAccessAccountArea` did not change.** The access *endpoint* stopped calling it for the `account` flag; the function itself is still the server-side gate for the object ACL and every ERP route. `canAccessBookingArea` is its AP-17 counterpart, and the 11 AP-17 routes use it.
- The live consequence: an IT/System Admin who is not on a roster no longer sees that form's queue or report. They keep ตั้งค่า, so nobody can lock themselves out.
- **An empty `AccBookingApprover` hides AP-17's queue and report from everyone** — seed it as a commissioning step.

- [ ] **Step 2: CLAUDE.md — the shared-database fact**

The "Shared with Rocks Fast" section describes only that sibling. Add ACC Portal: it points at the same `MSSQL_HOST` and the same `Rocks_Portal_Form`, measured 2026-08-19, so `AccApprover` and `AccApproverSettingsTab` rows are the same rows in both apps and a roster change here changes ACC Portal. Note that both apps' settings pages edit those rows with no locking — last write wins, acceptable for a roster changed a few times a year.

- [ ] **Step 3: README.md**

Add migration 095 to whatever list the README keeps, and update the shared-table count if it names one.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs(access): สิทธิ์เข้าถึง for AP-1 and AP-17"
```

---

## Self-Review

**Spec coverage**

| Spec § | Task |
|---|---|
| §1.1 shared database, recorded | 8 |
| §1.2 `AccApproverSettingsTab` needs no migration | 1, 8 |
| §2.1 tab order and label | 3 |
| §2.2 endpoint grows three fields; `account` becomes approver-only | 2 |
| §2.2 grantable tabs, `approvers` excluded | 1 |
| §2.2 missing-table degrades to empty, never permissive | 1 |
| §2.3 hub cards | 4 |
| §3.1 `AccBookingApprover`, both databases, alignment + seed | 5 |
| §3.2 AP-17 สิทธิ์เข้าถึง tab, admin-only, no per-tab grants | 7 |
| §3.3 own access endpoint; server-side gating, not just cards | 6 |
| §4 AP-4 consistency | out of scope here — AP-4's own branch owns its approver panel |
| §5 no per-tab grants for AP-17; no change to who may submit | 6, 7 |
| §6.1 the `account` narrowing is a live permission reduction | 8 |
| §6.2 an empty AP-17 roster hides everything | 7, 8 |
| §6.3 two apps, one roster, no locking | 8 |

**Placeholder scan:** none. Tasks 3, 6 and 7 describe UI by naming the exact file to mirror and the exact changes to make, rather than restating hundreds of lines of it; every value that must be exact — tab keys, labels, table and column names, function signatures, the route list — is written out. Task 5 step 4 deliberately makes the `seed-portal-form.ts` edit conditional on reading the script, because appending a name to a copy that reads `Fast_Form` would break it; the condition and both branches are stated.

**Type consistency:** `filterGrantableTabKeys`, `loadSettingsTabsByApproverIds`, `setApproverSettingsTabs` and `resolveApproverSettingsTabsByEmail` are defined in Task 1 and consumed under those names in 2 and 3. `BookingApproverRow`, `listBookingApprovers`, `upsertBookingApprover`, `setBookingApproverActive`, `isBookingApprover` and `canAccessBookingArea` are defined in Task 5 and consumed under those names in 6 and 7. The tab keys `brands`, `sameDayBrand`, `vehicles`, `departments`, `erpInterface` are the same five strings in `settings-tabs.ts`, the settings page's `TabKey` union and the grant table.

**One thing this plan changes about the spec:** the spec said `account` changes from `isAdminRole(role) || isAccApprover(email)` to the roster alone, without saying where. Measured on master, `canAccessAccountArea` has 40+ call sites including `request-acl.ts:80` — the shared object ACL — and every ERP route. Changing the function would change AP-1's authorization, not just its menus. Task 2 therefore changes the endpoint and leaves the function alone, and Task 6 adds a parallel function for AP-17 rather than widening it. This is recorded in the Global Constraints as the plan's first rule.
