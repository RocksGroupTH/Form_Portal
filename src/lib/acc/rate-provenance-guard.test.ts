import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RATE_SOURCE_OVERRIDE, isOverriddenRate } from "./currency";

/**
 * **A stored rate is never stored alone** (migration 130).
 *
 * `resolveRate` has always answered `{ rate, asOf, source }` and, until this
 * work, every caller kept the number and threw the other two away. So a claim
 * recorded that it converted at 8.1856 and nothing about when that was the rate
 * or who said so — and neither is recoverable afterwards:
 *
 *   * Whichever feed answered, it publishes on **working days only**. A line
 *     saved on a Saturday carries Friday's rate; over a long weekend, a
 *     three-day-old one. That behaviour is correct and deliberate — there is no
 *     rate for a day the market did not trade — but without `RateAsOf` nothing
 *     afterwards can tell which day a figure used.
 *   * A `BOT_CURRENCY_RATE` key was registered on 2026-09-04, so a rate recorded
 *     from that day on is the Bank of Thailand selling rate and every one before
 *     it is `bot-fx`'s ECB mid-market fallback. Rows either side convert on
 *     different bases, and `RateSource` is the only column that could
 *     distinguish them.
 *   * An accounting override is one person's figure, reproducible from no feed
 *     at all, so it must name itself rather than reading as published.
 *
 * None of the three writers is unit-testable — each needs a pool, and `@/env`
 * validates the whole environment at import. So this reads the sources, in the
 * shape `request-total-baht.test.ts` and `booking-currency-guard.test.ts`
 * already use. If it goes red the fix is to carry the provenance, never to relax
 * the check.
 */

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8");
}

/** Comments quoting a rule must not satisfy the check for it. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const AP1_SERVICE = "lib/acc/request-service.ts";
const AP17_SERVICE = "lib/acc/travel-booking/admin-service.ts";
const OVERRIDE = "lib/acc/line-rate-override.ts";

/* ── AP-1: per expense line ── */

/**
 * The line's money columns and its two provenance columns travel in one bind
 * and one set of fragments, so the insert and the update cannot come to
 * disagree about which of them a row gets.
 */
test("AP-1 writes the rate's day and source beside every line rate", () => {
  const src = code(AP1_SERVICE);
  // The insert names the columns and then the parameters, in two fragments that
  // have to stay the same length; the update names both together.
  const expected: [string, RegExp[]][] = [
    ["LINE_FX_COLUMNS", [/RateAsOf/, /RateSource/]],
    ["LINE_FX_VALUES", [/@lineAsOf/, /@lineSource/]],
    ["LINE_FX_SET", [/RateAsOf=@lineAsOf/, /RateSource=@lineSource/]],
  ];
  for (const [frag, patterns] of expected) {
    const at = src.indexOf("const " + frag + " =");
    assert.notEqual(at, -1, frag + " not found");
    const decl = src.slice(at, src.indexOf("`;", at));
    for (const p of patterns) {
      assert.ok(p.test(decl), `${frag} omits ${String(p)}`);
    }
  }
  // Bound, never interpolated — these statements carry money.
  const start = src.indexOf("function bindLineFx");
  const bind = src.slice(start, src.indexOf("\n}", start));
  assert.ok(/\.input\("lineAsOf", sql\.Date,/.test(bind), "RateAsOf must be a bound DATE");
  assert.ok(
    /\.input\("lineSource", sql\.NVarChar\(20\),/.test(bind),
    "RateSource must be bound, and bounded to the column width",
  );
});

/**
 * The provenance follows the **rate**, not the currency. A baht line consults no
 * provider and an unanswered one has no conversion at all, so a day or a source
 * on either would describe something that did not happen.
 */
test("AP-1 stores no provenance where it stored no rate", () => {
  const src = code(AP1_SERVICE);
  const bindAt = src.indexOf("function bindLineFx");
  const bind = src.slice(bindAt, src.indexOf("\n}", bindAt));
  assert.ok(
    /const asOf = rate === null \? null :/.test(bind),
    "a day must not outlive the rate it qualifies",
  );
  assert.ok(
    /const source = rate === null \? null :/.test(bind),
    "a source must not outlive the rate it qualifies",
  );

  // The same rule one level up, where the figure is converted.
  const fxAt = src.indexOf("function lineFxOrThrow");
  const body = src.slice(fxAt, src.indexOf("\n}", fxAt));
  const nulls = body.match(/asOf: null, source: null/g) ?? [];
  assert.equal(
    nulls.length,
    2,
    "the baht branch and the unanswered branch must both record nothing",
  );
});

/** The whole answer is kept now, not just the number. */
test("AP-1's single rate fetch keeps asOf and source", () => {
  const src = code(AP1_SERVICE);
  const start = src.indexOf("async function toBahtDays");
  const body = src.slice(start, src.indexOf("\nasync function", start + 10));
  assert.ok(/let resolved: ResolvedRate \| null = null/.test(body), "the whole ResolvedRate must be kept");
  assert.ok(/resolved = fx;/.test(body), "the fetch's answer must not be reduced to its rate");
  assert.ok(
    /rateAsOf: fx\.asOf/.test(body) && /rateSource: fx\.source/.test(body),
    "each converted line must carry the provenance out of the conversion",
  );
});

/**
 * AP-1 records no request-level currency, and so no request-level rate date
 * either: a day beside a cleared currency asserts a conversion that is not on
 * the row. All three header writers clear the whole group together.
 */
test("AP-1's header clear covers the provenance columns too", () => {
  assert.ok(
    /Currency=NULL, ExchangeRate=NULL, ForeignAmount=NULL, RateAsOf=NULL, RateSource=NULL/.test(
      code(AP1_SERVICE),
    ),
    "FX_CLEAR must clear the provenance along with the currency it belongs to",
  );
});

/* ── AP-17: per request, from the booking desk ── */

test("AP-17 writes the rate's day and source in the same statement as the rate", () => {
  const src = code(AP17_SERVICE);
  const updates = src.match(/UPDATE \[dbo\]\.\[AccRequest\] SET[^`;]*/g) ?? [];
  const write = updates.filter((u) => u.indexOf("Currency=") >= 0);
  assert.equal(write.length, 1, `expected one currency write, found ${write.length}`);
  // One statement or none: a date that could arrive a commit later than the rate
  // would describe a figure that is not on the row.
  assert.ok(/RateAsOf=@rateAsOf/.test(write[0]), "the write must set RateAsOf");
  assert.ok(/RateSource=@rateSource/.test(write[0]), "the write must set RateSource");
  assert.ok(/\.input\("rateAsOf", sql\.Date,/.test(src), "RateAsOf must be a bound DATE");
  assert.ok(
    /\.input\("rateSource", sql\.NVarChar\(20\),/.test(src),
    "RateSource must be bound, and bounded to the column width",
  );
});

/** A baht request stores nothing, exactly as it stores no currency and no rate. */
test("AP-17 stores no provenance on a baht request", () => {
  const src = code(AP17_SERVICE);
  assert.ok(
    /\.input\("rateAsOf", sql\.Date, fx\.currency === null \? null : fx\.asOf\)/.test(src),
    "a baht request must write NULL, not a date nobody converted at",
  );
  assert.ok(
    /\.input\("rateSource", sql\.NVarChar\(20\), fx\.currency === null \? null : fx\.source\)/.test(src),
    "a baht request must write NULL, not a source nobody consulted",
  );
});

/* ── The accounting override names itself ── */

/**
 * A hand-corrected rate must never read as one a provider published. It is one
 * person's number, entered because the reference rate is not what the bank
 * settled at, and nothing else in the row could tell the two apart.
 */
test("the override rewrites the provenance with the rate, and names itself", () => {
  const src = code(OVERRIDE);
  const at = src.indexOf("UPDATE i SET i.Amount=@amount");
  assert.notEqual(at, -1, "the line update was not found");
  const upd = src.slice(at, src.indexOf("CurrentStepCode='ACCOUNT'", at));
  assert.ok(
    /i\.RateAsOf=CAST\(SYSDATETIME\(\) AS DATE\)/.test(upd),
    "the day must be rewritten to the day of the correction, off the server's own clock",
  );
  assert.ok(/i\.RateSource=@rateSource/.test(upd), "the source must be rewritten too");
  assert.ok(
    /\.input\("rateSource", sql\.NVarChar\(20\), RATE_SOURCE_OVERRIDE\)/.test(src),
    "the source must be the shared constant, not a string typed here",
  );
});

/**
 * The queue patches its open drawer from this result rather than refetching, so
 * the written date has to come back — and it comes back out of the statement
 * that wrote it, not off a second clock that could disagree across midnight.
 */
test("the override returns the provenance it wrote, read out of the write", () => {
  const src = code(OVERRIDE);
  assert.ok(
    /OUTPUT inserted\.RateAsOf AS RateAsOf/.test(src),
    "the written date must be read back, never recomputed",
  );
  assert.ok(/rateSource: RATE_SOURCE_OVERRIDE,/.test(src), "the result must name the source it wrote");
  assert.ok(/\brateAsOf,/.test(src), "the result must carry the date it wrote");
});

/* ── The constant itself ── */

test("the override source fits NVARCHAR(20) and is recognised whatever its casing", () => {
  assert.ok(RATE_SOURCE_OVERRIDE.length <= 20, RATE_SOURCE_OVERRIDE);
  assert.equal(isOverriddenRate(RATE_SOURCE_OVERRIDE), true);
  assert.equal(isOverriddenRate("override"), true);
  assert.equal(isOverriddenRate("  Override "), true);
  // A published source is not one, and nor is an absent one.
  assert.equal(isOverriddenRate("ECB"), false);
  assert.equal(isOverriddenRate("BOT"), false);
  assert.equal(isOverriddenRate(null), false);
  assert.equal(isOverriddenRate(""), false);
});
