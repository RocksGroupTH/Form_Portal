import { isUatId } from "@/lib/form-environment/uat-identity";

/**
 * "Is the record being priced a UAT record?" — the one question the UAT
 * per-diem override turns on, in the two spellings the call sites can actually
 * answer it in.
 *
 * The rule is written here once so the two are visibly ONE rule rather than two
 * policies somebody later "unifies" in the wrong direction.
 *
 * ── Why the recompute must not use the environment resolver ──
 *
 * Not because it does I/O — it does not. `resolveCurrentFormAccess` short-circuits
 * to Production without touching the cookie, the header or the database when
 * `resolveFormClass()` is null, and says so in its own comment.
 *
 * The reason is that **Production is the wrong answer** there.
 * `recomputeGroupPerDiem` runs inside somebody else's transaction, and a
 * silently-Production verdict re-prices a UAT trip at real HR while writing
 * `AccTravelBooking.PerDiemTotal` AND `AccRequest.TotalAmount` in one batch,
 * leaving an activity row that records the figure moved and not why.
 *
 * `isUatId` is exact: migration 061 reseeds `AccRequest` to 900000 and 064 adds
 * the `CHECK`, so every id in a UAT group is >= 900000.
 */

/** Use where a record id exists — a submit, a recompute, a report row. */
export function uatByRecordId(requestId: number | null | undefined): boolean {
  return isUatId(requestId);
}

/**
 * Use only where no record id exists yet — a draft being filled, and the
 * allowance-log route that feeds its estimate. Pass the value of
 * `resolveFormEnvironment()`.
 */
export function uatByEnvironment(environment: string | null | undefined): boolean {
  return environment === "UAT";
}
