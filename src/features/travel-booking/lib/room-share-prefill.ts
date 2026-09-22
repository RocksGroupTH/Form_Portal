/**
 * What else a พักห้องเดียวกับ host fills in on the guest's tab — **and only
 * where the guest has not filled it themselves** (the user, 2026-09-23,
 * point 3).
 *
 * Two people sharing a room are, in practice, on the same trip: same company,
 * same destination, same reason, same work. Re-typing all of it is the thing
 * the user asked to stop, so picking a host copies แบรนด์ที่เบิก, สถานที่ไป
 * ปฏิบัติงาน, เหตุผลการเดินทาง, ระบุเหตุผลเพิ่มเติม and รายละเอียดการไปปฏิบัติงาน
 * across.
 *
 * ## "(ถ้ายังไม่เติม)" is the whole rule
 *
 * **Never overwrite what the requester has already put in.** A field is
 * copied only where the guest's own value is empty. Somebody who typed their
 * own เหตุผลการเดินทาง and then attached must not find it replaced by
 * somebody else's — that is a silent edit to a document they are about to
 * sign, and it is indistinguishable from their own typing afterwards.
 *
 * **This is the opposite rule from the DATES**, which `room-share-choice.ts`
 * copies *unconditionally*, and the two are deliberately not unified. The
 * dates are not a convenience: the picker matches hosts on date **overlap**
 * (final review I4), so a guest and its host can legitimately disagree from
 * the start, and `cascadeForHostDates` would then replace the guest's whole
 * span and its per-diem day count on the host's first re-date. The dates must
 * agree; these fields merely usually do.
 *
 * ## What "empty" means, field by field — and it is not the same answer
 *
 * - **แบรนด์ที่เบิก / เหตุผล / รายละเอียด** — null, or a string that is
 *   nothing but whitespace.
 * - **สถานที่ไปปฏิบัติงาน is a LIST, and empty means "no NAMED row", not "no
 *   rows".** `emptyTab()` seeds `workLocations` with one blank row
 *   (`[{ name: "", sortOrder: 0 }]`) so the form has a field to render, and
 *   `tabFromRequest` re-seeds the same blank row for a resumed request that
 *   has none. A rule reading "no rows at all" would therefore be **true of
 *   almost no tab that has ever existed** and this field would never be
 *   filled in — which is the failure mode worth naming, because it looks
 *   exactly like the feature working for the other four fields and not this
 *   one.
 * - **ระบุเหตุผลเพิ่มเติม follows the reason it belongs to.** It is filled
 *   only when the reason itself is being filled, or when the guest has
 *   already chosen *the same* reason the host did. Otherwise a guest who
 *   picked reason A keeps A while acquiring the host's free text about reason
 *   B — a field whose two halves describe different trips, which is worse
 *   than leaving it blank.
 *
 * ## What is NOT copied, and why each one
 *
 * - **The work location's coordinates.** Migration 135 gave
 *   `AccTravelWorkLocation` `Lat`/`Lng`, and the host's row has them — but
 *   the hosts endpoint answers work locations as **names alone**
 *   (`HostCandidateRow.workLocations: string[]`) and was deliberately not
 *   widened to carry a colleague's pin to every authenticated employee. So a
 *   copied location renders no map until the requester re-picks the place
 *   from Google, which is the same honest outcome CLAUDE.md already records
 *   for every location filed before 2026-09-01 — no map rather than a wrong
 *   pin.
 * - **The trip's dates, the per-diem figures, the amount, the attachments,
 *   the ID card, the vehicles.** The first belongs to `room-share-choice.ts`
 *   under a different rule; the rest are either derived, personal, or
 *   genuinely the guest's own decision.
 *
 * Pure and import-free, so it is unit-tested without a database — the form's
 * components and hook all reach `@/env` transitively. The host and tab types
 * are structural subsets rather than imports of `HostCandidateRow` and
 * `TabFormState`, for the same reason `RoomShareHostChoice` is.
 */

/** The host fields a prefill reads. A structural subset of `HostCandidateRow`. */
export interface RoomSharePrefillHost {
  brandCode: string | null;
  reasonId: number | null;
  reasonCustomText: string | null;
  workDetail: string | null;
  /** Names only — the endpoint carries no coordinates. See the header. */
  workLocations: string[];
}

/** One work location as the tab holds it. A structural subset of `WorkLocationInput`. */
export interface RoomSharePrefillLocation {
  name: string;
  sortOrder: number;
}

/** The tab fields a prefill has to look at before it writes anything. */
export interface RoomSharePrefillTab {
  brandCode: string | null;
  reasonId: number | null;
  reasonCustomText: string | null;
  workDetail: string | null;
  workLocations: RoomSharePrefillLocation[];
}

/**
 * The patch, carrying **only** the fields being filled.
 *
 * Every key is optional and each one is **absent** rather than `undefined`
 * when it is not being written: `updateTab` spreads this over the tab, and
 * `{ ...tab, workDetail: undefined }` blanks a value the requester typed. The
 * same absent-versus-present rule `roomShareChoicePatch` states for the dates.
 */
export interface RoomSharePrefillPatch {
  brandCode?: string;
  reasonId?: number;
  reasonCustomText?: string;
  workDetail?: string;
  workLocations?: RoomSharePrefillLocation[];
}

/** Null, or nothing but whitespace. The one emptiness test the scalar fields share. */
function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * True when the tab's work-location list holds **no named row**.
 *
 * See the header: a list of one blank row is the *starting* state of every
 * tab, so this is the only reading under which the field is ever filled.
 */
function hasNoNamedLocation(locations: readonly RoomSharePrefillLocation[]): boolean {
  for (const location of locations) {
    if (!isBlank(location.name)) return false;
  }
  return true;
}

/**
 * The tab patch for filling the rest of the trip in from `host`.
 *
 * Returns `{}` when the guest has already answered everything — which is a
 * real and ordinary outcome, not a failure: somebody attaching at the end of
 * filling the form should have nothing changed under them.
 */
export function roomSharePrefillPatch(
  host: RoomSharePrefillHost,
  tab: RoomSharePrefillTab,
): RoomSharePrefillPatch {
  const patch: RoomSharePrefillPatch = {};

  if (isBlank(tab.brandCode) && !isBlank(host.brandCode)) {
    patch.brandCode = (host.brandCode as string).trim();
  }

  /* The reason and its free text move together — see the header. `fillReason`
     is read again below rather than re-derived, so the two cannot disagree
     about whether the reason is the host's. */
  const fillReason = tab.reasonId == null && host.reasonId != null;
  if (fillReason) {
    patch.reasonId = host.reasonId as number;
  }
  const reasonMatchesHost = fillReason || (tab.reasonId != null && tab.reasonId === host.reasonId);
  if (reasonMatchesHost && isBlank(tab.reasonCustomText) && !isBlank(host.reasonCustomText)) {
    patch.reasonCustomText = (host.reasonCustomText as string).trim();
  }

  if (isBlank(tab.workDetail) && !isBlank(host.workDetail)) {
    patch.workDetail = (host.workDetail as string).trim();
  }

  if (hasNoNamedLocation(tab.workLocations)) {
    /* The host's own blank entries are dropped rather than copied: they would
       arrive as rows the requester has to delete before the form will accept
       the tab, which is worse than the blank row that was already there. A
       host with nothing named therefore fills nothing, and the key stays
       absent. */
    const named: RoomSharePrefillLocation[] = [];
    for (const name of host.workLocations) {
      if (!isBlank(name)) named.push({ name: name.trim(), sortOrder: named.length });
    }
    if (named.length > 0) patch.workLocations = named;
  }

  return patch;
}
