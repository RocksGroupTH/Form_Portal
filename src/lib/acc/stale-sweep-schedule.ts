/**
 * How often the *opportunistic* auto-cancel sweep is allowed to run.
 *
 * The sweep has two entry points: a scheduled `POST .../expire-stale`, and a
 * fire-and-forget call from a read path somebody hits anyway. The second one is
 * what makes the feature work without a cron job configured — but a read path
 * is hit many times a minute, and a request that has been sitting for a month
 * will still be sitting there in ten minutes' time. There is nothing to gain
 * from scanning both form databases on every page load.
 *
 * So the opportunistic caller asks this first. The scheduled endpoint does not
 * — an operator who posts to it means *now*.
 *
 * Pure and import-free, so it is unit-tested without a live environment
 * (`@/env` validates the whole environment at import time, so anything
 * reachable from a pool drags a real configuration into the test run).
 *
 * **The state it guards is an in-process variable**, like `auth.ts`'s jwt cache
 * and `rate-limit.ts`'s buckets: a second Node instance keeps its own clock and
 * may sweep in the same window. That costs a duplicated scan, never a
 * duplicated cancel — the cancel itself is a conditional UPDATE whose second
 * attempt matches no rows.
 */

/** Minimum gap between two opportunistic sweeps in one process. */
export const OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Whether an opportunistic sweep may start now.
 *
 * `lastStartedAt` is null when this process has never started one. It is
 * recorded at *start*, not at completion, so a slow or failed sweep cannot be
 * re-entered by the next few requests while it is still running.
 *
 * A clock that has gone backwards (`now < lastStartedAt`) is treated as "not
 * yet" rather than "definitely yes": the elapsed comparison is written as a
 * forward one so a negative interval fails it.
 */
export function shouldRunSweep(
  lastStartedAt: number | null,
  now: number,
  minIntervalMs: number = OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS,
): boolean {
  if (lastStartedAt === null) return true;
  return now - lastStartedAt >= minIntervalMs;
}
