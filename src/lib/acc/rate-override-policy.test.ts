import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_OVERRIDE_RATE,
  planLineRateOverride,
  planRateOverride,
  LINE_RATE_REFUSAL_TEXT,
  type LineRateRefusal,
  RATE_DECIMALS,
  RATE_OVERRIDE_REFUSAL_TEXT,
  sanitizeOverrideRate,
} from "@/lib/acc/rate-override-policy";

/* ── sanitizeOverrideRate ── */

test("a plain rate is taken, as a number or as the string the input yields", () => {
  assert.equal(sanitizeOverrideRate(8.25), 8.25);
  assert.equal(sanitizeOverrideRate("8.25"), 8.25);
  assert.equal(sanitizeOverrideRate("  8.25  "), 8.25);
});

test("nothing that is not a positive finite number survives", () => {
  for (const bad of [0, -1, "0", "-3", "", "   ", "abc", NaN, Infinity, -Infinity, null, undefined, {}, []]) {
    assert.equal(sanitizeOverrideRate(bad), null, `expected refusal for ${JSON.stringify(bad)}`);
  }
});

/**
 * `AccRequest.ExchangeRate` is `DECIMAL(18,6)`. Rounding must happen **before**
 * the bounds test, not after: a rate that rounds to zero would be stored as
 * zero and make `toBaht` return null on every later read of the claim, so the
 * edit has to be refused rather than accepted and silently flattened.
 */
test("the rate is rounded to what the column holds, and one that rounds away is refused", () => {
  assert.equal(RATE_DECIMALS, 6);
  assert.equal(sanitizeOverrideRate(8.1234564), 8.123456);
  assert.equal(sanitizeOverrideRate(8.1234565), 8.123457);
  assert.equal(sanitizeOverrideRate(0.0000004), null, "rounds to zero — must be refused, not stored as 0");
  assert.equal(sanitizeOverrideRate(0.000001), 0.000001, "the smallest value the column can hold is fine");
});

test("an absurd rate is refused at the bound, inclusive", () => {
  assert.equal(sanitizeOverrideRate(MAX_OVERRIDE_RATE), MAX_OVERRIDE_RATE);
  assert.equal(sanitizeOverrideRate(MAX_OVERRIDE_RATE + 0.000001), null);
  assert.equal(sanitizeOverrideRate("1e30"), null);
  assert.equal(sanitizeOverrideRate(1e308), null);
});

/* ── planRateOverride ── */

test("a baht claim has nothing to correct — null, empty and THB alike", () => {
  for (const c of [null, "", "THB", "thb", " thb "]) {
    const d = planRateOverride({ currency: c, foreignAmount: 100 }, 8.25);
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "not-foreign");
  }
});

test("a foreign claim recomputes the baht total from its own figure", () => {
  const d = planRateOverride({ currency: "MYR", foreignAmount: 1000 }, 8.25);
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.plan.rate, 8.25);
    assert.equal(d.plan.totalAmount, 8250);
  }
});

test("the recomputed total is rounded to satang, exactly as toBaht does it", () => {
  const d = planRateOverride({ currency: "MYR", foreignAmount: 123.45 }, 8.123456);
  assert.equal(d.ok, true);
  // 123.45 * 8.123456 = 1002.84067... -> 1002.84
  if (d.ok) assert.equal(d.plan.totalAmount, 1002.84);
});

test("zero converts to zero — a nil line is a real figure, not an absent one", () => {
  const d = planRateOverride({ currency: "MYR", foreignAmount: 0 }, 8.25);
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.plan.totalAmount, 0);
});

/**
 * AP-17's case, and it is decided by the row rather than by the form: a request
 * with no `ForeignAmount` has no figure of which the header total is the
 * conversion. `AccRequest.TotalAmount` there is the per-diem total, always
 * baht, and `recomputeGroupPerDiem` would rewrite anything else back anyway.
 */
test("no ForeignAmount means the rate is stored and the total is left alone", () => {
  const d = planRateOverride({ currency: "MYR", foreignAmount: null }, 8.25);
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.plan.rate, 8.25);
    assert.equal(d.plan.totalAmount, null, "null means leave the column untouched, never write 0");
  }
});

test("a bad rate refuses before anything is planned", () => {
  for (const bad of [0, -1, "", "abc", null, MAX_OVERRIDE_RATE * 2]) {
    const d = planRateOverride({ currency: "MYR", foreignAmount: 1000 }, bad);
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "invalid-rate");
  }
});

/**
 * The one rule the whole feature exists for: `toBaht` returning null refuses
 * the save. There is no branch that keeps the old baht figure beside a new
 * rate, and none that writes the unconverted foreign figure into a baht column.
 */
test("an unconvertible figure refuses the save rather than falling back", () => {
  const d = planRateOverride({ currency: "MYR", foreignAmount: Number.NaN }, 8.25);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "unconvertible");
});

test("every refusal has its own sentence, and none of them blames the claim wrongly", () => {
  const reasons = ["not-foreign", "invalid-rate", "unconvertible"] as const;
  const seen: string[] = [];
  for (const r of reasons) {
    const text = RATE_OVERRIDE_REFUSAL_TEXT[r];
    assert.ok(text && text.length > 0, `${r} has no copy`);
    assert.equal(seen.indexOf(text), -1, `${r} reuses another refusal's sentence`);
    seen.push(text);
  }
});

/**
 * No screen and no server message may caption the stored figure as a Bank of
 * Thailand rate: `BOT_API_CLIENT_ID` will not be provisioned, so every rate
 * here is an ECB mid-market reference rate.
 */
test("no refusal copy names the Bank of Thailand", () => {
  for (const text of Object.keys(RATE_OVERRIDE_REFUSAL_TEXT).map(
    (k) => RATE_OVERRIDE_REFUSAL_TEXT[k as keyof typeof RATE_OVERRIDE_REFUSAL_TEXT],
  )) {
    assert.equal(/ธนาคารแห่งประเทศไทย|BOT/.test(text), false, `caption names the BOT: ${text}`);
  }
});

/* ── planLineRateOverride — AP-1, since the currency moved onto the line ── */

/**
 * The whole point of the per-line rule: `AccTravelExpenseItem.Amount` is Thai
 * baht always, so the corrected figure is `toBaht(ForeignAmount, rate)` and
 * nothing else. The line's own figure is carried through unchanged — only what
 * it is worth in baht moves.
 */
test("a line's corrected baht is its own figure at the new rate", () => {
  const decision = planLineRateOverride({ currency: "MYR", foreignAmount: 20 }, "8.5");
  assert.deepEqual(decision, { ok: true, plan: { rate: 8.5, foreignAmount: 20, amount: 170 } });
});

test("a line's rate is rounded to the six places the column holds", () => {
  const decision = planLineRateOverride({ currency: "MYR", foreignAmount: 20 }, "8.12345678");
  assert.equal(decision.ok && decision.plan.rate, 8.123457);
});

/** A zero line is a real figure, and zero baht is the right answer for it. */
test("a zero figure converts to zero rather than being refused", () => {
  const decision = planLineRateOverride({ currency: "MYR", foreignAmount: 0 }, 8.25);
  assert.equal(decision.ok && decision.plan.amount, 0);
});

/**
 * A baht line has no rate to correct — and both spellings of baht mean baht, so
 * a line recording `'THB'` is refused exactly as one recording nothing is.
 */
test("a baht line is refused, however baht is spelt", () => {
  for (const currency of ["THB", "thb", "", null]) {
    const decision = planLineRateOverride({ currency, foreignAmount: 20 }, 8.25);
    assert.deepEqual(decision, { ok: false, reason: "not-foreign" }, `for ${JSON.stringify(currency)}`);
  }
});

test("an unusable rate is refused before anything is converted", () => {
  for (const bad of [0, -1, "", "abc", null, undefined, MAX_OVERRIDE_RATE + 1]) {
    const decision = planLineRateOverride({ currency: "MYR", foreignAmount: 20 }, bad);
    assert.deepEqual(decision, { ok: false, reason: "invalid-rate" }, `for ${JSON.stringify(bad)}`);
  }
});

/**
 * **The one place the line rule and the request rule deliberately differ.** A
 * request with no `ForeignAmount` means "leave `TotalAmount` alone" — that is
 * AP-17, whose header total is per diem and always baht. A *line* with none is
 * a contradiction: `ForeignAmount` is written beside `Currency` by the only
 * thing that writes either, so a row with one and not the other has been
 * hand-edited, and storing a rate against it would leave the rate and the baht
 * disagreeing with nothing on screen to say so.
 */
test("a foreign line with nothing to convert is refused, where a request is not", () => {
  assert.deepEqual(
    planLineRateOverride({ currency: "MYR", foreignAmount: null }, 8.25),
    { ok: false, reason: "no-foreign-amount" },
  );
  // The request-level rule, for contrast — it stores the rate and rewrites no total.
  assert.deepEqual(
    planRateOverride({ currency: "MYR", foreignAmount: null }, 8.25),
    { ok: true, plan: { rate: 8.25, totalAmount: null } },
  );
});

/** Each refusal says its own thing, so a `Record` keeps them honest. */
test("every line refusal has its own sentence, and none names the Bank of Thailand", () => {
  const reasons: LineRateRefusal[] = ["not-foreign", "invalid-rate", "unconvertible", "no-foreign-amount"];
  const seen: string[] = [];
  for (const r of reasons) {
    const text = LINE_RATE_REFUSAL_TEXT[r];
    assert.ok(text && text.length > 0, `${r} has no copy`);
    assert.equal(seen.indexOf(text), -1, `${r} reuses another refusal's sentence`);
    assert.equal(/ธนาคารแห่งประเทศไทย|BOT/.test(text), false, `caption names the BOT: ${text}`);
    seen.push(text);
  }
});
