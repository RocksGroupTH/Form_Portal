/**
 * Classify a failed image read so the requester is told the right thing.
 * Pure — imports nothing, so it is unit-tested without a key or a network.
 *
 * The distinction that matters is **who can fix it**. A 401 from a revoked or
 * mistyped key looks identical to an outage from inside the route, but "try
 * again in a moment" is useless advice for it — it will fail identically
 * forever until an operator changes the key. Measured on 2026-08-24: a key that
 * was present and the right length answered
 * `401 authentication_error — API key is invalid`, and the requester was told
 * to retry.
 */

/** 503 when only an operator can fix it; 502 when retrying might work. */
export function statusForVisionError(err: unknown): 502 | 503 {
  const status =
    typeof err === "object" && err !== null && typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : null;
  if (status === null) return 502;

  // 401/403: the credential. 400: we sent something the API refused. Neither
  // is anything the person holding the phone can do about.
  if (status === 401 || status === 403 || status === 400) return 503;
  return 502;
}
