import { test } from "node:test";
import assert from "node:assert/strict";
import { earliestTravelDate, isTravelDateTooSoon } from "./earliest-travel-date";

test("the earliest bookable day is tomorrow, not today", () => {
  assert.equal(earliestTravelDate(new Date(2026, 7, 27)), "2026-08-28");
});

test("it rolls over the end of a month", () => {
  assert.equal(earliestTravelDate(new Date(2026, 7, 31)), "2026-09-01");
});

test("it rolls over the end of a year", () => {
  assert.equal(earliestTravelDate(new Date(2026, 11, 31)), "2027-01-01");
});

/** Late in the evening is still today — the boundary is the calendar, not 24 hours. */
test("the hour of day does not move the boundary", () => {
  assert.equal(earliestTravelDate(new Date(2026, 7, 27, 23, 59)), "2026-08-28");
  assert.equal(earliestTravelDate(new Date(2026, 7, 27, 0, 1)), "2026-08-28");
});

test("today and the past are too soon; tomorrow onward is not", () => {
  const now = new Date(2026, 7, 27);
  assert.equal(isTravelDateTooSoon("2026-08-26", now), true);
  assert.equal(isTravelDateTooSoon("2026-08-27", now), true);
  assert.equal(isTravelDateTooSoon("2026-08-28", now), false);
  assert.equal(isTravelDateTooSoon("2026-09-01", now), false);
});

/**
 * A blank date is somebody part-way through the form, not a rule violation —
 * the required-field check is what speaks to that.
 */
test("a missing date is not reported as too soon", () => {
  assert.equal(isTravelDateTooSoon(null, new Date(2026, 7, 27)), false);
  assert.equal(isTravelDateTooSoon("", new Date(2026, 7, 27)), false);
});
