import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **`AccTravelExpenseItem.Amount` is Thai baht, always** — and therefore so is
 * every total built from it.
 *
 * Migration 129 moved the currency from the request to the line, and the reason
 * the change was small is that the *baht* column did not move with it. `Amount`
 * never stops being baht, so `calc.ts`'s `sum()`, the T-SQL `SUM(i.Amount)` in
 * `TRAVEL_DAYS_CSV_SELECT` that feeds the ERP prep queue an approver reads
 * immediately before pressing Send, the journal builder, and the approval
 * queue's per-vehicle cell all keep working with no idea a currency exists. A
 * foreign figure written into that column is not a display bug — it is a wrong
 * number in a financial posting, and no screen anywhere would reveal it.
 *
 * The conversion therefore has exactly **one** place it may happen on the way
 * in, `toBahtDays`, and the three `AccRequest.TotalAmount` writers must then be
 * plain sums. The middle writer is the trap: it is not a save and not a submit,
 * it is the recompute after a requester deletes a receipt row, it runs outside a
 * transaction, and it fires on an ordinary edit of a claim that was already
 * correct. Two separate reviews of the predecessor design listed two writers.
 *
 * Neither the writers nor the conversion is unit-testable — `request-service.ts`
 * needs a pool, and `@/env` validates the whole environment at import. So this
 * reads the source, in the shape `blocked-dates-parity.test.ts` and
 * `currency-pool-guard.test.ts` already use. The rule *itself* is pure and
 * tested for real in `features/accounting/lib/claim-currency.test.ts`.
 *
 * If this goes red the fix is to route the new writer through the same single
 * conversion, never to relax a count.
 */

const SERVICE = path.join(process.cwd(), "src/lib/acc/request-service.ts");

function code(): string {
  return fs
    .readFileSync(SERVICE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("AP-1 has exactly three AccRequest.TotalAmount writers", () => {
  const src = code();

  // `[dbo].[AccRequest] SET ... TotalAmount=@total` — the header column. The
  // per-day `AccTravelExpense` write is deliberately NOT matched here; it has
  // its own test below.
  const headerWrites = src.match(/\[dbo\]\.\[AccRequest\][\s\S]{0,600}?TotalAmount=@total/g) ?? [];
  assert.equal(
    headerWrites.length,
    3,
    `expected 3 AccRequest.TotalAmount writers (persistTravelDays, deleteItem, submitRequest), found ${headerWrites.length}. ` +
      "A new one must bind @total from a sum of already-converted lines.",
  );
});

/**
 * Every one of the three binds a **plain sum**, because the lines it adds are
 * already baht. A conversion here would be a second copy of the rule and would
 * double-convert whatever `toBahtDays` had already done.
 */
test("every header writer binds a plain sum of already-converted lines", () => {
  const src = code();
  // Four `@total` bindings in the file: the three header writers, plus
  // `deleteItem`'s per-day `AccTravelExpense` recompute, which the test below
  // owns. None of the four may convert.
  const bound = src.match(/\.input\("total",\s*sql\.Decimal\(18,\s*2\),\s*[^)]*\)+/g) ?? [];
  assert.equal(bound.length, 4, `expected 4 @total bindings, found ${bound.length}`);
  for (const b of bound) {
    assert.equal(
      /toBaht|ExchangeRate|\*\s*rate/.test(b),
      false,
      "a total is being converted; the lines it sums are already baht: " + b,
    );
  }
  // The three header ones are the sum across days, and nothing else.
  const headerTotals = bound.filter((b) => /computeRequestTotalAmount\(|,\s*totalAmount\)/.test(b));
  assert.equal(
    headerTotals.length,
    3,
    `expected 3 header totals summed across days, found ${headerTotals.length}: ${bound.join(" | ")}`,
  );
});

/**
 * The single conversion. `toBaht` returns null when it cannot know, and the one
 * thing that must never happen is a fallback to the unconverted figure — see
 * `acc/currency.ts`.
 */
test("lineFxOrThrow is the only conversion, and it has no fallback branch", () => {
  const src = code();
  const start = src.indexOf("function lineFxOrThrow");
  assert.notEqual(start, -1, "lineFxOrThrow not found");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(/if \(baht === null\) throw/.test(body), "must throw on null, not fall back");
  assert.ok(!/\?\?\s*(typed|amount)/.test(body), "must never fall back to the unconverted figure");

  // Exactly one `toBaht` call in the whole file: a second would be a second
  // rounding, on the path that decides what a claim is worth.
  const calls = src.match(/toBaht\(/g) ?? [];
  assert.equal(calls.length, 1, `expected one toBaht call, found ${calls.length}`);
});

/**
 * A baht line takes an identity branch that consults no rate at all. That is
 * what keeps an FX outage away from the Thai claims that are almost all of
 * them, and what makes a Thai claim's arithmetic bit-identical to what it was
 * before migration 129.
 *
 * **The figure and the rate are still absolutes; only the `Currency` column is
 * conditional.** On a Thai claim it is null, exactly as before. On a claim that
 * offers a choice it is `'THB'`, because there a missing currency is how an
 * *unanswered* line is written down — and a baht line recording nothing would
 * be indistinguishable from one nobody had priced, which is the state
 * `validateForSubmit` refuses. `recordBaht` is the only thing that may vary it.
 */
test("a baht line is converted by nothing and takes the typed figure through", () => {
  const src = code();
  const start = src.indexOf("function lineFxOrThrow");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(
    /if \(isBaht\(currency\)\)[\s\S]{0,200}?amount: typed, currency: recordBaht \? THB : null, rate: null, foreignAmount: null/.test(body),
    "the baht branch must return the typed figure, no rate, no foreign figure",
  );
});

/**
 * The third state, and the reason the second one had to change: a line whose
 * currency nobody has stated banks **no baht at all** and keeps the typed
 * figure where it can be asked about. It is savable — a draft is where the
 * question gets answered — and `validateForSubmit` refuses to submit it.
 *
 * Zero here is the truth rather than a fallback. The one thing that must never
 * happen is the typed figure reaching `amount`, which is the baht column every
 * total, export and Business Central journal reads.
 */
test("an unanswered line banks no baht and keeps the typed figure", () => {
  const src = code();
  const start = src.indexOf("function lineFxOrThrow");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(
    /if \(currency === null\) \{[\s\S]{0,200}?amount: 0, currency: null, rate: null, foreignAmount: typed/.test(body),
    "the unanswered branch must bank zero baht and keep the typed figure",
  );

  // And the submit refuses exactly those lines, on the shared pure predicate.
  assert.ok(
    /lineNeedsCurrency\(it, lineCurrencies\)/.test(src),
    "validateForSubmit must refuse a line whose currency nobody has stated",
  );
  // The country it derives those options from is the brand-checked one, not the
  // posted string — the same rule the save applies.
  assert.ok(
    /lineCurrencyOptions\(\s*await resolveClaimCountry\(/.test(src),
    "the submit's option list must be re-derived against the brand",
  );
});

/**
 * `ForeignAmount` outlives a null `Currency` in the bind, because that pair
 * *is* the unanswered line. Dropping the figure with the currency would lose
 * the number the requester is being asked about, and the row would come back
 * from a reload as an empty one.
 */
test("the line bind keeps the typed figure when no currency was stated", () => {
  const src = code();
  const start = src.indexOf("function bindLineFx");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(
    /const foreign = it\.foreignAmount \?\? null;/.test(body),
    "ForeignAmount must not be dropped along with a null Currency",
  );
  assert.ok(
    /const rate = currency === null \? null : it\.exchangeRate/.test(body),
    "a rate must not be stored for a currency nobody stated",
  );
});

/**
 * The rate is fetched once per save and only when a line actually needs one, so
 * a trip whose every line is in baht makes no FX call — and a fetch that fails
 * throws rather than letting the save through at a guessed rate.
 */
test("toBahtDays fetches at most one rate, and refuses when it cannot", () => {
  const src = code();
  const start = src.indexOf("async function toBahtDays");
  assert.notEqual(start, -1, "toBahtDays not found");
  const body = src.slice(start, src.indexOf("\nasync function", start + 10));
  const fetches = body.match(/await resolveRate\(/g) ?? [];
  assert.equal(fetches.length, 1, `expected exactly one rate fetch, found ${fetches.length}`);
  assert.ok(/if \(foreign\)/.test(body), "the fetch must be behind a test for a foreign line");
  assert.ok(/if \(!fx\) throw new Error\(FX_UNAVAILABLE_ERROR\)/.test(body), "a failed fetch must throw");

  // Only `resolveRate` may reach the provider from this file, and only there.
  const all = code().match(/resolveRate\(/g) ?? [];
  assert.equal(all.length, 1, `resolveRate is called ${all.length} times; it belongs in toBahtDays alone`);
});

/**
 * The per-day column is the other half of the rule and it is now baht too,
 * because the items it sums are. A reader "fixing" it to hold the claim's own
 * currency would reintroduce exactly the thing 129 removed.
 */
test("the per-day AccTravelExpense.TotalAmount is the same converted sum", () => {
  const src = code();
  assert.ok(
    /\.input\("totalAmt", sql\.Decimal\(18, 2\), computeTotalAmount\(day\)\)/.test(src),
    "bindTravel must bind the day's sum of already-converted lines",
  );
  assert.ok(
    /UPDATE \[dbo\]\.\[AccTravelExpense\] SET TotalAmount=@total, TotalDistanceKm=@dist/.test(src),
    "deleteItem's per-day recompute must stay a plain sum",
  );
});

/**
 * AP-1 records no request-level currency any more. All three header writers
 * clear 125's columns instead, so a draft saved under the old design cannot keep
 * a header currency beside per-line baht amounts — every display surface reads
 * that header to decide what a day figure is denominated in, and would convert
 * an already-converted figure a second time.
 */
test("every header writer clears the request-level currency columns", () => {
  const src = code();
  const clears = src.match(/Currency=NULL, ExchangeRate=NULL, ForeignAmount=NULL/g) ?? [];
  assert.equal(
    clears.length,
    1,
    "the clear belongs in one shared fragment (FX_CLEAR), used by all three writers",
  );
  const uses = src.match(/\$\{FX_CLEAR\}/g) ?? [];
  assert.equal(uses.length, 3, `expected all 3 header writers to use FX_CLEAR, found ${uses.length}`);

  // And nothing here writes a value into them.
  assert.equal(
    /Currency=@(currency|fxRate|foreignAmt)/.test(src),
    false,
    "AP-1 must not record a request-level currency; the currency lives on the line",
  );
});

/**
 * The client picks a country and each line picks a currency; **neither ever
 * picks a rate.** AP-2 lets the browser post one and nothing verifies it there,
 * which is the single part of that design this feature deliberately does not
 * reuse.
 */
test("SaveInput carries a country and no rate", () => {
  const src = code();
  const start = src.indexOf("export interface SaveInput");
  assert.notEqual(start, -1);
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(/countryCode\?:/.test(body), "SaveInput must accept the chosen country");
  assert.ok(
    !/exchangeRate|rate\?:|currency\?:/.test(body),
    "SaveInput must NOT accept a rate or a request-level currency",
  );
});

/**
 * The posted line currency is never trusted as written: `effectiveLineCurrency`
 * re-derives it from the country, so a hand-shaped body cannot file a line in a
 * currency the picker never offered. Same for the country against the brand.
 */
test("both the country and each line's currency are re-derived server-side", () => {
  const src = code();
  assert.ok(/effectiveClaimCountry\(/.test(src), "the posted country must be checked against the brand");
  assert.ok(/effectiveLineCurrency\(it\.currency, country\)/.test(src), "each line's currency must be re-derived");
});
