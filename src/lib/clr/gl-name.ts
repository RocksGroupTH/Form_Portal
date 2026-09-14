/**
 * AP-3.2 — what a typed Thai name means for the register.
 *
 * The settings screen fills each Thai box with the name the row actually shows,
 * which is Business Central's wording unless accounting has overridden it. That
 * is the readable thing to do — it held only the override at first, so 541 of
 * PCTH's 584 boxes rendered as grey placeholder text and read as missing data —
 * but it puts BC's own wording inside an input that saves on blur.
 *
 * **So tabbing through a row must store nothing.** This is the rule that makes
 * that true: a value equal to Business Central's is not an override, it is the
 * absence of one, exactly as an empty box is. Without it the first pass through
 * the column would freeze today's BC wording into the register on every row it
 * touched, and a later rename in BC would stop reaching the screen.
 *
 * Pure and import-free.
 */

/**
 * The value to store for a typed Thai name: the override, or `null` for "follow
 * Business Central".
 *
 * `erpName` is BC's own wording, or null for an account the sync no longer
 * returns — in which case anything typed is an override, because there is
 * nothing for it to be the same as.
 */
export function nameOverrideFor(typed: string, erpName: string | null | undefined): string | null {
  const value = (typed ?? "").trim();
  if (value === "") return null;
  return value === (erpName ?? "").trim() ? null : value;
}
