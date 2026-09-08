/**
 * The payee's ภ.ง.ด. type, suggested from their tax id.
 *
 * A Thai 13-digit tax id carries this already: juristic persons are registered
 * by the DBD with a number beginning 0, individuals use a national id beginning
 * 1-8. No DBD call is needed, which is why the requirement's lookup was dropped
 * (spec §5.3a).
 *
 * **It suggests; it never decides.** Some individuals do hold 0-prefixed ids —
 * foreigners issued one by the Revenue Department, two of whom are in our own
 * vendor list — so the requester can change it on the form and accounting can
 * change it again at the ACCOUNT step.
 */
export type PndType = "PND3" | "PND53";

/** The BC vendor each type clears against. Both exist for PCTH, KSI and UNO. */
export const PND_VENDOR_NO: Record<PndType, string> = {
  PND3: "WHT-PND.3",
  PND53: "WHT-PND.53",
};

/** Thai label for one type, for anywhere a person reads it. */
export const PND_LABEL: Record<PndType, string> = {
  PND3: "ภ.ง.ด. 3",
  PND53: "ภ.ง.ด. 53",
};

/**
 * Null means "nothing to suggest", which is not the same as suggesting an
 * individual. Anything that is not exactly thirteen digits — a half-typed id, a
 * registration number from somewhere else, a blank — answers nothing, and the
 * send refuses a clearing whose WHT nobody has typed rather than picking a
 * vendor on this much evidence.
 *
 * Non-digits are stripped, not counted: `01055000000O1` is twelve digits and
 * answers null, instead of reading the leading zero off a string that merely
 * happens to be thirteen characters long.
 */
export function suggestPndType(taxId: string | null | undefined): PndType | null {
  const digits = (taxId ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return null;
  return digits.startsWith("0") ? "PND53" : "PND3";
}
