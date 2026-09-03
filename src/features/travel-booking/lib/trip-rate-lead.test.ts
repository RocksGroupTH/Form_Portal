import { test } from "node:test";
import assert from "node:assert/strict";
import { tripRateLead } from "./trip-rate-lead";

/**
 * The one line beside the history button: what the trip is charged, at a glance.
 *
 * With a single rate it is the whole answer and there is no button. With more it
 * has to say that a change lands inside the trip without listing every leg —
 * that is what the button is for.
 */

test("one rate reads as itself", () => {
  assert.equal(
    tripRateLead([{ effectiveDate: "2026-09-01", amount: 1000, days: 3 }]),
    "฿1,000.00 ต่อวัน",
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

/** The range is by VALUE, so a rate that falls reads low-to-high all the same. */
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
 * Days no rate reaches are ฿0 and part of the range, not hidden: they are what
 * makes a total look wrong, so the line must not read as though the trip were
 * paid throughout.
 */
test("unrated days are in the range as zero", () => {
  assert.equal(
    tripRateLead([
      { effectiveDate: null, amount: 0, days: 2 },
      { effectiveDate: "2026-09-01", amount: 1000, days: 2 },
    ]),
    "฿0.00 – ฿1,000.00 ต่อวัน (เปลี่ยนระหว่างทริป)",
  );
});

/** A trip paid nothing throughout says the figure rather than a range. */
test("a single unrated segment reads as zero", () => {
  assert.equal(tripRateLead([{ effectiveDate: null, amount: 0, days: 3 }]), "฿0.00 ต่อวัน");
});

test("nothing to describe is a dash", () => {
  assert.equal(tripRateLead([]), "—");
});
