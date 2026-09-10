import { isUatId } from "@/lib/form-environment/uat-identity";

/**
 * "Is the record being priced a UAT record?" — the one question the UAT
 * per-diem override turns on, in the two spellings the call sites can actually
 * answer it in.
 *
 * The rule is written here once so the two are visibly ONE rule rather than two
 * policies somebody later "unifies" in the wrong direction.
 *
 * ── The two spellings ──
 *
 * Where a record id already exists and nothing else decides the question for
 * you — the recompute, a report row — use `uatByRecordId` below, which is
 * exact: migration 061 reseeds `AccRequest` to 900000 and 064 adds the
 * `CHECK`, so every id in a UAT group is >= 900000.
 *
 * Where no record id exists yet — a draft being filled, the allowance-log
 * route that feeds its estimate, and the submit (see the next section for why
 * the submit is in this arm rather than the id arm even though its rows
 * already have ids by then) — the environment has to answer instead. That
 * question already had exactly one asker before this module existed:
 * `isUatRequest()` (`@/lib/uat-tester/guards`), which is
 * `(await resolveFormEnvironment()) === "UAT"` — character-for-character the
 * same expression a second `uatByEnvironment` wrapper here would have
 * computed. This module does not re-wrap it; call `isUatRequest()` directly.
 * Naming it here, rather than only in `guards.ts`, is what keeps both
 * spellings of the one rule findable from the same place.
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
 * leaving an activity row that records the figure moved and not why. The
 * submit does not have this problem — it runs on AP-17's own route, where the
 * resolver answers correctly — which is why it uses `isUatRequest()` rather
 * than `uatByRecordId`, even though its rows already carry ids.
 */

/** Use where a record id exists — a recompute, a report row. */
export function uatByRecordId(requestId: number | null | undefined): boolean {
  return isUatId(requestId);
}
