import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_OVERRIDE_RATE,
  planRateOverride,
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
