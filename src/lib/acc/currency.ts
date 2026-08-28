/**
 * The currency rules for AP-1 and AP-17, with no imports, so they are unit-tested
 * without a database and shared unchanged by the form, the save, the AI document
 * read, the accounting override and the report.
 *
 * **`null` and `"THB"` are both baht.** Absence has to mean baht: every row
 * written before this feature existed has no currency, and every one of them was
 * in baht. A design where absence meant "unknown" would make every historical
 * claim unreadable.
 *
 * See `docs/superpowers/specs/2026-08-28-ap1-ap17-multi-currency-design.md`.
 */

export const THB = "THB";

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

export function isBaht(code: string | null | undefined): boolean {
  const c = norm(code);
  return c === "" || c === THB;
}

/**
 * A foreign figure in baht, or null when it cannot be known.
 *
 * **Never falls back to the unconverted figure.** Returning `amount` when the
 * rate is missing would write a foreign number into a baht column — the one
 * failure this whole feature exists to prevent, and one that leaves no trace on
 * screen. Callers must treat null as "refuse", not as "use what you had".
 *
 * Zero converts to zero: a nil line is a real figure, not an absent one.
 */
export function toBaht(amount: number, rate: number | null): number | null {
  if (!Number.isFinite(amount)) return null;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Whether two codes name the same money.
 *
 * Baht has three spellings here — null, `""` and `"THB"` — so a bare `===` is
 * wrong in the place it matters most: deciding whether a figure read off a
 * document belongs in the claim in front of somebody. A mismatch there leaves
 * the field blank rather than taking a ringgit total into a baht claim, which
 * is the defect the AI reads carried until the currency was asked for at all.
 */
export function sameCurrency(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (isBaht(a) || isBaht(b)) return isBaht(a) && isBaht(b);
  return norm(a) === norm(b);
}

/**
 * The currency a document read may be trusted with.
 *
 * Only the brand's own currency, or baht. A third currency is a misread rather
 * than a discovery — the claim is against one company, operating in one country,
 * and the picker never offered a third option. Returning null means **the user
 * must choose**, which is the same answer `sanitizeReceiptAmount` gives for a
 * figure it cannot trust: a blank editable field beats a wrong one on a document
 * about to be submitted.
 *
 * A brand whose configured currency is itself baht admits baht alone — there is
 * nothing to choose between, so an `MYR` answer against it is still a misread.
 */
export function admitModelCurrency(
  answer: string | null | undefined,
  brandCurrency: string | null,
): string | null {
  const a = norm(answer);
  if (a === "") return null;
  if (a === THB) return THB;
  const b = norm(brandCurrency);
  if (b !== "" && b !== THB && a === b) return b;
  return null;
}

/**
 * Whether a brand offers a currency choice at all — and so whether either form
 * renders a dropdown.
 *
 * Both halves are required. A code without the flag is configuration somebody
 * has staged but not turned on; the flag without a code names nothing. A brand
 * whose currency is literally baht is `"none"` for the same reason: a dropdown
 * offering THB and THB is worse than no dropdown.
 *
 * `"none"` must leave both forms looking exactly as they did before this
 * feature shipped.
 */
export function brandCurrencyState(b: {
  currencyCode: string | null;
  currencyEnabled: boolean;
}): "none" | "configured" {
  if (!b.currencyEnabled) return "none";
  if (isBaht(b.currencyCode)) return "none";
  return "configured";
}
