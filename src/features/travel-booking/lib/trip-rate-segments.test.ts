import { test } from "node:test";
import assert from "node:assert/strict";
import { tripRateSegments } from "./trip-rate-segments";

/**
 * Which dated rates a chosen trip actually falls under, and for how many days
 * each.
 *
 * **Not `computePerDiem`'s `groups`.** That groups by the rate's AMOUNT — a
 * `Map<number, number>` keyed on the value (`perdiem.ts:75-83`) — so it answers
 * "which distinct figures, and how many days each", which is the right question
 * for a one-line breakdown and the wrong one here. Two dated rates that happen
 * to carry the same amount collapse into one entry, and no entry carries a date
 * at all, so a history listing dated changes cannot be built from it.
 */

const LOG = [
  { effectiveDate: "2026-09-01", amount: 1000 },
  { effectiveDate: "2026-09-04", amount: 1500 },
];

test("a trip inside one rate is a single segment", () => {
  const s = tripRateSegments("2026-09-01", "2026-09-03", false, LOG);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0], { effectiveDate: "2026-09-01", amount: 1000, days: 3 });
});

/** The case the history exists for: the change lands inside the trip. */
test("a trip spanning a change is two dated segments", () => {
  const s = tripRateSegments("2026-09-03", "2026-09-05", false, LOG);
  assert.deepEqual(s, [
    { effectiveDate: "2026-09-01", amount: 1000, days: 1 },
    { effectiveDate: "2026-09-04", amount: 1500, days: 2 },
  ]);
});

/**
 * **Two dated rates at the same amount are two segments, not one.** This is the
 * whole reason `groups` cannot answer here: keyed on the amount, it would report
 * a single four-day stretch and the history would show one entry for a trip that
 * genuinely crossed a dated change.
 */
test("the same amount on two dates stays two segments", () => {
  const s = tripRateSegments("2026-09-01", "2026-09-04", false, [
    { effectiveDate: "2026-09-01", amount: 1000 },
    { effectiveDate: "2026-09-03", amount: 1000 },
  ]);
  assert.deepEqual(s, [
    { effectiveDate: "2026-09-01", amount: 1000, days: 2 },
    { effectiveDate: "2026-09-03", amount: 1000, days: 2 },
  ]);
});

/**
 * Days before the earliest rate are worth **0** — `rateForDay` answers 0 when no
 * entry's date has arrived (`perdiem.ts:24-32`) — and they are their own
 * segment, dated null. Hiding them would leave a total nobody could account for.
 */
test("days before the earliest rate are a null-dated zero segment", () => {
  const s = tripRateSegments("2026-08-30", "2026-09-02", false, LOG);
  assert.deepEqual(s, [
    { effectiveDate: null, amount: 0, days: 2 },
    { effectiveDate: "2026-09-01", amount: 1000, days: 2 },
  ]);
});

test("a trip entirely before the earliest rate is one zero segment", () => {
  const s = tripRateSegments("2026-08-01", "2026-08-03", false, LOG);
  assert.deepEqual(s, [{ effectiveDate: null, amount: 0, days: 3 }]);
});

/** A continuation drops its first day, exactly as `computePerDiem` does. */
test("a continuation drops the departure day", () => {
  const s = tripRateSegments("2026-09-03", "2026-09-05", true, LOG);
  assert.deepEqual(s, [{ effectiveDate: "2026-09-04", amount: 1500, days: 2 }]);
});

test("no rates configured is a single zero segment, not an empty list", () => {
  assert.deepEqual(tripRateSegments("2026-09-01", "2026-09-02", false, []), [
    { effectiveDate: null, amount: 0, days: 2 },
  ]);
});

/** Missing or reversed dates answer nothing — there is no trip to price. */
test("no usable date range is an empty list", () => {
  assert.deepEqual(tripRateSegments(null, "2026-09-02", false, LOG), []);
  assert.deepEqual(tripRateSegments("2026-09-02", null, false, LOG), []);
  assert.deepEqual(tripRateSegments("2026-09-05", "2026-09-02", false, LOG), []);
});

/** A one-day continuation counts nothing, so there is nothing to show. */
test("a continuation of a single day is empty", () => {
  assert.deepEqual(tripRateSegments("2026-09-05", "2026-09-05", true, LOG), []);
});

/**
 * The segments must add up to what the engine charges, or the card and the
 * total disagree. Same range, same log, same continuation flag.
 */
test("the segments total what computePerDiem would charge", () => {
  const s = tripRateSegments("2026-08-30", "2026-09-05", false, LOG);
  let total = 0;
  let days = 0;
  for (const seg of s) {
    total += seg.amount * seg.days;
    days += seg.days;
  }
  assert.equal(days, 7);
  assert.equal(total, 0 * 2 + 1000 * 3 + 1500 * 2);
});
