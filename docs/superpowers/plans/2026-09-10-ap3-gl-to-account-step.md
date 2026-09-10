# AP-3 G/L Account Moves to the Account Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "รายการ" (G/L account) column off the requester's expense grid and onto the account officer's, where it becomes mandatory before the request may leave the `ACCOUNT` step.

**Architecture:** The picker's behaviour is extracted out of `ClearAdvanceForm` into a shared hook + cell so it has one home, then mounted on the account-step grid instead. A pure `linesMissingGl` helper backs both a server gate in the approval engine and the client's approve button, mirroring the `linesMissingTaxVendor` pair that already exists. No schema change and no backfill.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, MSSQL via `mssql`, `node:test` + `tsx` for tests.

**Spec:** `docs/superpowers/specs/2026-09-10-ap3-gl-account-moves-to-account-step-design.md`

> **Commits are deferred.** The repo is on `master` and the user has asked that
> nothing be committed without their word. Execute every step except the commit
> steps; report the diff at the end and let them choose the branch. The commit
> steps are written out so they can be run verbatim once approved.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/clr/clear-advance-line-validation.ts` | Pure line rules (already owns `isFilledLine`, `validateLineGlBranch`) | Add `linesMissingGl` |
| `src/lib/clr/clear-advance-line-validation.test.ts` | Its tests | Add cases |
| `src/features/clear-advance/hooks/useGlOptionsByBranch.ts` | **New.** Per-branch G/L option fetch + cache + retry | Create |
| `src/features/clear-advance/components/GlCell.tsx` | **New.** The cell: picker, `glForced` lock, "เลือกสาขาก่อน" state, stored-account fallback | Create |
| `src/features/clear-advance/components/ClearAdvanceForm.tsx` | Requester's grid | Remove the column and its machinery |
| `src/features/clear-advance/components/OcrConfirmModal.tsx` | OCR confirm grid | Hide the cell, keep the suggestion |
| `src/lib/clr/clear-advance-request-service.ts` | Save/submit service | Drop the submit-time presence check |
| `src/lib/clr/clear-advance-approval-engine.ts` | Approval chain | Add the `ACCOUNT` gate |
| `src/app/api/request/clear-advance/requests/[id]/route.ts` | Detail GET | Return `canSeeGlAccount` |
| `src/features/clear-advance/components/ClearAdvanceDetail.tsx` | Approver/read-only view | Editable column, `accountBlocked`, visibility |

---

## Task 1: `linesMissingGl` — the pure rule

**Files:**
- Modify: `src/lib/clr/clear-advance-line-validation.ts`
- Test: `src/lib/clr/clear-advance-line-validation.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/clr/clear-advance-line-validation.test.ts`:

```ts
/* linesMissingGl — which lines must carry a G/L before the account step ends. */

function glLine(amountBeforeVat: number, glAccountNo: string | null): ClearAdvanceItem {
  return { ...base(), amountBeforeVat, glAccountNo } as ClearAdvanceItem;
}

test("a posting line with no account is reported by row number", () => {
  assert.deepEqual(linesMissingGl([glLine(100, null)]), [1]);
  assert.deepEqual(linesMissingGl([glLine(100, "   ")]), [1]);
});

test("a posting line with an account is fine", () => {
  assert.deepEqual(linesMissingGl([glLine(100, "510101001")]), []);
});

test("a line that posts nothing is not asked for an account", () => {
  // toJournalItems drops amountBeforeVat === 0, so demanding one would block
  // the step over a row that can never reach the journal.
  assert.deepEqual(linesMissingGl([glLine(0, null)]), []);
});

test("a negative posting line still needs an account", () => {
  assert.deepEqual(linesMissingGl([glLine(-100, null)]), [1]);
});

test("row numbers are 1-based and skip the rows that are fine", () => {
  assert.deepEqual(
    linesMissingGl([glLine(100, "510101001"), glLine(0, null), glLine(100, null), glLine(100, null)]),
    [3, 4],
  );
});

test("no lines is not a violation", () => {
  assert.deepEqual(linesMissingGl(null), []);
  assert.deepEqual(linesMissingGl([]), []);
});
```

Add `linesMissingGl` to the existing import at the top of the file. If the file
has no `base()` helper for building a `ClearAdvanceItem`, define one beside the
tests that returns an object with every required field of `ClearAdvanceItem`
set to a neutral value (`lineNo: 0`, `expenseDate: null`, `description: null`,
`branchCode: null`, `glAccountNo: null`, `glAccountName: null`,
`amountBeforeVat: 0`, `vatAmount: 0`, `whtAmount: 0`, and `null` for the
remaining optional columns) — read the interface at
`src/features/clear-advance/types.ts:6-44` and match it exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/clr/clear-advance-line-validation.test.ts`
Expected: FAIL — `linesMissingGl` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/clr/clear-advance-line-validation.ts`:

```ts
/**
 * Lines that will post but name no G/L account, as 1-based row numbers.
 *
 * The account is chosen at the ACCOUNT step and that is the last step which can
 * edit a line, so this is what stands between an unaccounted expense and a
 * journal. It pairs with `linesMissingTaxVendor` in tax-vendor-core, and the
 * approval engine throws on both for the same reason.
 *
 * Scoped to `amountBeforeVat !== 0`, which is the other half of the filter
 * `toJournalItems` applies: a row carrying only a description never reaches the
 * journal, so demanding an account for it would block the step over nothing.
 */
export function linesMissingGl(
  items: readonly Pick<ClearAdvanceItem, "amountBeforeVat" | "glAccountNo">[] | null | undefined,
): number[] {
  const out: number[] = [];
  (items ?? []).forEach((it, i) => {
    if (n0(it.amountBeforeVat) === 0) return;
    if (!(it.glAccountNo ?? "").trim()) out.push(i + 1);
  });
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/clr/clear-advance-line-validation.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit** *(deferred — see header)*

```bash
git add src/lib/clr/clear-advance-line-validation.ts src/lib/clr/clear-advance-line-validation.test.ts
git commit -m "feat(ap-3): the rule for which lines owe a G/L account"
```

---

## Task 2: Extract the option cache and the cell

**Files:**
- Create: `src/features/clear-advance/hooks/useGlOptionsByBranch.ts`
- Create: `src/features/clear-advance/components/GlCell.tsx`
- Read first: `src/features/clear-advance/components/ClearAdvanceForm.tsx:307-356`, `src/features/clear-advance/components/LinePickers.tsx:136-205`

- [ ] **Step 1: Create the hook**

`src/features/clear-advance/hooks/useGlOptionsByBranch.ts` — lift the effect at
`ClearAdvanceForm.tsx:307-331` verbatim, keeping its comment and its
retry-on-failure (`glRequested.current.delete(code)`):

```ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GlAccountOption } from "@/features/clear-advance/types";

/**
 * The AP-3 account list for every branch a set of lines currently uses.
 *
 * The server decides which accounts a branch may charge (`listGlAccounts`
 * filters by DimensionType), so nothing is filtered here — this only fetches
 * each distinct branch once and remembers the answer. A failed fetch forgets
 * the branch so a later render retries it.
 *
 * It lived inline in ClearAdvanceForm while the requester picked the account.
 * The account officer picks it now, and both grids would otherwise carry a copy
 * of the same cache.
 */
export function useGlOptionsByBranch(branchCodes: readonly (string | null | undefined)[]) {
  const [byBranch, setByBranch] = useState<Record<string, GlAccountOption[]>>({});
  const requested = useRef<Set<string>>(new Set());

  const key = useMemo(
    () => Array.from(new Set(branchCodes.filter(Boolean) as string[])).sort().join("|"),
    [branchCodes],
  );

  useEffect(() => {
    const missing = (key ? key.split("|") : []).filter((c) => !requested.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => requested.current.add(c));
    let cancelled = false;
    Promise.all(
      missing.map((code) =>
        fetch(`/api/request/clear-advance/options/gl-accounts?branch=${encodeURIComponent(code)}`)
          .then((r) => r.json())
          .then((j: { ok: boolean; data?: GlAccountOption[] }) => [code, j.ok ? j.data ?? [] : []] as const)
          .catch(() => {
            requested.current.delete(code); // let a later render retry
            return [code, [] as GlAccountOption[]] as const;
          }),
      ),
    ).then((entries) => {
      if (!cancelled) setByBranch((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [key]);

  return byBranch;
}

/**
 * Options for one line, keeping a stored account visible even when the current
 * branch filter would no longer offer it — a historical or since-deactivated
 * account must still render rather than silently reading as "not chosen".
 * The `dimensionType` on the synthetic entry is display-only.
 */
export function glOptionsForLine(
  byBranch: Record<string, GlAccountOption[]>,
  line: { branchCode?: string | null; glAccountNo?: string | null; glAccountName?: string | null },
): GlAccountOption[] {
  const opts = (line.branchCode && byBranch[line.branchCode]) || [];
  if (!line.glAccountNo || opts.some((o) => o.glAccountNo === line.glAccountNo)) return opts;
  return [
    { glAccountNo: line.glAccountNo, nameTh: line.glAccountName || null, nameEn: null, dimensionType: "Employee" },
    ...opts,
  ];
}
```

- [ ] **Step 2: Create the cell**

`src/features/clear-advance/components/GlCell.tsx` — lift the ternary at
`ClearAdvanceForm.tsx:1427-1441`, keeping the locked-cell styling exactly:

```tsx
"use client";

import React from "react";
import { GlPicker } from "@/features/clear-advance/components/LinePickers";
import { FORCE_GL_NON_ROCKS_PC } from "@/features/clear-advance/constants";
import { glOptionsForLine } from "@/features/clear-advance/hooks/useGlOptionsByBranch";
import type { GlAccountOption } from "@/features/clear-advance/types";

/**
 * The "รายการ" cell — the G/L account one expense line is charged to.
 *
 * Two shapes, and which one shows is not the caller's decision to make:
 * a non-home brand has every line forced to FORCE_GL_NON_ROCKS_PC at save time
 * (`persistClear`), so offering a picker there would invite a choice the server
 * discards. Everywhere else the branch decides the list, which is why the
 * picker stays disabled until a branch is on the line.
 */
export function GlCell({
  line,
  optionsByBranch,
  glForced,
  disabled,
  onPick,
}: {
  line: { branchCode?: string | null; glAccountNo?: string | null; glAccountName?: string | null };
  optionsByBranch: Record<string, GlAccountOption[]>;
  glForced: boolean;
  disabled?: boolean;
  onPick: (o: GlAccountOption | null) => void;
}) {
  if (glForced) {
    return (
      <div
        className="text-[12px] px-2 py-1.5 rounded-lg"
        style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}
      >
        {FORCE_GL_NON_ROCKS_PC} · เงินจ่ายแทนบริษัทอื่น
      </div>
    );
  }
  return (
    <GlPicker
      options={glOptionsForLine(optionsByBranch, line)}
      valueNo={line.glAccountNo ?? ""}
      disabled={disabled || !line.branchCode}
      noBranch={!line.branchCode}
      onPick={onPick}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If `GlPicker` is not exported from `LinePickers.tsx`, export it.

- [ ] **Step 4: Commit** *(deferred)*

```bash
git add src/features/clear-advance/hooks/useGlOptionsByBranch.ts src/features/clear-advance/components/GlCell.tsx
git commit -m "refactor(ap-3): the G/L cell and its option cache get one home"
```

---

## Task 3: Take the column off the requester's grid

**Files:**
- Modify: `src/features/clear-advance/components/ClearAdvanceForm.tsx`

- [ ] **Step 1: Remove the column**

Delete `<Th w={220}>รายการ</Th>` (`:1388`) and its `<Td>` (`:1427-1441`) from the
desktop table, and the matching mobile block at `:1539-1544`. Read each region
before cutting — the mobile layout is labelled rows, not a table.

- [ ] **Step 2: Remove the machinery it needed**

Delete `glOptionsFor` (`:350-356`), the fetch effect (`:307-331`), the
`branchKeys` memo (`:309-312`), the `glByBranch` / `glRequested` state and ref,
the branch-invalidation effect (`:334-348`), and the now-unused
`GlAccountOption` import if nothing else uses it. Keep the `glForced` constant
only if something other than the deleted banner reads it; delete the banner at
`:1332-1337`.

Keep `glAccountNo` / `glAccountName` on `LineRow` (`:98-99`). They are not
rendered any more but they must round-trip: a Returned request carries the
account the officer already chose, and `persistClear` writes back whatever the
payload holds.

- [ ] **Step 3: Clear the account when the branch changes**

The deleted effect did this by comparing against fetched options. Without the
fetch, do it at the point of change instead. In `updateLine`, when the patch
carries a `branchCode` different from the line's current one, clear the account
in the same update:

```ts
const updateLine = (idx: number, patch: Partial<LineRow>) => {
  setLines((prev) =>
    prev.map((l, i) => {
      if (i !== idx) return l;
      /* The account is branch-dependent, so changing the branch invalidates it.
         The requester cannot see the account any more, which is exactly why
         this has to be silent and automatic: leaving a now-illegal account on
         the line would fail `validateLineGlBranch` on their own save, with an
         error naming a field they can neither see nor fix. */
      const branchChanged = patch.branchCode !== undefined && patch.branchCode !== l.branchCode;
      return branchChanged
        ? { ...l, ...patch, glAccountNo: "", glAccountName: "" }
        : { ...l, ...patch };
    }),
  );
};
```

Read the existing `updateLine` first and preserve whatever else it does.

- [ ] **Step 4: Remove the client-side presence check**

Delete line `:631`:

```ts
if (!glForced && !l.glAccountNo) { errs.push({ key: "lines", message: "มีรายการค่าใช้จ่ายที่ยังไม่ได้เลือกหมวด (รายการ)" }); break; }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit** *(deferred)*

```bash
git add src/features/clear-advance/components/ClearAdvanceForm.tsx
git commit -m "feat(ap-3): the requester no longer chooses the G/L account"
```

---

## Task 4: Keep the AI guess, drop its cell

**Files:**
- Modify: `src/features/clear-advance/components/OcrConfirmModal.tsx`

- [ ] **Step 1: Hide the cell and the badge**

Remove the G/L column header, the cell at `:459-465`, and the
"AI แนะนำจากรายละเอียด — เปลี่ยนได้" badge at `:478-482`.

- [ ] **Step 2: Keep the suggestion effect exactly as it is**

Do **not** touch `:220-251`. It still fills `glAccountNo` / `glAccountName` on
rows that have a branch, a description and no account yet, and those values
still travel into the form's lines at `ClearAdvanceForm.tsx:1063-1064`. That is
what puts a pre-filled grid in front of the account officer.

The `glSuggested` flag stays on the row type — it is no longer rendered, and
nothing persists it. Leave it rather than unpicking the effect around it.

Keep the branch-change clearing at `:206-218`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. Remove any import left unused by the deletion.

- [ ] **Step 4: Commit** *(deferred)*

```bash
git add src/features/clear-advance/components/OcrConfirmModal.tsx
git commit -m "feat(ap-3): the OCR guess now waits for accounting, unseen"
```

---

## Task 5: Stop requiring the account at submit

**Files:**
- Modify: `src/lib/clr/clear-advance-request-service.ts:408`

- [ ] **Step 1: Delete the check**

Remove from the `for (const it of lines)` loop inside `validateForSubmit`:

```ts
if (!it.glAccountNo) errs.push("มีรายการค่าใช้จ่ายที่ยังไม่ได้เลือกหมวด (รายการ)");
```

Leave the `expenseDate` and `amountBeforeVat` checks beside it untouched, and
leave `assertLinesWritable` alone — `validateLineGlBranch` must keep running on
every save path, because an account that is present still has to be one the
line's branch may charge.

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: PASS. If a test asserted the removed message, it is now wrong — delete
that assertion; the rule it covered has moved to Task 6.

- [ ] **Step 3: Commit** *(deferred)*

```bash
git add src/lib/clr/clear-advance-request-service.ts
git commit -m "feat(ap-3): submitting no longer waits on an account nobody can pick"
```

---

## Task 6: The gate at the account step

**Files:**
- Modify: `src/lib/clr/clear-advance-approval-engine.ts`
- Read first: `:60-100` — the existing vendor and ภ.ง.ด. gates

- [ ] **Step 1: Add the gate**

Import the helper:

```ts
import { linesMissingGl } from "@/lib/clr/clear-advance-line-validation";
```

Inside `if (step === "ACCOUNT") { ... }`, directly after the
`linesMissingTaxVendor` block, add:

```ts
    /* Every posting line must name its G/L account before it leaves this step.
       The requester used to choose it and no longer sees the field at all, so
       accounting owns it now — and this is the last step that can edit a line,
       the same reason the vendor check above lives here. Read from the request
       rather than from the caller: the officer's own autosave is what fills
       this, so the check is on stored state. */
    const missingGl = linesMissingGl(before.clear?.items);
    if (missingGl.length > 0) {
      throw new Error(
        `กรุณาเลือกรายการ (หมวดบัญชี) ให้ครบก่อนอนุมัติ — รายการที่ ${missingGl.join(", ")} ยังไม่ได้เลือก`,
      );
    }
```

- [ ] **Step 2: Write the failing test**

Add to the approval-engine test file (create
`src/lib/clr/clear-advance-approval-gate.test.ts` if the engine has no test file
— the engine touches the database, so test `linesMissingGl` against the exact
shapes the engine passes rather than mocking a pool):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { linesMissingGl } from "./clear-advance-line-validation";

test("the account step is blocked by the rows it can still fix", () => {
  const items = [
    { amountBeforeVat: 500, glAccountNo: "510101001" },
    { amountBeforeVat: 300, glAccountNo: null },
  ];
  const missing = linesMissingGl(items);
  assert.deepEqual(missing, [2]);
  assert.equal(
    `กรุณาเลือกรายการ (หมวดบัญชี) ให้ครบก่อนอนุมัติ — รายการที่ ${missing.join(", ")} ยังไม่ได้เลือก`,
    "กรุณาเลือกรายการ (หมวดบัญชี) ให้ครบก่อนอนุมัติ — รายการที่ 2 ยังไม่ได้เลือก",
  );
});
```

- [ ] **Step 3: Run it**

Run: `npm test -- src/lib/clr/clear-advance-approval-gate.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit** *(deferred)*

```bash
git add src/lib/clr/clear-advance-approval-engine.ts src/lib/clr/clear-advance-approval-gate.test.ts
git commit -m "feat(ap-3): a clearing cannot leave accounting without its accounts"
```

---

## Task 7: Put the column on the account officer's grid

**Files:**
- Modify: `src/app/api/request/clear-advance/requests/[id]/route.ts`
- Modify: `src/features/clear-advance/components/ClearAdvanceDetail.tsx`

- [ ] **Step 1: Return the flag the route already computes**

In the GET handler, keep the gate's result instead of discarding it:

```ts
  const gate = await authorizeAccRequest(session, id, "read", AP3_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const req = await getRequest(id);
    if (!req) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    /* Who may see the G/L column. `isAccountArea` is accounting-area access or
       an active approver on this form's own roster, and for AP-3 that roster
       check is exactly ["ACCOUNT", "HEAD"] (request-acl.ts:112-117) — the line
       manager comes from the requester's ManagerStaffId in HR, not from it. So
       this already means "accounting, not the requester and not the manager",
       which is the audience the column is for. */
    return NextResponse.json({ ok: true, data: req, canSeeGlAccount: gate.viewer.isAccountArea });
  } catch (e) {
```

- [ ] **Step 2: Pass it down**

In `src/app/(dashboard)/request/clear-advance/[id]/page.tsx`, read
`canSeeGlAccount` off the response beside `data` and pass it at `:92`:

```tsx
<ClearAdvanceDetail request={request} canSeeGlAccount={canSeeGlAccount} onChanged={fetchRequest} />
```

In `ClearAdvanceDetail.tsx`, add to `interface Props` (`:105`):

```ts
  /** Accounting may see and set the G/L account; nobody else sees the column.
      Defaults to false so a mount that does not know — MyRequestsPanel, which
      is the requester's own list — hides it, which is the right answer there. */
  canSeeGlAccount?: boolean;
```

and destructure it at `:131` with `canSeeGlAccount = false`.

- [ ] **Step 3: Add the editable column**

In the account-step grid, add a `รายการ` header after `รายละเอียด` in the
`<thead>` at `:557-579` and the matching cell in the `<tbody>` row, both wrapped
in `{canSeeGlAccount && ( ... )}`:

```tsx
<td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
  <GlCell
    line={it}
    optionsByBranch={glByBranch}
    glForced={glForced}
    onPick={(o) => patchItem(i, { glAccountNo: o?.glAccountNo ?? null, glAccountName: o?.nameTh ?? null })}
  />
</td>
```

Wire the hook near the other hooks in the component:

```ts
const glByBranch = useGlOptionsByBranch(editItems.map((it) => it.branchCode));
const glForced = !!request.brandCode && !isRocksPcBrand(request.brandCode);
```

Use whatever the component's existing per-row edit function is called — read
`:268-277` and the surrounding handlers; the grid already updates `editItems`
and the 900 ms autosave at `:396-404` picks the change up with no extra work,
because `saveNow` sends `items: latest.current.items` wholesale.

- [ ] **Step 4: Block approve on a missing account**

At `:257`, beside the vendor line:

```ts
const missingGlLines = linesMissingGl(isAccountStep ? editItems : items);
```

and add it to `accountBlocked` at `:265`. Show the row numbers next to the
approve button the same way the vendor block does, so the officer is told which
rows rather than only that something is wrong.

- [ ] **Step 5: Hide it from everyone else in the read-only grid**

At `:1134`, wrap the G/L cell and its header in `canSeeGlAccount` so the
requester and the manager see the grid without the column.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0, all tests pass.

- [ ] **Step 7: Commit** *(deferred)*

```bash
git add src/app/api/request/clear-advance/requests/\[id\]/route.ts "src/app/(dashboard)/request/clear-advance/[id]/page.tsx" src/features/clear-advance/components/ClearAdvanceDetail.tsx
git commit -m "feat(ap-3): accounting picks the G/L account, on the grid it already edits"
```

---

## Task 8: Verify the whole thing

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Full suite**

Run: `npm test`
Expected: every test passes, count no lower than 1452 plus the new cases.

- [ ] **Step 3: Do not build**

`npm run build` is forbidden while the user's `npm run dev` is running on
:3081 — they share `.next` and the build hangs the dev server. Typecheck plus
tests is the gate.

- [ ] **Step 4: Confirm the dev server compiled**

The dev server recompiles on save. Read its output and confirm the changed
routes still answer 200 with no compile error.

- [ ] **Step 5: Report**

Report the diff, the test counts, and what was left uncommitted.

---

## Self-Review

**Spec coverage** — all ten numbered changes in the spec map to a task: 1→T2,
2→T3, 3→T3, 4→T3, 5→T4, 6→T5, 7→T6, 8→T7, 9→T7, 10→T7. "Who may see the
column" →T7. "Returned requests" is behaviour, covered by T3 step 3. "No schema
change" needs no task. The three spec tests map to T1, T6 and T7; the
`GlCell`/`useGlOptionsByBranch` test the spec asks for is folded into T2's
typecheck plus T7's use, because both are thin wrappers over code that already
had no test — noted here rather than silently dropped.

**Placeholders** — none. Every code step carries its code. The two places that
say "read the existing function first" (T3 step 3, T7 step 3) name the exact
lines and say what must be preserved.

**Type consistency** — `linesMissingGl` takes
`Pick<ClearAdvanceItem, "amountBeforeVat" | "glAccountNo">[]` in T1 and is
called with `before.clear?.items` (T6) and `editItems` / `items` (T7), all of
which are `ClearAdvanceItem[]`. `GlCell`'s `onPick` gives
`GlAccountOption | null`, matching `GlPicker`'s existing signature and the
`o?.glAccountNo ?? null` call in T7. `glOptionsForLine` and `useGlOptionsByBranch`
are both imported from the hook file in T2 and used under those names in T7.
