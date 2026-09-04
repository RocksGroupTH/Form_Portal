import { test } from "node:test";
import assert from "node:assert/strict";
import {
  payoutTripKind,
  payoutDeterminingDate,
  payoutDateFor,
  payoutDateForDetermining,
  payoutOptions,
  payoutRoundOf,
  payoutDateLabel,
} from "./payout-rule";

/**
 * The six worked cases the user specified this rule with, first and by name.
 *
 * They are the specification. If one of these goes red the rule is wrong, not
 * the test — every other assertion in this file is downstream of them.
 */

/* ── Part 1: domestic ───────────────────────────────────────────────────── */

test("Part 1 · Case 1 — approved 06/09, returns 20/09 → end of September", () => {
  assert.equal(payoutDateFor("domestic", "2026-09-06", "2026-09-20"), "2026-09-30");
});

/**
 * Case 1 vs Case 2 differ ONLY in the return date, and the answers differ by a
 * month — which is what proves the travel date has to be an input at all. The
 * old `computePayoutDate` read the approval date alone and would answer
 * 2026-09-30 for both.
 */
test("Part 1 · Case 2 — approved 06/09, returns 21/09 → end of October", () => {
  assert.equal(payoutDateFor("domestic", "2026-09-06", "2026-09-21"), "2026-10-31");
});

/**
 * And Case 3 is what proves the approval date is STILL an input: the trip
 * returns on the 20th, well inside the band, but the approval lands on the
 * 21st. Return-date-alone would answer 2026-09-30.
 */
test("Part 1 · Case 3 — approved 21/09, returns 20/09 → end of October", () => {
  assert.equal(payoutDateFor("domestic", "2026-09-21", "2026-09-20"), "2026-10-31");
});

/* ── Part 2: foreign ────────────────────────────────────────────────────── */

test("Part 2 · Case 1 — approved 06/09, returns 20/09 → end of September", () => {
  assert.equal(payoutDateFor("foreign", "2026-09-06", "2026-09-20"), "2026-09-30");
});

test("Part 2 · Case 2 — approved 06/09, returns 21/09 → 10 October", () => {
  assert.equal(payoutDateFor("foreign", "2026-09-06", "2026-09-21"), "2026-10-10");
});

test("Part 2 · Case 3 — approved 21/09, returns 20/09 → 10 October", () => {
  assert.equal(payoutDateFor("foreign", "2026-09-21", "2026-09-20"), "2026-10-10");
});

/* ── The determining date itself ────────────────────────────────────────── */

test("the determining date is the later of the two, whichever that is", () => {
  assert.equal(payoutDeterminingDate("2026-09-06", "2026-09-21"), "2026-09-21");
  assert.equal(payoutDeterminingDate("2026-09-21", "2026-09-20"), "2026-09-21");
  assert.equal(payoutDeterminingDate("2026-09-20", "2026-09-20"), "2026-09-20");
  // Across a month, where string comparison still has to agree with the calendar.
  assert.equal(payoutDeterminingDate("2026-09-30", "2026-10-01"), "2026-10-01");
  assert.equal(payoutDeterminingDate("2026-12-31", "2027-01-01"), "2027-01-01");
});

/**
 * A missing or malformed date REFUSES rather than falling back to the one that
 * is present. Falling back to the approval date would silently restore the old
 * behaviour for exactly the broken row, and the difference is a whole month.
 */
test("a missing or malformed date is a refusal, not a fallback", () => {
  assert.equal(payoutDeterminingDate(null, "2026-09-20"), null);
  assert.equal(payoutDeterminingDate("2026-09-20", null), null);
  assert.equal(payoutDeterminingDate("", "2026-09-20"), null);
  assert.equal(payoutDeterminingDate("2026-9-20", "2026-09-20"), null);
  assert.equal(payoutDateFor("domestic", "2026-09-06", null), null);
  assert.equal(payoutDateFor("foreign", null, null), null);
});

/* ── The band boundaries, every one of them ─────────────────────────────── */

test("domestic splits exactly at the 20th", () => {
  assert.equal(payoutDateForDetermining("domestic", "2026-09-01"), "2026-09-30");
  assert.equal(payoutDateForDetermining("domestic", "2026-09-20"), "2026-09-30");
  assert.equal(payoutDateForDetermining("domestic", "2026-09-21"), "2026-10-31");
  assert.equal(payoutDateForDetermining("domestic", "2026-09-30"), "2026-10-31");
});

/**
 * **Domestic has no 1..5 band.** Foreign does, and giving domestic one would
 * move real payments by a month — so the 1st through the 5th are asserted here
 * as month end, right beside the foreign test that says the opposite.
 */
test("domestic days 1-5 pay at month end, unlike foreign", () => {
  assert.equal(payoutDateForDetermining("domestic", "2026-09-03"), "2026-09-30");
  assert.equal(payoutDateForDetermining("foreign", "2026-09-03"), "2026-09-10");
});

test("foreign has three bands, and every boundary lands where it should", () => {
  // 1..5 -> the SAME month's 10th. The branch no worked case covered;
  // confirmed with the user 2026-09-04.
  assert.equal(payoutDateForDetermining("foreign", "2026-09-01"), "2026-09-10");
  assert.equal(payoutDateForDetermining("foreign", "2026-09-05"), "2026-09-10");
  // 6..20 -> month end.
  assert.equal(payoutDateForDetermining("foreign", "2026-09-06"), "2026-09-30");
  assert.equal(payoutDateForDetermining("foreign", "2026-09-20"), "2026-09-30");
  // 21..end -> the NEXT month's 10th.
  assert.equal(payoutDateForDetermining("foreign", "2026-09-21"), "2026-10-10");
  assert.equal(payoutDateForDetermining("foreign", "2026-09-30"), "2026-10-10");
});

/**
 * The foreign bands must tile the calendar with no gap and no overlap — that is
 * the property the wrap-around 21..5 band exists to give, and the reason the
 * 1..5 answer is the same month rather than the next.
 */
test("the foreign bands cover every day of a month exactly once", () => {
  const seen: Record<string, number> = {};
  for (let day = 1; day <= 30; day++) {
    const d = `2026-09-${day < 10 ? "0" + day : day}`;
    const out = payoutDateForDetermining("foreign", d) as string;
    seen[out] = (seen[out] ?? 0) + 1;
  }
  // 1-5 -> 10 Sep (5 days), 6-20 -> 30 Sep (15), 21-30 -> 10 Oct (10).
  assert.deepEqual(seen, { "2026-09-10": 5, "2026-09-30": 15, "2026-10-10": 10 });
});

/* ── Month and year arithmetic ──────────────────────────────────────────── */

test("December rolls into January of the next year, both arms", () => {
  assert.equal(payoutDateForDetermining("domestic", "2026-12-25"), "2027-01-31");
  assert.equal(payoutDateForDetermining("foreign", "2026-12-25"), "2027-01-10");
  assert.equal(payoutDateForDetermining("domestic", "2026-12-20"), "2026-12-31");
  assert.equal(payoutDateForDetermining("foreign", "2026-12-20"), "2026-12-31");
});

test("February gets its real length, leap year included", () => {
  assert.equal(payoutDateForDetermining("domestic", "2026-02-10"), "2026-02-28");
  assert.equal(payoutDateForDetermining("domestic", "2024-02-10"), "2024-02-29");
  assert.equal(payoutDateForDetermining("domestic", "2026-01-25"), "2026-02-28");
});

/* ── Which trips are foreign ────────────────────────────────────────────── */

/**
 * **Absence means Thailand.** Migration 129 added `CountryCode` with no
 * backfill, so every request filed before 2026-08-31 carries NULL — measured
 * 2026-09-04, five of seven in UAT, including both rows in the accounting queue,
 * which are Bangkok trips. Reading absence as "unknown" would make the entire
 * back catalogue unpayable.
 */
test("a missing country is domestic, not unknown", () => {
  assert.equal(payoutTripKind(null), "domestic");
  assert.equal(payoutTripKind(undefined), "domestic");
  assert.equal(payoutTripKind(""), "domestic");
  assert.equal(payoutTripKind("   "), "domestic");
});

/** `CHAR(2)` pads on the way out, and nothing guarantees the case. */
test("TH is domestic however it is stored", () => {
  assert.equal(payoutTripKind("TH"), "domestic");
  assert.equal(payoutTripKind("th"), "domestic");
  assert.equal(payoutTripKind("TH "), "domestic");
  assert.equal(payoutTripKind(" th "), "domestic");
});

test("any other country is foreign", () => {
  for (const c of ["MY", "GB", "SG", "JP", "my"]) {
    assert.equal(payoutTripKind(c), "foreign", c);
  }
});

/* ── The options accounting picks from ──────────────────────────────────── */

test("domestic options are month ends only", () => {
  const o = payoutOptions("domestic", "2026-09-04", 3);
  assert.deepEqual(o.map((x) => x.date), ["2026-09-30", "2026-10-31", "2026-11-30"]);
  assert.ok(o.every((x) => x.round === "month-end"));
});

/** Foreign pays twice a month, so its list has two entries per month. */
test("foreign options alternate the 10th and the month end", () => {
  const o = payoutOptions("foreign", "2026-09-04", 3);
  assert.deepEqual(o.map((x) => x.date), [
    "2026-09-10", "2026-09-30",
    "2026-10-10", "2026-10-31",
    "2026-11-10", "2026-11-30",
  ]);
  assert.deepEqual(o.map((x) => x.round), [
    "tenth", "month-end", "tenth", "month-end", "tenth", "month-end",
  ]);
});

test("options never start before the day asked from", () => {
  // From the 15th, this month's 10th has gone.
  const o = payoutOptions("foreign", "2026-09-15", 2);
  assert.deepEqual(o.map((x) => x.date), ["2026-09-30", "2026-10-10", "2026-10-31"]);
});

/**
 * The row whose own scheduled date has already gone past. Without
 * `alwaysInclude` the list cannot contain the value the row holds, so the
 * `<select>` renders blank and the server — which validates by membership of
 * this same list — refuses the date it is already storing.
 */
test("a past date the row already holds is still offered, and stays in order", () => {
  const o = payoutOptions("domestic", "2026-09-15", 2, "2026-08-31");
  assert.deepEqual(o.map((x) => x.date), ["2026-08-31", "2026-09-30", "2026-10-31"]);
});

test("alwaysInclude never duplicates a date already in the list", () => {
  const o = payoutOptions("domestic", "2026-09-15", 2, "2026-09-30");
  assert.deepEqual(o.map((x) => x.date), ["2026-09-30", "2026-10-31"]);
});

test("a malformed from-date yields no options rather than guessing", () => {
  assert.deepEqual(payoutOptions("domestic", "2026-9-15", 3), []);
  assert.deepEqual(payoutOptions("foreign", "", 3), []);
});

/* ── Display ────────────────────────────────────────────────────────────── */

test("the round is read off the day", () => {
  assert.equal(payoutRoundOf("2026-10-10"), "tenth");
  assert.equal(payoutRoundOf("2026-10-31"), "month-end");
  assert.equal(payoutRoundOf("2026-09-30"), "month-end");
});

test("labels are Buddhist-year Thai", () => {
  assert.equal(payoutDateLabel("2026-10-10"), "10 ตุลาคม 2569");
  assert.equal(payoutDateLabel("2026-12-31"), "31 ธันวาคม 2569");
  assert.equal(payoutDateLabel(null), null);
  assert.equal(payoutDateLabel("2026-13-01"), null);
});

/**
 * Every option's label must be renderable — a null slipping through would print
 * "null" in the picker, and `payoutOptions` casts.
 */
test("every generated option carries a real label", () => {
  for (const kind of ["domestic", "foreign"] as const) {
    for (const o of payoutOptions(kind, "2026-11-04", 4)) {
      assert.equal(typeof o.label, "string");
      assert.ok(o.label.length > 0, `${kind} ${o.date}`);
      assert.equal(o.label, payoutDateLabel(o.date));
    }
  }
});
