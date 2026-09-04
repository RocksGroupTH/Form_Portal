/* eslint-disable no-console */
/**
 * Pure-logic assertion test for AP-17 per-diem engine + end-of-month payout.
 * No DB, no env. Run: npx tsx scripts/checks/ap17-logic.ts
 */
import assert from "node:assert";
import { computePerDiem, rateForDay } from "@/lib/acc/travel-booking/perdiem";
import { payoutDateFor } from "@/lib/acc/travel-booking/payout-rule";

const log = [
  { effectiveDate: "2026-01-01", amount: 500 },
  { effectiveDate: "2026-01-03", amount: 1000 },
];

// normal 20-day
assert.strictEqual(
  computePerDiem("2026-02-01", "2026-02-20", false, [{ effectiveDate: "2020-01-01", amount: 100 }]).days,
  20
);

// chain with rate change
const r1 = computePerDiem("2026-01-01", "2026-01-03", false, log); // 3 days: 500+500+1000
assert.strictEqual(r1.days, 3);
assert.strictEqual(r1.total, 2000);

const r2 = computePerDiem("2026-01-03", "2026-01-05", true, log); // continuation: 2 days 01/04,01/05 @1000
assert.strictEqual(r2.days, 2);
assert.strictEqual(r2.total, 2000);

assert.strictEqual(rateForDay("2026-01-02", log), 500);
assert.strictEqual(rateForDay("2026-01-03", log), 1000);

// payout: the determining date is the LATER of approval and travel return.
// Domestic splits at the 20th; foreign pays twice a month. The exhaustive
// coverage is payout-rule.test.ts — these two lines are the smoke test.
assert.strictEqual(payoutDateFor("domestic", "2026-07-20", "2026-07-20"), "2026-07-31");
assert.strictEqual(payoutDateFor("domestic", "2026-07-21", "2026-07-20"), "2026-08-31");
assert.strictEqual(payoutDateFor("foreign", "2026-07-21", "2026-07-20"), "2026-08-10");

console.log("ap17-logic OK");
