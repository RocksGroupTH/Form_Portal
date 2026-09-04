/**
 * How a figure is *shown* once a claim may be in something other than baht.
 *
 * It imports only `@/lib/acc/currency`, which imports nothing at all, so every
 * rule here is unit-tested without a database and is safe in a client bundle —
 * the same constraint `features/accounting/lib/claim-currency.ts` records.
 *
 * ── Why display needs its own module ──
 *
 * `AccRequest.TotalAmount` is Thai baht always, and that invariant is what left
 * every summer, report and ERP path untouched when the currency landed. What it
 * did **not** leave untouched is every screen that prints a *per-day* or
 * *per-line* figure: `AccTravelExpense.TotalAmount` and
 * `AccTravelBookingDetail.*` are in the claim's own currency, and the surfaces
 * printing them all captioned `บาท` unconditionally. A ringgit figure captioned
 * as baht beside a baht header that does not sum to it is not a cosmetic fault —
 * on the ERP prep queue it is the last thing an approver reads before pressing
 * Send.
 *
 * Nothing here converts anything that is stored. `amountInBaht` is a display
 * conversion, and it answers **null** rather than a guess when it cannot be
 * done, exactly as `toBaht` does and for the same reason.
 */

import { isBaht, toBaht } from "@/lib/acc/currency";

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/**
 * The word that goes after a figure — `บาท`, or the currency code.
 *
 * Baht keeps the Thai word it has always had, so a baht claim reads exactly as
 * it did before this feature shipped. A foreign claim gets the ISO code rather
 * than a translated name: `MYR` is what the invoice, the rate line and the
 * picker all say, and inventing a Thai name for each currency would be three
 * spellings of one thing.
 */
export function currencyWord(code: string | null | undefined): string {
  return isBaht(code) ? "บาท" : norm(code);
}

/** Two-decimal Thai-locale money. `—` for absent, never `0.00`. */
export function fmtMoneyTh(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A rate, at four to six places.
 *
 * `AccRequest.ExchangeRate` is `DECIMAL(18,6)` (migration 125), so six is what
 * the database can hold and printing fewer would show a rate the approver
 * cannot reproduce. Four is the floor because a rate near 8.25 reads as a
 * rounded guess at two.
 */
export function fmtRateTh(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return rate.toLocaleString("th-TH", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

/** `1,234.56 MYR` / `1,234.56 บาท` — a figure that cannot be read as the wrong money. */
export function fmtAmountWithCurrency(
  n: number | null | undefined,
  code: string | null | undefined,
): string {
  return `${fmtMoneyTh(n)} ${currencyWord(code)}`;
}

/**
 * A stored rate date as `YYYY-MM-DD`, or **null when there is none**.
 *
 * Takes what the provider answered (`ResolvedRate.asOf`, already `YYYY-MM-DD`)
 * or what the driver read back out of a `DATE` column (a `Date`), so the write
 * and the read normalise through one definition. Anything else — `""`, a
 * half-typed string, a day the month does not have — is null rather than a
 * guess: `RateAsOf` exists to say which day's rate a figure used, and a wrong
 * date there is worse than an admitted absence. That is the same reasoning
 * migration 130 backfilled nothing on.
 *
 * Local getters on the `Date`, never `toISOString()`. Every timestamp in these
 * databases is a Thai wall clock and the Node process runs in the same zone
 * (`useUTC: false`), so a UTC conversion would move a Bangkok date backwards
 * across midnight.
 */
export function rateAsOfYmd(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  // `new Date(2026, 1, 29)` rolls forward to 1 March rather than failing, so a
  // day the month does not have would otherwise be accepted here and then shown
  // as a different date than the one stored.
  if (day > new Date(year, month, 0).getDate()) return null;
  return m[0];
}

/**
 * The twelve Thai month abbreviations, spelled out here rather than imported.
 *
 * This module imports only `@/lib/acc/currency`, which imports nothing at all —
 * that is what makes every rule in it unit-testable and safe in a client
 * bundle. `features/accounting/lib/thai-calendar.ts` carries the same table,
 * but it sits in a feature and `lib/` must not reach up into one.
 */
/**
 * English months, and common-era years, for the rate date alone.
 *
 * **Every other date this app shows a Thai reader is Thai and Buddhist-era.**
 * This one is deliberately not, and it is the only such date: it is the day an
 * international rate source published a rate, and the person who checks it will
 * be on the ECB's own page, where it reads "28 Aug 2026". Printing "28 ส.ค.
 * 2569" beside a figure taken from there asks somebody to reconcile two
 * calendars and two languages in their head, over an exchange rate.
 *
 * Do not "make this consistent" with the rest of the app without knowing that.
 */
const RATE_MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `"2026-08-28"` → `"28 Aug 2026"`. `""` for a date nobody recorded.
 *
 * Named `...AsOf` and not `...Th`: it is the one date in this app that is
 * neither Thai nor Buddhist-era. See `RATE_MONTHS_EN` for why.
 */
export function fmtRateAsOf(v: string | Date | null | undefined): string {
  const ymd = rateAsOfYmd(v);
  if (ymd === null) return "";
  const year = Number(ymd.slice(0, 4));
  const month0 = Number(ymd.slice(5, 7)) - 1;
  const day = Number(ymd.slice(8, 10));
  return `${day} ${RATE_MONTHS_EN[month0]} ${year}`;
}

/**
 * The reference-rate caption. **Never "อัตราแลกเปลี่ยนธนาคารแห่งประเทศไทย".**
 *
 * A `BOT_CURRENCY_RATE` key was registered on 2026-09-04, so a rate recorded
 * from that day on is the Bank of Thailand selling rate while everything
 * recorded before it came from `bot-fx`'s keyless ECB mid-market fallback. This
 * one sentence captions rows of both kinds, so naming either feed would state
 * something false about the other on a screen accounting signs off against —
 * and it would state it on every screen at once, which is why the sentence lives
 * here rather than being retyped per surface. `rateSource` on the row is what
 * distinguishes the two, and neither figure is what the company's own bank
 * finally charged, which is why the override exists at all.
 *
 * **`asOf` says which day's rate that was, and it matters more than it looks.**
 * Neither feed publishes on a day the market did not trade, so a claim saved on
 * a Saturday carries Friday's rate, and one saved after a long weekend can carry
 * a three-day-old one. That behaviour is correct and deliberate — there is no
 * rate for a day the market did not trade — but without the date on screen
 * nobody can tell afterwards which day a figure was converted at. Migration 130
 * is what stores it; this is where it is read out.
 *
 * **Optional, and silently omitted when absent.** Every row written before 130
 * reads NULL, which is the truth: nobody recorded the provenance. The caption
 * then reads exactly as it always did, rather than printing an invented date or
 * an empty bracket.
 */
export function referenceRateNote(
  currency: string | null | undefined,
  rate: number,
  asOf?: string | Date | null,
): string {
  const note = `อัตราอ้างอิง 1 ${norm(currency)} = ${fmtRateTh(rate)} บาท`;
  const on = fmtRateAsOf(asOf);
  return on === "" ? note : `${note} (ณ ${on})`;
}

/**
 * A figure recorded in a claim's own currency, expressed in baht — or null.
 *
 * Baht passes straight through, so **a baht claim's arithmetic is bit-identical
 * to what it was before this feature existed**: no rate is consulted, no
 * rounding is applied, and a screen showing baht cannot start showing a
 * different number because a currency column was added.
 *
 * A foreign figure with no usable rate answers **null**, never the unconverted
 * figure. Returning the figure would put a ringgit number in a baht column on
 * the posting-preview screen — the one failure the whole currency feature
 * exists to prevent, and one that leaves no trace on screen. Callers show the
 * claim's own figure with its own code instead, and leave it out of any baht
 * total they are summing.
 */
export function amountInBaht(
  amount: number | null | undefined,
  currency: string | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (isBaht(currency)) return amount;
  return toBaht(amount, rate == null || !Number.isFinite(rate) ? null : rate);
}

/**
 * Whether a surface has to say anything extra at all.
 *
 * Every conditional block added by the display work is behind this, so a claim
 * with no currency — which is every claim written before migration 125, and
 * every claim against a brand nobody has configured — renders precisely the
 * markup it rendered yesterday. That is the plan's own Global Constraint, and a
 * single predicate is what makes it checkable rather than hoped for.
 */
export function showsForeignCurrency(code: string | null | undefined): boolean {
  return !isBaht(code);
}
