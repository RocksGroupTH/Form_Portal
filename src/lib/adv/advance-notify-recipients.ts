/**
 * Who an AP-2 notification goes to once the on-behalf pair is known.
 *
 * AP-2 lets one person file a request **for** another — the account officer
 * who raises advances for a whole department. Every notification the form
 * sends was addressed to `AccRequest.RequesterEmail`, which is the person the
 * request is *for*, or to a step's role roster. Nothing ever reached the person
 * who actually filed it.
 *
 * Measured 2026-09-25, before this existed: one filer had raised eleven
 * requests on other people's behalf (ADV26-00046 … 00059) and received **zero**
 * messages about any of them — not on submit, not on return, not on approval,
 * not on rejection. The filer is the one who has to act on a returned request,
 * and they were the one person never told it had come back.
 *
 * Two additions, both decided by the user on 2026-09-25 and both conditional on
 * the request actually being on-behalf:
 *
 * 1. **The filer is added to every trigger.** They are managing the request.
 * 2. **On submit only, the person it was filed for is told too** — otherwise a
 *    request goes out in their name and the first they hear of it is the
 *    outcome.
 *
 * Neither applies when somebody files for themselves: there the filer and the
 * requester are the same person, so rule 1 adds a duplicate and rule 2 would
 * email them about the submit they just performed.
 */

function norm(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export interface OnBehalfPair {
  /** The person the request is FOR — `AccRequest.RequesterEmail`. */
  requesterEmail?: string | null;
  /** The person who FILED it — the `TeamMember` email of `AccRequest.CreatedBy`. */
  filerEmail?: string | null;
}

/**
 * Whether this request was filed by somebody other than the person it is for.
 *
 * Compared on the normalised address rather than on ids, because the two sides
 * come from different systems — `RequesterEmail` is HR's
 * `COALESCE(Email, EmailCompBr)` and the filer's is the portal login. An
 * unknown filer is not on-behalf: absence must not turn a self-filed request
 * into one, which would email the requester about their own submit.
 */
export function isOnBehalf(pair: OnBehalfPair): boolean {
  const filer = norm(pair.filerEmail);
  if (!filer) return false;
  return filer !== norm(pair.requesterEmail);
}

/**
 * `base` plus whatever the on-behalf pair adds, de-duplicated.
 *
 * Blank entries are dropped and matching is case-insensitive, but the **first
 * spelling wins** — the address a caller already chose is the one that reaches
 * `AccEmailQueue`, so the queue keeps reading the way the rest of the form
 * writes it. De-duplication is not cosmetic: `Cancelled` already unions a role
 * roster with the requester, and the filer is frequently on that roster.
 */
export function advanceNotifyList(
  base: readonly (string | null | undefined)[],
  pair: OnBehalfPair,
  opts: { alsoRequester?: boolean } = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (email: string | null | undefined) => {
    const key = norm(email);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push((email as string).trim());
  };

  for (const email of base) add(email);

  if (isOnBehalf(pair)) {
    add(pair.filerEmail);
    if (opts.alsoRequester) add(pair.requesterEmail);
  }

  return out;
}
