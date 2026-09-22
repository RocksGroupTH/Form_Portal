# AP-17 package B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse a submit whose travel days overlap another live request of the same person, stop paying per diem on a trip that books no accommodation, and make the continuation deduction work across separately submitted requests instead of only within one booking group.

**Architecture:** Three pure modules carry the rules — a new `date-overlap.ts`, a widened `continuation-chain.ts`, and an extended `computePerDiem`. One new database loader answers "this requester's other live AP-17 trips" and is shared by the submit's overlap check, the submit's continuation flags, and the cancellation recompute, so the three cannot disagree about what a person's calendar contains.

**Tech Stack:** TypeScript, MSSQL (`mssql` driver), `node:test` + `node:assert/strict` via `tsx`, React 19 (one validator and one label).

**Spec:** `docs/superpowers/specs/2026-09-21-ap17-b-per-diem-rules.md` — read it before Task 1; it is the binding authority and the plan argues from it.

## Global Constraints

- **`perdiem-window.ts` decides what may be WRITTEN, and this package does not touch it.** Widening which rows are *considered* must never widen which rows are *rewritten*: a request past accounting keeps its figure and still gets a `perdiem_recalculated` activity row with `after == before` and `locked: true`.
- **`computePerDiem` must never return null or throw for a zero case.** Zero days is a real answer: `{ days: 0, total: 0, groups: [] }`. `perdiem-country.ts`'s docblock records why the null/empty distinction matters on a path that writes `AccRequest.TotalAmount`.
- **"Live" means `Status` is neither `Cancelled` nor `Rejected`** — the same test `continuation-chain.ts`'s `alive` flag already applies.
- Parameterised SQL only — `pool.request().input("name", sql.Int, value)`. Never interpolate a value.
- Tests are `node:test` + `node:assert/strict`, discovered by a walker over `src/`. Import **values** relatively (`./date-overlap`); `import type` may use the `@/` alias because it erases. A module reaching `@/env` cannot be statically imported in a test — use `sharepoint-path.test.ts`'s placeholder-env + dynamic-import pattern if you hit that.
- **ES5 target:** `Array.from()` only, never a spread over a Set or Map.
- In-page and error copy is **Thai**; every string in this plan is final.
- Dates are Thai wall clocks read with **local getters**; `useUTC: false`. Never slice a `YYYY-MM-DD` off an ISO string — that is a bug this branch already fixed once.
- `npm run typecheck` clean before every commit. Record the suite count before Task 1 and never let it drop.
- No dev server. **Tasks 1-3 and 7 touch no database. Tasks 4-6 change SQL but must not connect to one** — migrations are not part of this package and there are none.

---

### Task 1: `date-overlap.ts` — the rule that refuses a duplicate date

**Files:**
- Create: `src/lib/acc/travel-booking/date-overlap.ts`
- Test: `src/lib/acc/travel-booking/date-overlap.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface OtherTrip { requestId: number; requestNo: string | null; departDate: string; returnDate: string; alive: boolean }`
  - `interface OverlapRefusal { date: string; requestId: number; requestNo: string | null; otherDepart: string; otherReturn: string; message: string }`
  - `findDateOverlap(candidate: { departDate: string; returnDate: string }, others: readonly OtherTrip[]): OverlapRefusal | null`

**Why this is separate from `continuation-chain.ts`.** Both reason about touching date ranges, and the spec says not to fold them: one decides whether a submit is allowed, the other decides what a day is worth. Sharing a code path would let a change meant for one silently move the other.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/acc/travel-booking/date-overlap.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findDateOverlap, type OtherTrip } from "./date-overlap";

const other = (over: Partial<OtherTrip> = {}): OtherTrip => ({
  requestId: 123,
  requestNo: "TRL26-00123",
  departDate: "2026-09-20",
  returnDate: "2026-09-24",
  alive: true,
  ...over,
});

test("a return date meeting a depart date is allowed — this is the whole point", () => {
  // 20-24 then 24-26. The 24th is worked once and paid once; continuation-chain
  // drops it from the second trip. Refusing this would block the case item 4
  // exists for.
  assert.equal(findDateOverlap({ departDate: "2026-09-24", returnDate: "2026-09-26" }, [other()]), null);
});

test("a depart date meeting a return date is allowed in the other direction too", () => {
  // The new trip ENDS where the old one starts: 18-20 before an existing 20-24.
  assert.equal(findDateOverlap({ departDate: "2026-09-18", returnDate: "2026-09-20" }, [other()]), null);
});

test("a partial overlap is refused and names the first shared day", () => {
  const r = findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-22");
  assert.equal(r.requestNo, "TRL26-00123");
});

test("a trip contained inside another is refused", () => {
  const r = findDateOverlap({ departDate: "2026-09-21", returnDate: "2026-09-23" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-21");
});

test("a trip that swallows another is refused", () => {
  const r = findDateOverlap({ departDate: "2026-09-18", returnDate: "2026-09-28" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-20");
});

test("a same-day trip on an existing return date is refused, not treated as a continuation", () => {
  // 24-24 is not a depart meeting a return, it is the whole trip sitting on a
  // day already paid. The spec's table names this case explicitly.
  const r = findDateOverlap({ departDate: "2026-09-24", returnDate: "2026-09-24" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-24");
});

test("trips that do not touch are allowed", () => {
  assert.equal(findDateOverlap({ departDate: "2026-09-26", returnDate: "2026-09-28" }, [other()]), null);
  assert.equal(findDateOverlap({ departDate: "2026-09-10", returnDate: "2026-09-12" }, [other()]), null);
});

test("an empty list of other trips allows anything", () => {
  assert.equal(findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, []), null);
});

test("a cancelled or rejected trip blocks nothing — re-filing is the point", () => {
  // A trip that will never be paid cannot own a day. Refusing a re-file because
  // of the request it replaces is the failure this arm exists to prevent, and
  // the rule lives HERE rather than in the caller's filter so it is testable.
  const dead = [other({ alive: false })];
  assert.equal(findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, dead), null);
  assert.equal(findDateOverlap({ departDate: "2026-09-20", returnDate: "2026-09-24" }, dead), null);
});

test("a dead trip does not mask a live one behind it", () => {
  const rows = [
    other({ requestId: 1, requestNo: "TRL26-00111", alive: false }),
    other({ requestId: 2, requestNo: "TRL26-00222", departDate: "2026-09-23", returnDate: "2026-09-27" }),
  ];
  const r = findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, rows);
  assert.ok(r);
  assert.equal(r.requestNo, "TRL26-00222");
  assert.equal(r.date, "2026-09-23");
});

test("the message names the date AND the request, in Thai", () => {
  const r = findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, [other()]);
  assert.ok(r);
  // A refusal a requester cannot act on is not a refusal. The request they hit
  // may be one they filed weeks ago.
  assert.ok(r.message.includes("22/09/2026"), `message lacks the date: ${r.message}`);
  assert.ok(r.message.includes("TRL26-00123"), `message lacks the running number: ${r.message}`);
  assert.ok(r.message.includes("20/09/2026"), `message lacks the other trip's range: ${r.message}`);
});

test("a request with no running number still produces a usable message", () => {
  // A Draft has no RequestNo. It should not render "null" at the reader.
  const r = findDateOverlap(
    { departDate: "2026-09-22", returnDate: "2026-09-26" },
    [other({ requestNo: null })],
  );
  assert.ok(r);
  assert.ok(!r.message.includes("null"), `message leaks null: ${r.message}`);
  assert.ok(r.message.includes("22/09/2026"));
});

test("the earliest colliding trip is reported when several collide", () => {
  const rows = [
    other({ requestId: 2, requestNo: "TRL26-00222", departDate: "2026-09-25", returnDate: "2026-09-27" }),
    other({ requestId: 1, requestNo: "TRL26-00111", departDate: "2026-09-20", returnDate: "2026-09-24" }),
  ];
  const r = findDateOverlap({ departDate: "2026-09-21", returnDate: "2026-09-26" }, rows);
  assert.ok(r);
  // Deterministic: the first shared DAY, so the reader is pointed at the start
  // of their problem rather than at whichever row the database returned first.
  assert.equal(r.date, "2026-09-21");
  assert.equal(r.requestNo, "TRL26-00111");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/acc/travel-booking/date-overlap.test.ts`
Expected: module not found. Create the module with `findDateOverlap` returning `null`, re-run, and confirm you now see real ASSERTION failures. This step is required.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/acc/travel-booking/date-overlap.ts

/**
 * Whether a trip's days collide with another request of the same person.
 *
 * **One shared day is allowed, and only at the boundary**: the previous trip's
 * return date may equal the new trip's depart date, or the reverse. That is the
 * continuation case — the day is worked once and paid once, and
 * `continuation-chain.ts` drops it from the later trip. Everything else is a
 * duplicate and the submit is refused.
 *
 * Deliberately NOT folded into `continuation-chain.ts`, which reasons about the
 * same touching ranges: that one decides what a day is worth, this one decides
 * whether a submit is allowed. One code path would let a change meant for one
 * silently move the other.
 *
 * Pure and import-free so it is unit-tested without a database.
 */

export interface OtherTrip {
  requestId: number;
  /** Null on a Draft, which has no running number yet. */
  requestNo: string | null;
  departDate: string;
  returnDate: string;
  /**
   * False once Cancelled or Rejected. **A dead trip blocks nothing** — it will
   * never be paid, so it cannot own a day, and refusing a re-file because of
   * the request it replaces is exactly the situation a re-file exists for.
   *
   * The test lives here rather than in the caller's filter so it is a rule with
   * a unit test rather than a line someone can drop from a query.
   */
  alive: boolean;
}

export interface OverlapRefusal {
  /** The first day, in `YYYY-MM-DD`, that both trips claim. */
  date: string;
  requestId: number;
  requestNo: string | null;
  otherDepart: string;
  otherReturn: string;
  /** Thai, ready to show. Names the day and the request it collided with. */
  message: string;
}

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, the format every AP-17 screen shows. */
function thaiDate(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

/**
 * Every day of an inclusive range, as `YYYY-MM-DD`.
 *
 * String comparison is safe and intended here: both ends are already fixed-width
 * `YYYY-MM-DD`, so lexicographic order is chronological order, and no `Date` is
 * constructed — which keeps this free of the timezone question entirely.
 */
function daysOf(depart: string, ret: string): string[] {
  const out: string[] = [];
  const start = new Date(`${depart}T00:00:00`);
  const end = new Date(`${ret}T00:00:00`);
  const cur = new Date(start.getTime());
  while (cur <= end) {
    const m = `${cur.getMonth() + 1}`.padStart(2, "0");
    const d = `${cur.getDate()}`.padStart(2, "0");
    out.push(`${cur.getFullYear()}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** True when the only thing the two ranges share is one boundary day. */
function touchesOnlyAtBoundary(
  candidate: { departDate: string; returnDate: string },
  other: OtherTrip,
): boolean {
  // The candidate starts the day the other ends, or ends the day the other
  // starts — and is not itself a single day sitting on that boundary, which
  // shares the day without continuing anything.
  if (candidate.departDate === candidate.returnDate) return false;
  if (other.departDate === other.returnDate) return false;
  return (
    (candidate.departDate === other.returnDate && candidate.returnDate > other.returnDate) ||
    (candidate.returnDate === other.departDate && candidate.departDate < other.departDate)
  );
}

export function findDateOverlap(
  candidate: { departDate: string; returnDate: string },
  others: readonly OtherTrip[],
): OverlapRefusal | null {
  const mine = daysOf(candidate.departDate, candidate.returnDate);

  let best: OverlapRefusal | null = null;
  for (const other of others) {
    if (!other.alive) continue;
    if (touchesOnlyAtBoundary(candidate, other)) continue;
    const theirs = daysOf(other.departDate, other.returnDate);
    for (const day of mine) {
      if (theirs.indexOf(day) < 0) continue;
      // The FIRST shared day wins, across every colliding trip — the reader is
      // pointed at the start of their problem, not at whichever row the
      // database happened to return first.
      if (best && best.date <= day) break;
      const who = other.requestNo ?? "คำขอฉบับร่าง";
      best = {
        date: day,
        requestId: other.requestId,
        requestNo: other.requestNo,
        otherDepart: other.departDate,
        otherReturn: other.returnDate,
        message:
          `วันที่ ${thaiDate(day)} ซ้ำกับ ${who} ` +
          `(${thaiDate(other.departDate)}–${thaiDate(other.returnDate)})`,
      };
      break;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/lib/acc/travel-booking/date-overlap.test.ts` → 11 passing.
Then `npm run typecheck`, then `npm test` in full.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/date-overlap.ts src/lib/acc/travel-booking/date-overlap.test.ts
git commit -m "feat(ap-17): the rule that refuses a duplicate travel date"
```

---

### Task 2: `computePerDiem` pays nothing when no room is booked

**Files:**
- Modify: `src/lib/acc/travel-booking/perdiem.ts`
- Modify: `src/lib/acc/travel-booking/perdiem.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `computePerDiem(departDate, returnDate, isContinuation, log, opts?: { roomBooked?: boolean })` — a fifth **optional** parameter. Absent means `true` (a room is booked), so every existing caller keeps its behaviour until Task 4 starts passing it.

**Why optional-defaulting-true.** Four call sites exist (`useTravelBookingForm.ts:719`, `perdiem-recompute.ts:152`, `request-service.ts:1258`, plus tests). A required parameter would make this task break all of them at once; an optional one lets Task 4 wire the real value with the rule already tested.

- [ ] **Step 1: Write the failing test**

Add to the existing `perdiem.test.ts`:

```typescript
test("a trip that books no room is worth nothing, however long it is", () => {
  // The cut is the BOOKING, not the calendar (user, 2026-09-21). Three nights
  // staying with relatives pays zero — per diem here follows the company having
  // booked a room.
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const r = computePerDiem("2026-09-20", "2026-09-23", false, log, { roomBooked: false });
  assert.equal(r.days, 0);
  assert.equal(r.total, 0);
  assert.deepEqual(r.groups, []);
});

test("zero days is a real answer, not a missing one", () => {
  // `groups: []` with `days: 0` and `total: 0` — never null, never a throw.
  // perdiem-country.ts's docblock records why that distinction matters on a
  // path that writes AccRequest.TotalAmount.
  const r = computePerDiem("2026-09-20", "2026-09-20", false, [], { roomBooked: false });
  assert.equal(r.days, 0);
  assert.equal(r.total, 0);
  assert.ok(Array.isArray(r.groups));
});

test("a booked room pays exactly as before, and omitting the option means booked", () => {
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const withOpt = computePerDiem("2026-09-20", "2026-09-22", false, log, { roomBooked: true });
  const without = computePerDiem("2026-09-20", "2026-09-22", false, log);
  assert.equal(withOpt.days, 3);
  assert.deepEqual(without, withOpt);
});

test("no room plus a continuation still gives zero, not minus one", () => {
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const r = computePerDiem("2026-09-20", "2026-09-22", true, log, { roomBooked: false });
  assert.equal(r.days, 0);
  assert.equal(r.total, 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/acc/travel-booking/perdiem.test.ts`
Expected: the four new tests fail — the option is ignored, so `days` is 4, 1, 3 and 2 respectively. Every pre-existing test in the file must still pass; if one fails, stop and report BLOCKED.

- [ ] **Step 3: Write the implementation**

In `computePerDiem`, add the parameter and the early return. Put it **before** the day walk:

```typescript
export function computePerDiem(
  departDate: string,
  returnDate: string,
  isContinuation: boolean,
  log: AllowanceLogEntry[],
  opts?: {
    /**
     * Whether this trip books a room. **Absent means true** — every caller that
     * predates the 2026-09-21 rule keeps its behaviour.
     */
    roomBooked?: boolean;
  },
): { days: number; total: number; groups: { rate: number; days: number }[] } {
  // **No accommodation booked, no per diem** (user, 2026-09-21): the cut is the
  // booking, not the calendar, so a three-night trip staying with relatives
  // pays nothing. Zero days is a real answer here — never null, never a throw —
  // because this figure is written straight into AccRequest.TotalAmount.
  //
  // There is exactly ONE exception and it is package E: a requester who picks
  // พักห้องเดียวกับ books no room of their own and DOES get per diem. That
  // caller passes `roomBooked: true`; the exception lives there, not here.
  if (opts?.roomBooked === false) return { days: 0, total: 0, groups: [] };

  // …existing body unchanged from here…
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/lib/acc/travel-booking/perdiem.test.ts` → all passing, old and new.
Then `npm run typecheck`, then `npm test` in full.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/perdiem.ts src/lib/acc/travel-booking/perdiem.test.ts
git commit -m "feat(ap-17): no accommodation booked, no per diem"
```

---

### Task 3: the continuation chain orders by depart date, not by insertion

**Files:**
- Modify: `src/lib/acc/travel-booking/continuation-chain.ts`
- Modify: `src/lib/acc/travel-booking/continuation-chain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `continuationFlags(trips)` — same name, same `Map<number, boolean>` return. `ChainTrip.sortOrder` stays on the interface but stops deciding order.

**What changes and why.** Today the chain sorts by `sortOrder` (`AccTravelBooking.SortOrder`), which orders trips *within one booking group* and means nothing between groups filed weeks apart. Depart date is the only ordering both cases share. Tasks 4 and 5 then feed it a wider set of trips.

- [ ] **Step 1: Write the failing test**

Add to the existing `continuation-chain.test.ts`:

```typescript
test("trips are chained by depart date, not by the order they were inserted", () => {
  // Two requests filed in separate rounds: the LATER trip was entered first, so
  // its sortOrder is lower. Ordering by sortOrder chains them backwards and the
  // shared day is either double-paid or deducted from the wrong trip.
  const flags = continuationFlags([
    { requestId: 2, sortOrder: 0, departDate: "2026-09-24", returnDate: "2026-09-26", alive: true },
    { requestId: 1, sortOrder: 1, departDate: "2026-09-20", returnDate: "2026-09-24", alive: true },
  ]);
  assert.equal(flags.get(1), false, "the earlier trip continues nothing");
  assert.equal(flags.get(2), true, "the later trip continues the earlier one");
});

test("a cross-request boundary is detected exactly as an in-group one is", () => {
  const flags = continuationFlags([
    { requestId: 10, sortOrder: 0, departDate: "2026-09-20", returnDate: "2026-09-24", alive: true },
    { requestId: 20, sortOrder: 0, departDate: "2026-09-24", returnDate: "2026-09-26", alive: true },
  ]);
  // Both carry sortOrder 0 because they come from different groups. Depart date
  // is what separates them.
  assert.equal(flags.get(10), false);
  assert.equal(flags.get(20), true);
});

test("a dead predecessor is skipped to the live one behind it, ordered by date", () => {
  const flags = continuationFlags([
    { requestId: 1, sortOrder: 2, departDate: "2026-09-20", returnDate: "2026-09-24", alive: true },
    { requestId: 2, sortOrder: 1, departDate: "2026-09-24", returnDate: "2026-09-26", alive: false },
    { requestId: 3, sortOrder: 0, departDate: "2026-09-26", returnDate: "2026-09-28", alive: true },
  ]);
  // 3's immediate predecessor by date is 2, which is dead; the nearest live one
  // is 1, which returns on the 24th and does not touch the 26th.
  assert.equal(flags.get(3), false, "3 must not continue a dead trip");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/acc/travel-booking/continuation-chain.test.ts`
Expected: the first two fail (sortOrder still decides). **Every pre-existing test in the file must still pass** — the spec requires it. If one fails, the change is wrong, not the test: stop and report BLOCKED with the output.

- [ ] **Step 3: Write the implementation**

Change only the sort, and the docblock that explains it:

```typescript
  // **Ordered by depart date, not by SortOrder** (2026-09-21). SortOrder orders
  // trips within ONE booking group and means nothing between groups filed weeks
  // apart — and this chain now spans a person's whole calendar, not one group.
  // SortOrder stays the tiebreak so two trips departing the same day keep a
  // stable, reproducible order instead of depending on row order.
  const ordered = trips.slice().sort((a, b) => {
    const ad = a.departDate ?? "";
    const bd = b.departDate ?? "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
```

Update `ChainTrip.sortOrder`'s own comment to say it is now only a tiebreak.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/lib/acc/travel-booking/continuation-chain.test.ts` → all passing.
Then `npm run typecheck`, then `npm test` in full.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/continuation-chain.ts src/lib/acc/travel-booking/continuation-chain.test.ts
git commit -m "feat(ap-17): chain trips by depart date so the chain can cross requests"
```

---

### Task 4: one loader for a requester's other live trips, and the submit uses it

**Files:**
- Create: `src/lib/acc/travel-booking/requester-trips.ts`
- Modify: `src/lib/acc/travel-booking/request-service.ts` (the submit, around lines 1238-1262)
- Create: `src/lib/acc/travel-booking/requester-trips-guard.test.ts`

**Interfaces:**
- Consumes: `findDateOverlap`, `OtherTrip` (Task 1); `continuationFlags`, `ChainTrip` (Task 3); `computePerDiem`'s `opts.roomBooked` (Task 2).
- Produces:
  - `loadRequesterTrips(pool, input: { staffId: number | null; employeeId: string | null; excludeRequestIds: readonly number[] }): Promise<RequesterTrip[]>`
  - `interface RequesterTrip { requestId: number; requestNo: string | null; sortOrder: number; departDate: string | null; returnDate: string | null; alive: boolean }`

**Why one loader.** The overlap refusal, the submit's continuation flags and Task 5's recompute all need the same answer — "what else is on this person's calendar". Three queries would drift; the spec's §3 is explicit that the chain and the refusal must see the same set.

- [ ] **Step 1: Write the loader**

```typescript
// src/lib/acc/travel-booking/requester-trips.ts
import sql from "mssql";
import type { ConnectionPool, Transaction } from "mssql";
import { toYmd } from "@/lib/acc/travel-booking/request-service";

/**
 * Every AP-17 trip on one person's calendar, for the rules that span requests.
 *
 * Shared by three callers that must agree: the submit's duplicate-date refusal
 * (`date-overlap.ts`), the submit's continuation flags, and the cancellation
 * recompute. Separate queries would drift, and a chain that disagreed with the
 * refusal would either double-pay a day or refuse a submit it then paid twice.
 *
 * **Matched on StaffId OR EmployeeId**, the two ways an AP-17 requester is
 * identified — `AccRequest.StaffId` is null for a requester with no active HR
 * row, and `EmployeeId` is the uniqueidentifier the booking form carries.
 * Either alone misses real trips.
 */
export interface RequesterTrip {
  requestId: number;
  requestNo: string | null;
  sortOrder: number;
  departDate: string | null;
  returnDate: string | null;
  /** False once Cancelled or Rejected — it will not be paid. */
  alive: boolean;
}

export async function loadRequesterTrips(
  pool: ConnectionPool | Transaction,
  input: {
    staffId: number | null;
    employeeId: string | null;
    /** The request(s) being submitted or recomputed — never their own neighbour. */
    excludeRequestIds: readonly number[];
  },
): Promise<RequesterTrip[]> {
  if (input.staffId == null && !input.employeeId) return [];

  const req = pool.request().input("staffId", sql.Int, input.staffId);
  req.input("employeeId", sql.UniqueIdentifier, input.employeeId);

  // Excluded ids are bound one parameter each — never interpolated, however
  // small and however internal the list looks.
  const params: string[] = [];
  input.excludeRequestIds.forEach((id, i) => {
    req.input(`ex${i}`, sql.Int, id);
    params.push(`@ex${i}`);
  });
  const exclude = params.length > 0 ? `AND r.Id NOT IN (${params.join(", ")})` : "";

  const res = await req.query(`
    SELECT t.RequestId, t.SortOrder, t.DepartDate, t.ReturnDate,
           r.RequestNo, r.Status
      FROM [dbo].[AccTravelBooking] t
      INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
     WHERE r.FormCode = 'AP-17'
       AND r.Status <> 'Draft'
       AND (
         (@staffId IS NOT NULL AND r.StaffId = @staffId)
         OR (@employeeId IS NOT NULL AND r.EmployeeId = @employeeId)
       )
       ${exclude}`);

  return (res.recordset as Record<string, unknown>[]).map((x) => ({
    requestId: x.RequestId as number,
    requestNo: (x.RequestNo as string) ?? null,
    sortOrder: (x.SortOrder as number) ?? 0,
    departDate: x.DepartDate ? toYmd(x.DepartDate as Date) : null,
    returnDate: x.ReturnDate ? toYmd(x.ReturnDate as Date) : null,
    alive: (x.Status as string) !== "Cancelled" && (x.Status as string) !== "Rejected",
  }));
}
```

> **Check `toYmd`'s real export path before writing this import.** It is used in `perdiem-recompute.ts` and `request-service.ts`; import it from wherever it actually lives rather than from my guess, and say in your report what you found.

- [ ] **Step 2: Write the guard test and watch it fail**

The loader reaches a pool, so it cannot be unit-tested. Pin its shape instead:

```typescript
// src/lib/acc/travel-booking/requester-trips-guard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = () =>
  fs.readFileSync(path.join(process.cwd(), "src/lib/acc/travel-booking/requester-trips.ts"), "utf8");

test("the query is pinned to AP-17 and excludes drafts", () => {
  // AccRequest is shared by five forms. Without the FormCode pin this loader
  // hands AP-17's per-diem chain another form's date ranges.
  const s = SRC();
  assert.ok(s.includes("r.FormCode = 'AP-17'"), "the AP-17 pin is gone");
  assert.ok(s.includes("r.Status <> 'Draft'"), "drafts would collide with their own submit");
});

test("the requester is matched on StaffId OR EmployeeId, not one alone", () => {
  const s = SRC();
  assert.ok(s.includes("r.StaffId = @staffId"));
  assert.ok(s.includes("r.EmployeeId = @employeeId"));
});

test("excluded ids are bound, never interpolated", () => {
  // The one place a list becomes SQL. A template literal here is an injection
  // hole even though the values are internal ids.
  const s = SRC();
  assert.ok(/\.input\(`ex\$\{i\}`/.test(s), "excluded ids must be bound one parameter each");
  assert.ok(!/NOT IN \(\$\{input\.excludeRequestIds/.test(s), "excluded ids are interpolated");
});
```

Run: `npm test -- src/lib/acc/travel-booking/requester-trips-guard.test.ts` → fails on the missing file until Step 1's file exists; write Step 1 first if you prefer, but run this and see it red before you rely on it.

- [ ] **Step 3: Wire the submit — refuse an overlap before anything is claimed**

In `request-service.ts`'s submit, **before** the transaction begins and before the per-diem loop, load the other trips once and refuse:

```typescript
  const others = await loadRequesterTrips(pool, {
    staffId: emp.staffId ?? null,
    employeeId: emp.id ?? null,
    excludeRequestIds: tabs.map((t) => t.requestId),
  });

  // **Refused before the transaction opens.** An overlap is a property of the
  // request as filed, so nothing should be claimed, numbered or written before
  // it is checked — and the requester gets the same answer whether they are
  // first or tenth in the queue.
  // Only the aliveness of the DATES is filtered here — `findDateOverlap` owns
  // the live/dead rule itself, and is tested on it.
  const datedOthers = others.filter((o) => o.departDate && o.returnDate);
  const overlapInput = datedOthers.map((o) => ({
    requestId: o.requestId,
    requestNo: o.requestNo,
    departDate: o.departDate as string,
    returnDate: o.returnDate as string,
    alive: o.alive,
  }));
  for (const tab of tabs) {
    const clash = findDateOverlap(
      { departDate: tab.departDate as string, returnDate: tab.returnDate as string },
      overlapInput,
    );
    if (clash) throw new Error(clash.message);
  }
  const liveOthers = datedOthers.filter((o) => o.alive);
```

> **Confirm the real field names on `emp` and `tabs` before writing this.** The loop above assumes `emp.staffId`, `emp.id` and `tab.requestId`; read the surrounding code and use what is actually there. Report what you found.

- [ ] **Step 4: Wire the submit — continuation across requests, and the no-room rule**

Replace the existing continuation loop (currently `const prev = i > 0 ? tabs[i - 1] : null;`) with one that feeds `continuationFlags` the tabs **and** the other live trips:

```typescript
  // The chain spans this person's whole calendar, not just this group — a trip
  // filed last week whose return date meets this one's depart date still owns
  // that day. `continuationFlags` orders by depart date for exactly this.
  const chainTrips = tabs
    .map((t, i) => ({
      requestId: t.requestId,
      sortOrder: i,
      departDate: t.departDate as string,
      returnDate: t.returnDate as string,
      alive: true,
    }))
    .concat(
      liveOthers.map((o) => ({
        requestId: o.requestId,
        sortOrder: o.sortOrder,
        departDate: o.departDate as string,
        returnDate: o.returnDate as string,
        alive: true,
      })),
    );
  const flagsByRequest = continuationFlags(chainTrips);

  const continuationFlagList: boolean[] = [];
  const perDiems: { days: number; total: number }[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const isContinuation = flagsByRequest.get(tabs[i].requestId) ?? false;
    continuationFlagList.push(isContinuation);
    const resolved = perDiemLogFor(tabs[i].countryCode, log, countryRates);
    perDiems.push(
      computePerDiem(
        tabs[i].departDate as string,
        tabs[i].returnDate as string,
        isContinuation,
        resolved.log,
        // No room booked, no per diem (2026-09-21). Read from the persisted
        // flag, never from the posted DTO — `derive-flags.ts` makes the same
        // point for every other booking flag.
        { roomBooked: tabs[i].needsRoomBooking },
      ),
    );
  }
```

Keep the existing variable name wherever it is read further down (the write at `:1318` uses `continuationFlags[i]`); rename consistently so the local array and the imported function do not collide.

- [ ] **Step 5: Verify**

Run `npm run typecheck`, then `npm test` in full. No test exercises the submit — it needs a pool — so the guard test plus Tasks 1-3's unit tests are the coverage. Say so in your report rather than implying the wiring is tested.

- [ ] **Step 6: Commit**

```bash
git add src/lib/acc/travel-booking/requester-trips.ts src/lib/acc/travel-booking/requester-trips-guard.test.ts src/lib/acc/travel-booking/request-service.ts
git commit -m "feat(ap-17): refuse a duplicate travel date, and chain across requests"
```

---

### Task 5: the recompute widens with the chain

**Files:**
- Modify: `src/lib/acc/travel-booking/perdiem-recompute.ts`

**Interfaces:**
- Consumes: `loadRequesterTrips` (Task 4), `continuationFlags` (Task 3).
- Produces: nothing new.

**Why this is not optional.** `recomputeGroupPerDiem` runs inside the cancelling transaction of `rejectRequest`, `rejectByAdmin` and `cancelByRequester`, and today rewrites **the group's** figures — it loads `WHERE t.GroupKey = @gk`. Once the chain crosses groups, cancelling a trip in group 1 can change what a trip in group 2 is owed, and nothing recomputes group 2. That is a silently wrong payment.

- [ ] **Step 1: Widen the set the CHAIN sees, without widening the query's columns**

**Do not rewrite the existing `GroupKey` query.** It selects `r.StaffId` and `r.CountryCode`, and both carry comments explaining that dropping them re-prices every UAT trip at the tester's real HR allowance *inside the cancelling transaction*. Leave it exactly as it is and add a second read beside it.

After the existing `trips` array is built and before `continuationFlags(trips)` is called:

```typescript
  // **The chain now spans the requester's calendar, not this group.** Cancelling
  // a trip here can give a day back to a trip in a group filed weeks ago, and
  // before 2026-09-21 nothing recomputed that one — a silently wrong payment.
  //
  // Read on the SAME transaction the caller holds, so the rows this sees are
  // the rows the cancellation just wrote (the cause's own status included).
  const requesterId = raw.length > 0
    ? {
        staffId: (raw[0].StaffId as number) ?? null,
        employeeId: (raw[0].EmployeeId as string) ?? null,
      }
    : { staffId: null, employeeId: null };

  const groupIds = trips.map((t) => t.requestId);
  const outside = await loadRequesterTrips(tx, {
    staffId: requesterId.staffId,
    employeeId: requesterId.employeeId,
    excludeRequestIds: groupIds,
  });

  const chainInput: ChainTrip[] = trips.concat(
    outside
      .filter((o) => o.departDate && o.returnDate)
      .map((o) => ({
        requestId: o.requestId,
        sortOrder: o.sortOrder,
        departDate: o.departDate,
        returnDate: o.returnDate,
        alive: o.alive,
      })),
  );

  const flags = continuationFlags(chainInput);
```

`flags` keeps its name and type, so everything downstream reads unchanged. Check the real name of the transaction/pool variable in scope and the real casing of the `StaffId` / `EmployeeId` recordset keys before writing this, and report what you found.

- [ ] **Step 2: Widen which rows are REWRITTEN — but only those that could have moved**

The existing rewrite loop iterates the group. Extend it to the outside trips whose chain position can have changed, which is those departing at or after the cancelled trip:

```typescript
  // Only a trip AFTER the cancelled one can have gained or lost its
  // predecessor. Recomputing the whole calendar would rewrite figures nothing
  // touched, and every extra row is a row inside this transaction's lock.
  const causeDepart = trips.find((t) => t.requestId === causeRequestId)?.departDate ?? null;
  const alsoAffected = causeDepart
    ? outside.filter((o) => o.alive && o.departDate && o.departDate >= causeDepart)
    : [];
```

Then run the same per-row body over `alsoAffected` that the group rows already use — same `perDiemWritable` gate, same `perdiem_recalculated` activity row, same `AccRequest.TotalAmount` rewrite in the same statement batch. Do not duplicate that body: extract it to a local function first and call it for both sets, so the two can never drift.

Check the real name of the cancelled request's id variable in scope (`causeRequestId` above is a placeholder for whatever the function already calls it) and use it.

- [ ] **Step 3: Keep the write window exactly as it is**

`perdiem-window.ts`'s `perDiemWritable` allow-list is **not** touched, and the new `alsoAffected` rows go through it like every other row. A request past accounting keeps its figure and still gets its `perdiem_recalculated` row with `after == before` and `locked: true`. Widening which rows are *considered* must not widen which rows are *written* — that is this package's Global Constraint and the whole reason the allow-list exists.

- [ ] **Step 4: Extend the existing tests**

`perdiem-recompute.test.ts` runs with **no database** — its preamble records that no fixture row carries an `EmployeeId` and no fixture `RequestId` reaches 900000, so neither the HR read nor the UAT per-diem read is ever issued. **Preserve that property**: the new `loadRequesterTrips` call must be stubbed the way the existing reads are, and no fixture may grow an `EmployeeId` to make it work.

Add these cases, in the file's existing fixture shape:

```typescript
test("cancelling a trip gives its boundary day back to a trip in ANOTHER group", () => {
  // Group 1: 20-24. Group 2 (filed separately): 24-26, which dropped the 24th
  // as a continuation. Cancel group 1 and the 24th is nobody else's — group 2
  // is owed it back, and before 2026-09-21 nothing recomputed group 2 at all.
  // Assert the OUTSIDE trip's PerDiemDays rises by one.
});

test("a trip departing BEFORE the cancelled one is not rewritten", () => {
  // Its chain position cannot have moved, so it must not appear in the update
  // set — every extra row is a row inside the cancelling transaction's lock.
});

test("an outside trip past accounting is reported but not rewritten", () => {
  // perDiemWritable's allow-list still governs: after == before, locked: true,
  // and the activity row is still written so the gap is visible not silent.
});
```

Fill each body against the file's existing helpers — read two neighbouring tests first and match their shape rather than inventing a new one.

- [ ] **Step 5: Verify and commit**

`npm run typecheck`, then `npm test` in full.

```bash
git add src/lib/acc/travel-booking/perdiem-recompute.ts src/lib/acc/travel-booking/perdiem-recompute.test.ts
git commit -m "feat(ap-17): recompute every trip the cancelled one could have moved"
```

---

### Task 6: the client refuses early, and the detail page names the collision

**Files:**
- Modify: `src/features/travel-booking/hooks/useTravelBookingForm.ts`
- Modify: `src/features/travel-booking/components/TravelBookingDetail.tsx:1197`

**Interfaces:**
- Consumes: `findDateOverlap` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Find out whether the form can already see the other trips**

**Do this before writing anything**, and report the answer: does the AP-17 form already fetch the requester's other requests, or would this need a new endpoint? Search for an existing requester-scoped AP-17 list the form consumes.

- **If one exists**, use it — Step 2 as written.
- **If none exists**, do **not** invent an endpoint in this task. Report `DONE_WITH_CONCERNS`, implement Step 3 only, and say so: a new requester-scoped endpoint listing someone's trips is its own surface with its own authorization question, and it does not belong in a validator task. The server refusal from Task 4 already makes the rule real; the client check is an earliness nicety.

- [ ] **Step 2: Client-side refusal (only if Step 1 found a source)**

In `useTravelBookingForm.ts`'s validator, beside the existing date checks:

```typescript
  // The same pure rule the submit enforces — one module, two callers, so the
  // client cannot refuse something the server allows or vice versa.
  //
  // **The server check stays** and is the real one: a client-enforced
  // invariant is not one, and a resumed draft can hold dates that were free
  // when it was saved and are not now.
  const clash = findDateOverlap(
    { departDate: tab.departDate, returnDate: tab.returnDate },
    otherTrips,
  );
  if (clash) issues.push({ key: `day-${i}-overlap`, label: clash.message });
```

Match `issues`' real element shape — read the surrounding pushes and use their field names, not mine. The `key` must carry a `data-field` that `focusFirstMissing` can reach; CLAUDE.md records that its ternary chain used to send unmatched keys to the vehicle picker, so a key with no matching `data-field` scrolls to the wrong place.

- [ ] **Step 3: Name the collision on the detail page**

`TravelBookingDetail.tsx:1197` currently reads:

```tsx
ต่อเนื่องจากทริปก่อนหน้า จึงไม่นับซ้ำที่นี่ (−1 วัน)
```

It states that a day was deducted and never says which day or which trip owns it, so a requester querying their figure has nothing to check. Extend it to name both, reading the values the deduction already used:

```tsx
ต่อเนื่องจาก {prevRequestNo ?? "ทริปก่อนหน้า"} (วันที่ {thaiDate(sharedDay)}) จึงไม่นับซ้ำที่นี่ (−1 วัน)
```

The predecessor's running number and the shared day both have to reach this component. If the read shape does not already carry them, add them to it — and if that turns out to span more than the detail read, report `DONE_WITH_CONCERNS` with what it would take rather than widening the task silently.

- [ ] **Step 3: Verify and commit**

`npm run typecheck`, then `npm test` in full.

```bash
git add src/features/travel-booking/hooks/useTravelBookingForm.ts src/features/travel-booking/components/TravelBookingDetail.tsx
git commit -m "feat(ap-17): say which date and which request a trip collides with"
```

---

### Task 7: CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Record the three rules**

In the AP-17 section, in that section's house style — dense prose, bold lead-ins, the reason rather than only the decision:

- **No accommodation booked, no per diem**, and the one exception is package E's shared room. Zero days is a real answer, never null.
- **A duplicate travel date refuses the submit**, with exactly one allowed overlap: a previous return meeting a new depart. Name the four cases from the spec's table, and that the refusal names the date and the running number.
- **The continuation chain spans a person's calendar, not a booking group**, ordered by depart date because `SortOrder` means nothing between groups — and that `recomputeGroupPerDiem` widened with it, while `perdiem-window.ts`'s write allow-list did not.
- **Nothing backfills.** Requests already submitted keep their figures.

- [ ] **Step 2: Verify and commit**

`npm run typecheck`, `npm test` in full.

```bash
git add CLAUDE.md
git commit -m "docs: record AP-17's three per-diem rule changes"
```

---

## Deployment notes

- **No migration and no schema change.** Every column this package reads already exists.
- **Nothing backfills.** The wider chain and the no-room rule apply to future submits and future transitions only; requests already submitted keep the figures they were given. That matches the 2026-08-27 recompute work's own choice.
- **The refusal is new behaviour a requester will meet.** A person who has legitimately been filing overlapping requests will now be stopped. That is the intent, but it is worth telling the AP-17 desk before it deploys.
