import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountInBaht,
  currencyWord,
  fmtAmountWithCurrency,
  fmtMoneyTh,
  fmtRateAsOf,
  fmtRateTh,
  rateAsOfYmd,
  referenceRateNote,
  showsForeignCurrency,
} from "./currency-display";

test("baht keeps the Thai word, a foreign currency shows its code", () => {
  assert.equal(currencyWord(null), "บาท");
  assert.equal(currencyWord(undefined), "บาท");
  assert.equal(currencyWord(""), "บาท");
  assert.equal(currencyWord("THB"), "บาท");
  assert.equal(currencyWord("thb"), "บาท");
  assert.equal(currencyWord("MYR"), "MYR");
  assert.equal(currencyWord(" myr "), "MYR");
});

test("an absent figure is a dash, never 0.00", () => {
  assert.equal(fmtMoneyTh(null), "—");
  assert.equal(fmtMoneyTh(undefined), "—");
  assert.equal(fmtMoneyTh(Number.NaN), "—");
  assert.equal(fmtMoneyTh(0), "0.00");
});

test("a figure carries its own currency word", () => {
  assert.equal(fmtAmountWithCurrency(1234.5, "MYR"), "1,234.50 MYR");
  assert.equal(fmtAmountWithCurrency(1234.5, null), "1,234.50 บาท");
  assert.equal(fmtAmountWithCurrency(null, "MYR"), "— MYR");
});

test("a rate prints at four to six places — what DECIMAL(18,6) can hold", () => {
  assert.equal(fmtRateTh(8.25), "8.2500");
  assert.equal(fmtRateTh(8.123456), "8.123456");
  assert.equal(fmtRateTh(null), "—");
});

/** Never captioned as a Bank of Thailand rate — BOT_API_CLIENT_ID is unprovisioned. */
test("the rate caption says reference, and names no bank", () => {
  const note = referenceRateNote("MYR", 8.25);
  assert.ok(note.indexOf("อัตราอ้างอิง") === 0, note);
  assert.ok(note.indexOf("1 MYR") !== -1, note);
  assert.equal(note.indexOf("ธนาคารแห่งประเทศไทย"), -1);
});

/* ── Which day's rate it was (migration 130) ── */

/**
 * A date, or nothing. Never a guess — `RateAsOf` exists to say what a figure
 * was converted at, so a wrong date there is worse than an admitted absence.
 */
test("a rate date is normalised to YYYY-MM-DD or refused outright", () => {
  assert.equal(rateAsOfYmd("2026-08-28"), "2026-08-28");
  assert.equal(rateAsOfYmd("  2026-08-28  "), "2026-08-28");
  // What the driver hands back out of a DATE column.
  assert.equal(rateAsOfYmd(new Date(2026, 7, 28)), "2026-08-28");
  assert.equal(rateAsOfYmd(null), null);
  assert.equal(rateAsOfYmd(undefined), null);
  // `resolveRate` answers `""` for baht, which describes no conversion at all.
  assert.equal(rateAsOfYmd(""), null);
  assert.equal(rateAsOfYmd("28/08/2026"), null);
  assert.equal(rateAsOfYmd("2026-8-28"), null);
  assert.equal(rateAsOfYmd(new Date("nope")), null);
});

/**
 * `new Date(2026, 1, 29)` rolls forward to 1 March rather than failing, so a
 * day the month does not have would be stored as one date and shown as another.
 */
test("a day the month does not have is refused, not rolled forward", () => {
  assert.equal(rateAsOfYmd("2026-02-29"), null);
  assert.equal(rateAsOfYmd("2024-02-29"), "2024-02-29");
  assert.equal(rateAsOfYmd("2026-13-01"), null);
  assert.equal(rateAsOfYmd("2026-00-10"), null);
  assert.equal(rateAsOfYmd("2026-04-31"), null);
});

test("a rate date reads as a Thai date, and an absent one as nothing at all", () => {
  // Common era, not Buddhist: the reader checking this is looking at the rate
  // source's own site, where the year is 2026.
  assert.equal(fmtRateAsOf("2026-08-28"), "28 Aug 2026");
  assert.equal(fmtRateAsOf("2026-01-01"), "1 Jan 2026");
  assert.equal(fmtRateAsOf("2026-12-31"), "31 Dec 2026");
  assert.equal(fmtRateAsOf(null), "");
  assert.equal(fmtRateAsOf(""), "");
});

/**
 * The ECB publishes on working days only, so the date is regularly *not* the
 * day the claim was saved — which is the whole reason it has to be on screen.
 */
test("the caption names the day the rate was published, when one is known", () => {
  assert.equal(
    referenceRateNote("MYR", 8.1856, "2026-08-28"),
    "อัตราอ้างอิง 1 MYR = 8.1856 บาท (ณ 28 Aug 2026)",
  );
});

/**
 * Every row written before migration 130 reads NULL, which is the truth. The
 * caption then reads exactly as it always did — no invented date, and no empty
 * bracket left behind by a naive template.
 */
test("a caption with no date is unchanged from before migration 130", () => {
  const bare = referenceRateNote("MYR", 8.25);
  assert.equal(referenceRateNote("MYR", 8.25, null), bare);
  assert.equal(referenceRateNote("MYR", 8.25, undefined), bare);
  assert.equal(referenceRateNote("MYR", 8.25, ""), bare);
  assert.equal(referenceRateNote("MYR", 8.25, "not-a-date"), bare);
  assert.equal(bare.indexOf("("), -1, bare);
});

/**
 * The invariant a baht claim rests on: no rate is consulted and the figure comes
 * back untouched, so nothing a baht claim displays can move.
 */
test("a baht figure passes through unconverted, with or without a rate", () => {
  assert.equal(amountInBaht(1234.56, null, null), 1234.56);
  assert.equal(amountInBaht(1234.56, "THB", 8.25), 1234.56);
  assert.equal(amountInBaht(1234.56, "", null), 1234.56);
  assert.equal(amountInBaht(0, null, null), 0);
});

test("a foreign figure converts at the stored rate", () => {
  assert.equal(amountInBaht(100, "MYR", 8.25), 825);
  assert.equal(amountInBaht(12.34, "MYR", 8.25), 101.81);
});

/** Never the unconverted figure — that is a ringgit number in a baht column. */
test("a foreign figure with no usable rate is null, never itself", () => {
  assert.equal(amountInBaht(100, "MYR", null), null);
  assert.equal(amountInBaht(100, "MYR", 0), null);
  assert.equal(amountInBaht(100, "MYR", -1), null);
  assert.equal(amountInBaht(100, "MYR", Number.NaN), null);
});

test("an absent figure converts to null in either currency", () => {
  assert.equal(amountInBaht(null, null, null), null);
  assert.equal(amountInBaht(undefined, "MYR", 8.25), null);
});

test("only a foreign claim shows anything extra", () => {
  assert.equal(showsForeignCurrency(null), false);
  assert.equal(showsForeignCurrency("THB"), false);
  assert.equal(showsForeignCurrency(""), false);
  assert.equal(showsForeignCurrency("MYR"), true);
});
