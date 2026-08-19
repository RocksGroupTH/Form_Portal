import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentRoundsInMonth, defaultPaymentRound } from "./payment-calendar";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("the rounds are the 1st and 3rd Friday, whatever weekday the month opens on", () => {
  // Aug 2026 opens on a Saturday: Fridays are 7, 14, 21, 28.
  assert.deepEqual(paymentRoundsInMonth(2026, 7).map(ymd), ["2026-08-07", "2026-08-21"]);
  // May 2026 opens on a Friday: Fridays are 1, 8, 15, 22, 29.
  assert.deepEqual(paymentRoundsInMonth(2026, 4).map(ymd), ["2026-05-01", "2026-05-15"]);
});

test("the 2nd and 4th Fridays are not rounds — that is AP-1's calendar, not this one", () => {
  const rounds = paymentRoundsInMonth(2026, 7).map(ymd);
  assert.equal(rounds.includes("2026-08-14"), false);
  assert.equal(rounds.includes("2026-08-28"), false);
});

test("a check before Monday noon can still make that week's round", () => {
  const rounds = [new Date(2026, 7, 7), new Date(2026, 7, 21)];
  // Monday 3 Aug 2026, 11:00 — the Friday of the same week is the 7th.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 11, 0), rounds)!), "2026-08-07");
});

test("a check after Monday noon falls to the next round", () => {
  const rounds = [new Date(2026, 7, 7), new Date(2026, 7, 21)];
  // Monday 3 Aug 2026, 13:00 — past the cut-off, so the 7th is gone.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 13, 0), rounds)!), "2026-08-21");
  // Wednesday is likewise past that Monday's noon.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 5, 9, 0), rounds)!), "2026-08-21");
});

test("exactly Monday noon still counts as in time", () => {
  const rounds = [new Date(2026, 7, 7), new Date(2026, 7, 21)];
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 12, 0), rounds)!), "2026-08-07");
});

test("no round left means no default rather than a wrong one", () => {
  assert.equal(defaultPaymentRound(new Date(2026, 7, 25), [new Date(2026, 7, 7)]), null);
});
