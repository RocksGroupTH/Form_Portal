/**
 * Who may grant, read and reuse a stored national-ID scan (AP-17).
 *
 * ## What was wrong
 *
 * AP-17 lets someone file a booking on behalf of a colleague, and authorizes
 * that by **shared department** alone (`resolveEmployeeForActor` in
 * `@/lib/hr/employee-lookup`). Four endpoints then took a caller-supplied
 * `requesterStaffId` and ran it through that same check:
 *
 * - `id-card/consent` (POST) wrote `ap17.idcard.reuse.{staffId}` for whichever
 *   staff id was posted — so A could record B's consent on B's behalf;
 * - `id-card/previous` (GET) returned B's most recent ID-card file id once that
 *   flag was true;
 * - `id-card/previous/download` (GET) streamed the bytes for any file that
 *   matched the staff id, checking no consent of its own — a known or guessed
 *   file id was enough;
 * - `requests/[id]/files/reuse-idcard` (POST) copied one onto A's draft, also
 *   with no consent check.
 *
 * Chained, a colleague in the same department could set the consent, list the
 * card and pull down someone's national-ID scan. Sharing a department is not
 * consent, and consent recorded by somebody else is not consent at all.
 *
 * ## The rule now
 *
 * **Only the data subject touches their own card.** Granting, listing,
 * downloading and reusing all require `actorStaffId === subjectStaffId`, and
 * the download and the reuse re-check the consent flag themselves rather than
 * trusting that the caller went through the metadata endpoint first.
 *
 * Ordinary on-behalf filing is untouched — A can still create and submit a
 * booking for B. What A can no longer do is attach B's stored card without B;
 * A attaches a copy B gave them, the same as the very first time.
 *
 * A delegated-consent model (B authorises A explicitly, time-bound, audited)
 * would be a real feature. It is deliberately not faked here out of department
 * membership.
 *
 * Refusals are 404, not 403: "there is no card here" leaks nothing, while
 * "forbidden" confirms that a colleague has a stored ID scan.
 */

export type IdCardVerdict = { ok: true } | { ok: false; status: 403 | 404; error: string };

export const ID_CARD_NOT_FOUND: IdCardVerdict = {
  ok: false,
  status: 404,
  error: "ไม่พบบัตรของผู้ขอเบิกคนนี้",
};

export const ID_CARD_CONSENT_NOT_YOURS: IdCardVerdict = {
  ok: false,
  status: 403,
  error: "บันทึกความยินยอมได้เฉพาะบัตรของตนเองเท่านั้น",
};

/**
 * May this actor read, download or reuse the stored card of `subjectStaffId`?
 *
 * `consent` is the tri-state the setting stores: `true` granted, `false`
 * refused, `null` never answered. Only `true` opens it.
 */
export function decideIdCardRead(input: {
  actorStaffId: number | null | undefined;
  subjectStaffId: number | null | undefined;
  consent: boolean | null;
}): IdCardVerdict {
  const { actorStaffId, subjectStaffId } = input;
  if (actorStaffId == null || subjectStaffId == null) return ID_CARD_NOT_FOUND;
  if (actorStaffId !== subjectStaffId) return ID_CARD_NOT_FOUND;
  if (input.consent !== true) return ID_CARD_NOT_FOUND;
  return { ok: true };
}

/** May this actor record a reuse-consent answer for `subjectStaffId`? Self only. */
export function decideIdCardConsentWrite(input: {
  actorStaffId: number | null | undefined;
  subjectStaffId: number | null | undefined;
}): IdCardVerdict {
  const { actorStaffId, subjectStaffId } = input;
  if (actorStaffId == null) return ID_CARD_CONSENT_NOT_YOURS;
  // A request that names nobody means "me", which is how the form posts it.
  if (subjectStaffId == null) return { ok: true };
  if (actorStaffId !== subjectStaffId) return ID_CARD_CONSENT_NOT_YOURS;
  return { ok: true };
}

/** Parse the stored setting value into the tri-state the decisions expect. */
export function parseConsentSetting(raw: string | null | undefined): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}
