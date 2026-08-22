/**
 * The "does this session have a usable internal identity" rule, on its own.
 *
 * Split out of `@/lib/api-auth` only so it can be tested: that module imports
 * `@/lib/auth`, which pulls in NextAuth, the whole provider configuration and
 * `@/env`'s validation of every environment variable. The rule itself is one
 * predicate over a string, and the cases that matter — `""`, `"0"`, `"abc"` —
 * are exactly the ones a running application makes hardest to reach.
 *
 * See `requireAuth` for what the answer is used for and why it is a 401.
 */

/**
 * True when `session.user.id` names a real `TeamMember` row.
 *
 * The values that must be rejected all come from somewhere real:
 *   · `""`      — the degraded session `signIn`'s catch used to grant, and what
 *                 the jwt callback writes when a roster row is retired;
 *   · `"0"`     — `String(Number(""))`, one coercion downstream of the above;
 *   · `"NaN"`   — `String(Number("abc"))`, the same shape from a bad token;
 *   · negatives — never minted, but `Number("-1") > 0` is the only thing
 *                 standing between one and an ownership check that compares
 *                 with `!==`.
 */
export function isUsableUserId(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0;
}
