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
  // Ordered by depart date: 1 (04), 2 (05), 3 (06). Trip 3's nearest live
  // predecessor is 2, which returns on the 5th — so 3 departing on the 6th
  // continues nothing. Trip 1 DOES return on the 6th, so a chain that
  // considered *any* predecessor would wrongly credit a continuation here.
  //
  // Note the trips have to overlap for this rule to bite at all under
  // chronological ordering, and `date-overlap.ts` now refuses overlapping
  // dates at submit. The rule stays because `continuationFlags` also runs over
  // rows filed before that refusal existed.
  const flags = continuationFlags([
    trip(1, 0, "2026-08-04", "2026-08-06"),
    trip(2, 1, "2026-08-05", "2026-08-05"),
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
