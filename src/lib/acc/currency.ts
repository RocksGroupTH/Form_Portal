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
 * Only one of the currencies the brand actually offers, or baht. Anything else
 * is a misread rather than a discovery — the document is being attached to a
 * claim against one company, and the picker never offered it. Returning null
 * means **the user must choose**, which is the same answer
 * `sanitizeReceiptAmount` gives for a figure it cannot trust: a blank editable
 * field beats a wrong one on a document about to be submitted.
 *
 * **It takes the whole list**, because a brand may carry several currencies
 * (`BrandCurrency`, migration 127). A single-code parameter would have admitted
 * whichever one happened to be first and refused every other currency the same
 * brand genuinely offers — a misread invented by the shape of this argument
 * rather than by the model.
 *
 * A brand offering nothing, or only baht, admits baht alone: there is nothing
 * to choose between, so an `MYR` answer against it is still a misread.
 */
export function admitModelCurrency(
  answer: string | null | undefined,
  brandCurrencies: readonly string[] | null | undefined,
): string | null {
  const a = norm(answer);
  if (a === "") return null;
  if (a === THB) return THB;
  const list = brandCurrencies ?? [];
  for (let i = 0; i < list.length; i++) {
    const b = norm(list[i]);
    if (b !== "" && b !== THB && a === b) return b;
  }
  return null;
}

/**
 * One row of `BrandCurrency` (migration 127) as everything downstream reads it.
 *
 * **A brand carries several of these, not one.** `BrandSetting` held a single
 * `CountryCode` / `CurrencyCode` / `CurrencyEnabled` triple until 2026-08-28,
 * and that shape cannot say what KSI actually needs — Thailand (THB) *and*
 * England (GBP), and more later. Nothing may read those three columns any more;
 * migration 128 drops them, and `brand-registry.ts` is the only module that
 * reads this table.
 *
 * `isEnabled` is per row, so a brand can carry a currency it is not currently
 * claiming in without losing the country configured alongside it.
 */
export interface BrandCurrencyEntry {
  /** `BrandCurrency.Id` — what the settings editor toggles and removes by. */
  id: number;
  /** ISO-3166-1 alpha-2, or null. Display only; `currencyCode` is what decides money. */
  countryCode: string | null;
  /** ISO-4217, upper case. */
  currencyCode: string;
  /** Whether a claim against this brand may be entered in it. */
  isEnabled: boolean;
}

/**
 * The currencies a brand actually offers a choice of: enabled, not baht,
 * deduplicated, in the order the rows arrive.
 *
 * **Baht is dropped rather than listed.** It is not a choice — it is always
 * available and always the default — so a `THB` row adds nothing a picker can
 * offer. That is the same reason a brand whose only configured currency is baht
 * offers no choice at all, which `brandCurrencyState` answers `"none"` to.
 *
 * The dedupe is belt and braces over `UQ_BrandCurrency_Brand_Currency`: the
 * constraint is the rule. This only ensures a picker cannot render the same
 * code twice if a row ever reached the table around it.
 */
export function enabledForeignCurrencies(
  currencies: readonly BrandCurrencyEntry[] | null | undefined,
): string[] {
  const out: string[] = [];
  const list = currencies ?? [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c || !c.isEnabled) continue;
    const code = norm(c.currencyCode);
    if (code === "" || code === THB) continue;
    if (out.indexOf(code) !== -1) continue;
    out.push(code);
  }
  return out;
}

/**
 * Whether a brand offers a currency choice at all — and so whether either form
 * renders a currency control (AP-1's per-line segments, AP-17's desk toggle).
 *
 * **It answers exactly the question it always answered**: is there a foreign
 * currency a claim against this brand may be entered in today. What changed is
 * where the answer is read from. The two halves that used to be required
 * together — a code, and a flag turning it on — are now one row's
 * `currencyCode` and that same row's own `isEnabled`, so a row missing either
 * is simply not counted rather than being a contradictory pair.
 *
 * `"none"` must leave both forms looking exactly as they did before this
 * feature shipped: no control, no extra field, no extra request. A brand with
 * no rows, with only disabled rows, or with only a THB row is `"none"`.
 */
export function brandCurrencyState(
  b: { currencies: readonly BrandCurrencyEntry[] | null | undefined } | null | undefined,
): "none" | "configured" {
  return enabledForeignCurrencies(b?.currencies).length > 0 ? "configured" : "none";
}

/**
 * What `AccTravelExpenseItem.RateSource` / `AccRequest.RateSource` holds when a
 * human corrected the rate rather than a provider publishing it (migration 130).
 *
 * **A hand-corrected rate must never be mistaken for a published one.** Every
 * other value in that column names a feed — `ECB` today, `BOT` if
 * `BOT_API_CLIENT_ID` is ever provisioned — and both are reproducible from the
 * date beside them. This one is not: it is one person's figure, entered at the
 * ACCOUNT step because the mid-market reference rate is not what the bank
 * settled at, and the only thing that can tell it apart afterwards is this
 * string. `NVARCHAR(20)`, so it must stay short.
 */
export const RATE_SOURCE_OVERRIDE = "OVERRIDE";

/** Whether this row's rate was entered by hand — see `RATE_SOURCE_OVERRIDE`. */
export function isOverriddenRate(source: string | null | undefined): boolean {
  return norm(source) === RATE_SOURCE_OVERRIDE;
}
