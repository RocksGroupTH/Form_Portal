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

/* ─────────────────── the same correction, one expense line ─────────────────── */

/**
 * AP-1's correction, since migration 129 moved the currency onto the line.
 *
 * `planRateOverride` above still answers for a **request-level** rate, which is
 * what AP-17's booking desk records and what AP-1 claims filed during
 * migration 125's design carry. AP-1 writes no such header any more, so its
 * override had to move down a level with the currency — this is that rule, and
 * the two are deliberately separate functions rather than one with a flag,
 * because they differ on the thing that matters most: what a **missing figure
 * to convert** means.
 *
 * For a request it means "leave `TotalAmount` alone" — AP-17's header total is
 * per diem, always baht, and rewriting it from a booking cost would double the
 * figure on every screen. For a **line** it is a contradiction: a foreign line
 * exists precisely because somebody typed a foreign figure, and `ForeignAmount`
 * is written beside `Currency` by the one place that writes either. A row with
 * one and not the other has been hand-edited, and storing a new rate against it
 * would leave the rate and the baht disagreeing with nothing on screen to say
 * so. So it refuses.
 */
export type LineRateRefusal = RateOverrideRefusal | "no-foreign-amount";

export interface LineRateOverridePlan {
  /** The rate to store, already rounded to what `DECIMAL(18,6)` holds. */
  rate: number;
  /**
   * The line's own figure, carried through unchanged.
   *
   * On the plan rather than left for the caller to re-read, because it is the
   * one that reaching this branch has already proved is not null — a caller
   * digging it back out of its own row would need a cast to say so.
   */
  foreignAmount: number;
  /** The line's new `AccTravelExpenseItem.Amount`. **Baht, always.** */
  amount: number;
}

export type LineRateOverrideDecision =
  | { ok: true; plan: LineRateOverridePlan }
  | { ok: false; reason: LineRateRefusal };

/**
 * What a corrected rate does to one expense line, or why it may not happen.
 *
 * Converts through `toBaht` and refuses on null, exactly as the request-level
 * rule does and for exactly the same reason: `AccTravelExpenseItem.Amount` is
 * Thai baht always, and the unconverted figure reaching it is a wrong number in
 * a Business Central journal that no screen would ever reveal.
 */
export function planLineRateOverride(
  line: { currency: string | null; foreignAmount: number | null },
  posted: unknown,
): LineRateOverrideDecision {
  if (isBaht(line.currency)) return { ok: false, reason: "not-foreign" };

  const rate = sanitizeOverrideRate(posted);
  if (rate === null) return { ok: false, reason: "invalid-rate" };

  if (line.foreignAmount === null) return { ok: false, reason: "no-foreign-amount" };

  const baht = toBaht(line.foreignAmount, rate);
  if (baht === null) return { ok: false, reason: "unconvertible" };
  return { ok: true, plan: { rate, foreignAmount: line.foreignAmount, amount: baht } };
}

/**
 * One sentence per refusal, over the wider union. The three shared reasons take
 * the same wording as the request-level ones by reference rather than by
 * retyping, so a correction to any of them lands in both places.
 */
export const LINE_RATE_REFUSAL_TEXT: Record<LineRateRefusal, string> = {
  "not-foreign": "รายการนี้เป็นเงินบาท จึงไม่มีอัตราแลกเปลี่ยนให้แก้ไข",
  "invalid-rate": RATE_OVERRIDE_REFUSAL_TEXT["invalid-rate"],
  "unconvertible": RATE_OVERRIDE_REFUSAL_TEXT["unconvertible"],
  "no-foreign-amount":
    "รายการนี้ไม่มียอดสกุลเงินต่างประเทศให้แปลง จึงแก้อัตราแลกเปลี่ยนไม่ได้",
};
