import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS,
  shouldRunSweep,
} from "./stale-sweep-schedule";

const T = 1_000_000_000_000;

test("a process that has never swept runs immediately", () => {
  assert.equal(shouldRunSweep(null, T), true);
});

test("a second request in the same window does not sweep again", () => {
  assert.equal(shouldRunSweep(T, T + 1), false);
  assert.equal(shouldRunSweep(T, T + OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS - 1), false);
});

/** The boundary itself is a run — "at least this long ago" includes exactly. */
test("the interval boundary runs", () => {
  assert.equal(shouldRunSweep(T, T + OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS), true);
  assert.equal(shouldRunSweep(T, T + OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS + 1), true);
});

/**
 * A backwards clock must not read as "ages ago". Written as a forward
 * comparison so a negative elapsed time fails rather than overflowing into a
 * pass.
 */
test("a clock that went backwards does not trigger a sweep", () => {
  assert.equal(shouldRunSweep(T, T - 60_000), false);
});

test("the interval is overridable, for callers that want their own", () => {
  assert.equal(shouldRunSweep(T, T + 5_000, 1_000), true);
  assert.equal(shouldRunSweep(T, T + 500, 1_000), false);
});

/** A zero interval means "every time", not "never". */
test("a zero interval always runs", () => {
  assert.equal(shouldRunSweep(T, T, 0), true);
});
