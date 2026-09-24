# AP-2 pays every Friday, and AP-3's journal says ADC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AP-2 a weekly payday without moving AP-1's or AP-3's, and make AP-3's Business Central journal lead with the ADC number instead of the ADV.

**Architecture:** One pure module decides which Fridays a form pays on; `getPaymentDates` gains a **required** form argument so the compiler finds every caller and none can keep a default. AP-3 stops borrowing AP-2's picker endpoint and gets its own. Separately and independently, the AP-3 journal's `describe()` drops four fixed words and the ADV number.

**Tech Stack:** Next.js 16, TypeScript, node-mssql. **Form Portal has no vitest** — `npm test` runs `tsx scripts/run-tests.ts` over `node --test`; every test uses `node:test` + `node:assert/strict`. **ACC Portal uses vitest** — `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-09-24-ap2-weekly-payday-and-adc-description-design.md`

---

## Global constraints

1. **Never run `npm run build`** in either repo — a dev server owns `.next`. Use `npx tsc --noEmit` plus the repo's own runner.
2. `next-env.d.ts` in Form Portal carries an unrelated pre-existing diff. **Stage by name, never `git add -u` / `.` / `-a`.**
3. **Do not touch AP-4.** `src/lib/acc/reimburse/payment-calendar.ts` has its own calendar and is out of scope.
4. **Do not change any amount, posting date, document type or `employeeCode`.** Group B changes *when* AP-2 pays and *what one Description string says*. Nothing else.
5. Slices A–C (item 1) and Slice D (item 6) are independent. D can ship without A–C and vice versa.

## Open question, deliberately not answered here

**Which Friday AP-2 pre-fills.** This plan changes which Fridays AP-2 *offers*; it does not touch
the rule that decides which one is *preselected*. `defaultPaymentRound` takes the first round whose
own week's Monday noon has not passed — designed for a fortnightly cadence, where missing that
deadline cost two weeks. Under a weekly cadence an approval at Monday 12:01 defaults to the Friday
eleven days out while the Friday four days out sits selectable in the picker beside it, so an
officer approving Tuesday-to-Friday will override the default every week.

Raised by the code review of Task 2 on 2026-09-24. The user deferred it to ask the business, so
**AP-2 keeps the shared cut-off for now** and the reasoning is recorded in `getDefaultPaymentDate`'s
docblock rather than left to be rediscovered. Nothing in Tasks 1–9 depends on the answer; whichever
way it goes, the change is in `payment-calendar-core.ts`'s `defaultPaymentRound` plus a test, and it
must be made in both consoles.

## File structure

| File | Change | Task |
| --- | --- | --- |
| `FP src/lib/acc/payment-calendar-core.ts` | **new** `everyFridayInMonth` | 1 |
| `FP src/lib/acc/payment-rounds.ts` | **new** — which Fridays each form pays on | 1 |
| `FP src/lib/acc/payment-rounds.test.ts` | **new** — its tests | 1 |
| `FP src/lib/acc/payment-calendar.ts` | `ROUNDS` goes; `form` threaded through | 2 |
| `FP` 8 consumers | each names its form | 2 |
| `FP src/app/api/request/clear-advance/payment-dates/route.ts` | **new** — AP-3's own picker | 3 |
| `FP ClearAdvanceDetail.tsx`, `admin/ClrErpInterfaceQueue.tsx` | point at it | 3 |
| `ACC src/lib/acc/payment-calendar-core.ts`, `payment-rounds.ts` + test | the same two modules | 4 |
| `ACC src/lib/acc/payment-calendar.ts` + consumers | inline `[2,4]` goes; `form` threaded | 5 |
| `ACC src/app/api/request/clear-advance/payment-dates/route.ts` | **new** | 6 |
| `ACC ClrAccountWorkspace.tsx`, `ClrErpInterfaceQueue.tsx` | point at it | 6 |
| `FP` + `ACC` `src/lib/clr/clear-advance-erp-payload.ts` + tests | the Description | 7, 8 |

---

# Slice A — the rule, as pure code (Form Portal)

## Task 1: Which Fridays each form pays on

**Files:**
- Modify: `R:\Form_Portal\src\lib\acc\payment-calendar-core.ts`
- Create: `R:\Form_Portal\src\lib\acc\payment-rounds.ts`
- Create: `R:\Form_Portal\src\lib\acc\payment-rounds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/acc/payment-rounds.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { everyFridayInMonth, ymd } from "./payment-calendar-core";
import { paydaysInMonth } from "./payment-rounds";

const days = (ds: Date[]) => ds.map(ymd);

/* September 2026 has four Fridays: 4, 11, 18, 25. */
test("a four-Friday month gives four", () => {
  assert.deepEqual(days(everyFridayInMonth(2026, 8)),
    ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
});

/* January 2027 has five: 1, 8, 15, 22, 29. */
test("a five-Friday month gives five", () => {
  assert.deepEqual(days(everyFridayInMonth(2027, 0)),
    ["2027-01-01", "2027-01-08", "2027-01-15", "2027-01-22", "2027-01-29"]);
});

/* The trap this function exists for. nthFridayOfMonth(2026, 8, 5) is raw date
   arithmetic — 1 + offset + 4*7 — and rolls into October, silently. Every date
   here must belong to the month asked for. */
test("no date escapes its month", () => {
  for (let m = 0; m < 12; m++) {
    for (const d of everyFridayInMonth(2026, m)) {
      assert.equal(d.getMonth(), m, `${ymd(d)} escaped month ${m}`);
      assert.equal(d.getDay(), 5, `${ymd(d)} is not a Friday`);
    }
  }
});

test("AP-2 pays every Friday", () => {
  assert.deepEqual(days(paydaysInMonth("AP-2", 2026, 8)),
    ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
});

test("AP-1 and AP-3 pay on the 2nd and 4th only", () => {
  assert.deepEqual(days(paydaysInMonth("AP-1", 2026, 8)), ["2026-09-11", "2026-09-25"]);
  assert.deepEqual(days(paydaysInMonth("AP-3", 2026, 8)), ["2026-09-11", "2026-09-25"]);
});

/* The property that makes this change safe to ship: no stored PaymentDate can
   become invalid, because AP-2's new set contains its old one. */
test("AP-2's days are a superset of what they were", () => {
  for (let m = 0; m < 12; m++) {
    const weekly = new Set(days(paydaysInMonth("AP-2", 2026, m)));
    for (const d of days(paydaysInMonth("AP-1", 2026, m))) {
      assert.ok(weekly.has(d), `${d} was payable before and is not now`);
    }
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/acc/payment-rounds.test.ts
```

Expected: FAIL — `everyFridayInMonth` is not exported and `./payment-rounds` does not exist.

- [ ] **Step 3: Add the primitive to the core**

In `src/lib/acc/payment-calendar-core.ts`, directly after `nthFridayOfMonth` (which ends at line 20), add:

```ts
/**
 * Every Friday that falls inside this month — four in most, five in some.
 *
 * NOT `[1,2,3,4,5].map(nthFridayOfMonth)`. That helper is raw arithmetic —
 * `1 + offset + (nth - 1) * 7` — so asking a four-Friday month for its fifth
 * returns a date in the NEXT month, silently, which is then produced again when
 * that month is walked as its own first Friday. This walks instead, and stops
 * when it leaves the month it was asked about.
 */
export function everyFridayInMonth(year: number, month0: number): Date[] {
  const out: Date[] = [];
  const d = nthFridayOfMonth(year, month0, 1);
  while (d.getMonth() === month0) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}
```

- [ ] **Step 4: Create the form map**

Create `src/lib/acc/payment-rounds.ts`:

```ts
import { everyFridayInMonth, paymentRoundsInMonth } from "@/lib/acc/payment-calendar-core";

/**
 * The forms whose payday calendar lives here.
 *
 * AP-4 is deliberately absent: it pays on the 1st and 3rd Friday and keeps its
 * own calendar in `@/lib/acc/reimburse/payment-calendar`, which predates this
 * module and is not in its way.
 */
export type PaydayForm = "AP-1" | "AP-2" | "AP-3";

/**
 * Which Fridays a form pays on, in one place, so that "when does AP-2 pay?" is
 * answered by reading one function rather than by finding which caller passed
 * what.
 *
 * AP-2 moved to every Friday on 2026-09-24 (user's CR of 2026-09-23, item 1).
 * AP-1 and AP-3 did not, deliberately — the CR named AP-2 and the user confirmed
 * the scope when told the three forms shared one calendar.
 */
export function paydaysInMonth(form: PaydayForm, year: number, month0: number): Date[] {
  return form === "AP-2"
    ? everyFridayInMonth(year, month0)
    : paymentRoundsInMonth(year, month0, [2, 4]);
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/acc/payment-rounds.test.ts
```

Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 6: Prove the tests are not vacuous**

Back up with `cp`, mutate, run, restore. **Never `git checkout --`.**

```bash
cd /r/Form_Portal && cp src/lib/acc/payment-calendar-core.ts /tmp/c.bak
sed -i 's/while (d.getMonth() === month0)/while (out.length < 5)/' src/lib/acc/payment-calendar-core.ts
npx tsx --test src/lib/acc/payment-rounds.test.ts | grep -E "^# (pass|fail)"
cp /tmp/c.bak src/lib/acc/payment-calendar-core.ts
cp src/lib/acc/payment-rounds.ts /tmp/r.bak
sed -i 's/form === "AP-2"/form === "AP-1"/' src/lib/acc/payment-rounds.ts
npx tsx --test src/lib/acc/payment-rounds.test.ts | grep -E "^# (pass|fail)"
cp /tmp/r.bak src/lib/acc/payment-rounds.ts
npx tsx --test src/lib/acc/payment-rounds.test.ts | grep -E "^# (pass|fail)"
```

Expected: `# fail` at least 1 on each mutation — the first is the month-escape trap, the second swaps which form is weekly — then `# fail 0` after restoring. Report the actual numbers.

- [ ] **Step 7: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

```bash
cd /r/Form_Portal
git add src/lib/acc/payment-calendar-core.ts src/lib/acc/payment-rounds.ts src/lib/acc/payment-rounds.test.ts
git commit -m "feat(acc): which Fridays each form pays on, in one function

AP-2 moves to a weekly payday and AP-1 and AP-3 do not, so 'when does this
form pay?' stops being answerable only by finding which caller passed which
array.

everyFridayInMonth is not [1..5] mapped over nthFridayOfMonth. That helper is
raw date arithmetic, so a four-Friday month asked for its fifth answers with a
date in the next month — silently, and then again when that month is walked
as its own first Friday. This walks and stops at the month boundary, and a
test sweeps all twelve months of 2026 to prove nothing escapes.

Also pins the property that makes the change safe: AP-2's new days contain
its old ones, so no stored PaymentDate can become invalid.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# Slice B — Form Portal names its forms

## Task 2: `getPaymentDates` requires a form

**Files:**
- Modify: `R:\Form_Portal\src\lib\acc\payment-calendar.ts`
- Modify: the eight consumers listed below

**The signature change is the safety mechanism.** `form` is the **first parameter and has no
default**, so `tsc` refuses to compile any caller that has not said which form it is asking for.
Do not add a default to quieten it.

- [ ] **Step 1: Thread the form through the calendar**

In `src/lib/acc/payment-calendar.ts`:

Delete these two lines (around `:9-10`):

```ts
/** AP-1 pays on the 2nd and 4th Friday. AP-4 pays on the 1st and 3rd. */
const ROUNDS = [2, 4];
```

Change the import block at the top to drop `paymentRoundsInMonth` and add the form map:

```ts
import { getCorePool, sql } from "@/lib/db/mssql";
import {
  defaultPaymentRound,
  nthFridayOfMonth,
  ymd,
} from "@/lib/acc/payment-calendar-core";
import { paydaysInMonth, type PaydayForm } from "@/lib/acc/payment-rounds";
```

Change `unshiftedRounds` (around `:112`) to take the form:

```ts
/** Every round from `from`'s month through `months` later, UNSHIFTED, ascending. */
function unshiftedRounds(form: PaydayForm, from: Date, months: number): Date[] {
  const out: Date[] = [];
  for (let m = 0; m <= months; m++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + m, 1);
    for (const r of paydaysInMonth(form, anchor.getFullYear(), anchor.getMonth())) {
      out.push(r);
    }
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}
```

Then make `form` the first parameter of `getPaymentDates`, `getDefaultPaymentDate` and
`paymentRoundsForApprovals`, and pass it down to `unshiftedRounds` and to each other. Read each
function body first; the only change any of them needs is the extra parameter and forwarding it.
**No default value on `form` in any of the three.**

- [ ] **Step 2: Let the compiler find every caller**

```bash
cd /r/Form_Portal && npx tsc --noEmit
```

Expected: **eight errors**, one per consumer, each "Expected 1-N arguments, but got …" or
"Argument of type 'Date' is not assignable to parameter of type 'PaydayForm'". If you see fewer
than eight, a default crept in — remove it.

- [ ] **Step 3: Give each consumer its form**

Work through the errors. The form each one belongs to:

| File | Pass |
| --- | --- |
| `src/lib/acc/approval-engine.ts:97` | `"AP-1"` |
| `src/lib/adv/advance-approval-engine.ts:82` | `"AP-2"` |
| `src/lib/clr/clear-advance-approval-engine.ts:78` | `"AP-3"` |
| `src/app/api/request/accounting/payment-dates/route.ts` | `"AP-1"` (both calls) |
| `src/app/api/request/accounting/requests/[id]/payment-date/route.ts:54` | `"AP-1"` |
| `src/app/api/request/advance/erp-queue/payment-date/route.ts:34` | `"AP-2"` |
| `src/app/api/request/advance/payment-dates/route.ts:10` | `"AP-2"` (both calls) |
| `src/app/api/request/clear-advance/erp/payment-date/route.ts:20` | `"AP-3"` |

`src/lib/acc/report-service.ts` calls `paymentRoundsForApprovals` — that report is AP-1's, so
pass `"AP-1"` and add a one-line comment saying so, because a report that mixes forms would want
a per-row answer and this one does not.

- [ ] **Step 4: Change AP-2's refusal message**

`src/lib/adv/advance-approval-engine.ts:83` currently reads:

```ts
      throw new Error("วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 2 หรือ 4)");
```

Replace with:

```ts
      throw new Error("วันที่จ่ายไม่อยู่ในรอบที่กำหนด — ต้องเป็นวันศุกร์");
```

**Leave `src/lib/acc/approval-engine.ts:98` alone.** That is AP-1's and it still pays on the 2nd
and 4th, so its message is still true.

- [ ] **Step 5: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

Expected: tsc silent; suite green.

```bash
cd /r/Form_Portal
git add src/lib/acc/payment-calendar.ts src/lib/acc/approval-engine.ts src/lib/adv/advance-approval-engine.ts src/lib/clr/clear-advance-approval-engine.ts src/lib/acc/report-service.ts "src/app/api/request/accounting/payment-dates/route.ts" "src/app/api/request/accounting/requests/[id]/payment-date/route.ts" "src/app/api/request/advance/erp-queue/payment-date/route.ts" "src/app/api/request/advance/payment-dates/route.ts" "src/app/api/request/clear-advance/erp/payment-date/route.ts"
git commit -m "feat(acc): every payday caller says which form it is asking for

AP-2 pays every Friday from today; AP-1 and AP-3 still pay on the 2nd and the
4th. One module-level ROUNDS could not express that, and a default argument
would have let a caller keep the old answer by saying nothing.

So the form is the first parameter and has no default. The compiler found all
eight consumers, which is the point: three forms were reading one calendar and
nothing in the code said so.

AP-2's refusal now says ต้องเป็นวันศุกร์. AP-1's still names the 2nd and the
4th, because for AP-1 that is still true.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: AP-3 stops borrowing AP-2's picker

**Files:**
- Create: `R:\Form_Portal\src\app\api\request\clear-advance\payment-dates\route.ts`
- Modify: `R:\Form_Portal\src\features\clear-advance\components\ClearAdvanceDetail.tsx:282`
- Modify: `R:\Form_Portal\src\features\clear-advance\components\admin\ClrErpInterfaceQueue.tsx:484`

- [ ] **Step 1: Read AP-2's picker route, then copy its shape**

Read `src/app/api/request/advance/payment-dates/route.ts` first — the new route is the same shape
with a different form and its own gate. Create
`src/app/api/request/clear-advance/payment-dates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getPaymentDates, getDefaultPaymentDate } from "@/lib/acc/payment-calendar";

/**
 * GET /api/request/clear-advance/payment-dates — AP-3's payable Fridays + default.
 *
 * AP-3 read AP-2's `/api/request/advance/payment-dates` until 2026-09-24, which
 * was harmless only while the two forms shared a calendar. AP-2 now pays every
 * Friday and AP-3 still pays on the 2nd and the 4th, so a borrowed list would
 * have offered accounting dates AP-3 does not pay on — and, worse, would have
 * stopped `paymentDateOffCycle` warning about the ones it does not.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const [dates, def] = await Promise.all([
      getPaymentDates("AP-3"),
      getDefaultPaymentDate("AP-3"),
    ]);
    return NextResponse.json({ ok: true, data: { dates, default: def } });
  } catch (err) {
    console.error("[api/request/clear-advance/payment-dates] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงรอบวันจ่ายไม่สำเร็จ" }, { status: 500 });
  }
}
```

**Check AP-2's route before finalising**: match its gate (`requireAuth` vs something stricter) and
its response shape exactly. If AP-2's returns `{ ok, data: { dates, default } }` under different
key names, use AP-2's names — the two client call sites you are about to move expect them.

- [ ] **Step 2: Point AP-3's two call sites at it**

`ClearAdvanceDetail.tsx:282` and `admin/ClrErpInterfaceQueue.tsx:484` both contain:

```tsx
    fetch("/api/request/advance/payment-dates")
```

Change both to:

```tsx
    fetch("/api/request/clear-advance/payment-dates")
```

Change nothing else in either file — the response shape is identical.

- [ ] **Step 3: Pin it, because the regression is silent**

A call site pointing back at AP-2's route does not throw — it returns dates, just the wrong
form's. Create `src/lib/clr/ap3-payday-endpoint-guard.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-3's screens must ask AP-3's payday route.
 *
 * They asked AP-2's until 2026-09-24, which was invisible while the two forms
 * paid on the same Fridays. AP-2 is weekly now and AP-3 is not, so the old
 * endpoint answers with dates AP-3 does not pay on — and returns 200 while it
 * does, which is why this is read out of the source rather than left to review.
 */

const FILES = [
  "src/features/clear-advance/components/ClearAdvanceDetail.tsx",
  "src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx",
];

test("no AP-3 screen fetches AP-2's payday route", () => {
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    assert.doesNotMatch(src, /request\/advance\/payment-dates/, rel);
    assert.match(src, /request\/clear-advance\/payment-dates/, rel);
  }
});
```

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/ap3-payday-endpoint-guard.test.ts
```

Expected: `# pass 1`. Then prove it bites — back up with `cp`, point one call site back at
`/api/request/advance/payment-dates`, run it (expect `# fail 1`), and restore from the backup.
**Never `git checkout --`.**

- [ ] **Step 4: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

```bash
cd /r/Form_Portal
git add "src/app/api/request/clear-advance/payment-dates/route.ts" src/lib/clr/ap3-payday-endpoint-guard.test.ts src/features/clear-advance/components/ClearAdvanceDetail.tsx src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx
git commit -m "fix(clr): AP-3 reads its own paydays, not AP-2's

Two AP-3 screens fetched /api/request/advance/payment-dates. That was
invisible while both forms paid on the same Fridays and became wrong the
moment AP-2 went weekly: accounting would have been offered dates AP-3 does
not pay on, and ClrAccountWorkspace's off-cycle warning would have gone quiet
about the ones it does not.

Same borrowing the bank-account CR fixed a day earlier, in the same files.
AP-3 was built by copying AP-2's screens and the copies kept the endpoints.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# Slice C — ACC Portal, the same change

## Task 4: The two modules, ported

**Files:**
- Modify: `R:\Acc_Portal\src\lib\acc\payment-calendar-core.ts`
- Create: `R:\Acc_Portal\src\lib\acc\payment-rounds.ts`
- Create: `R:\Acc_Portal\src\lib\acc\payment-rounds.test.ts`

ACC Portal uses **vitest**, not `node:test`.

- [ ] **Step 1: Add `everyFridayInMonth`**

Identical body to Task 1 Step 3, in ACC's own `payment-calendar-core.ts` after `nthFridayOfMonth`:

```ts
/**
 * Every Friday that falls inside this month — four in most, five in some.
 *
 * NOT `[1,2,3,4,5].map(nthFridayOfMonth)`. That helper is raw arithmetic —
 * `1 + offset + (nth - 1) * 7` — so asking a four-Friday month for its fifth
 * returns a date in the NEXT month, silently, which is then produced again when
 * that month is walked as its own first Friday. This walks instead, and stops
 * when it leaves the month it was asked about.
 */
export function everyFridayInMonth(year: number, month0: number): Date[] {
  const out: Date[] = [];
  const d = nthFridayOfMonth(year, month0, 1);
  while (d.getMonth() === month0) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}
```

- [ ] **Step 2: Create `payment-rounds.ts`**

Identical to Task 1 Step 4, in `R:\Acc_Portal\src\lib\acc\payment-rounds.ts`, with one extra line
in the docblock recording the port:

```ts
import { everyFridayInMonth, paymentRoundsInMonth } from "@/lib/acc/payment-calendar-core";

/**
 * The forms whose payday calendar lives here.
 *
 * AP-4 is deliberately absent: it pays on the 1st and 3rd Friday and keeps its
 * own calendar, which predates this module and is not in its way.
 */
export type PaydayForm = "AP-1" | "AP-2" | "AP-3";

/**
 * Which Fridays a form pays on, in one place, so that "when does AP-2 pay?" is
 * answered by reading one function rather than by finding which caller passed
 * what.
 *
 * AP-2 moved to every Friday on 2026-09-24 (user's CR of 2026-09-23, item 1).
 * AP-1 and AP-3 did not, deliberately.
 *
 * Kept byte-identical with Form Portal's `src/lib/acc/payment-rounds.ts` apart
 * from this paragraph: the two consoles must agree about when a form pays, and
 * the cheapest way to keep them agreeing is for the file to be the same file.
 */
export function paydaysInMonth(form: PaydayForm, year: number, month0: number): Date[] {
  return form === "AP-2"
    ? everyFridayInMonth(year, month0)
    : paymentRoundsInMonth(year, month0, [2, 4]);
}
```

- [ ] **Step 3: Write the tests, in vitest**

Create `R:\Acc_Portal\src\lib\acc\payment-rounds.test.ts` — the same six cases as Task 1 Step 1,
translated: `import { it, expect } from "vitest";`, `it(...)` for `test(...)`,
`expect(x).toEqual(y)` for `assert.deepEqual(x, y)`, and `expect(x).toBe(y)` for
`assert.equal(x, y)`. Keep every comment from the Form Portal version — they say why the cases
exist, which is the part worth porting.

- [ ] **Step 4: Verify and commit**

```bash
cd /r/Acc_Portal && npx vitest run src/lib/acc/payment-rounds.test.ts && npx tsc --noEmit
```

Expected: 6 passed.

```bash
cd /r/Acc_Portal
git add src/lib/acc/payment-calendar-core.ts src/lib/acc/payment-rounds.ts src/lib/acc/payment-rounds.test.ts
git commit -m "feat(acc): which Fridays each form pays on, in one function

Ported from Form Portal so both consoles answer 'when does AP-2 pay?' the
same way. The two files are deliberately identical apart from a paragraph
saying so — a payday the consoles disagree about is worse than either answer.

everyFridayInMonth walks rather than mapping [1..5] over nthFridayOfMonth,
which would answer a four-Friday month's fifth with a date in the next month.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ACC's calendar and its consumers name their forms

**Files:**
- Modify: `R:\Acc_Portal\src\lib\acc\payment-calendar.ts:67`, `:88`
- Modify: every consumer the compiler names

- [ ] **Step 1: Thread the form through**

ACC's `getPaymentDates` (`:67`) computes its rounds inline:

```ts
export async function getPaymentDates(from: Date = new Date(), months = 4, monthsBack = 0): Promise<string[]> {
```

and inside its month loop:

```ts
    for (const nth of [2, 4]) {
      const base = nthFridayOfMonth(anchor.getFullYear(), anchor.getMonth(), nth);
      const shifted = shiftPaymentDay(base, holidays);
```

Make `form` the first parameter with **no default**, and replace the inline loop with the form map:

```ts
export async function getPaymentDates(form: PaydayForm, from: Date = new Date(), months = 4, monthsBack = 0): Promise<string[]> {
```

```ts
    for (const base of paydaysInMonth(form, anchor.getFullYear(), anchor.getMonth())) {
      const shifted = shiftPaymentDay(base, holidays);
```

Add the import:

```ts
import { paydaysInMonth, type PaydayForm } from "@/lib/acc/payment-rounds";
```

Do the same to `getDefaultPaymentDate` (`:88`), forwarding `form` to its `getPaymentDates` call.

- [ ] **Step 2: Let the compiler find the callers**

```bash
cd /r/Acc_Portal && npx tsc --noEmit
```

Fix each error by passing the form that route or engine belongs to. Decide it from the path:
anything under `accounting/` is **AP-1**, under `advance/` is **AP-2**, under `clear-advance/` is
**AP-3**. If a file's form is not obvious from its path, **stop and report it** rather than
guessing — a wrong form here moves somebody's payday.

- [ ] **Step 3: Change AP-2's refusal message if ACC has one**

```bash
cd /r/Acc_Portal && grep -rn "ศุกร์ที่ 2 หรือ 4" src --include=*.ts --include=*.tsx
```

For each hit, decide from the file's path which form owns it. AP-2's becomes
`"วันที่จ่ายไม่อยู่ในรอบที่กำหนด — ต้องเป็นวันศุกร์"`. **AP-1's and AP-3's stay as they are.**
If there are no hits, say so in your report.

- [ ] **Step 4: Verify and commit**

```bash
cd /r/Acc_Portal && npx tsc --noEmit && npx vitest run
```

```bash
cd /r/Acc_Portal
git add -- $(git diff --name-only)
git commit -m "feat(acc): every payday caller says which form it is asking for

The same change Form Portal took: the rounds were inline in getPaymentDates,
so three forms shared one answer and nothing said so. form is the first
parameter and has no default, which is how the compiler found the callers.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

> `git add -- $(git diff --name-only)` is used here only because the file list depends on what the
> compiler found. **Run `git status` first and read it**; if anything unexpected is dirty, stage by
> name instead.

---

## Task 6: ACC's AP-3 stops borrowing too

**Files:**
- Create: `R:\Acc_Portal\src\app\api\request\clear-advance\payment-dates\route.ts`
- Modify: `R:\Acc_Portal\src\features\clear-advance\components\ClrAccountWorkspace.tsx:180`
- Modify: `R:\Acc_Portal\src\features\clear-advance\components\ClrErpInterfaceQueue.tsx:601`

- [ ] **Step 1: Create the route**

Read ACC's `src/app/api/request/advance/payment-dates/route.ts` and copy its shape exactly — its
gate, its response keys, its error text. Change only the form passed (`"AP-3"`) and the log tag,
and carry this docblock:

```ts
/**
 * GET /api/request/clear-advance/payment-dates — AP-3's payable Fridays + default.
 *
 * AP-3 read AP-2's route until 2026-09-24, which was harmless only while the two
 * forms shared a calendar. AP-2 now pays every Friday and AP-3 still pays on the
 * 2nd and the 4th, so a borrowed list would offer accounting dates AP-3 does not
 * pay on — and would stop ClrAccountWorkspace's off-cycle warning firing on the
 * ones it does not.
 */
```

If ACC has no AP-2 picker route to copy, **stop and report** — do not invent a gate for a route
that hands out payment dates.

- [ ] **Step 2: Point the two call sites at it**

Both `ClrAccountWorkspace.tsx:180` and `ClrErpInterfaceQueue.tsx:601` contain
`fetch("/api/request/advance/payment-dates")`. Change both to
`fetch("/api/request/clear-advance/payment-dates")`. Nothing else.

- [ ] **Step 3: Verify and commit**

```bash
cd /r/Acc_Portal && npx tsc --noEmit && npx vitest run
```

```bash
cd /r/Acc_Portal
git add "src/app/api/request/clear-advance/payment-dates/route.ts" src/features/clear-advance/components/ClrAccountWorkspace.tsx src/features/clear-advance/components/ClrErpInterfaceQueue.tsx
git commit -m "fix(clr): AP-3 reads its own paydays, not AP-2's

Two AP-3 screens fetched AP-2's route. Invisible while both paid on the same
Fridays; wrong the moment AP-2 went weekly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# Slice D — the Description (independent of A–C)

## Task 7: ACC Portal's journal leads with the ADC number

**Files:**
- Modify: `R:\Acc_Portal\src\lib\clr\clear-advance-erp-payload.ts:234-243`
- Modify: `R:\Acc_Portal\src\lib\clr\clear-advance-erp-payload.test.ts:48`, `:56`, `:62`

- [ ] **Step 1: Update the tests first, and watch them fail**

In `clear-advance-erp-payload.test.ts`, the three expected descriptions become:

| line | from | to |
| --- | --- | --- |
| 48 | `"ADV26-00026 เบิก เคลียร์เงินทดลอง ภาสพงษ์ พิษณุพจน์ ค่าแท็กซี่"` | `"ADC26-09005 ค่าแท็กซี่"` |
| 56 | `"ADV26-00026 เบิก เคลียร์เงินทดลอง ภาสพงษ์ พิษณุพจน์"` | `"ADC26-09005"` |
| 62 | `"ADV26-00026 เบิก เคลียร์เงินทดลอง ภาสพงษ์ พิษณุพจน์"` | `"ADC26-09005"` |

**Read the fixture before you type `ADC26-09005`** — use whatever `requestNo` that test's `base()`
actually passes. If it is not `ADC26-09005`, use the real one and say so in your report.

```bash
cd /r/Acc_Portal && npx vitest run src/lib/clr/clear-advance-erp-payload.test.ts
```

Expected: 3 failures, each showing the old string against the new expectation.

- [ ] **Step 2: Change the description**

Replace lines 234-243:

```ts
  // Spec §3.2 format: [ADV no] เบิก เคลียร์เงินทดลอง [employee] [document detail].
  // Gen. Journal Line Description is 100 chars, so the trailing detail is what gets
  // cut — the identifying half has to survive.
  const advNo = (input.advanceRequestNo ?? "").trim() || requestNo;
  const who = (input.requesterName ?? "").trim();
  const describe = (detail?: string | null) =>
    [advNo, "เบิก", "เคลียร์เงินทดลอง", who, (detail ?? "").trim()]
      .filter((s) => s !== "")
      .join(" ")
      .slice(0, 100);
```

with:

```ts
  /* The ADC number and then the line's own detail — user's CR of 2026-09-23,
     item 6. See docs/superpowers/specs/2026-09-24-ap2-weekly-payday-and-adc-
     description-design.md.
     It led with the ADV number until 2026-09-24, followed by "เบิก
     เคลียร์เงินทดลอง" (a typo for ทดรอง, posted to BC in that form for months)
     and the requester's name. BC's Description caps at 100 characters, so those
     four fixed words and a name were spending the budget that the line's own
     detail — the only part that differs between lines — needs.
     The ADV number now appears nowhere on the journal. That is the user's
     decision, made knowing it (2026-09-24): the ADC is what somebody holding a
     posted journal can search AP-3 for, and AP-3 shows which advance each
     clearing settles. If it is ever wanted back, it belongs in employeeCode —
     which BC maps to External Document No. — the way AP-2 already does it, not
     back in this string. */
  const describe = (detail?: string | null) =>
    [requestNo, (detail ?? "").trim()]
      .filter((s) => s !== "")
      .join(" ")
      .slice(0, 100);
```

If `advNo` or `who` are now unused, `tsc` will say so — delete them. **Do not delete
`input.advanceRequestNo` or `input.requesterName` from the input type**: other parts of the
payload or its callers may still use them, and the compiler will tell you if they do not.

- [ ] **Step 3: Run the tests**

```bash
cd /r/Acc_Portal && npx vitest run src/lib/clr/ && npx tsc --noEmit
```

Expected: green. **If any other test in that folder fails, read it — do not loosen it.** A test
asserting the description from a different angle is a test doing its job.

- [ ] **Step 4: Prove nothing else moved**

```bash
cd /r/Acc_Portal && git diff --stat
```

Expected: two files, and the payload diff touching only the `describe` block. An amount, a date,
a `documentType` or an `employeeCode` in that diff means something went wrong — stop and report.

- [ ] **Step 5: Commit**

```bash
cd /r/Acc_Portal
git add src/lib/clr/clear-advance-erp-payload.ts src/lib/clr/clear-advance-erp-payload.test.ts
git commit -m "feat(clr): the journal's Description leads with the ADC number

It led with the ADV number — the advance being cleared, not the clearing — so
somebody reconciling a posted journal had the ADC and could not search for it.
Behind it sat 'เบิก เคลียร์เงินทดลอง' (ทดลอง is a typo for ทดรอง; it has been
posting to BC that way) and the requester's name, spending a 100-character
budget that the line's own detail needs.

Now: ADC number, then the line's detail, and the ADC number alone on the bank
and vendor lines that have none.

The ADV number is on the journal nowhere after this. The user chose that
knowing it — AP-3 shows which advance a clearing settles, so the link survives
at one hop. If it is wanted back it belongs in employeeCode, which BC maps to
External Document No., not in this string.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Form Portal's journal, the same change

**Files:**
- Modify: `R:\Form_Portal\src\lib\clr\clear-advance-erp-payload.ts:223-232`
- Modify: `R:\Form_Portal\src\lib\clr\clear-advance-erp-payload.test.ts:48`, `:56`, `:62`, `:112`, `:119`

Form Portal uses `node:test`, not vitest.

- [ ] **Step 1: Update the five assertions, and watch them fail**

Lines 48, 56 and 62 take the same three new strings as ACC's (read the fixture's `requestNo`
rather than assuming). Line 112 becomes:

```ts
  assert.equal(exp.description, "ADC26-09005 ค่าแท็กซี่");
```

Line 119 currently reads:

```ts
  assert.ok(exp.description.startsWith("ADC26-09005 เบิก เคลียร์เงินทดลอง"));
```

That case covers a clearing with **no** `advanceRequestNo`, where the old code fell back to
`requestNo`. The fallback is gone — the ADC number is now what it always uses — so the case is
still worth keeping and should assert the whole string, not a prefix:

```ts
  assert.equal(exp.description, "ADC26-09005 ค่าแท็กซี่");
```

Read the fixture first: if that case's detail is not `ค่าแท็กซี่`, use the real one.

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/clear-advance-erp-payload.test.ts
```

Expected: 5 failures.

- [ ] **Step 2: Make the same change**

Replace lines 223-232 with the identical `describe` and comment block from Task 7 Step 2. The two
apps' payload builders are kept in step deliberately; a Description that differs between consoles
means the same claim posts differently depending on who sent it.

- [ ] **Step 3: Add the case the old comment claimed and never tested**

The old code carried a comment saying the identifying half has to survive BC's 100-character
cut, and nothing checked it. Add to the same test file:

```ts
test("a long detail is cut at 100 characters with the ADC number intact", () => {
  const long = "ค่า".repeat(80);
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 100, vatAmount: 0, whtAmount: 0,
              branchCode: "HQ01", description: long }],
  }));
  const exp = p.lines.find((l) => l.accountType === "G/L Account")!;
  assert.equal(exp.description.length, 100);
  assert.ok(exp.description.startsWith("ADC26-09005 "), exp.description.slice(0, 20));
});
```

Use the fixture's real `requestNo` and its real `base()` shape — read the file rather than
copying this literally. The point of the case is the two assertions, not the fixture.

- [ ] **Step 4: Verify**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/clear-advance-erp-payload.test.ts && npx tsc --noEmit && npm test
```

- [ ] **Step 5: Confirm the two apps agree**

```bash
diff <(sed -n '/const describe = /,/slice(0, 100);/p' /r/Acc_Portal/src/lib/clr/clear-advance-erp-payload.ts) \
     <(sed -n '/const describe = /,/slice(0, 100);/p' /r/Form_Portal/src/lib/clr/clear-advance-erp-payload.ts)
```

Expected: no output. If they differ, the two consoles will write different Descriptions for the
same claim — fix it before committing.

- [ ] **Step 6: Confirm the typo is gone from both repos**

```bash
grep -rn "เคลียร์เงินทดลอง" /r/Form_Portal/src /r/Acc_Portal/src
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
cd /r/Form_Portal
git add src/lib/clr/clear-advance-erp-payload.ts src/lib/clr/clear-advance-erp-payload.test.ts
git commit -m "feat(clr): the journal's Description leads with the ADC number

Form Portal's half of the same change: ADC number, then the line's detail, and
the ADC number alone on the lines that have none. Kept identical to ACC
Portal's — the same claim must not post a different Description depending on
which console sent it.

Also removes the last copy of 'เคลียร์เงินทดลอง', a typo for ทดรอง that has
been posting to Business Central for months.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Drive it in the browser

**Files:** none. This task changes nothing.

Ask before starting a dev server — one was stopped for memory once already. Form Portal runs on
`:3081`, ACC Portal on `:3060`.

- [ ] **Step 1: AP-2 offers every Friday**

Open AP-2's approval queue and open the วันจ่าย picker. Every Friday of the coming weeks should be
selectable, not only the 2nd and 4th — and a Friday that falls on a holiday should still show as
the day before, not disappear.

- [ ] **Step 2: AP-3 still offers only two**

Open AP-3's account step on a clearing where the company pays the employee extra. Its picker must
still offer the 2nd and 4th Friday only. **This is the check the whole of Task 3 exists for** — if
AP-3 shows every Friday, a call site is still pointing at AP-2's route.

- [ ] **Step 3: AP-1 is untouched**

Open AP-1's approval queue and confirm its picker still shows the 2nd and 4th.

- [ ] **Step 4: Preview an AP-3 journal**

In ACC Portal's Interface ERP queue, preview any claim and read the Description column: it must
begin with `ADC` and carry the line's own detail, and the bank and vendor lines must show the ADC
number alone. **Do not send it** — preview only.

- [ ] **Step 5: Report what could not be checked**

If a step could not be run — no AP-2 claim at the approval step, no refund-direction AP-3 claim to
preview — say so plainly rather than implying it passed.
