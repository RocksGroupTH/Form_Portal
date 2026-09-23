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

/**
 * The **filed-on** window the same picker opens on: **today … today + 30** —
 * the same range as the travel one above, deliberately.
 *
 * ## It took two corrections, and the second one is the binding instruction
 *
 * This opened blank at first. Asked for a default "เหมือนกัน" with the travel
 * one (2026-09-22), it became `today − 30 … today`: the same span with the
 * direction flipped, reasoning that a filed-on date is always in the past, so a
 * forward window could only ever match requests filed *today*. The user
 * corrected that on 2026-09-23 by naming the dates outright — *"วันนี้เป็นวันที่
 * 23 ต้องเป็น 23 Sep 2026 - 23 Oct 2026"*. เหมือนกัน meant the same **range**,
 * not the same span mirrored.
 *
 * ## The cost is real, was stated, and is the user's call
 *
 * A request is filed when somebody presses ส่งคำขอ, so nothing is ever filed in
 * the future: untouched, this window matches requests filed **today** and
 * nothing else. What makes that a trade rather than a trap is that both ends are
 * editable and clearable, so widening it is one edit away. **Do not flip it back
 * on this reasoning** — it has been raised and ruled on; get the instruction
 * changed first.
 */
export function defaultFiledOnFilterRange(now: Date): { from: string; to: string } {
  // The same window, kept behind its own name rather than de-duplicated away:
  // the two modes answer different questions and have already carried different
  // ranges twice. The seam is what stops the next change to one silently moving
  // the other.
  return defaultHostFilterRange(now);
}
