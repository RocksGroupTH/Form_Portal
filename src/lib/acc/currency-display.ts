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
 * The reference-rate caption. **Never "อัตราแลกเปลี่ยนธนาคารแห่งประเทศไทย".**
 *
 * `BOT_API_CLIENT_ID` is deliberately unprovisioned (spec §9.1), so every rate
 * this app records comes from `bot-fx`'s keyless ECB fallback — a mid-market
 * reference rate, which is not what a bank settles at. Captioning it as a Bank
 * of Thailand rate would state something false on a screen accounting signs off
 * against, and it would be stated on every screen at once, which is why the
 * sentence lives here rather than being retyped per surface.
 */
export function referenceRateNote(
  currency: string | null | undefined,
  rate: number,
): string {
  return `อัตราอ้างอิง 1 ${norm(currency)} = ${fmtRateTh(rate)} บาท`;
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
