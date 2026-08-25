import { test } from "node:test";
import assert from "node:assert/strict";
import { describeExpiry } from "./expiry";

/** Local midnight, the way the app builds dates everywhere else. */
const TODAY = new Date(2026, 7, 25); // 25 Aug 2026

test("no date is not a warning — it is a state of its own", () => {
  assert.deepEqual(describeExpiry(null, TODAY), { tone: "none", daysLeft: null });
  assert.deepEqual(describeExpiry(undefined, TODAY), { tone: "none", daysLeft: null });
  assert.deepEqual(describeExpiry("", TODAY), { tone: "none", daysLeft: null });
});

test("more than a month away is quiet", () => {
  // 31 days out.
  assert.deepEqual(describeExpiry("2026-09-25", TODAY), { tone: "ok", daysLeft: 31 });
});

test("a month or less turns yellow", () => {
  assert.deepEqual(describeExpiry("2026-09-24", TODAY), { tone: "warn", daysLeft: 30 });
  assert.deepEqual(describeExpiry("2026-09-02", TODAY), { tone: "warn", daysLeft: 8 });
});

test("a week or less turns red", () => {
  assert.deepEqual(describeExpiry("2026-09-01", TODAY), { tone: "danger", daysLeft: 7 });
  assert.deepEqual(describeExpiry("2026-08-26", TODAY), { tone: "danger", daysLeft: 1 });
});

test("expiring today is red, not expired", () => {
  // Still usable for the rest of the day — and nothing blocks on it anyway.
  assert.deepEqual(describeExpiry("2026-08-25", TODAY), { tone: "danger", daysLeft: 0 });
});

test("a date already past reports how long ago", () => {
  assert.deepEqual(describeExpiry("2026-08-24", TODAY), { tone: "expired", daysLeft: -1 });
  assert.deepEqual(describeExpiry("2026-07-25", TODAY), { tone: "expired", daysLeft: -31 });
});

test("the time of day on `today` does not shift the count", () => {
  // Both ends are compared at local midnight, so an afternoon check and a
  // morning check of the same key agree.
  const morning = new Date(2026, 7, 25, 6, 30);
  const night = new Date(2026, 7, 25, 23, 59);
  assert.deepEqual(describeExpiry("2026-09-01", morning), { tone: "danger", daysLeft: 7 });
  assert.deepEqual(describeExpiry("2026-09-01", night), { tone: "danger", daysLeft: 7 });
});

test("counting across a month and a year boundary is plain arithmetic", () => {
  // 25 Dec 2026 → 1 Jan 2027 is seven days, so it is red like any other seven.
  assert.deepEqual(describeExpiry("2027-01-01", new Date(2026, 11, 25)), {
    tone: "danger",
    daysLeft: 7,
  });
});

test("a value that is not a date is treated as no date, never as expired", () => {
  // Reading garbage as "expired" would paint a working key red.
  assert.deepEqual(describeExpiry("not-a-date", TODAY), { tone: "none", daysLeft: null });
  assert.deepEqual(describeExpiry("2026-13-45", TODAY), { tone: "none", daysLeft: null });
});
