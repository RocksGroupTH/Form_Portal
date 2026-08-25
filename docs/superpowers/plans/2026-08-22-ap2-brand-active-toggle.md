# AP-2 Shared Active Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Active switch on each AP-2 Interface card that turns a brand on/off for the brand picker of **both** AP-2 and AP-3 request forms (shared `AccFormBrand.IsActive`), with AP-3 Interface settings reflecting it read-only.

**Architecture:** Reuse `AccFormBrand.IsActive` per `(FormCode, BrandCode)` — no migration. Toggling on the AP-2 card writes `IsActive` to both the `AP-2` and `AP-3` rows (dual-write prod+UAT). The AP-2 settings card list switches to `listFormBrands` (all rows, incl. inactive) so a disabled brand stays visible; request pickers already filter `IsActive=1`, so no picker code changes.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, MSSQL (`mssql`, `getAccPool`/`writeBothPools`), node:test, Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-08-22-ap2-brand-active-toggle-design.md`
**Branch:** `feat/ap-2-advance`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/adv/brand-active-service.ts` (new) | `setBrandActiveShared(brandCode, active, userId)` — MERGE `IsActive` on AP-2 + AP-3 rows |
| `src/app/api/request/advance/settings/brand-active/route.ts` (new) | POST `{brandCode, active}`, admin-gated |
| `src/lib/adv/advance-interface-settings-service.ts` (modify) | card source → `listFormBrands("AP-2")`; view row gains `active` |
| `src/features/advance/components/settings/AdvanceErpInterfaceSettings.tsx` (modify) | Active `Toggle` per card; dim when off; wire route |
| `src/lib/clr/clear-advance-interface-settings-service.ts` (modify) | view row gains `active` (from AccFormBrand AP-3) |
| `src/features/clear-advance/components/admin/ClrErpInterfaceSettings.tsx` (modify) | read-only Active/Inactive badge + note |

Nothing in the request-form pickers changes (`getAllowedBrands` already filters `IsActive=1`).

---

## Task 1: `setBrandActiveShared` service

**Files:**
- Create: `src/lib/adv/brand-active-service.ts`

- [ ] **Step 1: Write the service**

```ts
import { writeBothPools } from "@/lib/acc/dual-write";
import { sql } from "@/lib/adv/pool";

/**
 * Turn a brand on/off for BOTH AP-2 and AP-3 at once (shared IsActive).
 * MERGE keeps them in lockstep: an AP-3 row missing for a brand is inserted
 * from the AP-2 row's SortOrder so the shared write can never half-apply.
 * Dual-writes prod + UAT via writeBothPools.
 */
export async function setBrandActiveShared(
  brandCode: string,
  active: boolean,
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) throw new Error("กรุณาเลือกแบรนด์");
  await writeBothPools(async (tx) => {
    // SortOrder to use if an AP-3 row must be created — take the AP-2 row's, else 0.
    const soRes = await tx.request()
      .input("brand", sql.NVarChar, brand)
      .query(`SELECT SortOrder FROM [dbo].[AccFormBrand] WHERE FormCode='AP-2' AND BrandCode=@brand`);
    const sortOrder = (soRes.recordset[0]?.SortOrder as number | undefined) ?? 0;

    for (const form of ["AP-2", "AP-3"] as const) {
      await tx.request()
        .input("form", sql.NVarChar, form)
        .input("brand", sql.NVarChar, brand)
        .input("active", sql.Bit, active)
        .input("sort", sql.Int, sortOrder)
        .query(`
          MERGE [dbo].[AccFormBrand] AS t
          USING (SELECT @form AS FormCode, @brand AS BrandCode) AS s
          ON t.FormCode = s.FormCode AND t.BrandCode = s.BrandCode
          WHEN MATCHED THEN UPDATE SET IsActive = @active
          WHEN NOT MATCHED THEN INSERT (FormCode, BrandCode, IsActive, SortOrder)
            VALUES (@form, @brand, @active, @sort);`);
    }
  });
  void userId; // reserved for a future audit column; not stored today
}
```

> The MERGE mirrors the existing pattern in `src/lib/acc/settings-service.ts:196`. `AccFormBrand` has no UpdatedBy column, so `userId` is accepted for signature symmetry but not written (the `void userId` documents that intentionally).

- [ ] **Step 2: Typecheck**

Run (PowerShell): `$env:Path = "C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"; cd R:\Form_Portal; npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/adv/brand-active-service.ts
git commit -m "feat(ap-2): setBrandActiveShared — shared AccFormBrand.IsActive for AP-2+AP-3"
```

---

## Task 2: `brand-active` route

**Files:**
- Create: `src/app/api/request/advance/settings/brand-active/route.ts`

- [ ] **Step 1: Write the route** (admin gate mirrors `settings/erp-master/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { setBrandActiveShared } from "@/lib/adv/brand-active-service";

/** POST { brandCode, active } — turn a brand on/off for AP-2 + AP-3 (shared). */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as { brandCode?: string; active?: boolean };
    const brandCode = (body.brandCode ?? "").trim();
    if (!brandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ ok: false, error: "active ต้องเป็น true/false" }, { status: 400 });
    }
    await setBrandActiveShared(brandCode, body.active, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/brand-active] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/request/advance/settings/brand-active/route.ts"
git commit -m "feat(ap-2): brand-active route (POST toggle, admin-gated)"
```

---

## Task 3: AP-2 view — list all brands + `active`

**Files:**
- Modify: `src/lib/adv/advance-interface-settings-service.ts`

Context: after commit a70e724 the card source is `getAllowedBrands(AP2_FORM_CODE)` (active only). Switch to `listFormBrands` (all rows) and surface `active`.

- [ ] **Step 1: Add `active` to the view interface**

In `AdvanceInterfaceConfigView` (the `export interface`), add after `ready: boolean;`:
```ts
  /** AccFormBrand.IsActive — whether the brand is selectable in the request forms. */
  active: boolean;
```

- [ ] **Step 2: Swap the imports**

Replace:
```ts
import { getAllowedBrands, listAllBrands } from "@/lib/acc/brand-options";
```
with:
```ts
import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
```

- [ ] **Step 3: Use `listFormBrands` + build an active map**

Replace the Promise.all + codes block. FROM:
```ts
  const [allBrands, ctx, ap2, ap2Access, ap2Brands] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext(),
    listAdvanceInterfaceConfig(),
    resolveFormAccess("AP-2"),
    getAllowedBrands(AP2_FORM_CODE),
  ]);
```
TO:
```ts
  const [allBrands, ctx, ap2, ap2Access, ap2Brands] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext(),
    listAdvanceInterfaceConfig(),
    resolveFormAccess("AP-2"),
    listFormBrands(AP2_FORM_CODE), // ALL rows incl. inactive → disabled cards stay visible
  ]);
  const activeByCode = new Map(ap2Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
```
The existing `for (const b of ap2Brands) { ... b.brandCode ... }` loop still compiles (`listFormBrands` rows also have `brandCode`).

- [ ] **Step 4: Populate `active` on each row**

In the returned row object (the `return { brandCode: code, ... ready, }` block), add:
```ts
        active: activeByCode.get(code) ?? false,
```

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/adv/advance-interface-settings-service.ts
git commit -m "feat(ap-2): settings lists all brands (incl inactive) + active flag"
```

---

## Task 4: AP-2 card — Active toggle

**Files:**
- Modify: `src/features/advance/components/settings/AdvanceErpInterfaceSettings.tsx`

- [ ] **Step 1: Import Toggle + add `active` to the row type**

Add `Toggle` to the ui import (it currently imports `{ Button }` from `@/components/ui`):
```ts
import { Button, Toggle } from "@/components/ui";
```
In the `interface ConfigRow { ... }`, add after `ready: boolean;`:
```ts
  active: boolean;
```

- [ ] **Step 2: Add the toggle handler in `BrandCard`**

Inside `BrandCard`, alongside the other handlers (e.g. above `saveAll`):
```ts
  const [activeBusy, setActiveBusy] = useState(false);
  async function toggleActive(next: boolean) {
    setActiveBusy(true);
    try {
      const res = await fetch("/api/request/advance/settings/brand-active", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCode: row.brandCode, active: next }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "อัปเดตสถานะไม่สำเร็จ"); return; }
      toast.success(next ? `เปิดใช้งาน ${row.brandName}` : `ปิด ${row.brandName}`);
      onSaved();
    } catch {
      toast.error("อัปเดตสถานะไม่สำเร็จ");
    } finally {
      setActiveBusy(false);
    }
  }
```

- [ ] **Step 3: Render the Toggle at the top of the card body + dim when off**

Directly after the card header `</div>` (the block containing brand name + `<StatusBadge />`) and before the target Company block, insert:
```tsx
      <div className="mb-3">
        <Toggle
          checked={row.active}
          onChange={toggleActive}
          disabled={activeBusy}
          label="เปิดใช้งานแบรนด์นี้ (Active)"
          description="ปิดแล้วแบรนด์จะหายจากตัวเลือกในฟอร์มขอเบิก AP-2 และเคลียร์ AP-3"
        />
      </div>
```
Dim the whole card when inactive: on the card's outermost `<div style={{ ... }}>`, add `opacity: row.active ? 1 : 0.6` to the style object (keep the toggle itself readable — the Toggle sits above the dimmed body, which is fine).

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/advance/components/settings/AdvanceErpInterfaceSettings.tsx
git commit -m "feat(ap-2): Active toggle on each Interface card"
```

---

## Task 5: AP-3 view — surface `active`

**Files:**
- Modify: `src/lib/clr/clear-advance-interface-settings-service.ts`

- [ ] **Step 1: Add `active` to the interface**

In `ClrInterfaceConfigView`, add after `ready: boolean;`:
```ts
  /** Shared AccFormBrand.IsActive (managed on the AP-2 card) — read-only here. */
  active: boolean;
```

- [ ] **Step 2: Load AP-3 brand active states**

Add the import at the top:
```ts
import { listFormBrands } from "@/lib/acc/settings-service";
```
Extend the Promise.all and build a map. FROM:
```ts
  const [allBrands, ctx, ap2, clr] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext(),
    listAdvanceInterfaceConfig(),
    listClrInterfaceConfig(),
  ]);
```
TO:
```ts
  const [allBrands, ctx, ap2, clr, ap3Brands] = await Promise.all([
    listAllBrands(),
    loadErpJournalBuildContext(),
    listAdvanceInterfaceConfig(),
    listClrInterfaceConfig(),
    listFormBrands("AP-3"),
  ]);
  const activeByCode = new Map(ap3Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
```

- [ ] **Step 3: Populate `active` on each returned row**

In the returned row object (`return { brandCode: code, ... ready: ..., }`), add:
```ts
        active: activeByCode.get(code) ?? false,
```

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-interface-settings-service.ts
git commit -m "feat(ap-3): interface view surfaces shared Active state (read-only)"
```

---

## Task 6: AP-3 card — read-only Active badge

**Files:**
- Modify: `src/features/clear-advance/components/admin/ClrErpInterfaceSettings.tsx`

- [ ] **Step 1: Add `active` to the component's `ViewRow` type**

In `interface ViewRow { brandCode: string; ... }`, add:
```ts
  active: boolean;
```

- [ ] **Step 2: Render a read-only badge on each card**

In each card's header area (next to where the brand name / ready state is shown), add a badge that reflects `row.active`:
```tsx
  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
    style={row.active
      ? { background: "rgba(79,163,122,0.15)", color: "var(--text-info-green)" }
      : { background: "var(--bg-badge)", color: "var(--text-muted)" }}>
    {row.active ? "Active" : "Inactive"}
  </span>
```
And once near the top of the tab (above the card list), a one-line note:
```tsx
  <p className="text-[11px] m-0 mb-2" style={{ color: "var(--text-muted)" }}>
    สถานะ Active จัดการที่หน้า AP-2 → ตั้งค่า → Interface ERP (ใช้ร่วมกัน)
  </p>
```
> Bind these to the real render structure in the file — place the badge where the AP-3 card already shows its per-brand status, and the note just inside the tab's container.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/clear-advance/components/admin/ClrErpInterfaceSettings.tsx
git commit -m "feat(ap-3): read-only Active badge + note on Interface settings"
```

---

## Task 7: E2E verification (Playwright, UAT) + push

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 2: Unit suite** — `npm test` → all pass (no new unit tests, but confirm nothing broke).

- [ ] **Step 3: E2E — toggle off**

In the Playwright browser (UAT mode), go to `/request/advance/settings?from=admin` → Interface ERP tab. Pick a brand card (e.g. UNO) and toggle Active **off**. Expected: the card stays (dimmed), toggle shows off, toast "ปิด …".

- [ ] **Step 4: Verify DB (both forms, both DBs)** via mssql-rocks MCP:
```sql
SELECT 'UAT' db, FormCode, BrandCode, IsActive FROM [Rocks_Portal_Form_UAT].[dbo].[AccFormBrand] WHERE BrandCode='UNO' AND FormCode IN ('AP-2','AP-3')
UNION ALL
SELECT 'PROD', FormCode, BrandCode, IsActive FROM [Rocks_Portal_Form].[dbo].[AccFormBrand] WHERE BrandCode='UNO' AND FormCode IN ('AP-2','AP-3');
```
Expected: `IsActive=0` for both AP-2 and AP-3 rows in both DBs.

- [ ] **Step 5: Verify request pickers**

Load the AP-2 request form brand picker (`/request/advance`) and the AP-3 request form (`/request/clear-advance`) → UNO is **absent** from both. Check the AP-3 settings Interface tab → UNO badge = "Inactive".

- [ ] **Step 6: Toggle back on → restore**

Toggle UNO Active **on** at the AP-2 card. Verify DB `IsActive=1` for both forms/DBs, and UNO reappears in both request pickers and the AP-3 badge reads "Active".

- [ ] **Step 7: Push**

```bash
git push origin feat/ap-2-advance
```

---

## Self-Review

- **Spec coverage:** shared write both forms (T1) ✓; toggle route (T2) ✓; settings lists inactive + active flag (T3) ✓; AP-2 toggle UI dim-when-off (T4) ✓; AP-3 view active (T5) ✓; AP-3 read-only badge + note (T6) ✓; request pickers unchanged (design §5) — nothing to do ✓; E2E both forms both DBs + re-enable (T7) ✓. No-migration honoured.
- **Placeholders:** T6 flags "bind to the real render structure" because `ClrErpInterfaceSettings.tsx`'s exact card markup must be read at implementation time; the badge/note code itself is complete. All other code is exact.
- **Type consistency:** `setBrandActiveShared(brandCode, active, userId)` used identically in T1/T2. `active: boolean` added to `AdvanceInterfaceConfigView` (T3) and consumed by `ConfigRow`/Toggle (T4); `active` added to `ClrInterfaceConfigView` (T5) and consumed by `ViewRow` (T6). `listFormBrands` returns `{ id, brandCode, isActive, sortOrder }` — `.isActive`/`.brandCode` used consistently in T3/T5. `sql.Bit` for the boolean throughout.
