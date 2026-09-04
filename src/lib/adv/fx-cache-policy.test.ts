import { test } from "node:test";
import assert from "node:assert/strict";
import { fxYmd, resolveFxDate, fxCacheKey, canServeCached } from "./fx-cache-policy";

/**
 * The FX cache's decisions, all of which are wrong in the obvious way.
 *
 * None is reachable from a behavioural test: `fx-rate-cache.ts` needs a pool
 * and `@/env` validates the whole environment at import, so the rules live in a
 * module that imports nothing and the database half holds no decisions.
 */

const NOW = new Date(2026, 8, 4, 10, 0); // Fri 4 Sep 2026, local

/** Narrow the union in tests that only care about the resolved day. */
function dayOf(now: Date): string {
  const r = resolveFxDate(undefined, now);
  assert.notEqual(r.kind, "invalid");
  return (r as { date: string }).date;
}


test("a local date never shifts across the ISO boundary", () => {
  // 23:30 local on the 4th is still the 4th. `toISOString()` would say the 5th
  // in Thailand (UTC+7), which would key an evening lookup to tomorrow.
  assert.equal(fxYmd(new Date(2026, 8, 4, 23, 30)), "2026-09-04");
  assert.equal(fxYmd(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
  assert.equal(fxYmd(new Date(2026, 11, 31)), "2026-12-31");
});

test("no date asked for means today, and the provider is asked for its latest", () => {
  for (const raw of [undefined, null, "", "   "]) {
    assert.deepEqual(resolveFxDate(raw, NOW), { kind: "today", date: "2026-09-04" });
  }
});

test("a well-formed past date is used exactly as given", () => {
  assert.deepEqual(resolveFxDate("2026-08-31", NOW), { kind: "explicit", date: "2026-08-31" });
});

test("today asked for explicitly is still explicit, and still today", () => {
  assert.deepEqual(resolveFxDate("2026-09-04", NOW), { kind: "explicit", date: "2026-09-04" });
});

/**
 * **The money bug this union exists to prevent.**
 *
 * The caller's date used to go two ways at once: to the key builder, which
 * demanded `YYYY-MM-DD` and silently substituted today for anything else; and
 * RAW to the provider, which did `new Date(raw)` and accepted far more. Every
 * spelling below therefore keyed on *today* while asking the bank about *31
 * August* — and the write stored August's rate under today's row, where
 * `resolveRate` (which passes no date at all) read it for the rest of the day.
 *
 * They are refusals now. Answering a question about one day with another day's
 * rate is the silent-wrong-value failure `toBaht` and `resolveRate` refuse.
 */
test("a date the provider would parse but the key would not is refused, not substituted", () => {
  for (const raw of [
    "2026-8-31",
    "2026/08/31",
    "08/31/2026",
    "August 31, 2026",
    "2026-08-31T00:00:00Z",
  ]) {
    assert.deepEqual(resolveFxDate(raw, NOW), { kind: "invalid" }, raw);
  }
});

test("junk is refused", () => {
  for (const raw of ["garbage", "latest", "31-08-2026", "2026-08"]) {
    assert.deepEqual(resolveFxDate(raw, NOW), { kind: "invalid" }, raw);
  }
});

/** Right shape, not a day. JS rolls it over rather than rejecting it. */
test("a date that is not a real calendar day is refused", () => {
  assert.deepEqual(resolveFxDate("2026-02-30", NOW), { kind: "invalid" });
  assert.deepEqual(resolveFxDate("2026-13-01", NOW), { kind: "invalid" });
  assert.deepEqual(resolveFxDate("2026-00-10", NOW), { kind: "invalid" });
  // A real leap day must still pass, so the rule is not just "reject the 30th".
  assert.deepEqual(resolveFxDate("2024-02-29", NOW), { kind: "explicit", date: "2024-02-29" });
});

/**
 * No provider can quote tomorrow, and `CK_FxRateCache_AsOf` would happily store
 * today's `asOf` under a future `QueryDate` — so accepting one let any
 * authenticated caller write rows for days nobody has reached.
 */
test("a future date is refused", () => {
  assert.deepEqual(resolveFxDate("2026-09-05", NOW), { kind: "invalid" });
  assert.deepEqual(resolveFxDate("2099-01-01", NOW), { kind: "invalid" });
});

/**
 * The key takes an already-resolved day, so the provider and the row can no
 * longer interpret the caller's string separately. That is the structural half
 * of the fix: the mismatch is unrepresentable rather than merely corrected.
 */
test("the key is built from a resolved day, and normalises the currency", () => {
  const when = resolveFxDate(undefined, NOW);
  assert.equal(when.kind, "today");
  const k = fxCacheKey(" usd ", when.date, "BOT");
  assert.deepEqual(k, { currency: "USD", queryDate: "2026-09-04", source: "BOT" });
});

/**
 * **The rule the whole design turns on.** Both providers publish on working
 * days only, so a lookup returns a rate stamped earlier than the day asked
 * about — measured on the first real call: asking on 2026-09-04 returned a rate
 * stamped 2026-09-03. Keyed on that stamp, every lookup all day would miss and
 * call out again. Keyed on the day asked, the second lookup hits.
 */
test("the key is the day asked for, not the day the provider answered with", () => {
  const morning = fxCacheKey("USD", dayOf(new Date(2026, 8, 5, 9)), "ECB");
  const evening = fxCacheKey("USD", dayOf(new Date(2026, 8, 5, 22)), "ECB");
  assert.equal(morning.queryDate, "2026-09-05");
  assert.deepEqual(morning, evening);
});

/**
 * Source is part of the key so registering a BOT credential stops serving
 * yesterday's ECB figure. Without it an operator configures BOT, sees no
 * change, and has nothing to look at.
 */
test("source is part of the key", () => {
  assert.notDeepEqual(
    fxCacheKey("USD", "2026-09-04", "BOT"),
    fxCacheKey("USD", "2026-09-04", "ECB"),
  );
});

test("a row from the other source is never served", () => {
  assert.equal(canServeCached({ rate: 36.5, asOf: "2026-09-04", source: "ECB" }, "BOT"), false);
  assert.equal(canServeCached({ rate: 36.5, asOf: "2026-09-04", source: "BOT" }, "BOT"), true);
});

/**
 * Zero, negative and non-finite are refusals, not values — the discipline
 * `resolveRate` and `toBaht` apply. `CK_FxRateCache_Rate` forbids them at the
 * column too; this is deliberately the second of two answers, because a
 * restored backup or a hand-edited row reaches the application through here.
 */
test("an unusable rate is a miss, not a value", () => {
  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      canServeCached({ rate, asOf: "2026-09-04", source: "ECB" }, "ECB"),
      false,
      String(rate),
    );
  }
});

test("no row is a miss", () => {
  assert.equal(canServeCached(null, "ECB"), false);
});
