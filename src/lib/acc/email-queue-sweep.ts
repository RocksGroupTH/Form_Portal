import { processQueue } from "@/lib/acc/email-queue";
import { shouldRunSweep } from "@/lib/acc/stale-sweep-schedule";
import { EMAIL_SWEEP_BATCH, EMAIL_SWEEP_MIN_INTERVAL_MS } from "@/lib/acc/email-sweep-schedule";

/**
 * Send whatever the post-action drains dropped, from a page somebody is loading
 * anyway.
 *
 * **The problem this exists for.** Every route that queues mail ends with
 * `void processQueue().catch(() => {})` — unawaited, after the response. When
 * that promise does not get to finish, or runs after the request scope is gone
 * (`resolveFormEnvironment` then answers Production, and a UAT row is invisible
 * to it), the row simply stays `Queued`. Nothing retries it: there is no cron,
 * and `processQueueOn`'s docblock refers to a sweep endpoint that does not
 * exist. Measured 2026-09-25 — an AP-3 approval mail sat unsent for **53
 * minutes**, `AttemptCount = 0` and `ErrorMessage` null, which is
 * indistinguishable from a row created a second ago. Nobody would ever have
 * noticed but the person waiting for it.
 *
 * **It is awaited, unlike every other drain in this codebase.** That is the
 * whole point: a recovery path written fire-and-forget recovers from a
 * fire-and-forget failure only by luck. The cost with an empty queue is one
 * indexed `SELECT TOP`, which is why it can sit on a read path at all.
 *
 * **It never throws.** A mail server having a bad afternoon must not turn
 * somebody's approval queue into an error page — the rows stay `Queued` and the
 * next load tries again, which is exactly the behaviour being restored.
 *
 * Throttled per process, far more tightly than the stale-request sweep's ten
 * minutes: a request that has waited a month can wait ten more, but somebody
 * refreshing a queue for their approval mail cannot. Thirty seconds also bounds
 * the window in which two concurrent loads could pick up the same row and send
 * it twice — a risk this shares with the post-action drains, and the reason the
 * batch is small rather than the 20 `processQueue` defaults to.
 */

let lastSweepStartedAt: number | null = null;

/** Exported for tests; a process's own clock is not otherwise reachable. */
export function resetEmailSweepThrottle(): void {
  lastSweepStartedAt = null;
}

export async function sweepEmailQueueOnLoad(): Promise<void> {
  const now = Date.now();
  if (!shouldRunSweep(lastSweepStartedAt, now, EMAIL_SWEEP_MIN_INTERVAL_MS)) return;
  // Recorded at the start, not at completion, so a slow drain is not re-entered
  // by the next request while it is still going.
  lastSweepStartedAt = now;

  try {
    await processQueue(EMAIL_SWEEP_BATCH);
  } catch (err) {
    console.error("[acc/email-queue-sweep] drain failed; rows stay Queued", err);
  }
}
