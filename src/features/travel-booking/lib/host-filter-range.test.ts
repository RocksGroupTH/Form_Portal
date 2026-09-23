import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultFiledOnFilterRange,
  defaultHostFilterRange,
  HOST_FILTER_DEFAULT_DAYS,
} from "./host-filter-range";

/** Local constructor throughout — `new Date("...")` is UTC for a bare date string. */
const at = (y: number, m1: number, d: number, h = 12) => new Date(y, m1 - 1, d, h);

test("the window opens on today, not tomorrow", () => {
  assert.equal(
    defaultHostFilterRange(at(2026, 9, 22)).from,
    "2026-09-22",
    "a colleague's trip that departed this morning and returns on Friday is still a room worth " +
      "sharing — `loadHostableRequests` matches on overlap, so starting at tomorrow would hide it",
  );
});

test("the window runs thirty days out", () => {
  assert.equal(defaultHostFilterRange(at(2026, 9, 22)).to, "2026-10-22");
  assert.equal(HOST_FILTER_DEFAULT_DAYS, 30);
});

test("it rolls the month", () => {
  assert.deepEqual(defaultHostFilterRange(at(2026, 1, 20)), {
    from: "2026-01-20",
    to: "2026-02-19",
  });
});

test("it rolls the year", () => {
  assert.deepEqual(defaultHostFilterRange(at(2026, 12, 20)), {
    from: "2026-12-20",
    to: "2027-01-19",
  });
});

test("February in a leap year is counted, not assumed", () => {
  // 2028-02-20 + 30 = 2028-03-21, because February has 29 days that year.
  assert.equal(defaultHostFilterRange(at(2028, 2, 20)).to, "2028-03-21");
  // 2026 is not a leap year: 2026-02-20 + 30 = 2026-03-22.
  assert.equal(defaultHostFilterRange(at(2026, 2, 20)).to, "2026-03-22");
});

/**
 * The house rule for every date in this application: Thai wall clock, local
 * getters. `toISOString()` at UTC+7 names YESTERDAY for everything after 17:00,
 * so the boundary hours are what this pins.
 */
test("late and early on the same day answer the same window", () => {
  const early = defaultHostFilterRange(at(2026, 9, 22, 0));
  const late = defaultHostFilterRange(at(2026, 9, 22, 23));
  assert.deepEqual(early, late);
  assert.equal(early.from, "2026-09-22");
});

test("single-digit months and days are zero-padded", () => {
  assert.deepEqual(defaultHostFilterRange(at(2026, 3, 5)), {
    from: "2026-03-05",
    to: "2026-04-04",
  });
});

/* ── defaultFiledOnFilterRange — the SAME range, after two corrections ── */

test("the filed-on window STARTS today and reaches forward", () => {
  // The user's own worked example, 2026-09-23: "วันนี้เป็นวันที่ 23 ต้องเป็น
  // 23 Sep 2026 - 23 Oct 2026". Pinned as literal strings rather than derived,
  // so the assertion cannot follow the implementation if somebody flips the
  // direction back.
  assert.deepEqual(defaultFiledOnFilterRange(at(2026, 9, 23)), {
    from: "2026-09-23",
    to: "2026-10-23",
  });
});

test("it is the same range as the travel window, not the same span mirrored", () => {
  // This is the correction itself. `today − 30 … today` also spans
  // HOST_FILTER_DEFAULT_DAYS, so a span assertion passes on both readings and
  // pins neither — only comparing the two windows can tell them apart.
  for (const now of [at(2026, 9, 23), at(2026, 3, 5), at(2026, 12, 20)]) {
    assert.deepEqual(defaultFiledOnFilterRange(now), defaultHostFilterRange(now));
  }
  assert.equal(
    defaultFiledOnFilterRange(at(2026, 9, 23)).from,
    "2026-09-23",
    "a backwards window would still equal itself — the from date is what says which way it runs",
  );
});

test("it rolls forward over a month boundary", () => {
  assert.equal(defaultFiledOnFilterRange(at(2026, 3, 5)).to, "2026-04-04");
});

test("it rolls forward over a year boundary", () => {
  const r = defaultFiledOnFilterRange(at(2026, 12, 20));
  assert.equal(r.from, "2026-12-20");
  assert.equal(r.to, "2027-01-19");
});

test("late evening still starts today, which toISOString would not at UTC+7", () => {
  assert.equal(defaultFiledOnFilterRange(at(2026, 9, 23, 23)).from, "2026-09-23");
});
