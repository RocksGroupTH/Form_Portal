import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentDateForApproval } from "./payment-cycle";

/** Two consecutive rounds, as `getPaymentDates` would hand them over. */
const ROUNDS = ["2026-09-11", "2026-09-25", "2026-10-09"];

/** Local time, because that is what the driver now hands back — see the module. */
const at = (iso: string) => new Date(iso);

test("approved before noon takes the next round", () => {
  assert.equal(paymentDateForApproval(at("2026-08-26T11:59:00"), ROUNDS), "2026-09-11");
});

test("approved at noon exactly skips a round", () => {
  assert.equal(paymentDateForApproval(at("2026-08-26T12:00:00"), ROUNDS), "2026-09-25");
});

test("approved in the afternoon skips a round", () => {
  assert.equal(paymentDateForApproval(at("2026-08-26T18:53:00"), ROUNDS), "2026-09-25");
});

/**
 * A manager approving *on* a payment Friday is approving for the round after it
 * either way — that day's batch has already been prepared.
 */
test("the approval day itself is never the round", () => {
  assert.equal(paymentDateForApproval(at("2026-09-11T09:00:00"), ROUNDS), "2026-09-25");
  assert.equal(paymentDateForApproval(at("2026-09-11T15:00:00"), ROUNDS), "2026-10-09");
});

test("no approval time, no suggestion", () => {
  assert.equal(paymentDateForApproval(null, ROUNDS), null);
  assert.equal(paymentDateForApproval(undefined, ROUNDS), null);
  assert.equal(paymentDateForApproval(new Date("nonsense"), ROUNDS), null);
});

test("an empty calendar yields nothing rather than guessing", () => {
  assert.equal(paymentDateForApproval(at("2026-08-26T09:00:00"), []), null);
});

test("running past the end of the calendar yields null, not the last round", () => {
  // Afternoon wants the *second* upcoming round; only one exists.
  assert.equal(paymentDateForApproval(at("2026-08-26T18:00:00"), ["2026-09-11"]), null);
});

test("the rounds need not arrive sorted", () => {
  assert.equal(
    paymentDateForApproval(at("2026-08-26T09:00:00"), ["2026-10-09", "2026-09-11", "2026-09-25"]),
    "2026-09-11",
  );
});
