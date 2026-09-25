/**
 * How often, and how much, the opportunistic mail drain runs.
 *
 * Kept apart from `email-queue-sweep.ts` for the reason every tunable in this
 * codebase ends up in its own file: that module imports `processQueue`, which
 * reaches a pool, which drags `@/env` — and `@/env` validates the whole
 * environment the moment it is imported, so nothing downstream of it can be
 * read from a test. `stale-sweep-schedule.ts` is split for the same reason and
 * says so.
 *
 * Pure and import-free.
 */

/**
 * Minimum gap between two opportunistic mail drains in one process.
 *
 * Far tighter than the stale-request sweep's ten minutes, deliberately: a
 * request that has waited a month can wait ten more, but somebody refreshing a
 * queue because they are waiting on an approval mail cannot. It also bounds the
 * window in which two concurrent loads could pick up the same row and send it
 * twice — a risk shared with the post-action drains.
 */
export const EMAIL_SWEEP_MIN_INTERVAL_MS = 30 * 1000;

/**
 * How many to send per load.
 *
 * Small because the drain is **awaited** on a read path: each one is a mail
 * server round trip that somebody's queue page is waiting for. This is
 * recovery, not the normal path — the post-action drains still do the bulk.
 */
export const EMAIL_SWEEP_BATCH = 5;
