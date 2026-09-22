/**
 * Whether AP-17's form opens by asking **"พักห้องเดียวกับเพื่อนร่วมงานหรือไม่"**
 * (the user, 2026-09-23, point 4).
 *
 * A guest books nothing themselves, so พักห้องเดียวกับ is not a field to fill
 * in at the end — it *replaces* ที่พักค้างคืน and now fills the rest of the
 * trip in too (`room-share-prefill.ts`). Somebody who fills the whole form and
 * only then finds the control has done the work twice. So the form asks first.
 *
 * ## It is a modal in front of somebody who came to fill a form
 *
 * Three properties keep that acceptable, and each is a separate rule:
 *
 * 1. **It is asked once per FORM SESSION, not per tab** — see below.
 * 2. **"No" is final for that session.** The answer is latched in the form's
 *    own state, so a tab switch, a re-render, a refetch or an SWR revalidation
 *    cannot ask again. Nothing about the question is derived from the tab.
 * 3. **It blocks nothing.** Escape, the backdrop and ไม่ใช่ all do the same
 *    thing — close it and leave the requester exactly where they are today.
 *    There is no state in which the form is unusable until it is answered.
 *
 * ## Per form session, and not per tab
 *
 * An AP-17 group is several trips filed in one sitting by one person, and the
 * tab strip's เพิ่มทริป is pressed several times in that sitting. Asking per
 * tab means four modals for one group, which is its own defect — and the
 * second and subsequent times it would be asking somebody who has the
 * พักห้องเดียวกับ button in front of them and has just declined it.
 *
 * **The cost is stated rather than hidden**: a requester who says ไม่ใช่ and
 * then adds a second trip that *is* a room share is not asked again. They
 * press พักห้องเดียวกับเพื่อนร่วมงาน on that tab, which is the ordinary
 * control and is never disabled. Losing a prompt is a smaller harm than four
 * modals.
 *
 * ## Not on a resumed draft — which is what this function answers
 *
 * A requester who saved yesterday and comes back has already answered this
 * question, by having filled the form. `TravelBookingForm` receives the
 * resumed group as `initial`, fixed for the life of the mount (the page
 * renders a loading popup until the fetch settles, so `initial` is never
 * "null because it has not arrived yet" at the moment the form mounts), and
 * the answer is taken **once**, in a `useState` initialiser.
 *
 * Pure and import-free, so it is unit-tested without a database. The
 * parameter is a structural subset of `TravelBookingGroup` rather than an
 * import of it, for the same reason `RoomShareHostChoice` is.
 */

/** A resumed booking group, as much of it as this decision reads. */
export interface RoomSharePromptGroup {
  requests?: readonly unknown[] | null;
}

/**
 * Should the form open by asking about a room share?
 *
 * **True only for a genuinely new trip** — no resumed group, or a group that
 * carries no request at all, which is a shape nothing produces today and is
 * answered as "new" rather than left to `undefined.length`.
 */
export function shouldAskRoomShare(
  initial: RoomSharePromptGroup | null | undefined,
): boolean {
  const requests = initial?.requests;
  return !requests || requests.length === 0;
}
