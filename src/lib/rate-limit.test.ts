import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRateLimit } from "./rate-limit";

const OPTS = { limit: 3, windowMs: 10_000 };

test("the first call on an empty history is allowed", () => {
  const v = decideRateLimit([], { ...OPTS, now: 1000 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.hits, [1000]);
});

test("calls up to the limit are allowed", () => {
  const v = decideRateLimit([1000, 2000], { ...OPTS, now: 3000 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.hits, [1000, 2000, 3000]);
});

test("the call past the limit is refused", () => {
  const v = decideRateLimit([1000, 2000, 3000], { ...OPTS, now: 4000 });
  assert.equal(v.ok, false);
});

test("a refused call is not recorded — otherwise the window never drains", () => {
  // Recording refusals would let a caller hammering the endpoint push the
  // oldest hit forward forever and lock themselves out permanently.
  const v = decideRateLimit([1000, 2000, 3000], { ...OPTS, now: 4000 });
  assert.deepEqual(v.hits, [1000, 2000, 3000]);
});

test("hits older than the window do not count", () => {
  // 1000 is 11s ago with a 10s window — dropped, so there is room again.
  const v = decideRateLimit([1000, 5000, 6000], { ...OPTS, now: 12_000 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.hits, [5000, 6000, 12_000]);
});

test("retry-after counts from the oldest hit still inside the window", () => {
  // Oldest is 1000, window 10s → room at 11000, i.e. 7s after now=4000.
  const v = decideRateLimit([1000, 2000, 3000], { ...OPTS, now: 4000 });
  assert.equal(v.retryAfterSeconds, 7);
});

test("retry-after rounds up and is never zero", () => {
  // Oldest is 1000, room at 11000, now 10_500 → 0.5s left, reported as 1.
  const v = decideRateLimit([1000, 2000, 3000], { ...OPTS, now: 10_500 });
  assert.equal(v.ok, false);
  assert.equal(v.retryAfterSeconds, 1);
});

test("an allowed call reports no retry delay", () => {
  assert.equal(decideRateLimit([], { ...OPTS, now: 1000 }).retryAfterSeconds, 0);
});

test("a limit of zero refuses everything", () => {
  const v = decideRateLimit([], { limit: 0, windowMs: 10_000, now: 1000 });
  assert.equal(v.ok, false);
});
