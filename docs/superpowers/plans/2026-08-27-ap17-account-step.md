# AP-17 Accounting Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AP-17 an accounting sign-off after the Admin booking desk, let that accountant move the payout month, and recompute a trip's per diem when the trip it was a continuation of is cancelled — with an audit trail, and never after accounting has signed.

**Architecture:** The step is inserted by changing where `completeRequest` leaves a request (`CurrentStepCode='ACCOUNT'` instead of `Completed`) and adding an `approveByAccount` that finishes the job. The per-diem recompute is a pure function over a group's rows, called inside the cancelling/rejecting transaction. Nothing new is stored: the trail goes in `AccActivityLog`, the grants in `AccBookingApproverTab`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (ES5 target — use `Array.from()`, never `[...set]`), MSSQL via `mssql`/tedious, `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-27-ap17-account-step-design.md`

## Global Constraints

- **No migrations.** `CK_AccApproval_Step` already permits `ACCOUNT` (091); `CK_AccRequest_Status` already permits both `Completed` and `Approved` (059); `AccBookingApproverTab` has no CHECK on `TabKey` (096, deliberately); `AccRequest.PaymentDate` already exists and is already set for AP-17 at manager approval.
- **The spec says `Approved`; the code says `Completed`.** AP-17's terminal status is `Completed`, set today by `completeRequest` in `admin-service.ts`. Everywhere the spec writes "past the accounting step", read `Status = 'Completed'`. This plan uses `Completed`.
- **ES5 target.** `Array.from(...)`, never `[...set]` or `[...map.values()]`.
- **Dates.** Local getters (`getFullYear`, `getMonth`, `getDate`), never `toISOString()` on a date-only value. The driver runs `useUTC: false`.
- **Parameterised SQL only** — `pool.request().input(...)`.
- **Every pure module imports nothing** that reaches a database pool, or `@/env` throws in the test runner.
- Run `npm test`, `npx tsc --noEmit` and `npm run build` before every commit.

---

### Task 1: The continuation chain, recomputed over live trips

**Files:**
- Create: `src/lib/acc/travel-booking/continuation-chain.ts`
- Test: `src/lib/acc/travel-booking/continuation-chain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ChainTrip { requestId: number; sortOrder: number; departDate: string | null; returnDate: string | null; alive: boolean }` and `function continuationFlags(trips: readonly ChainTrip[]): Map<number, boolean>` — request id to whether that trip is a continuation, considering only `alive` predecessors.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { continuationFlags, type ChainTrip } from "./continuation-chain";

const trip = (
  requestId: number,
  sortOrder: number,
  departDate: string,
  returnDate: string,
  alive = true,
): ChainTrip => ({ requestId, sortOrder, departDate, returnDate, alive });

test("a trip departing the day the live one before it returned is a continuation", () => {
  const flags = continuationFlags([
    trip(1, 0, "2026-08-04", "2026-08-06"),
    trip(2, 1, "2026-08-06", "2026-08-06"),
  ]);
  assert.equal(flags.get(1), false);
  assert.equal(flags.get(2), true);
});

/**
 * The whole point of the module. Trip 2 was a continuation of trip 1; trip 1 is
 * cancelled, so nothing has counted that day and trip 2 must get it back.
 */
test("a cancelled predecessor stops absorbing the day", () => {
  const flags = continuationFlags([
    trip(1, 0, "2026-08-04", "2026-08-06", false),
    trip(2, 1, "2026-08-06", "2026-08-06"),
  ]);
  assert.equal(flags.get(2), false);
});

test("the search skips over dead trips to the nearest live one", () => {
  // 3 departs on the day 2 returned, but 2 is dead; 1 does not touch it.
  const flags = continuationFlags([
    trip(1, 0, "2026-08-01", "2026-08-02"),
    trip(2, 1, "2026-08-04", "2026-08-06", false),
    trip(3, 2, "2026-08-06", "2026-08-08"),
  ]);
  assert.equal(flags.get(3), false);
});

test("only the nearest live predecessor is considered, not any of them", () => {
  // 1 returns on the 6th and 3 departs on the 6th, but 2 sits between them and
  // is alive — the chain is 1 -> 2 -> 3, and 3 continues 2, which it does not.
  const flags = continuationFlags([
    trip(1, 0, "2026-08-04", "2026-08-06"),
    trip(2, 1, "2026-08-10", "2026-08-11"),
    trip(3, 2, "2026-08-06", "2026-08-07"),
  ]);
  assert.equal(flags.get(3), false);
});

test("a dead trip is never itself a continuation", () => {
  const flags = continuationFlags([
    trip(1, 0, "2026-08-04", "2026-08-06"),
    trip(2, 1, "2026-08-06", "2026-08-07", false),
  ]);
  assert.equal(flags.get(2), false);
});

test("a trip with a missing date is never a continuation", () => {
  const flags = continuationFlags([
    { requestId: 1, sortOrder: 0, departDate: "2026-08-04", returnDate: "2026-08-06", alive: true },
    { requestId: 2, sortOrder: 1, departDate: null, returnDate: "2026-08-07", alive: true },
  ]);
  assert.equal(flags.get(2), false);
});

test("input order does not matter — SortOrder does", () => {
  const flags = continuationFlags([
    trip(2, 1, "2026-08-06", "2026-08-06"),
    trip(1, 0, "2026-08-04", "2026-08-06"),
  ]);
  assert.equal(flags.get(2), true);
});

test("the first trip is never a continuation", () => {
  const flags = continuationFlags([trip(1, 0, "2026-08-04", "2026-08-06")]);
  assert.equal(flags.get(1), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/acc/travel-booking/continuation-chain.test.ts`
Expected: FAIL with `Cannot find module './continuation-chain'`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Which trips in a booking group continue the one before them.
 *
 * A trip is a continuation when it departs on the day the previous trip
 * returned: the day is worked once and paid once, so the later trip drops it.
 *
 * **`alive` is the whole reason this module exists.** `submitTravelBookingGroup`
 * decides the same thing from `tabs[i - 1]` at submit time and stores the answer,
 * so a trip cancelled afterwards goes on absorbing a day nobody will be paid
 * for. Here a dead trip is skipped and the search continues to the nearest live
 * predecessor — usually finding one whose dates do not touch, which gives the
 * day back.
 *
 * Pure and import-free so it is unit-tested without a database.
 */

export interface ChainTrip {
  requestId: number;
  /** `AccTravelBooking.SortOrder` — the order the group was filled in. */
  sortOrder: number;
  departDate: string | null;
  returnDate: string | null;
  /** False once the trip is Cancelled or Rejected: it will not be paid. */
  alive: boolean;
}

export function continuationFlags(trips: readonly ChainTrip[]): Map<number, boolean> {
  const ordered = trips.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const flags = new Map<number, boolean>();

  for (let i = 0; i < ordered.length; i++) {
    const trip = ordered[i];
    // A dead trip's own flag is meaningless — nothing will be computed from it —
    // but it is reported false rather than left absent so a caller iterating the
    // map does not have to special-case it.
    if (!trip.alive || !trip.departDate) {
      flags.set(trip.requestId, false);
      continue;
    }

    // The nearest live predecessor, and only that one. Looking further back
    // would let a trip continue a journey it is not adjacent to.
    let previous: ChainTrip | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (ordered[j].alive) {
        previous = ordered[j];
        break;
      }
    }

    flags.set(
      trip.requestId,
      !!(previous && previous.returnDate && previous.returnDate === trip.departDate),
    );
  }

  return flags;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/acc/travel-booking/continuation-chain.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/continuation-chain.ts src/lib/acc/travel-booking/continuation-chain.test.ts
git commit -m "feat(ap-17): derive the continuation chain from live trips only"
```

---

### Task 2: The payout months an accountant may choose

**Files:**
- Create: `src/lib/acc/travel-booking/payout-months.ts`
- Test: `src/lib/acc/travel-booking/payout-months.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface PayoutMonth { ym: string; date: string; label: string }` and `function payoutMonthOptions(from: Date, count?: number): PayoutMonth[]`, plus `function payoutDateForMonth(ym: string): string | null`. `ym` is `"YYYY-MM"`, `date` is that month's last day as `"YYYY-MM-DD"`, `label` is Thai (`"สิงหาคม 2569"`).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { payoutDateForMonth, payoutMonthOptions } from "./payout-months";

test("the first option is the current month, not the next", () => {
  const opts = payoutMonthOptions(new Date(2026, 7, 27), 3);
  assert.equal(opts[0].ym, "2026-08");
  assert.equal(opts[0].date, "2026-08-31");
});

test("each option's date is that month's last day", () => {
  const opts = payoutMonthOptions(new Date(2026, 7, 1), 3);
  assert.deepEqual(opts.map((o) => o.date), ["2026-08-31", "2026-09-30", "2026-10-31"]);
});

test("February is 28 or 29 depending on the year", () => {
  assert.equal(payoutDateForMonth("2026-02"), "2026-02-28");
  assert.equal(payoutDateForMonth("2028-02"), "2028-02-29");
});

test("December rolls the year over", () => {
  const opts = payoutMonthOptions(new Date(2026, 11, 5), 2);
  assert.deepEqual(opts.map((o) => o.ym), ["2026-12", "2027-01"]);
  assert.equal(opts[1].date, "2027-01-31");
});

/** Buddhist year, matching every other date the app shows a requester. */
test("the label is Thai with a Buddhist year", () => {
  assert.equal(payoutMonthOptions(new Date(2026, 7, 1), 1)[0].label, "สิงหาคม 2569");
});

test("a malformed month yields null rather than a guessed date", () => {
  assert.equal(payoutDateForMonth("nonsense"), null);
  assert.equal(payoutDateForMonth("2026-13"), null);
  assert.equal(payoutDateForMonth("2026-00"), null);
  assert.equal(payoutDateForMonth(""), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/acc/travel-booking/payout-months.test.ts`
Expected: FAIL with `Cannot find module './payout-months'`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The payout months AP-17's accounting step may choose between.
 *
 * AP-17 pays at a month's end — `payment-month.ts` already sets the date that
 * way at manager approval (on or before the 20th pays this month, after it rolls
 * to the next). This is the same convention offered as a choice: pick a month,
 * and the date is that month's last day. There is no day to get wrong.
 *
 * From the current month forward, never back: a payout already in the past is
 * not a schedule. AP-1's correction case does not apply here because the figure
 * is not signed yet — see the spec.
 *
 * Pure and import-free so it is unit-tested without a database.
 */

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export interface PayoutMonth {
  /** `"YYYY-MM"` — what the client posts back. */
  ym: string;
  /** That month's last day, `"YYYY-MM-DD"`. */
  date: string;
  /** `"สิงหาคม 2569"`. */
  label: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `new Date(y, m, 0)` is the last day of month `m - 1` (0-indexed), so passing
 * the 1-indexed month gives that month's own end, and `Date` normalises a
 * December rollover on its own.
 */
function lastDayOf(year: number, month1: number): Date {
  return new Date(year, month1, 0);
}

export function payoutDateForMonth(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (month1 < 1 || month1 > 12) return null;
  const d = lastDayOf(year, month1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function payoutMonthOptions(from: Date = new Date(), count = 12): PayoutMonth[] {
  const out: PayoutMonth[] = [];
  for (let i = 0; i < count; i++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const year = anchor.getFullYear();
    const month0 = anchor.getMonth();
    const ym = `${year}-${pad2(month0 + 1)}`;
    const date = payoutDateForMonth(ym);
    if (!date) continue;
    out.push({ ym, date, label: `${THAI_MONTHS[month0]} ${year + 543}` });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/acc/travel-booking/payout-months.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/payout-months.ts src/lib/acc/travel-booking/payout-months.test.ts
git commit -m "feat(ap-17): offer payout months from the current one forward"
```

---

### Task 3: Two menu grants on the สิทธิ์เข้าถึง tab

**Files:**
- Modify: `src/lib/acc/travel-booking/settings-tabs.ts`
- Modify: `src/lib/acc/travel-booking/settings-tabs.test.ts`
- Modify: `src/app/api/request/travel-booking/access/route.ts:54`
- Modify: `src/features/travel-booking/components/settings/BookingApproverSettings.tsx`

**Interfaces:**
- Consumes: `decideBookingTabAccess(isAdmin: boolean, granted: string[], tab: string): boolean` — unchanged.
- Produces: `type BookingMenuKey = "bookingQueue" | "accountApproval"`, `const GRANTABLE_BOOKING_MENUS: readonly { key: BookingMenuKey; label: string }[]`, `function isBookingMenuKey(key: string): boolean`. `/api/request/travel-booking/access` gains `bookingQueue: boolean` and `accountApproval: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/acc/travel-booking/settings-tabs.test.ts`:

```ts
/* ── The two work-queue menus ─────────────────────────────────────────────
 *
 * Stored in the same `AccBookingApproverTab` rows as the settings tabs, which
 * is why they must be told apart from them: `requireBookingSettingsTab` gates
 * *configuration*, and a menu grant is not that.
 */

test("both booking menus are grantable, in the page's order", () => {
  assert.deepEqual(
    GRANTABLE_BOOKING_MENUS.map((m) => m.key),
    ["bookingQueue", "accountApproval"],
  );
});

test("a menu key is not a settings tab, and a settings tab is not a menu", () => {
  assert.equal(isGrantableBookingTabKey("bookingQueue"), false);
  assert.equal(isGrantableBookingTabKey("accountApproval"), false);
  assert.equal(isBookingMenuKey("brands"), false);
  assert.equal(isBookingMenuKey("access"), false);
});

test("an unknown menu key is refused however it is spelled", () => {
  assert.equal(isBookingMenuKey("nope"), false);
  assert.equal(isBookingMenuKey(""), false);
  assert.equal(isBookingMenuKey("__proto__"), false);
  assert.equal(isBookingMenuKey("BookingQueue"), false);
});

test("a padded menu key still matches", () => {
  assert.equal(isBookingMenuKey(" bookingQueue "), true);
});
```

Add `GRANTABLE_BOOKING_MENUS` and `isBookingMenuKey` to that file's existing import from `./settings-tabs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/acc/travel-booking/settings-tabs.test.ts`
Expected: FAIL — `GRANTABLE_BOOKING_MENUS` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/acc/travel-booking/settings-tabs.ts`:

```ts
/**
 * The two AP-17 work queues an admin may hand to an individual approver.
 *
 * Stored in the same `AccBookingApproverTab` rows as the settings tabs above —
 * the table has no CHECK on `TabKey`, which is what makes a second vocabulary
 * possible without a migration, and what makes keeping them apart in code
 * essential. `isGrantableBookingTabKey` must refuse these and `isBookingMenuKey`
 * must refuse those, or a menu grant becomes a way past
 * `requireBookingSettingsTab` into the configuration routes.
 *
 * Membership of `AccBookingApprover` is still what lets somebody *act*; a tick
 * only decides what they see.
 */
export type BookingMenuKey = "bookingQueue" | "accountApproval";

const BOOKING_MENU_LABELS: Record<BookingMenuKey, string> = {
  bookingQueue: "คิวจองที่พัก/ตั๋วโดยสาร",
  accountApproval: "อนุมัติ (บัญชี)",
};

const BOOKING_MENU_ORDER: readonly BookingMenuKey[] = ["bookingQueue", "accountApproval"];

export const GRANTABLE_BOOKING_MENUS: readonly { key: BookingMenuKey; label: string }[] =
  BOOKING_MENU_ORDER.map((key) => ({ key, label: BOOKING_MENU_LABELS[key] }));

export function isBookingMenuKey(key: string): boolean {
  const k = String(key).trim();
  for (const m of GRANTABLE_BOOKING_MENUS) if (m.key === k) return true;
  return false;
}

/**
 * Everything `AccBookingApproverTab` may legitimately hold: settings tabs **and**
 * menu grants.
 *
 * Separate from `filterGrantableBookingTabKeys` on purpose, and this is the
 * distinction the whole design rests on. That one answers "may this grant open a
 * settings route" and must stay narrow; this one answers "may this row exist",
 * and menu keys must survive it or a tick saves nothing.
 *
 * The pre-flight scan caught the version of this plan that had no such split:
 * `booking-approver-tabs.ts` applies the grantable filter on **both** read (:72)
 * and write (:94), so a menu key was dropped twice over and the feature silently
 * did nothing.
 */
export function filterStorableBookingKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if ((isGrantableBookingTabKey(k) || isBookingMenuKey(k)) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}
```

- [ ] **Step 3b: Let the menu keys round-trip**

In `src/lib/acc/travel-booking/booking-approver-tabs.ts`, swap the filter at the
two storage call sites — **line 72 (read) and line 94 (write)** — from
`filterGrantableBookingTabKeys` to `filterStorableBookingKeys`, importing it from
`./settings-tabs`. Leave every other use of `filterGrantableBookingTabKeys`
alone, in particular the one inside `decideBookingTabAccess`.

Add to `settings-tabs.test.ts`:

```ts
test("storage keeps both vocabularies; authorization keeps only tabs", () => {
  const both = ["brands", "bookingQueue", "access", "nope"];
  // 'access' and 'nope' are in neither vocabulary and are dropped by both.
  assert.deepEqual(filterStorableBookingKeys(both), ["brands", "bookingQueue"]);
  assert.deepEqual(filterGrantableBookingTabKeys(both), ["brands"]);
});

/**
 * The security property the split exists to preserve: a menu grant must not
 * open a settings route. `decideBookingTabAccess` refuses it because
 * `isGrantableBookingTabKey` does.
 */
test("a menu grant never satisfies a settings tab", () => {
  assert.equal(decideBookingTabAccess(false, ["bookingQueue"], "bookingQueue"), false);
  assert.equal(decideBookingTabAccess(false, ["bookingQueue"], "brands"), false);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/acc/travel-booking/settings-tabs.test.ts`
Expected: PASS

- [ ] **Step 5: Report the grants from the access endpoint**

In `src/app/api/request/travel-booking/access/route.ts`, replace line 54's `data` object with:

```ts
      // Admins see both menus; a grant list only governs non-admins, exactly as
      // `settingsTabs` above does. `approver` (the AccBookingApprover roster) is
      // still what decides whether an action is permitted once a page is open.
      data: {
        account: approver,
        approver,
        admin,
        settingsTabs,
        canSettings,
        bookingQueue: admin || settingsTabs.indexOf("bookingQueue") !== -1,
        accountApproval: admin || settingsTabs.indexOf("accountApproval") !== -1,
      },
```

- [ ] **Step 6: Add the two columns to the grant grid**

In `BookingApproverSettings.tsx`, render `GRANTABLE_BOOKING_MENUS` as two extra tick columns beside the existing `GRANTABLE_BOOKING_TABS` ones, posting to the same endpoint the tab ticks already use. Group them under a heading `เมนูที่เห็น` so an admin can tell a menu grant from a settings grant at a glance.

- [ ] **Step 7: Verify and commit**

```bash
npm test && npx tsc --noEmit && npm run build
git add src/lib/acc/travel-booking/settings-tabs.ts src/lib/acc/travel-booking/settings-tabs.test.ts "src/app/api/request/travel-booking/access/route.ts" src/features/travel-booking/components/settings/BookingApproverSettings.tsx
git commit -m "feat(ap-17): grant the booking queue and the accounting queue separately"
```

---

### Task 4: The accounting step itself

**Files:**
- Modify: `src/lib/acc/travel-booking/admin-service.ts:325` (`completeRequest`)
- Modify: `src/lib/acc/travel-booking/approval.ts`
- Create: `src/app/api/request/travel-booking/requests/[id]/account-approve/route.ts`

**Interfaces:**
- Consumes: `Actor` from `@/lib/acc/actor-context`; `getTravelBookingRequest(id: number)`.
- Produces: `approveByAccount(requestId: number, actor: Actor): Promise<TravelBookingRequest>`.

- [ ] **Step 1: Move the Admin desk's exit to the accounting step**

In `admin-service.ts`, `completeRequest` currently writes:

```sql
UPDATE [dbo].[AccRequest] SET Status='Completed', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
WHERE Id=@rid AND CurrentStepCode='ADMIN' AND Status='ManagerApproved';
```

Change to:

```sql
UPDATE [dbo].[AccRequest] SET CurrentStepCode='ACCOUNT', UpdatedAt=SYSDATETIME()
WHERE Id=@rid AND CurrentStepCode='ADMIN' AND Status='ManagerApproved';
```

Status stays `ManagerApproved` — the request is not finished, it is waiting for accounting. Update the function's doc comment: it no longer closes the request, it hands it on.

- [ ] **Step 2: Add the accounting approval**

Add to `approval.ts`, following `approveByManager`'s shape (conditional UPDATE inside a transaction, `rowsAffected` checked, activity row, `AccApproval` row closed):

```ts
/**
 * Accounting signs the booking off: `ManagerApproved`/`ACCOUNT` → `Completed`.
 *
 * The last step, and the point after which the per-diem figure is frozen — see
 * `recomputeGroupPerDiem`, which refuses a `Completed` request.
 *
 * The status and step are the UPDATE's own predicate rather than a read followed
 * by a write: two accountants pressing approve on the same request both pass a
 * read, and only one may close it.
 */
export async function approveByAccount(requestId: number, actor: Actor): Promise<TravelBookingRequest> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const res = await tx.request()
      .input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest]
              SET Status='Completed', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND Status='ManagerApproved' AND CurrentStepCode='ACCOUNT'`);
    if ((res.rowsAffected[0] ?? 0) === 0) {
      throw new Error("คำขอนี้ไม่อยู่ในขั้นตอนอนุมัติของบัญชี");
    }

    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.staffId ?? null)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'account_approved', N'บัญชีอนุมัติ')`);

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  const updated = await getTravelBookingRequest(requestId);
  if (!updated) throw new Error("ไม่พบคำขอ");
  return updated;
}
```

- [ ] **Step 3: Add the route**

`src/app/api/request/travel-booking/requests/[id]/account-approve/route.ts`, mirroring the existing `approve/route.ts`: `requireAuth`, then `uatActorGate`, then the `AccBookingApprover` membership check the queue routes already use, then `approveByAccount`, then `void processQueue().catch(() => {})`.

- [ ] **Step 4: Verify**

```bash
npm test && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/admin-service.ts src/lib/acc/travel-booking/approval.ts "src/app/api/request/travel-booking/requests/[id]/account-approve/route.ts"
git commit -m "feat(ap-17): add the accounting step after the Admin booking desk"
```

---

### Task 5: Recompute the per diem when a predecessor dies

**Files:**
- Create: `src/lib/acc/travel-booking/perdiem-window.ts`
- Test: `src/lib/acc/travel-booking/perdiem-window.test.ts`
- Create: `src/lib/acc/travel-booking/perdiem-recompute.ts`
- Modify: `src/lib/acc/travel-booking/approval.ts` (`rejectRequest`, `rejectByAdmin`, `cancelByRequester`)

**Interfaces:**
- Consumes: `continuationFlags`, `ChainTrip` (Task 1); `computePerDiem(departDate: string, returnDate: string, isContinuation: boolean, log: AllowanceLogEntry[])` from `./perdiem`; `AccTx` — declare it locally as `type AccTx = { request: () => ReturnType<AccPool["request"]> }`, the shape `reimburse/request-service.ts:74` uses, **not** `admin-service.ts:109`'s `ReturnType<AccPool["transaction"]>`, which is the transaction object rather than something with `.request()`.
- Produces: `function perDiemWritable(status: string): boolean` and `recomputeGroupPerDiem(tx: AccTx, groupKey: string, cause: { requestId: number; requestNo: string | null; kind: "cancelled" | "rejected" }): Promise<void>`.

- [ ] **Step 1a: Write the failing window test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { perDiemWritable } from "./perdiem-window";

test("a request still moving through the workflow may be rewritten", () => {
  assert.equal(perDiemWritable("Submitted"), true);
  assert.equal(perDiemWritable("ManagerApproved"), true);
  assert.equal(perDiemWritable("Returned"), true);
  assert.equal(perDiemWritable("Draft"), true);
});

/** Accounting has signed the figure. It is a decision, not a derivation. */
test("a completed request is frozen", () => {
  assert.equal(perDiemWritable("Completed"), false);
});

/** Not going to be paid at all — rewriting it would be noise in the log. */
test("a dead request is not rewritten either", () => {
  assert.equal(perDiemWritable("Cancelled"), false);
  assert.equal(perDiemWritable("Rejected"), false);
});

/**
 * Fails closed. A status this file has never heard of is more likely a new
 * terminal state than a new editable one, and writing over a paid figure is the
 * expensive mistake.
 */
test("an unknown status is refused", () => {
  assert.equal(perDiemWritable("Paid"), false);
  assert.equal(perDiemWritable(""), false);
  assert.equal(perDiemWritable("completed"), false);
});
```

- [ ] **Step 1b: Run it to verify it fails**

Run: `npx tsx --test src/lib/acc/travel-booking/perdiem-window.test.ts`
Expected: FAIL with `Cannot find module './perdiem-window'`

- [ ] **Step 1c: Implement it**

```ts
/**
 * May this request's per-diem figure still be rewritten?
 *
 * `Completed` means accounting has signed it — see `approveByAccount`. From
 * there the figure is a decision somebody made, and a predecessor cancelled
 * afterwards is a thing for a person to look at, not for a transaction to
 * silently correct. `Cancelled` and `Rejected` are not going to be paid at all.
 *
 * **An allow-list, so an unknown status is refused.** A status added later is
 * far more likely to be another terminal state than another editable one, and
 * overwriting a figure somebody has already been paid on is the expensive
 * direction to be wrong in.
 *
 * Pure and import-free so it is unit-tested without a database.
 */
const WRITABLE: readonly string[] = ["Draft", "Submitted", "ManagerApproved", "Returned"];

export function perDiemWritable(status: string): boolean {
  return WRITABLE.indexOf(status) !== -1;
}
```

- [ ] **Step 1d: Run it to verify it passes**

Run: `npx tsx --test src/lib/acc/travel-booking/perdiem-window.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 2: Write the recompute**

```ts
/**
 * Recompute a booking group's per diem after one of its trips dies.
 *
 * A cancelled or rejected trip stops absorbing the day its successor dropped as
 * a duplicate — see `continuation-chain.ts`. Everything below is bookkeeping
 * around that one idea.
 *
 * **Runs inside the caller's transaction.** A cancel that commits while this
 * fails leaves the group inconsistent in exactly the way it exists to prevent.
 *
 * **A `Completed` trip is never rewritten.** Accounting has signed the figure;
 * a predecessor cancelled afterwards is a thing for a person to decide. It still
 * gets a log row, with `before` equal to `after` — that is the case somebody
 * most needs to find later, and a silent skip leaves nothing to find.
 */
export async function recomputeGroupPerDiem(
  tx: AccTx,
  groupKey: string,
  cause: { requestId: number; requestNo: string | null; kind: "cancelled" | "rejected" },
): Promise<void> {
  const rows = await tx.request()
    .input("gk", sql.NVarChar(40), groupKey)
    .query(`SELECT t.RequestId, t.SortOrder, t.DepartDate, t.ReturnDate,
                   t.IsContinuation, t.PerDiemDays, t.PerDiemTotal,
                   r.Status, r.EmployeeId
              FROM [dbo].[AccTravelBooking] t
              INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
             WHERE t.GroupKey = @gk`);

  const raw = rows.recordset as Record<string, unknown>[];

  const trips: ChainTrip[] = raw.map((x) => ({
    requestId: x.RequestId as number,
    sortOrder: (x.SortOrder as number) ?? 0,
    departDate: x.DepartDate ? toYmd(x.DepartDate as Date) : null,
    returnDate: x.ReturnDate ? toYmd(x.ReturnDate as Date) : null,
    // The cause's own row is already updated to its new status by the caller's
    // UPDATE, which ran earlier in this same transaction — so it reads as dead
    // here without being special-cased.
    alive: (x.Status as string) !== "Cancelled" && (x.Status as string) !== "Rejected",
  }));

  const flags = continuationFlags(trips);

  for (const x of raw) {
    const requestId = x.RequestId as number;
    const status = x.Status as string;
    const wasContinuation = !!x.IsContinuation;
    const nowContinuation = flags.get(requestId) ?? false;
    if (wasContinuation === nowContinuation) continue;

    const beforeDays = (x.PerDiemDays as number) ?? 0;
    const beforeTotal = Number(x.PerDiemTotal ?? 0);
    const departDate = x.DepartDate ? toYmd(x.DepartDate as Date) : null;
    const returnDate = x.ReturnDate ? toYmd(x.ReturnDate as Date) : null;

    // A frozen request still gets its row in the trail — with before === after,
    // and `locked` set — because a figure that *would* have moved is exactly
    // what somebody reconciling this later needs to find. A silent skip leaves
    // nothing to find.
    const writable = perDiemWritable(status) && !!departDate && !!returnDate;

    let afterDays = beforeDays;
    let afterTotal = beforeTotal;

    if (writable) {
      // `getAllowanceLog` from `./allowance-log` — the same reader
      // `submitTravelBookingGroup` uses at request-service.ts:1170. It takes its
      // own pool rather than this transaction, which is fine: it only reads, and
      // the allowance history is not something this transaction is changing.
      const employeeId = x.EmployeeId as string | null;
      const log = employeeId ? await getAllowanceLog(employeeId) : [];
      const computed = computePerDiem(departDate!, returnDate!, nowContinuation, log);
      afterDays = computed.days;
      afterTotal = computed.total;

      await tx.request()
        .input("rid", sql.Int, requestId)
        .input("cont", sql.Bit, nowContinuation ? 1 : 0)
        .input("days", sql.Int, afterDays)
        .input("total", sql.Decimal(18, 2), afterTotal)
        .query(`UPDATE [dbo].[AccTravelBooking] SET
                  IsContinuation=@cont, PerDiemDays=@days, PerDiemTotal=@total,
                  UpdatedAt=SYSDATETIME()
                WHERE RequestId=@rid`);
    }

    const causeLabel = cause.kind === "cancelled" ? "ถูกยกเลิก" : "ไม่ได้รับอนุมัติ";
    const causeNo = cause.requestNo ?? `#${cause.requestId}`;
    const note = writable
      ? `Per diem ${beforeDays} → ${afterDays} วัน (${beforeTotal.toFixed(2)} → ${afterTotal.toFixed(2)}) เพราะ ${causeNo} ${causeLabel}`
      : `${causeNo} ${causeLabel} แต่คำขอนี้ผ่านบัญชีแล้ว — ไม่ได้แก้ยอด (${beforeDays} วัน / ${beforeTotal.toFixed(2)})`;

    // AuthorId NULL, deliberately: nobody did this. A cancellation elsewhere
    // caused it, and `causedByRequestId` in the metadata is who to look at.
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("note", sql.NVarChar, note)
      .input("meta", sql.NVarChar, JSON.stringify({
        before: { days: beforeDays, total: beforeTotal },
        after: { days: afterDays, total: afterTotal },
        causedByRequestId: cause.requestId,
        causedByRequestNo: cause.requestNo,
        cause: cause.kind,
        locked: !writable,
      }))
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
              VALUES (@rid, NULL, 'perdiem_recalculated', @note, @meta)`);
  }
}
```

`getAllowanceLog(employeeId: string): Promise<AllowanceLogEntry[]>` is exported
from `src/lib/acc/travel-booking/allowance-log.ts` and is what
`submitTravelBookingGroup` calls (request-service.ts:1170) — reuse it rather
than writing a second reader. A trip with no `EmployeeId` gets an empty log,
which `computePerDiem` handles: no rate, so no days counted.

`toYmd` is the local-getter formatter at `request-service.ts:69`. Import or
duplicate it, but do **not** reach for `toISOString()` on a date column — it
shifts a date-only value back a day in a UTC+7 process.

For reference, the log row this writes is:

```ts
await tx.request()
  .input("rid", sql.Int, trip.requestId)
  .input("note", sql.NVarChar, note)
  .input("meta", sql.NVarChar, JSON.stringify({
    before: { days: beforeDays, total: beforeTotal },
    after: { days: afterDays, total: afterTotal },
    causedByRequestId: cause.requestId,
    causedByRequestNo: cause.requestNo,
    cause: cause.kind,
    locked: status === "Completed",
  }))
  .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
          VALUES (@rid, NULL, 'perdiem_recalculated', @note, @meta)`);
```

`AuthorId` is NULL deliberately: nobody did this, a cancellation caused it.

- [ ] **Step 2: Call it from the three death paths**

In `approval.ts`, inside the existing transaction of `rejectRequest`, `rejectByAdmin` and `cancelByRequester`, after the status UPDATE succeeds, read the request's `GroupKey` and call `recomputeGroupPerDiem`. A request with no group key (there should be none for AP-17) skips it.

- [ ] **Step 3: Verify against the live UAT group**

Write a throwaway script under `scripts/checks/tmp/` that loads the `TRL26-09002` / `09003` / `09004` group, prints each trip's `IsContinuation` / `PerDiemDays`, and **does not write**. Confirm the chain reads as expected before letting the recompute run for real. Delete the script afterwards.

- [ ] **Step 4: Verify and commit**

```bash
npm test && npx tsc --noEmit && npm run build
git add src/lib/acc/travel-booking/perdiem-recompute.ts src/lib/acc/travel-booking/approval.ts
git commit -m "feat(ap-17): give back a per-diem day when the trip that took it is cancelled"
```

---

### Task 6: The accounting queue page

**Files:**
- Create: `src/app/(dashboard)/request/accounting/travel-booking/approvals/page.tsx`
- Create: `src/app/api/request/travel-booking/requests/[id]/payment-date/route.ts`
- Modify: `src/lib/constants.ts` (`REQUEST_CARDS` — add the card)

**Interfaces:**
- Consumes: `payoutMonthOptions`, `payoutDateForMonth` (Task 2); `approveByAccount` (Task 4); `/api/request/travel-booking/access`'s `accountApproval` flag (Task 3).
- Produces: nothing later tasks rely on.

- [ ] **Step 1: The payment-date route**

```ts
/**
 * POST /api/request/travel-booking/requests/[id]/payment-date  { ym: "YYYY-MM" }
 *
 * A **month** is posted, not a date: AP-17 pays at a month's end and the server
 * derives the day, so a client cannot write the 3rd of anything.
 *
 * Refused unless the request is at `ManagerApproved`/`ACCOUNT`. Once accounting
 * has signed, `Status` is `Completed` and the figure is frozen — the page hides
 * the control and this refuses it, because a control removed from a page is not
 * a rule.
 */
```

Body: validate `ym` against `payoutMonthOptions(new Date())` (membership, not a regex — that also enforces "current month forward"), derive the date with `payoutDateForMonth`, then a conditional UPDATE bounded on `Status='ManagerApproved' AND CurrentStepCode='ACCOUNT' AND FormCode='AP-17'`, then an `AccActivityLog` row with action `payment_date_edited`.

- [ ] **Step 2: The page**

A queue listing `ManagerApproved` / `ACCOUNT` requests. Per row: request number (opens the existing `SidePanel` detail), requester, brand, travel dates, per diem, and the payout month as a select of `payoutMonthOptions` labels. An approve button per row and a multi-select approve, matching AP-1's queue. Gate the page on `accountApproval` from the access endpoint, and render "ไม่มีสิทธิ์เข้าถึง" otherwise.

Show the per-diem history inline where `AccActivityLog` holds a `perdiem_recalculated` row for that request, so an accountant signing a figure that moved sees why before they sign.

- [ ] **Step 3: The card**

Add to `REQUEST_CARDS` in `src/lib/constants.ts` beside the existing AP-17 cards, badge `AP-17`. It is **not** `devHostOnly` — this is a live-host workflow.

- [ ] **Step 4: Verify and commit**

```bash
npm test && npx tsc --noEmit && npm run build
git add "src/app/(dashboard)/request/accounting/travel-booking/approvals/page.tsx" "src/app/api/request/travel-booking/requests/[id]/payment-date/route.ts" src/lib/constants.ts
git commit -m "feat(ap-17): the accounting approval queue, with an editable payout month"
```

---

## Deployment notes

- **No migrations.** See Global Constraints.
- **The Admin desk stops closing requests.** After Task 4, anything the Admin
  completes waits at `ACCOUNT` instead of reaching `Completed`. Nobody can clear
  that queue until Task 3 has granted somebody the `accountApproval` menu **and**
  they are on `AccBookingApprover`. Do the grant before deploying, or AP-17
  requests pile up with no visible reason.
- **In-flight requests.** Anything already `Completed` is untouched. Anything at
  `ADMIN` when this deploys will route through the new step normally.
