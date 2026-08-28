/**
 * Accounting's correction to a recorded exchange rate — the pure half.
 *
 * **Why this exists at all.** `BOT_API_CLIENT_ID` will not be provisioned
 * (spec §9.1), so `bot-fx.ts` always takes its keyless fallback and **every
 * rate this application records is an ECB mid-market reference rate**. That is
 * not the rate a bank settles at, so the figure the company actually pays
 * differs from the one the requester's form computed. This override is the only
 * place that difference can be corrected, which is why it ships in the first
 * release rather than being deferred.
 *
 * Imports only `currency.ts`, which is itself import-free, so the rule is
 * unit-tested without a database — `@/env` validates the whole environment at
 * import, and anything reachable from a pool would drag a live configuration
 * into the test run.
 */

import { isBaht, toBaht } from "@/lib/acc/currency";

/**
 * `AccRequest.ExchangeRate` is `DECIMAL(18,6)` (migration 125), so six places
 * is what the column can actually hold. Rounding **before** the bounds test is
 * load-bearing: a posted `0.0000004` stores as `0.000000`, and a rate of zero
 * makes `toBaht` return null on every later read of the claim. Refusing it here
 * is the difference between a rejected edit and a claim nobody can convert.
 */
export const RATE_DECIMALS = 6;

/**
 * THB per 1 unit. The strongest currency in circulation is worth a few hundred
 * baht, so ten thousand is loose enough to never be reached by a real rate and
 * tight enough that a fat-fingered paste cannot multiply a claim by a million.
 * It is a sanity bound, not an exchange-rate opinion.
 */
export const MAX_OVERRIDE_RATE = 10000;

export type RateOverrideRefusal =
  /** The claim is in baht. There is no rate to correct, and no conversion. */
  | "not-foreign"
  /** Not a positive finite number, or outside what the column can hold. */
  | "invalid-rate"
  /** `toBaht` said it cannot know. Never fall back to the unconverted figure. */
  | "unconvertible";

export interface RateOverridePlan {
  /** The rate to store, already rounded to what the column holds. */
  rate: number;
  /**
   * The new baht `AccRequest.TotalAmount`, or **null meaning leave that column
   * exactly as it is**.
   *
   * Null is AP-17's case and it is data-driven, not form-driven: a request with
   * no `ForeignAmount` has no figure of which `TotalAmount` is the conversion.
   * For AP-17 that column is the per-diem total alone — always baht, since
   * `EmployeeAllowanceLog` has no currency column — and `recomputeGroupPerDiem`
   * would rewrite anything else back anyway. Rewriting it from a booking cost
   * would double the figure on My Requests, My Work and the header, for baht
   * requests too.
   */
  totalAmount: number | null;
}

export type RateOverrideDecision =
  | { ok: true; plan: RateOverridePlan }
  | { ok: false; reason: RateOverrideRefusal };

/**
 * A posted rate turned into something storable, or null.
 *
 * Accepts a string as well as a number because the field is a text input and
 * `JSON.stringify` of `"8.25"` is a string; the server must not depend on the
 * client having coerced it. Null is a refusal, never a substituted default.
 */
export function sanitizeOverrideRate(input: unknown): number | null {
  let n: number;
  if (typeof input === "number") n = input;
  else if (typeof input === "string") n = input.trim() === "" ? NaN : Number(input.trim());
  else return null;

  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = Math.pow(10, RATE_DECIMALS);
  const rounded = Math.round(n * factor) / factor;
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > MAX_OVERRIDE_RATE) return null;
  return rounded;
}

/**
 * What an override would do to this request, or why it may not happen.
 *
 * There is no branch that writes a rate without converting, and none that
 * converts by falling back to the unconverted figure — `toBaht` returning null
 * refuses the whole save. `AccRequest.TotalAmount` is Thai baht always, and it
 * is read by every report, Excel export and Business Central journal in the
 * application, none of which knows what a currency is.
 */
export function planRateOverride(
  current: { currency: string | null; foreignAmount: number | null },
  posted: unknown,
): RateOverrideDecision {
  if (isBaht(current.currency)) return { ok: false, reason: "not-foreign" };

  const rate = sanitizeOverrideRate(posted);
  if (rate === null) return { ok: false, reason: "invalid-rate" };

  if (current.foreignAmount === null) return { ok: true, plan: { rate, totalAmount: null } };

  const baht = toBaht(current.foreignAmount, rate);
  if (baht === null) return { ok: false, reason: "unconvertible" };
  return { ok: true, plan: { rate, totalAmount: baht } };
}

/**
 * One sentence per refusal, so a `Record` over the union makes adding a reason
 * without copy a compile error — the shape `RECEIPT_FAILURE_TEXT` already uses.
 * "แก้ไม่สำเร็จ" for all three would read as *your number is bad* even when the
 * claim simply is not in a foreign currency.
 */
export const RATE_OVERRIDE_REFUSAL_TEXT: Record<RateOverrideRefusal, string> = {
  "not-foreign": "คำขอนี้เป็นสกุลบาท จึงไม่มีอัตราแลกเปลี่ยนให้แก้ไข",
  "invalid-rate": `อัตราไม่ถูกต้อง — ต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน ${MAX_OVERRIDE_RATE} (ทศนิยมไม่เกิน ${RATE_DECIMALS} ตำแหน่ง)`,
  "unconvertible": "อัตรานี้แปลงยอดเป็นเงินบาทไม่ได้ — ยังไม่บันทึกการแก้ไข",
};

/** The step a claim must be sitting on for accounting to correct its rate. */
export const RATE_OVERRIDE_WRONG_STEP_TEXT =
  "คำขอนี้ไม่อยู่ในขั้นตรวจสอบของบัญชี จึงแก้อัตราแลกเปลี่ยนไม่ได้";
