import { test } from "node:test";
import assert from "node:assert/strict";
import { payoutDateForMonth, payoutMonthOptions } from "./payout-months";

test("the first option is the current month, not the next", () => {
  const opts = payoutMonthOptions(new Date(2026, 7, 27), 3);
  assert.equal(opts[0].ym, "2026-08");
  assert.equal(opts[0].date, "2026-08-31");
});

test("each option's date is that month's last day", () => {
  const opts = payoutMonthOptions(new Date(2026, 7, 1), 3);
  assert.deepEqual(opts.map((o) => o.date), ["2026-08-31", "2026-09-30", "2026-10-31"]);
});

test("February is 28 or 29 depending on the year", () => {
  assert.equal(payoutDateForMonth("2026-02"), "2026-02-28");
  assert.equal(payoutDateForMonth("2028-02"), "2028-02-29");
});

test("December rolls the year over", () => {
  const opts = payoutMonthOptions(new Date(2026, 11, 5), 2);
  assert.deepEqual(opts.map((o) => o.ym), ["2026-12", "2027-01"]);
  assert.equal(opts[1].date, "2027-01-31");
});

/** Buddhist year, matching every other date the app shows a requester. */
test("the label is Thai with a Buddhist year", () => {
  assert.equal(payoutMonthOptions(new Date(2026, 7, 1), 1)[0].label, "สิงหาคม 2569");
});

test("a malformed month yields null rather than a guessed date", () => {
  assert.equal(payoutDateForMonth("nonsense"), null);
  assert.equal(payoutDateForMonth("2026-13"), null);
  assert.equal(payoutDateForMonth("2026-00"), null);
  assert.equal(payoutDateForMonth(""), null);
});
