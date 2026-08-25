# AP-2 Company "Active" Toggle (shared with AP-3) — Design

**Date:** 2026-08-22 · **Branch:** `feat/ap-2-advance` · **Forms:** AP-2 (Advance) + AP-3 (Clear Advance)
**DBs:** Rocks_Portal_Form (prod) + Rocks_Portal_Form_UAT (dual-write)
**Status:** Approved (brainstorming) → ready for writing-plans

---

## 1. Problem

The AP-2 Interface ERP settings shows one card per Company/brand. There is no way to turn a brand on/off. The user wants an **Active** toggle on each AP-2 card that governs whether the brand is selectable in the request-form brand picker of **both AP-2 and AP-3**, with the AP-3 Interface settings page reflecting the same state.

## 2. Decisions (locked in brainstorming)

- **Active is SHARED across AP-2 + AP-3.** One toggle governs both forms.
- **Toggle lives only on the AP-2 card.** The AP-3 Interface settings shows the Active state **read-only**.
- Off = the brand is **hidden** from the request-form brand picker (existing `getAllowedBrands` behavior). Old requests already created are untouched.
- No block/warning when deactivating a brand that has pending requests (YAGNI).

## 3. Key facts established

- `AccFormBrand` already has `IsActive` per `(FormCode, BrandCode)` — **no new table/column.**
- Request pickers already filter it: `getAllowedBrands(formCode)` runs `WHERE FormCode=@form AND IsActive=1 ORDER BY SortOrder, BrandCode`. AP-2 picker → `getAllowedBrands("AP-2")`, AP-3 picker → `getAllowedBrands("AP-3")`.
- `AccFormBrand` has rows for both AP-2 and AP-3 for the 5 brands (ROCKS/PCTH/PCMY/KSI/UNO).
- There is an existing AccFormBrand write pattern in `src/lib/acc/settings-service.ts` (`UPDATE ... SET IsActive` + `MERGE ... SortOrder`) to follow.
- AP-3 already has an Interface ERP settings tab: `ClrErpInterfaceSettings` (`src/app/(dashboard)/request/clear-advance/settings/page.tsx`).
- **Chicken-and-egg:** the AP-2 settings card list currently comes from `getAllowedBrands("AP-2")` which filters `IsActive=1` (commit a70e724). If a brand is deactivated it would vanish from the settings page and could never be re-enabled. So the **settings list must include inactive brands**.

## 4. Data model

Reuse `AccFormBrand.IsActive`. "Shared" = the same brand's `IsActive` is written to **both** the `FormCode='AP-2'` and `FormCode='AP-3'` rows in the same operation. If an AP-3 row does not exist for a brand, MERGE-insert it (mirroring the AP-2 row's SortOrder) so the two stay in lockstep.

No migration required.

## 5. Components / changes

- **`src/lib/acc/brand-options.ts`** — add `listFormBrandsAll(formCode)`: every `AccFormBrand` row for the form (active + inactive), enriched with name/logo, each carrying `active: boolean` and `sortOrder`. (Sibling of `getAllowedBrands`, minus the `IsActive=1` filter.)
- **`src/lib/adv/advance-interface-settings-service.ts`** — card source switches from `getAllowedBrands("AP-2")` to `listFormBrandsAll("AP-2")`; the view row gains `active: boolean`. (Adjusts commit a70e724 so deactivated cards still render.)
- **`src/lib/adv/advance-interface-config-service.ts`** (or a small new `brand-active-service.ts`) — `setBrandActiveShared(brandCode, active, userId)`: within `writeBothPools`, MERGE `AccFormBrand.IsActive=@active` for `FormCode IN ('AP-2','AP-3')` for that brand (insert the AP-3 row from the AP-2 row's SortOrder if missing).
- **`src/app/api/request/advance/settings/brand-active/route.ts`** (new) — `POST { brandCode, active }`, role-gated (IT/System Admin, same as the other AP-2 settings routes), calls `setBrandActiveShared`.
- **`src/features/advance/components/settings/AdvanceErpInterfaceSettings.tsx`** — an Active toggle switch in each card header; on change, POST the route and optimistically update / refetch. A card with `active=false` renders dimmed but still fully visible and toggleable.
- **AP-3 read-only reflect** — the AP-3 interface settings view service returns `active` per brand; `ClrErpInterfaceSettings.tsx` shows an **Active/Inactive badge** (read-only) with a one-line note: "จัดการสถานะ Active ที่หน้า AP-2 Interface settings".

Request-form pickers: **no change** — `getAllowedBrands` (IsActive=1) already hides inactive brands from AP-2 and AP-3.

## 6. Data flow

```
Admin toggles Active=off on AP-2 card for brand X
   │  POST /api/request/advance/settings/brand-active { brandCode: X, active: false }
   ▼
setBrandActiveShared(X, false)  (writeBothPools → prod + UAT)
   • MERGE AccFormBrand SET IsActive=0 WHERE BrandCode=X AND FormCode='AP-2'
   • MERGE AccFormBrand SET IsActive=0 WHERE BrandCode=X AND FormCode='AP-3'
   ▼
Effect (no extra code):
   • AP-2 request picker  getAllowedBrands("AP-2") → X gone
   • AP-3 request picker  getAllowedBrands("AP-3") → X gone
   • AP-2 settings card    listFormBrandsAll("AP-2") → X still shown, toggle=off
   • AP-3 settings badge    → "Inactive"
Toggle back on → all restored.
```

## 7. Edge cases & guards

- **Re-enable always possible** — settings lists inactive brands, so a card is never lost.
- **Missing AP-3 row** — MERGE inserts it (from the AP-2 SortOrder) so the shared write can't half-apply.
- **Pending/draft requests on a deactivated brand** — allowed; only the new-request picker is affected. Existing records keep their brand.
- **Dual-write partial failure** — `writeBothPools` is the existing mechanism; a failure surfaces as an error and the toggle does not report success.

## 8. Testing

**Unit**
- `listFormBrandsAll("AP-2")` returns inactive rows too (with `active=false`).
- `setBrandActiveShared` writes `IsActive` to both `AP-2` and `AP-3` rows; inserts a missing AP-3 row.

**E2E (Playwright, UAT)**
1. Toggle brand X off on the AP-2 card → card remains, state = off (dimmed).
2. DB: `AccFormBrand.IsActive=0` for X on **both** FormCode AP-2 and AP-3, in **both** DBs.
3. X disappears from the AP-2 request brand picker **and** the AP-3 request brand picker.
4. AP-3 Interface settings badge for X = "Inactive".
5. Toggle back on → X reappears in both pickers, AP-3 badge = "Active".

## 9. Scope

In: the shared Active toggle + read-only AP-3 reflect, over the existing AccFormBrand brands (ROCKS/PCTH/PCMY/KSI/UNO). Out: adding brand-new brands to a form, reordering (SortOrder editing), per-form independent Active, and any block/confirm on deactivation.
