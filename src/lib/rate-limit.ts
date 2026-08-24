/**
 * A sliding-window rate limit, split so the rule is unit-testable without a
 * clock or a store: `decideRateLimit` is pure and takes both as arguments;
 * `consumeRateLimit` is the thin stateful wrapper the routes call.
 *
 * **In-process only.** The store is a module-level `Map`, so a second Node
 * instance counts separately — the same caveat the jwt TeamMember cache in
 * `auth.ts` carries. Production runs one `next start` behind IIS/ARR today,
 * which is what makes that acceptable; horizontal scaling would need a shared
 * store.
 */

export interface RateVerdict {
  ok: boolean;
  /** Seconds until the oldest hit leaves the window. 0 when allowed. */
  retryAfterSeconds: number;
  /** The history to store back — the pruned list, plus this hit when allowed. */
  hits: number[];
}

/**
 * Pure. A refused call is deliberately **not** added to `hits`: recording it
 * would keep pushing the window forward every time a caller retried, and a
 * client that retries on a 429 would lock itself out for good.
 */
export function decideRateLimit(
  hits: readonly number[],
  opts: { now: number; limit: number; windowMs: number },
): RateVerdict {
  const { now, limit, windowMs } = opts;
  const cutoff = now - windowMs;
  const live: number[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (hits[i] > cutoff) live.push(hits[i]);
  }

  if (live.length < limit) {
    live.push(now);
    return { ok: true, retryAfterSeconds: 0, hits: live };
  }

  // `live[0]` is the oldest still counted; room opens one window after it.
  const waitMs = live.length > 0 ? live[0] + windowMs - now : windowMs;
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    hits: live,
  };
}

const buckets = new Map<string, number[]>();

/** Stateful wrapper: read the caller's history, decide, store the result back. */
export function consumeRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): RateVerdict {
  const verdict = decideRateLimit(buckets.get(key) ?? [], { ...opts, now: Date.now() });
  if (verdict.hits.length > 0) buckets.set(key, verdict.hits);
  else buckets.delete(key);
  return verdict;
}
