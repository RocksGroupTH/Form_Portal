import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRate } from "./fx";

test("baht never needs a rate", () => {
  assert.equal(needsRate(null), false);
  assert.equal(needsRate(undefined), false);
  assert.equal(needsRate(""), false);
  assert.equal(needsRate("THB"), false);
  assert.equal(needsRate("thb"), false);
});

/**
 * The half that keeps an FX outage from stopping ordinary work: a baht claim
 * never calls out at all, so the fail-closed rule at submit only ever applies
 * to a foreign one.
 */
test("a foreign currency needs one", () => {
  assert.equal(needsRate("MYR"), true);
  assert.equal(needsRate("usd"), true);
});
