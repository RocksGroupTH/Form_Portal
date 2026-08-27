import { test } from "node:test";
import assert from "node:assert/strict";
import { lockedTravelDates } from "./date-locks";

const r = (departDate: string | null, returnDate: string | null) => ({ departDate, returnDate });

/**
 * A day holds **two half-slots**. A trip's departure takes one and its return
 * takes one, so two trips can meet on a handover day — one arriving back, one
 * setting off. Every day strictly between them is taken whole.
 *
 * The rule this replaces disabled the interiors of other trips and left every
 * endpoint open for ever, so a third and fourth trip could all claim the same
 * day as a handover, which is not a day anybody can work.
 */

test("a trip's interior days are taken whole", () => {
  assert.deepEqual(lockedTravelDates([r("2026-08-04", "2026-08-06")]), ["2026-08-05"]);
});

test("an endpoint is still free for one more trip to meet on", () => {
  const locked = lockedTravelDates([r("2026-08-04", "2026-08-06")]);
  assert.equal(locked.indexOf("2026-08-06"), -1);
  assert.equal(locked.indexOf("2026-08-04"), -1);
});

test("a day two trips already meet on is full", () => {
  // Trip 1 returns on the 6th, trip 2 departs on the 6th — both halves gone.
  const locked = lockedTravelDates([
    r("2026-08-04", "2026-08-06"),
    r("2026-08-06", "2026-08-08"),
  ]);
  assert.ok(locked.indexOf("2026-08-06") !== -1, "the 6th should be full");
  assert.ok(locked.indexOf("2026-08-05") !== -1, "trip 1's interior");
  assert.ok(locked.indexOf("2026-08-07") !== -1, "trip 2's interior");
  // The outer endpoints are each still half-free.
  assert.equal(locked.indexOf("2026-08-04"), -1);
  assert.equal(locked.indexOf("2026-08-08"), -1);
});

test("a single-day trip takes both halves of its day", () => {
  assert.deepEqual(lockedTravelDates([r("2026-08-06", "2026-08-06")]), ["2026-08-06"]);
});

test("an incomplete range contributes nothing", () => {
  assert.deepEqual(lockedTravelDates([r("2026-08-04", null), r(null, null)]), []);
});

test("a reversed range is ignored rather than trusted", () => {
  assert.deepEqual(lockedTravelDates([r("2026-08-06", "2026-08-04")]), []);
});

test("the result has no duplicates", () => {
  const locked = lockedTravelDates([
    r("2026-08-04", "2026-08-08"),
    r("2026-08-04", "2026-08-08"),
  ]);
  assert.equal(new Set(locked).size, locked.length);
});
