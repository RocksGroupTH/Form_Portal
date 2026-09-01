/**
 * Whether a trip's work location is one the booking desk can actually be sent to.
 *
 * Imports nothing, so the client validator and the submit guard ask the same
 * question from the same place and cannot drift apart.
 *
 * ── A name is not enough any more ──
 *
 * Until 2026-09-01 a typed name satisfied ข้อ9: the field committed whatever was
 * in it so that Google being down, or simply not knowing somewhere, could never
 * stop a request being filed. That escape hatch is deliberately closed for
 * SUBMIT — a booking desk that cannot put the place on a map is a desk guessing
 * which "Central" was meant, and the map is now the thing they work from.
 *
 * **The trade this makes, stated rather than discovered:** while Google is
 * unreachable or its key is unconfigured, no AP-17 request can be submitted at
 * all. That is the same fail-closed shape AP-17's ID-card check already has and
 * the opposite of AP-1's receipt read, and it is a deliberate answer to
 * "what is worse — a blocked requester, or a booking nobody can locate".
 *
 * Saving a DRAFT is untouched: a half-filled trip still saves, so the work is
 * never lost while somebody waits for the search to come back.
 */

export interface PinnedPlace {
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** A coordinate pair worth trusting: both finite, and not the (0,0) null island. */
export function hasUsablePin(p: PinnedPlace): boolean {
  return (
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    !(p.lat === 0 && p.lng === 0)
  );
}

/** At least one place that is both named and pinned. */
export function hasPinnedWorkLocation(places: readonly PinnedPlace[] | null | undefined): boolean {
  return (places ?? []).some((p) => !!p.name?.trim() && hasUsablePin(p));
}

/**
 * Why ข้อ9 is not satisfied, so the message can name the actual problem.
 *
 * "none" and "unpinned" are different situations for the person filling the
 * form — one has not answered, the other typed something Google did not
 * recognise — and telling them apart is the difference between "fill this in"
 * and "pick it from the list instead of typing it".
 */
export function workLocationIssue(
  places: readonly PinnedPlace[] | null | undefined,
): "none" | "unpinned" | null {
  const named = (places ?? []).filter((p) => !!p.name?.trim());
  if (named.length === 0) return "none";
  return named.some(hasUsablePin) ? null : "unpinned";
}
