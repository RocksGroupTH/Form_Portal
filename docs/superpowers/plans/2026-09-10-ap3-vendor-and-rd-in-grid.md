# AP-3 Vendor + RD Check Into the Grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put each expense line's BC vendor and its Revenue Department answer on the line itself, delete the card stack below the grid, and add one button that checks every tax id still lacking an answer.

**Architecture:** The card's two jobs split into two in-cell components following the `GlCell`/`GlPicker` precedent already in this grid. Its module-level vendor cache becomes a hook; its per-card RD check becomes page-level state keyed by tax id, which is where `ClearAdvanceDetail` still has dead declarations waiting for it. No API, schema or approval-gate change.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-10-ap3-vendor-and-rd-into-the-grid-design.md`
**Branch:** `feat/ap3-vendor-and-rd-in-grid`, off `feat/ap3-gl-to-account-step`

---

## File Structure

| File | Change |
|---|---|
| `src/lib/clr/rd-vat-core.ts` | Add `tinsNeedingRdCheck` (pure) |
| `src/lib/clr/rd-vat-core.test.ts` | Add its cases |
| `src/features/clear-advance/hooks/useTaxVendors.ts` | **New.** The brand's vendor list, fetched once |
| `src/features/clear-advance/hooks/useRdVatByTin.ts` | **New.** Page-level RD answers keyed by tax id |
| `src/features/clear-advance/components/VendorCell.tsx` | **New.** In-cell vendor picker |
| `src/features/clear-advance/components/RdCell.tsx` | **New.** Status chip + popover |
| `src/features/clear-advance/components/ClearAdvanceDetail.tsx` | Two columns, the button, the banner text, revived state |
| `src/features/clear-advance/components/SellerVendorCard.tsx` | **Deleted** |

---

## Task 1: The button's count, as a pure rule

**Files:** `src/lib/clr/rd-vat-core.ts`, `src/lib/clr/rd-vat-core.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `rd-vat-core.test.ts` (import `tinsNeedingRdCheck` at the top):

```ts
/* The button asks about tax ids, not rows: six receipts from one seller are one
   question. */

test("six rows sharing a tax id are one thing to ask about", () => {
  const items = [{ taxId: "0105556000001" }, { taxId: "0105556000001" }, { taxId: "0105556000001" }];
  assert.deepEqual(tinsNeedingRdCheck(items, {}), ["0105556000001"]);
});

test("an id already answered is not asked again", () => {
  const items = [{ taxId: "0105556000001" }, { taxId: "0994000000002" }];
  const answered = { "0105556000001": { state: "found" as const } };
  assert.deepEqual(tinsNeedingRdCheck(items, answered), ["0994000000002"]);
});

test("an unregistered answer is an answer", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }], { "0105556000001": { state: "unregistered" as const } }),
    [],
  );
});

test("a failed check is asked again", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }], { "0105556000001": { state: "unknown" as const } }),
    ["0105556000001"],
  );
});

test("one in flight is not queued twice", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }], { "0105556000001": { state: "checking" as const } }),
    [],
  );
});

test("an id that is not thirteen digits is not a question for the registry", () => {
  assert.deepEqual(tinsNeedingRdCheck([{ taxId: "123" }, { taxId: null }, { taxId: "" }], {}), []);
});

test("punctuation in a typed tax id does not make a second id", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }, { taxId: "0-1055-56000-00-1" }], {}),
    ["0105556000001"],
  );
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- src/lib/clr/rd-vat-core.test.ts`
Expected: FAIL, `tinsNeedingRdCheck` is not exported.

- [ ] **Step 3: Implement**

Append to `rd-vat-core.ts`:

```ts
/** What the account screen knows about one tax id, as far as this rule cares. */
export type RdAnswerState = "checking" | "found" | "unregistered" | "unknown";

/**
 * The distinct tax ids on these lines that the registry has not answered for.
 *
 * The count the "ตรวจสรรพากร" button shows, and the work it does. It counts ids
 * rather than rows because six receipts from one seller are one question — the
 * per-card check this replaces asked six times.
 *
 * `unknown` is a failed check and is asked again; `unregistered` is a real
 * answer and is not. `checking` is already in flight. Anything that is not
 * thirteen digits is not a question the registry can take.
 */
export function tinsNeedingRdCheck(
  items: readonly { taxId?: string | null }[] | null | undefined,
  answers: Readonly<Record<string, { state: RdAnswerState }>>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items ?? []) {
    const tin = (it.taxId ?? "").replace(/\D/g, "");
    if (tin.length !== 13 || seen.has(tin)) continue;
    seen.add(tin);
    const state = answers[tin]?.state;
    if (state === undefined || state === "unknown") out.push(tin);
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- src/lib/clr/rd-vat-core.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/rd-vat-core.ts src/lib/clr/rd-vat-core.test.ts
git commit -m "feat(ap-3): the rule for which tax ids still owe the registry an answer"
```

---

## Task 2: The vendor list, as a hook

**Files:** Create `src/features/clear-advance/hooks/useTaxVendors.ts`
**Read first:** `SellerVendorCard.tsx:36-40` (the `TaxVendorCandidate` type) and `:66-91` (the cache + `fetchVendors`)

- [ ] **Step 1: Create it**

Move `vendorListCache` and `fetchVendors` verbatim, keeping their comments, and wrap them in a hook. Export `TaxVendorCandidate` from here so the card's copy can die with it:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export interface TaxVendorCandidate {
  vendorNo: string;
  displayName: string | null;
  taxRegistrationNumber: string | null;
}

/**
 * One fetch per Company per page, shared by every row on it.
 *
 * A clearing with six receipts needs the same list six times — to filter when a
 * cell is opened, and to show the name of a vendor already chosen rather than a
 * bare code. Without the cache that is six identical requests for 93KB on
 * mount, every time the account step opens. It outlives the component on
 * purpose; a remount must not re-ask.
 */
const vendorListCache = new Map<string, Promise<TaxVendorCandidate[]>>();

export function fetchVendors(brandCode: string | null): Promise<TaxVendorCandidate[]> {
  const key = brandCode ?? "";
  const hit = vendorListCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(`/api/request/clear-advance/tax-vendors?brand=${encodeURIComponent(key)}`);
    const j = (await res.json()) as { ok: boolean; data?: TaxVendorCandidate[]; error?: string };
    if (!j.ok) {
      // Not cached: a failure now must not become this page's answer forever.
      vendorListCache.delete(key);
      throw new Error(j.error ?? "โหลดรายชื่อ Vendor ไม่สำเร็จ");
    }
    return j.data ?? [];
  })();
  vendorListCache.set(key, p);
  return p;
}

/**
 * The brand's vendor list for the whole grid.
 *
 * `load` is called when a cell is first opened, and eagerly by the grid when any
 * line already carries a vendor — a stored `taxVendorNo` is a bare number and
 * the list is what carries its name.
 */
export function useTaxVendors(brandCode: string | null) {
  const [vendors, setVendors] = useState<TaxVendorCandidate[] | "loading" | null>(null);

  const load = useCallback(async () => {
    setVendors((prev) => (prev === null ? "loading" : prev));
    try {
      setVendors(await fetchVendors(brandCode));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดรายชื่อ Vendor ไม่สำเร็จ");
      setVendors([]);
    }
  }, [brandCode]);

  // A new brand invalidates what is on screen; the cache keeps the old answer.
  useEffect(() => { setVendors(null); }, [brandCode]);

  return { vendors, list: Array.isArray(vendors) ? vendors : [], load };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — exit 0. `sonner`'s `toast` is what the card imported; confirm the import path matches the card's.

---

## Task 3: The RD answers, page-level

**Files:** Create `src/features/clear-advance/hooks/useRdVatByTin.ts`
**Read first:** `SellerVendorCard.tsx:104-131` (`checkRd`) and `:151-159` (the per-card trigger); `OcrConfirmModal.tsx:149-173` (the Set-dedupe pattern to follow)

- [ ] **Step 1: Create it**

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RdVatRegistrant } from "@/lib/clr/rd-vat-core";

export type RdAnswer =
  | { state: "checking" }
  | { state: "found"; registrant: RdVatRegistrant; checkedAt: string | null }
  | { state: "unregistered"; checkedAt: string | null }
  | { state: "unknown" };

/**
 * What the Revenue Department says about each tax id on the grid.
 *
 * Keyed by tax id, not by row. The card this replaces asked once per card,
 * deduped by a ref holding one value, so six lines sharing a seller made six
 * HTTP calls for one answer. The registry is a slow SOAP service behind a
 * 15-second timeout, and the answer is identical for every one of those rows.
 *
 * The automatic ask keeps the card's trigger — a stored answer never expires,
 * so the ordinary case is a row read and making someone click for it bought
 * nothing. `ask` is the manual path: the button uses it for the ids with no
 * answer, and a row's popover uses it with `refresh` to overwrite one.
 */
export function useRdVatByTin(taxIds: readonly (string | null | undefined)[]) {
  const [byTin, setByTin] = useState<Record<string, RdAnswer>>({});
  const requested = useRef<Set<string>>(new Set());

  const ask = useCallback(async (tin: string, refresh = false) => {
    if (tin.length !== 13) return;
    if (refresh) requested.current.delete(tin);
    setByTin((p) => ({ ...p, [tin]: { state: "checking" } }));
    try {
      const res = await fetch(
        `/api/request/clear-advance/vat-registrant?taxId=${tin}${refresh ? "&refresh=1" : ""}`,
      );
      const j = (await res.json()) as {
        ok: boolean;
        data?: { registrant: RdVatRegistrant | null; checkedAt: string | null };
      };
      if (!j.ok) {
        // A failed ask must be askable again — the button counts `unknown`.
        requested.current.delete(tin);
        return setByTin((p) => ({ ...p, [tin]: { state: "unknown" } }));
      }
      const checkedAt = j.data?.checkedAt ?? null;
      setByTin((p) => ({
        ...p,
        [tin]: j.data?.registrant
          ? { state: "found", registrant: j.data.registrant, checkedAt }
          : { state: "unregistered", checkedAt },
      }));
    } catch {
      requested.current.delete(tin);
      setByTin((p) => ({ ...p, [tin]: { state: "unknown" } }));
    }
  }, []);

  const key = useMemo(
    () => Array.from(new Set(
      taxIds.map((t) => (t ?? "").replace(/\D/g, "")).filter((t) => t.length === 13),
    )).sort().join("|"),
    [taxIds],
  );

  useEffect(() => {
    for (const tin of key ? key.split("|") : []) {
      if (requested.current.has(tin)) continue;
      requested.current.add(tin);
      void ask(tin);
    }
  }, [key, ask]);

  return { byTin, ask };
}
```

Note the two `requested.current.delete(tin)` calls on failure. Without them a
transient outage marks the id asked forever, which is the shape of the bug
already fixed once on this branch stack in `useGlOptionsByBranch`.

- [ ] **Step 2: Confirm the canonical type fits**

Read `src/lib/clr/rd-vat-core.ts:19-34` (`RdVatRegistrant`) and compare field by
field with the API's `registrant` shape (`vat-registrant/route.ts`) and the
card's local `VatRegistrant` (`SellerVendorCard.tsx:26-34`). If a field differs,
use the canonical one and adapt the consumers — do not redeclare a fourth copy.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/clear-advance/hooks/
git commit -m "refactor(ap-3): the vendor list and the registry answers move up to the grid"
```

---

## Task 4: `<VendorCell>`

**Files:** Create `src/features/clear-advance/components/VendorCell.tsx`
**Read first:** `SellerVendorCard.tsx:173-192` (`chosen`, `shortlist`, `needsVendor`) and `:292-405` (the button + panel JSX). Also `LinePickers.tsx:136-205` — `GlPicker` is the shape to match, including `PICKER_PANEL_ATTR` so outside-click handling keeps working.

- [ ] **Step 1: Create it**

Carry across, unchanged in behaviour: the lazy `load()` on first open; seeding
`term` with the invoice payee name only when nothing is chosen yet; the
exact-tax-id hoist with the `ตรงเลขภาษี` badge; `.slice(0, 80)`; the
"— ไม่เลือก Vendor (เว้นว่างได้) —" clear row. Keep `vendorMatches` from
`tax-vendor-core` — the matching stays in the browser, for the reason its own
comment gives.

The cell renders a compact trigger — `{vendorNo} · {name}` truncated, or
`— เลือก —` — with a red hint when `vatAmount > 0 && !taxVendorNo`, since that
is what blocks approval. Mark the panel with `PICKER_PANEL_ATTR`.

Props:

```tsx
export function VendorCell({
  item, vendors, list, onLoad, onPick,
}: {
  item: Pick<ClearAdvanceItem, "taxId" | "payeeName" | "vatAmount" | "taxVendorNo">;
  vendors: TaxVendorCandidate[] | "loading" | null;
  list: TaxVendorCandidate[];
  onLoad: () => void;
  onPick: (vendorNo: string | null) => void;
}) 
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`, exit 0.

---

## Task 5: `<RdCell>`

**Files:** Create `src/features/clear-advance/components/RdCell.tsx`
**Read first:** `SellerVendorCard.tsx:161-171` (`reg`, `rdFullName`, `differs`) and `:221-289` (the RD panel JSX), `:461-468` (`CheckedAt`)

- [ ] **Step 1: Create it**

The chip, by state — keep every existing wording:

| Condition | Chip |
|---|---|
| no 13-digit id | `—`, muted, not clickable, title `ยังไม่มีเลขผู้เสียภาษี 13 หลัก` |
| `checking` | a spinner |
| `unknown` | `!` faint, title `ตรวจไม่สำเร็จ` |
| `found` and not `differs` | `✓` green, title `ตรงกับใบกำกับ` |
| `found` and `differs` | `⚠` yellow |
| `unregistered` and `vatAmount > 0` | `⚠` yellow |
| `unregistered` and no VAT | `—` muted, title `ไม่อยู่ในทะเบียน VAT — ปกติสำหรับบุคคลธรรมดาหรือผู้ขายรายย่อย` |

Keep the split on `unregistered`: the comment at `SellerVendorCard.tsx:233-237`
records why — nearly every individual seller lands there, and dressing that as a
warning taught the reader to scroll past the line where VAT really was claimed
from a non-registrant.

Keep `differs` exactly as it is, `sameRegisteredName` included, so spacing alone
is never a difference.

The popover (click the chip) holds what the card's panel held: the
`ใบกำกับ` / `สรรพากร` comparison rows, `ใช้ข้อมูลจากสรรพากร` calling
`onApply({ payeeName, taxBranchCode })`, `ตรวจเมื่อ {dd/mm/yyyy}` and
`ตรวจใหม่` / `ลองใหม่` calling `onRecheck()`. Mark it with `PICKER_PANEL_ATTR`.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/clear-advance/components/VendorCell.tsx src/features/clear-advance/components/RdCell.tsx
git commit -m "feat(ap-3): the vendor picker and the registry answer become cells"
```

---

## Task 6: Wire the grid, delete the cards

**Files:** `src/features/clear-advance/components/ClearAdvanceDetail.tsx`, delete `SellerVendorCard.tsx`

- [ ] **Step 1: Revive the dead state with the canonical types**

Delete the unused local `VatRegistrant` (125-133), `TaxVendorCandidate`
(134-138), `VatCheck` (140-144), `vendorsByRow` (242) and `vendorNameTerm`
(245). Replace `vatByTin` (233) with the hooks:

```ts
const { vendors, list: vendorList, load: loadVendors } = useTaxVendors(request.brandCode ?? null);
const { byTin: rdByTin, ask: askRd } = useRdVatByTin(editItems.map((it) => it.taxId));
```

Keep the eager vendor load the card did — any line already carrying a
`taxVendorNo` needs the list to show its name:

```ts
useEffect(() => {
  if (vendors !== null) return;
  if (editItems.some((it) => (it.taxVendorNo ?? "").trim())) void loadVendors();
}, [editItems, vendors, loadVendors]);
```

- [ ] **Step 2: Add the two columns**

Headers after `สาขาผู้ขาย` (`:604`): `RD` then `Vendor`. Cells in the same
place, both going through `setEditItems` — **not** `setEditItemsState`, or the
`dirty` gate swallows the autosave:

```tsx
<td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
  <RdCell
    item={it}
    answer={rdByTin[(it.taxId ?? "").replace(/\D/g, "")]}
    onRecheck={() => void askRd((it.taxId ?? "").replace(/\D/g, ""), true)}
    onApply={(patch) => {
      const next = [...editItems];
      next[i] = { ...next[i], ...patch };
      setEditItems(next);
    }}
  />
</td>
<td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)", minWidth: 200 }}>
  <VendorCell
    item={it}
    vendors={vendors}
    list={vendorList}
    onLoad={() => void loadVendors()}
    onPick={(vendorNo) => {
      const next = [...editItems];
      next[i] = { ...next[i], taxVendorNo: vendorNo };
      setEditItems(next);
    }}
  />
</td>
```

Raise the table's `minWidth` from 1240 (`:588`) to 1500.

- [ ] **Step 3: Add the button**

Beside `<SaveStatus>` (`:576-581`):

```tsx
{(() => {
  const pending = tinsNeedingRdCheck(editItems, rdByTin);
  return (
    <Button
      variant="secondary" size="sm" type="button"
      disabled={pending.length === 0}
      title={pending.length === 0 ? "ตรวจกับกรมสรรพากรครบทุกเลขแล้ว" : undefined}
      onClick={() => pending.forEach((tin) => void askRd(tin))}
    >
      {pending.length === 0 ? "ตรวจสรรพากรครบแล้ว" : `ตรวจสรรพากร (${pending.length} รายการ)`}
    </Button>
  );
})()}
```

Match the surrounding `Button` import and variants — read what the file already
uses rather than assuming.

- [ ] **Step 4: Delete the card stack and the file**

Remove the `ผู้ขาย — ตรวจกับกรมสรรพากร และเลือก Vendor` block (`:784-801`) with
its heading, the `SellerVendorCard` import, and then:

```bash
git rm src/features/clear-advance/components/SellerVendorCard.tsx
```

- [ ] **Step 5: Fix the banner that points at the deleted card**

At `:530-536`, replace `เลือกในการ์ด "ผู้ขาย" ด้านล่าง (ค้นด้วยเลขผู้เสียภาษีหรือชื่อผู้ขาย) แล้วบันทึก จึงจะอนุมัติได้`
with `เลือกในคอลัมน์ "Vendor" ของตารางด้านบน แล้วบันทึก จึงจะอนุมัติได้`.
Check `handleAccountApprove`'s toast (`:358-361`) for the same stale wording.

- [ ] **Step 6: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0; test count up by the Task 1 cases and no failures.

- [ ] **Step 7: Commit**

```bash
git add -A src/features/clear-advance/components/ClearAdvanceDetail.tsx
git commit -m "feat(ap-3): the seller and its registry answer sit on the line they describe"
```

---

## Task 7: Verify

- [ ] **Step 1:** `npx tsc --noEmit` — exit 0
- [ ] **Step 2:** `npm test` — all pass
- [ ] **Step 3:** Do NOT run `npm run build` — it shares `.next` with the running dev server on :3081
- [ ] **Step 4:** Read the dev server output; confirm the route compiles and answers 200
- [ ] **Step 5:** Browser pass on a request at `CurrentStepCode='ACCOUNT'`: both columns present, the vendor picker filters and stores, the chip states render, the popover applies the registered name, the button's count is distinct tax ids and it empties, and the approve block still names the right rows

---

## Self-Review

**Spec coverage** — components → T2-T5; grid columns and width → T6.2; button → T6.3; card deletion → T6.4; banner text → T6.5; the button's counting rule → T1; type consolidation → T6.1. "Unchanged" needs no task; the plan touches none of it.

**Placeholders** — Tasks 4 and 5 describe their JSX rather than reprinting ~200 lines of it, and name the exact source lines to carry across with the behaviours that must survive. That is a deliberate call for a move of existing markup, not a gap; every new logic decision is spelled out.

**Type consistency** — `tinsNeedingRdCheck(items, answers)` takes `{taxId}` rows and a map of `{state}`, which is what `RdAnswer` in T3 provides and what T6.3 passes. `TaxVendorCandidate` is exported once, from `useTaxVendors`, and imported by `VendorCell` and the grid. `RdVatRegistrant` from `rd-vat-core` is the only registrant type after T6.1.
