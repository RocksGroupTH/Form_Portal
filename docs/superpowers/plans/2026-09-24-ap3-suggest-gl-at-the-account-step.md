# AP-3: suggesting a G/L account at the account step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button at AP-3's ACCOUNT step that fills the G/L account for the lines that have none, in both consoles.

**Architecture:** One pure function decides which lines are eligible and why the rest are not. A claim-scoped route asks the model for the eligible ones and **returns** the answers — it does not write, because the grid autosaves and a second writer would erase itself. The screen applies them and the existing save path persists them.

**Tech Stack:** Next.js 16, TypeScript, Anthropic Haiku 4.5. **Form Portal has no vitest** — `npm test` runs `tsx scripts/run-tests.ts` over `node --test`. **ACC Portal uses vitest.**

**Spec:** `docs/superpowers/specs/2026-09-24-ap3-suggest-gl-at-the-account-step-design.md`

---

## Global constraints

1. **Never run `npm run build`** in either repo — a dev server owns `.next`.
2. `next-env.d.ts` in Form Portal carries an unrelated pre-existing diff. **Stage by name, never `git add -u` / `.` / `-a`.**
3. **Never `git checkout --`.** Use `cp` backups.
4. **No test may call a model.** The route's test fakes the suggestion function.
5. **Do not change the requester's form, the OCR-time suggestion, or the existing claim-less `/api/request/clear-advance/suggest-gl`.**
6. Commit trailer, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## The precedent to read first, in both repos

`src/app/api/request/reimburse/requests/[id]/suggest-gl/route.ts` — AP-4's version of this button. Its docblock carries the arguments (a button not a sweep, empty lines only, sequential calls, `filled: 0` is a success). **Read it before writing anything.** The one thing not to copy is that it writes; see §1 of the design.

---

# Slice A — who is eligible, and why the rest are not

## Task 1: Form Portal's eligibility rule

**Files:**
- Create: `R:\Form_Portal\src\lib\clr\gl-suggest-targets.ts`
- Create: `R:\Form_Portal\src\lib\clr\gl-suggest-targets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { planGlSuggestions } from "./gl-suggest-targets";
import { linesMissingGl } from "./clear-advance-line-validation";

/**
 * Which lines the suggest button asks about, and what it says about the rest.
 *
 * The property at the bottom is the point: every line the approval gate
 * complains about must come back either as a target or in one of the counts.
 * A line that falls out of both is a line the officer is blocked on and never
 * told about — the button would appear to work and the gate would stay red.
 */

const line = (over: Partial<Record<string, unknown>> = {}) => ({
  glAccountNo: "", amountBeforeVat: 100, description: "ค่าแท็กซี่", branchCode: "HQ01", ...over,
});

test("an empty G/L with a description, a branch and an amount is a target", () => {
  const p = planGlSuggestions([line()]);
  assert.deepEqual(p.targets, [0]);
  assert.deepEqual(p.noDescription, []);
  assert.deepEqual(p.noBranch, []);
});

test("an account already chosen is the officer's answer, not a target", () => {
  assert.deepEqual(planGlSuggestions([line({ glAccountNo: "610322005" })]).targets, []);
});

test("a zero-amount line is not a target, matching the gate", () => {
  const items = [line({ amountBeforeVat: 0 })];
  assert.deepEqual(planGlSuggestions(items).targets, []);
  assert.deepEqual(linesMissingGl(items), []);
});

test("no description is counted, not silently dropped", () => {
  const p = planGlSuggestions([line({ description: "   " })]);
  assert.deepEqual(p.targets, []);
  assert.deepEqual(p.noDescription, [0]);
});

test("no branch is counted, not guessed at", () => {
  const p = planGlSuggestions([line({ branchCode: "" })]);
  assert.deepEqual(p.targets, []);
  assert.deepEqual(p.noBranch, [0]);
});

test("every line the gate complains about is accounted for", () => {
  const items = [
    line(),
    line({ glAccountNo: "610322005" }),
    line({ description: "" }),
    line({ branchCode: null }),
    line({ amountBeforeVat: 0 }),
    line({ amountBeforeVat: 0, description: "" }),
    line({ description: "", branchCode: "" }),
  ];
  const p = planGlSuggestions(items);
  const accountedFor = [...p.targets, ...p.noDescription, ...p.noBranch].map((i) => i + 1).sort((a, b) => a - b);
  assert.deepEqual(
    accountedFor,
    linesMissingGl(items),
    "a line the gate blocks on fell out of every bucket",
  );
});

test("a line is counted once, even when it lacks both", () => {
  const p = planGlSuggestions([line({ description: "", branchCode: "" })]);
  const all = [...p.targets, ...p.noDescription, ...p.noBranch];
  assert.equal(new Set(all).size, all.length);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/gl-suggest-targets.test.ts
```

- [ ] **Step 3: Write the module**

```ts
import { linesMissingGl } from "@/lib/clr/clear-advance-line-validation";

/**
 * Which lines the account step's suggest button asks the model about, and why
 * the rest are left alone.
 *
 * ## The rule this has to match
 *
 * `linesMissingGl` is what blocks the ACCOUNT step. The button exists to clear
 * that block, so its buckets together must cover exactly what that function
 * flags — no more, and crucially no less. A line the gate complains about that
 * falls out of every bucket is a line the officer is blocked on and never told
 * about: the button reports success, the gate stays red, and nothing says why.
 * `gl-suggest-targets.test.ts` pins that as a property rather than a case.
 *
 * ## Why a line without a description is counted rather than asked about
 *
 * `suggestGlAccountWithAI` is given the description and the candidate list and
 * nothing else. With no description there is nothing to go on, and the route
 * would spend a model call to be told so. It is common now rather than
 * theoretical: group A's "attach without the AI read" produces no expense row
 * at all, so the requester types one, and the description is optional.
 *
 * ## Why a line without a branch is counted rather than asked about
 *
 * A blank branch does not produce an empty candidate list — it produces the
 * WRONG one. `allowedDimensionTypes` reads a blank branch as HQ, so a branch
 * line would be offered head-office accounts and `validateLineGlBranch` would
 * refuse them at save time. Suggesting an account that cannot be saved is
 * worse than suggesting none. In practice submitted lines always have a branch
 * (the submit validator requires it), so this is a guard, not a common case.
 */
export type GlSuggestPlan = {
  /** 0-based indices to ask the model about. */
  targets: number[];
  /** 0-based indices blocked on a G/L that have no description to go on. */
  noDescription: number[];
  /** 0-based indices blocked on a G/L that have no branch. */
  noBranch: number[];
};

type PlanLine = {
  glAccountNo?: string | null;
  amountBeforeVat?: number | string | null;
  description?: string | null;
  branchCode?: string | null;
};

const has = (s: string | null | undefined) => (s ?? "").trim() !== "";

export function planGlSuggestions(items: readonly PlanLine[] | null | undefined): GlSuggestPlan {
  const plan: GlSuggestPlan = { targets: [], noDescription: [], noBranch: [] };
  // The gate answers in 1-based row numbers; everything here is an index.
  const blocked = new Set(linesMissingGl(items as never).map((row) => row - 1));
  (items ?? []).forEach((it, i) => {
    if (!blocked.has(i)) return;
    if (!has(it.branchCode)) plan.noBranch.push(i);
    else if (!has(it.description)) plan.noDescription.push(i);
    else plan.targets.push(i);
  });
  return plan;
}
```

**Check `linesMissingGl`'s real signature before you finalise** — it takes `Pick<ClearAdvanceItem, "amountBeforeVat" | "glAccountNo">[]`. If `as never` is needed to satisfy it, prefer a narrower type or a small local adapter over a cast, and say what you chose.

- [ ] **Step 4: Run, then prove the tests bite**

`cp` the module aside and break it three ways, running after each and restoring:
1. Put `noBranch` before the `blocked` check (so unblocked lines get counted) — the property test must go red.
2. Drop the `noDescription` branch and let those fall through to `targets` — the "no description is counted" case must go red.
3. Return `{ targets: [], noDescription: [], noBranch: [] }` always — the property test must go red.

Report which test names failed for each. **A mutation that leaves everything green means a test is not pulling its weight — say so.**

- [ ] **Step 5: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```
Commit both files by name, message in your own words.

---

## Task 2: ACC Portal's copy

**Files:**
- Create: `R:\Acc_Portal\src\lib\clr\gl-suggest-targets.ts`
- Create: `R:\Acc_Portal\src\lib\clr\gl-suggest-targets.test.ts`

Branch first: `git checkout -b feat/ap3-suggest-gl-account-step` off the current HEAD (which is group C's branch — that is intended; this stacks on it).

Port the module **byte for byte** from Form Portal, adding one paragraph recording that it is kept identical and why. Translate the tests to vitest (`describe`/`it`/`expect`, following `src/lib/acc/ap234-roles.test.ts`), keeping every comment.

**Verify ACC's `linesMissingGl` is the same function** before assuming the port is valid — if the two repos' gates disagree, stop and report it. Repeat Task 1 Step 4's three mutations here and report the results.

---

# Slice B — the routes

## Task 3: Form Portal's route

**Files:**
- Create: `R:\Form_Portal\src\app\api\request\clear-advance\requests\[id]\suggest-gl\route.ts`
- Create: its `route.test.ts` alongside

- [ ] **Step 1: Read three things first**

1. AP-4's route (the precedent), at `src/app/api/request/reimburse/requests/[id]/suggest-gl/route.ts`.
2. The existing claim-less AP-3 route, `src/app/api/request/clear-advance/suggest-gl/route.ts` — it already builds the candidate list correctly (`resolveClrCompany(brand)` → `listGlAccounts({ company, branchCode })`) and matches the answer back against it. **Reuse that shape.**
3. `src/app/api/request/clear-advance/requests/[id]/account-edit/route.ts` — for the auth gate this screen's writes already use.

- [ ] **Step 2: Write the route**

`POST`, claim id in the path, **no request body**.

- **Auth:** `requireAuth()`, then the same check `account-edit` applies — this is an account-step action, and a viewer who may not edit the grid has no business spending model calls on it. Use `account-edit`'s gate verbatim rather than AP-4's `authorizeAccRequest(..., "read", ...)`, and **say in your report which you used and why** if the two differ in practice.
- Load the claim. Non-existent → 404.
- **Refuse for a forced-G/L brand**: if `!isRocksPcBrand(claim.brandCode)`, return 400 with a message saying this brand's account is fixed. The button is hidden there, so reaching this is a bug or a crafted call, and answering "filled 0" would hide it.
- `planGlSuggestions(claim items)` → `targets` / `noDescription` / `noBranch`.
- **The candidate list is per branch**, not per claim — lines in one claim can sit in different branches. Build it once per distinct branch and reuse, rather than once per line.
- **If a branch's candidate list comes back empty, that is an error, not an empty answer.** The design records this as a lived silent failure. Return 400 with a message naming the branch.
- **Sequential** over `targets`. Not `Promise.all` — AP-4's docblock says why, and it is a recorded lesson in this codebase.
- A model error on one line must not lose the others: catch per line and count it as no answer.

Response:

```ts
{ ok: true, data: {
  itemCount: number,              // how many lines the route saw
  suggestions: { index: number; glAccountNo: string; nameTh: string | null }[],
  noDescription: number,          // counts, not indices — the screen has the plan too
  noBranch: number,
  noAnswer: number,               // asked, model declined
} }
```

`suggestions: []` is a success.

Carry a docblock that states, in your own words: **this route does not write.** The screen holds the grid and autosaves it; a second writer would have its values erased by the next autosave from a screen still holding the old lines. The screen applies what this returns and the existing save path persists it.

- [ ] **Step 3: Test it without calling a model**

Create `route.test.ts` in the same folder. **Do not import the route** — it pulls `@/lib/db/mssql` → `@/env`, which validates the environment at module scope and throws under `tsx`. Follow the pattern used by `src/app/api/request/clear-advance/report/export/route.test.ts`: test the logic the route composes, through the pure pieces it is built from.

At minimum:
- `planGlSuggestions` over a realistic claim produces the counts the response reports;
- the counts add up: `suggestions.length + noAnswer === targets.length`;
- `itemCount` equals the number of lines.

If any of that can only be tested by extracting a helper out of the route, **extract it** — a route that cannot be tested without a database is a route whose logic belongs beside it, not inside it. Say what you extracted.

- [ ] **Step 4: Verify and commit** — `npx tsc --noEmit && npm test`.

---

## Task 4: ACC Portal's route

Same route at the same path in ACC. ACC has **no AP-3 suggest machinery**, so:

- It has `suggestGlAccountWithAI(description, candidates)` at `src/lib/acc/reimburse/ai-suggest.ts` (verified signature). **Reuse it** — do not add a second copy. If its `GlCandidate` type does not fit AP-3's account shape, adapt at the call site and say so.
- It has AP-3's candidate machinery behind `src/app/api/request/clear-advance/options/gl-accounts/route.ts`. Use the same service functions that route uses.
- ACC's account-step write gate is its own `account-edit` route's; use that.

Everything else — the plan, the sequential loop, the response shape, the no-write rule — identical to Task 3. **Report every place ACC's version had to differ.**

---

# Slice C — the button

## Task 5: Form Portal's account step

**Files:**
- Modify: `R:\Form_Portal\src\features\clear-advance\components\ClearAdvanceDetail.tsx`

- [ ] **Step 1: Place it beside the RD button**

The toolbar at `~:706-735` holds the **ตรวจสรรพากร** bulk button. Read it — it is this screen's established shape for a bulk action: derive the pending set from `editItems`, disable when empty, label with the count. Follow it.

- [ ] **Step 2: Behaviour**

- Compute the plan from `editItems` with `planGlSuggestions`.
- **Hidden entirely when `glForced`** (`~:313`) — the server overwrites those accounts anyway.
- **Hidden when `targets.length === 0`**, even if `noDescription`/`noBranch` are not: a button that can only report "nothing I can do" is one people learn to ignore. Label it with the target count, like the RD button.
- On click: `await flushSave()` first, so the route reads what the officer has typed rather than the last persisted state. Then POST. Then **apply the suggestions to `editItems` by index**, and let the existing autosave persist them.
- **Guard the apply**: if the response's `itemCount !== editItems.length`, do not apply anything — show an error asking the officer to reload. The indices would be meaningless, and writing an account onto the wrong line is the one outcome worse than doing nothing.
- A spinner while it runs; the button disabled during.

- [ ] **Step 3: What it says**

One toast, naming only the non-zero parts, e.g.
`เติมให้ 3 รายการ · อีก 2 รายการไม่มีคำอธิบาย ให้พิมพ์คำอธิบายหรือเลือกบัญชีเอง · 1 รายการ AI เดาไม่ออก`.
`filled: 0` is not an error — say what happened, not that something failed.

Write the sentence yourself; keep it one line and in this screen's voice.

- [ ] **Step 4: Verify and commit** — `npx tsc --noEmit && npm test`.

---

## Task 6: ACC Portal's account step

Same, in `R:\Acc_Portal\src\features\clear-advance\components\ClrAccountWorkspace.tsx` — its RD button is at `~:508-526`, `glForced` at `~:309`, `flushSave`/`saveNow` around `~:218-274`.

**Keep the Thai wording byte-identical to Form Portal's** — copy it out of the file, do not retype. The two consoles must not describe the same outcome differently.

---

# Slice D — guards and the browser

## Task 7: Guard tests, both repos

Source-scan guards in the established style (read `src/lib/acc/payday-form-scope-guard.test.ts` first; strip comments before matching; assert the scan found something).

Pin the two decisions a later edit is most likely to undo:

1. **The route does not use `Promise.all`** over its model calls, in either repo. This is a recorded lesson twice over and reads like an obvious optimisation.
2. **The button is not rendered when the brand forces the G/L** — assert the render is guarded by the same test `GlCell` uses.

**Prove both bite**: `cp` aside, make the regression, run, confirm it fails naming the file, restore, delete the copy. Report the failure output.

## Task 8: Drive it in the browser

Form Portal runs on `:3081`, ACC Portal on `:3060`. Both were running on 2026-09-24; ACC's was restarted that day after failing to render pages.

- [ ] A claim at the ACCOUNT step with a line that has a description and no G/L: the button appears with the right count; pressing it fills the cell; the grid saves; reloading keeps the value.
- [ ] A line with **no description**: it is not filled, and the toast says how many were skipped and why. **This is the case group A created and the whole reason for the separate counts.**
- [ ] A claim with every G/L already set: **no button at all.**
- [ ] A non-home brand: **no button at all**, and the G/L cells still show the forced chip.
- [ ] The same in the other console.
- [ ] Report what could not be checked, plainly, rather than implying it passed.
