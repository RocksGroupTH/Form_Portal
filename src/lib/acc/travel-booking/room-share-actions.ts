/**
 * The three `AccActivityLog.Action` values a room-share cascade writes —
 * AP-17 package E, spec §4.
 *
 * **This module imports nothing, and must stay that way.** It was split out
 * of `room-share-cascade-apply.ts` on 2026-09-22 (final review I3) the moment
 * a *client* component needed the same three strings: the detail page renders
 * these rows, and `room-share-cascade-apply.ts` reaches `@/lib/acc/pool` →
 * `@/lib/db/mssql` → `next/headers`, so importing it from a `"use client"`
 * file **breaks the build** — a failure no type error predicts, which
 * CLAUDE.md records having been measured on `src/lib/api-keys/codes.ts` and
 * states as the rule: *"anything both halves need to agree on belongs in
 * `codes.ts`."* This is that file for the cascade's action names.
 *
 * Retyping the literals in the renderer instead was the alternative, and it
 * is how a rename here silently stops matching there — on the one surface
 * that tells a requester why somebody else's action moved their trip.
 *
 * `AccActivityLog.Action` is `nvarchar(50)` and carries no CHECK; the longest
 * of these is 30 characters.
 */

/** A FILED guest, cancelled because its host was cancelled, rejected or hard-deleted. */
export const CASCADE_CANCEL_ACTION = "cancelled_by_room_share_host";

/**
 * An EDITABLE guest (`Draft`/`Returned`), detached rather than cancelled —
 * final review C1. See `cascadeForHostDeath` for why the two outcomes differ.
 */
export const CASCADE_DETACH_ACTION = "detached_by_room_share_host";

/** A live guest whose travel dates were rewritten to follow the host's. */
export const CASCADE_REDATE_ACTION = "dates_followed_room_share_host";

/**
 * Every action this cascade can write, for a reader that needs the set — the
 * detail page's narrowed `AccActivityLog` read, and its renderer.
 *
 * Declared here rather than rebuilt at each site so a fourth action cannot
 * reach the database while one of the two readers goes on filtering for
 * three.
 */
export const ROOM_SHARE_CASCADE_ACTIONS: readonly string[] = [
  CASCADE_CANCEL_ACTION,
  CASCADE_DETACH_ACTION,
  CASCADE_REDATE_ACTION,
];
