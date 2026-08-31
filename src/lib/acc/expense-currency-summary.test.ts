import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseLineCurrency } from "./expense-currency-summary";

/**
 * A header that sums several lines may print a foreign figure ONLY when every
 * line under it is that same foreign currency. Baht is summable at every level
 * because `AccTravelExpenseItem.Amount` is always baht; a foreign figure is not,
 * and a header pairing one line's currency with an N-line total reads as an
 * exchange rate that was never used.
 *
 * The claim-level design bounds this: `lineCurrencyOptions` offers the trip
 * country's currency and THB and nothing else, so the only mixed case is
 * FOREIGN + THB. That is exactly the case this refuses to summarise.
 */

const L = (amount: number, foreignAmount: number | null, currency: string | null) => ({
  amount,
  foreignAmount,
  currency,
});

test("every line the same foreign currency — the figures sum", () => {
  const s = summariseLineCurrency([
    L(163.71, 20, "MYR"),
    L(81.86, 10, "MYR"),
    L(81.86, 10, "MYR"),
  ]);
  assert.equal(s.currency, "MYR");
  assert.equal(s.foreignTotal, 40);
});

test("a single foreign line summarises as itself", () => {
  const s = summariseLineCurrency([L(163.71, 20, "MYR")]);
  assert.equal(s.currency, "MYR");
  assert.equal(s.foreignTotal, 20);
});

/** The case the whole per-line design exists for. */
test("THE REFUSAL: one foreign line beside a baht line summarises to nothing", () => {
  const s = summariseLineCurrency([L(163.71, 20, "MYR"), L(100, null, "THB")]);
  assert.equal(s.currency, null);
  assert.equal(s.foreignTotal, null);
});

test("two different foreign currencies summarise to nothing", () => {
  const s = summariseLineCurrency([L(163.71, 20, "MYR"), L(35, 1, "USD")]);
  assert.equal(s.currency, null);
  assert.equal(s.foreignTotal, null);
});

test("an all-baht group has no foreign summary, and that is not a failure", () => {
  for (const lines of [
    [L(100, null, "THB"), L(50, null, "THB")],
    [L(100, null, null)],
    [],
  ]) {
    const s = summariseLineCurrency(lines);
    assert.equal(s.currency, null);
    assert.equal(s.foreignTotal, null);
  }
});

/**
 * A line whose currency the receipt read could not determine carries a
 * `foreignAmount` with no `currency`. It is unsummarisable by definition —
 * adding it to a MYR total would invent a currency for it.
 */
test("a foreign amount with no currency poisons the summary rather than joining it", () => {
  const s = summariseLineCurrency([L(163.71, 20, "MYR"), L(0, 15, null)]);
  assert.equal(s.currency, null);
  assert.equal(s.foreignTotal, null);
});

test("a foreign line missing its figure cannot be summed", () => {
  const s = summariseLineCurrency([L(163.71, 20, "MYR"), L(81.86, null, "MYR")]);
  assert.equal(s.currency, null);
  assert.equal(s.foreignTotal, null);
});

/** Currency codes are compared case- and space-insensitively, like everywhere else. */
test("the same currency written differently is still the same currency", () => {
  const s = summariseLineCurrency([L(163.71, 20, "MYR"), L(81.86, 10, " myr ")]);
  assert.equal(s.currency, "MYR");
  assert.equal(s.foreignTotal, 30);
});

/** Money adds in hundredths; 0.1 + 0.2 must not surface as 0.30000000000000004. */
test("the total is rounded to two decimals", () => {
  const s = summariseLineCurrency([L(1, 0.1, "MYR"), L(2, 0.2, "MYR")]);
  assert.equal(s.foreignTotal, 0.3);
});
