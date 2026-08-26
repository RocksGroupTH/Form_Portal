import { test } from "node:test";
import assert from "node:assert/strict";
// Relative, not "@/": tsx does not resolve the alias for a bare test run.
import {
  TH_DAYS,
  TH_MONTHS,
  toYmd,
  parseYmd,
  buildMonthCells,
  toBuddhistYear,
  formatThaiYmd,
  addMonths,
} from "./thai-calendar";

test("a ymd round-trips through both directions", () => {
  assert.equal(toYmd(2026, 7, 25), "2026-08-25");
  assert.deepEqual(parseYmd("2026-08-25"), { year: 2026, month0: 7, day: 25 });
});

test("single-digit months and days are zero-padded", () => {
  // "2026-1-5" sorts and compares differently from "2026-01-05", and these
  // strings are compared as strings against minDate/maxDate.
  assert.equal(toYmd(2026, 0, 5), "2026-01-05");
});

test("a malformed ymd is null rather than a partly-filled object", () => {
  for (const bad of ["", "not-a-date", "2026-13-01", "2026-00-05", "2026-08-00", "2026-08"]) {
    assert.equal(parseYmd(bad), null, bad);
  }
});

test("a day that does not exist in that month is refused", () => {
  // 2026 is not a leap year. Accepting this would render a cell nobody can see
  // and hand back a date the server would store as 1 March.
  assert.equal(parseYmd("2026-02-29"), null);
  assert.notEqual(parseYmd("2024-02-29"), null);
});

test("the month grid pads to the first weekday and holds every day", () => {
  // August 2026 starts on a Saturday (index 6) and has 31 days.
  const cells = buildMonthCells(2026, 7);
  assert.deepEqual(cells.slice(0, 6), [null, null, null, null, null, null]);
  assert.equal(cells[6], 1);
  assert.equal(cells.filter((c) => c !== null).length, 31);
  assert.equal(cells[cells.length - 1], 31);
});

test("February gains a day in a leap year", () => {
  assert.equal(buildMonthCells(2024, 1).filter((c) => c !== null).length, 29);
  assert.equal(buildMonthCells(2026, 1).filter((c) => c !== null).length, 28);
});

test("a month starting on Sunday has no leading pad", () => {
  // 1 Feb 2026 is a Sunday.
  assert.equal(buildMonthCells(2026, 1)[0], 1);
});

test("the year shown is Buddhist, the year stored is Gregorian", () => {
  assert.equal(toBuddhistYear(2026), 2569);
  assert.equal(formatThaiYmd("2026-08-25"), "25 สิงหาคม 2569");
});

test("an unparseable date formats to the empty string, not to NaN", () => {
  assert.equal(formatThaiYmd(""), "");
  assert.equal(formatThaiYmd("2026-02-29"), "");
});

test("stepping past either end of the year carries into it", () => {
  assert.deepEqual(addMonths(2026, 11, 1), { year: 2027, month0: 0 });
  assert.deepEqual(addMonths(2026, 0, -1), { year: 2025, month0: 11 });
  assert.deepEqual(addMonths(2026, 5, 1), { year: 2026, month0: 6 });
});

test("the day and month labels are Thai and complete", () => {
  assert.equal(TH_DAYS.length, 7);
  assert.equal(TH_MONTHS.length, 12);
  assert.equal(TH_DAYS[0], "อา");
  assert.equal(TH_MONTHS[7], "สิงหาคม");
});
