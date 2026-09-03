import { test } from "node:test";
import assert from "node:assert/strict";
import { ratedSegments, tripRateLead, unratedNote } from "./trip-rate-lead";

/**
 * The line beside the history button: what this trip is charged per day.
 *
 * **A null-dated segment is the ABSENCE of a rate, not a ฿0 one.** Every
 * configured amount is greater than zero by the table's CHECK, restated in
 * `perdiem-country.ts`, so days no rate reaches must not count toward "how many
 * rates does this trip fall under", must not set the low end of a range, and
 * must not raise a history button on a trip that really falls under one rate.
 * They get their own sentence instead.
 */

test("one rate reads as itself, with the day it started", () => {
  assert.equal(
    tripRateLead([{ effectiveDate: "2026-09-01", amount: 1000, days: 3 }]),
    "฿1,000.00 ต่อวัน (มีผล 01/09/2026)",
  );
});

test("several rates say so, with the range", () => {
  assert.equal(
    tripRateLead([
      { effectiveDate: "2026-09-01", amount: 1000, days: 1 },
      { effectiveDate: "2026-09-04", amount: 1500, days: 2 },
    ]),
    "฿1,000.00 – ฿1,500.00 ต่อวัน (เปลี่ยนระหว่างทริป)",
  );
});

/** The range is by value, so a rate that falls still reads low to high. */
test("a falling rate still reads low to high", () => {
  assert.equal(
    tripRateLead([
      { effectiveDate: "2026-09-01", amount: 1500, days: 1 },
      { effectiveDate: "2026-09-04", amount: 900, days: 2 },
    ]),
    "฿900.00 – ฿1,500.00 ต่อวัน (เปลี่ยนระหว่างทริป)",
  );
});

/**
 * The case that shipped wrong: unrated days used to join the range and the
 * count, so a trip beginning two days before its only rate read as ฿0 – ฿1,500
 * "เปลี่ยนระหว่างทริป" and raised a history button for a single rate.
 */
test("unrated days leave the range and the count", () => {
  const segs = [
    { effectiveDate: null, amount: 0, days: 2 },
    { effectiveDate: "2026-09-04", amount: 1500, days: 2 },
  ];
  assert.equal(ratedSegments(segs).length, 1);
  assert.equal(tripRateLead(segs), "฿1,500.00 ต่อวัน (มีผล 04/09/2026)");
});

test("they get their own sentence, with the day the rate starts", () => {
  assert.equal(
    unratedNote([
      { effectiveDate: null, amount: 0, days: 2 },
      { effectiveDate: "2026-09-04", amount: 1500, days: 2 },
    ]),
    "2 วันแรกยังไม่มีเรทที่มีผลครอบคลุม จึงคิดเป็น ฿0 — เรทเริ่มมีผล 04/09/2026",
  );
});

/**
 * A trip entirely before the earliest rate: no rate applies at all, so there is
 * no figure to lead with and the sentence carries the whole answer. The date is
 * named from the log, since no segment carries it.
 */
test("a trip wholly before the rate has no lead figure", () => {
  const segs = [{ effectiveDate: null, amount: 0, days: 3 }];
  assert.equal(ratedSegments(segs).length, 0);
  assert.equal(tripRateLead(segs), null);
  assert.equal(
    unratedNote(segs, [{ effectiveDate: "2026-12-01", amount: 1500 }]),
    "ทุกวันของทริปนี้ยังไม่มีเรทที่มีผลครอบคลุม จึงคิดเป็น ฿0 — เรทเริ่มมีผล 01/12/2026",
  );
});

/** With no rate configured at all there is no start date to name. */
test("no configured rate at all names no date", () => {
  assert.equal(
    unratedNote([{ effectiveDate: null, amount: 0, days: 3 }], []),
    "ทุกวันของทริปนี้ยังไม่มีเรทที่มีผลครอบคลุม จึงคิดเป็น ฿0",
  );
});

test("a fully rated trip has no unrated sentence", () => {
  assert.equal(unratedNote([{ effectiveDate: "2026-09-01", amount: 1000, days: 3 }]), null);
  assert.equal(unratedNote([]), null);
  assert.equal(tripRateLead([]), null);
});
