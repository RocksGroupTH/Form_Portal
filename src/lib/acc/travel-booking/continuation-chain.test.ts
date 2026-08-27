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
