/**
 * The travel-date window the พักห้องเดียวกับ picker opens on: **today … today +
 * 30 days** (the user, 2026-09-22, point 3).
 *
 * ## Why not the guest's own dates any more
 *
 * Spec §6 seeded this filter from the tab's own `departDate`/`returnDate` —
 * "the overwhelmingly common case is two people on the same trip". Two things
 * killed that. The picker now opens on a tab that has not necessarily been
 * saved, so it very often has no dates at all; and since final review I4 the
 * dates flow the **other** way — picking a host writes the host's dates into
 * the guest's tab (`room-share-choice.ts`), so seeding the search from a value
 * the search is about to overwrite is circular.
 *
 * ## Today, not tomorrow
 *
 * `earliest-travel-date.ts` answers *tomorrow*, because AP-17 refuses a trip
 * departing today. This is not that rule and must not borrow it: it is a
 * **search window over hosts that already exist**, and a colleague's trip that
 * departed this morning and returns on Friday is a perfectly good room to
 * share — `loadHostableRequests` matches on overlap, so a host whose
 * `DepartDate` is in the past still overlaps this window through its
 * `ReturnDate`. Starting at tomorrow would hide exactly those.
 *
 * ## 30 days
 *
 * A round number with no rule behind it: long enough to cover the trip
 * somebody is filing for now, short enough that the list is readable and the
 * scan's 200-row cap is nowhere near. It is a **default**, not a bound — the
 * requester can move both ends, or clear them.
 *
 * Local getters throughout, never `toISOString()`: every date in these
 * databases is a Thai wall clock, and at UTC+7 `toISOString()` names yesterday
 * for most of the evening. `setDate` past the end of a month rolls the month
 * and past December rolls the year, so there is nothing to special-case — the
 * same construction `earliestTravelDate` uses.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** How many days past today the default window reaches. */
export const HOST_FILTER_DEFAULT_DAYS = 30;

/** `{ from: today, to: today + 30 }` as `YYYY-MM-DD`, in the viewer's own calendar. */
export function defaultHostFilterRange(now: Date): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  end.setDate(end.getDate() + HOST_FILTER_DEFAULT_DAYS);
  return { from: ymd(start), to: ymd(end) };
}
