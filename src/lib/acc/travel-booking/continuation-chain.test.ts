import { test } from "node:test";
import assert from "node:assert/strict";
import { continuationFlags, continuationPredecessors, type ChainTrip } from "./continuation-chain";

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

/**
 * `continuationPredecessors` — added 2026-09-22 for I1, to name a trip's
 * predecessor by identity rather than collapse it straight to a boolean.
 * `continuationFlags` above is now a thin wrapper over this, so every case
 * above already exercises the shared walk; these cases are specifically about
 * the IDENTITY this exposes that the boolean throws away.
 */

test("continuationPredecessors names the touching predecessor's identity", () => {
  const preds = continuationPredecessors([
    trip(1, 0, "2026-08-04", "2026-08-06"),
    trip(2, 1, "2026-08-06", "2026-08-06"),
  ]);
  assert.equal(preds.get(1), null, "the first trip has no predecessor");
  assert.equal(preds.get(2)?.requestId, 1);
});

test("continuationFlags derives false from continuationPredecessors exactly when the identity is there but does not touch", () => {
  // 2's nearest live predecessor is 1 (by adjacency), but 1 returns on the 5th
  // and 2 departs on the 6th — adjacent, not touching. The identity is still
  // reported; only the boolean is false.
  const trips: ChainTrip[] = [
    trip(1, 0, "2026-08-04", "2026-08-05"),
    trip(2, 1, "2026-08-06", "2026-08-08"),
  ];
  const preds = continuationPredecessors(trips);
  assert.equal(preds.get(2)?.requestId, 1, "adjacency alone still names an identity");
  assert.equal(continuationFlags(trips).get(2), false, "but it does not touch, so the flag is false");
});

test("continuationPredecessors skips a dead trip to the nearest live one, by identity", () => {
  const preds = continuationPredecessors([
    trip(1, 0, "2026-08-01", "2026-08-02"),
    trip(2, 1, "2026-08-04", "2026-08-06", false),
    trip(3, 2, "2026-08-06", "2026-08-08"),
  ]);
  assert.equal(preds.get(3)?.requestId, 1, "the dead trip 2 must not be named as 3's predecessor");
});

test("continuationPredecessors reports null for a trip with no depart date, but a live undated trip can still be named as ANOTHER trip's predecessor by adjacency", () => {
  const preds = continuationPredecessors([
    { requestId: 1, sortOrder: 0, departDate: null, returnDate: "2026-08-06", alive: true },
    { requestId: 2, sortOrder: 1, departDate: "2026-08-07", returnDate: "2026-08-09", alive: true },
  ]);
  assert.equal(preds.get(1), null, "a trip with no depart date has no predecessor of its own");
  // Sorted with the undated trip first (`ad ?? ""` sorts it to the front), so
  // it IS eligible to stand as trip 2's predecessor by adjacency — matching
  // the pre-existing behaviour this refactor must not change (see the walk's
  // own comment). It just never satisfies the touching check, since its
  // returnDate ("2026-08-06") happens not to equal 2's departDate here.
  assert.equal(preds.get(2)?.requestId, 1);
});

test("continuationPredecessors orders by depart date across different SortOrder groups, same as continuationFlags", () => {
  const preds = continuationPredecessors([
    { requestId: 10, sortOrder: 0, departDate: "2026-09-20", returnDate: "2026-09-24", alive: true },
    { requestId: 20, sortOrder: 0, departDate: "2026-09-24", returnDate: "2026-09-26", alive: true },
  ]);
  assert.equal(preds.get(10), null);
  assert.equal(preds.get(20)?.requestId, 10);
});
