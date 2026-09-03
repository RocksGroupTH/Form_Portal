import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPaymentRound,
  nthFridayOfMonth,
  paymentRoundsInMonth,
  weekMondayNoon,
  ymd,
} from "./payment-calendar-core";

/**
 * The Monday-noon cutoff, shared by every AP form that pays on a Friday round.
 *
 * It lived inside AP-4's calendar and AP-1 had none at all — AP-1's header copy
 * promised the rule to requesters while `getDefaultPaymentDate` simply took the
 * next 2nd/4th Friday, and `constants.ts` said so in a comment nobody acted on.
 * Moved here so the two forms differ only in WHICH Fridays they pay on.
 */

/** September 2026: Fridays fall on 4, 11, 18 and 25. */
const SEP = { y: 2026, m: 8 };

test("the nth Friday is counted from the first of the month", () => {
  assert.equal(ymd(nthFridayOfMonth(SEP.y, SEP.m, 1)), "2026-09-04");
  assert.equal(ymd(nthFridayOfMonth(SEP.y, SEP.m, 2)), "2026-09-11");
  assert.equal(ymd(nthFridayOfMonth(SEP.y, SEP.m, 4)), "2026-09-25");
});

test("a round's deadline is noon on its own week's Monday", () => {
  assert.equal(ymd(weekMondayNoon(new Date(2026, 8, 11))), "2026-09-07");
  assert.equal(weekMondayNoon(new Date(2026, 8, 11)).getHours(), 12);
  assert.equal(ymd(weekMondayNoon(new Date(2026, 8, 25))), "2026-09-21");
});

/** A Monday round is its own deadline day, not the week before. */
test("a Monday date is its own week's Monday", () => {
  assert.equal(ymd(weekMondayNoon(new Date(2026, 8, 7))), "2026-09-07");
});

/**
 * The reported case: manager approved Thu 03/09/2026 16:31 — after noon on its
 * own day, which is what the queue's label used to key on, but well before
 * Mon 07/09 noon. It belongs to Fri 11/09.
 */
test("TOF26-09046: approved Thursday afternoon still makes that week's round", () => {
  const rounds = paymentRoundsInMonth(SEP.y, SEP.m, [2, 4]);
  const chosen = defaultPaymentRound(new Date(2026, 8, 3, 16, 31), rounds);
  assert.equal(ymd(chosen as Date), "2026-09-11");
});

test("past its Monday noon, it falls to the next round", () => {
  const rounds = paymentRoundsInMonth(SEP.y, SEP.m, [2, 4]);
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 8, 7, 12, 1), rounds) as Date), "2026-09-25");
});

/** Exactly noon is still in time — the deadline is "at or before". */
test("exactly Monday noon makes the round", () => {
  const rounds = paymentRoundsInMonth(SEP.y, SEP.m, [2, 4]);
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 8, 7, 12, 0), rounds) as Date), "2026-09-11");
});

/**
 * **Each round is measured against its OWN Monday, not one shared cutoff.** A
 * check at Monday 13:00 misses that week's Friday and is then compared with the
 * next round's Monday, which is normally still well ahead.
 */
test("the next round is measured against its own Monday, not the first one's", () => {
  const rounds = paymentRoundsInMonth(SEP.y, SEP.m, [2, 4]);
  // 21/09 is the 4th Friday's Monday; noon on it is still in time for 25/09.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 8, 21, 12, 0), rounds) as Date), "2026-09-25");
  assert.equal(defaultPaymentRound(new Date(2026, 8, 21, 12, 1), rounds), null);
});

test("nothing left in the month answers null, so the caller can look further out", () => {
  assert.equal(defaultPaymentRound(new Date(2026, 8, 30), paymentRoundsInMonth(SEP.y, SEP.m, [2, 4])), null);
});

/** AP-4's rounds are the 1st and 3rd, and the same rule answers for them. */
test("the same rule serves AP-4's rounds", () => {
  const rounds = paymentRoundsInMonth(SEP.y, SEP.m, [1, 3]);
  assert.deepEqual(rounds.map(ymd), ["2026-09-04", "2026-09-18"]);
  // Mon 31/08 noon is the 04/09 round's own Monday.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 31, 12, 0), rounds) as Date), "2026-09-04");
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 31, 12, 1), rounds) as Date), "2026-09-18");
});
