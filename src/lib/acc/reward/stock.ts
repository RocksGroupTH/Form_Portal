/**
 * AP-11 reward stock arithmetic — the three derived numbers on brief §4-6.
 *
 * ## Why this is its own module
 *
 * AP-11 is the first form on the Accounting backbone whose submit consumes a
 * finite resource. AP-1 and AP-17 record claims about things that already
 * happened; AP-11 promises goods that may run out. So "how many are left" is
 * asked in four places — the reward card on the form, the quantity cap on the
 * input, the `Balance` column on the settings page, and the reconciliation
 * check — and all four have to agree. One pure function, tested without a
 * database, is what makes that true. (`@/env` validates the whole environment
 * at import time, so anything reachable from a pool would drag a live
 * configuration into the test run; this file imports nothing.)
 *
 * ## The definitions
 *
 * - `Qty` is stock received. Typed by an admin.
 * - `LockedQty` is held by in-flight requests: taken at submit, released on
 *   Reject, converted to `IssuedQty` when the requester collects.
 * - `IssuedQty` is what has gone out of the door.
 *
 * `requestQty = LockedQty + IssuedQty` — everything a request has spoken for,
 * whether or not it has been handed over. That choice is what lets `balanceQty`
 * be a single number meaning "what you may still ask for", rather than a figure
 * the reader has to subtract a second column from.
 *
 * ## Expiry needs no scheduled job
 *
 * Past `ExpireDate` the uncommitted remainder counts as expired, so `balanceQty`
 * goes to 0 and the reward drops out of the picker on its own. Deriving it from
 * the date instead of stamping a column means there is no window in which a
 * nightly job has not run yet and an expired reward is still requestable.
 *
 * Note what expiry does *not* do: it never touches `LockedQty`. A request
 * submitted the day before expiry is still owed its goods, and the owner's rule
 * is that stock returns only on a Reject.
 */

/** A reward's stock columns, as the service reads them. */
export interface RewardStockInput {
  qty: number;
  lockedQty: number;
  issuedQty: number;
  /** 'YYYY-MM-DD', or null for "never expires". */
  expireDate: string | null;
  /** 'YYYY-MM-DD', or null for "available immediately". */
  startDate: string | null;
  isActive: boolean;
}

/** The derived view every surface renders. */
export interface RewardStock {
  qty: number;
  lockedQty: number;
  issuedQty: number;
  /** brief §4 — locked + issued. */
  requestQty: number;
  /** brief §5 — the uncommitted remainder, once past ExpireDate. */
  expiredQty: number;
  /** brief §6 — what a person may still ask for. Never negative. */
  balanceQty: number;
}

/**
 * Today as 'YYYY-MM-DD', from local getters.
 *
 * Never `toISOString()`: the server runs Thai time (UTC+7), so between midnight
 * and 07:00 local it reports the previous day — which would keep an expired
 * reward requestable for seven hours and, worse, expire a reward seven hours
 * early on its final day.
 */
export function todayYmd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Non-finite or negative input is read as 0 rather than propagating NaN into a cap. */
function safeInt(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.trunc(v));
}

/** True once `today` is strictly past `expireDate`. ISO dates compare correctly as strings. */
export function isExpired(expireDate: string | null, today: string = todayYmd()): boolean {
  return !!expireDate && expireDate < today;
}

/** True once `today` has reached `startDate` (null = available immediately). */
export function hasStarted(startDate: string | null, today: string = todayYmd()): boolean {
  return !startDate || startDate <= today;
}

/**
 * The three derived numbers.
 *
 * Clamped at 0 rather than trusting the row: `CK_AccReward_Stock` makes
 * `locked + issued <= qty` true in the database, but this function also renders
 * rows mid-edit in the settings form, where a half-typed `Qty` can be
 * transiently lower than what is already committed.
 */
export function computeRewardStock(
  input: RewardStockInput,
  today: string = todayYmd(),
): RewardStock {
  const qty = safeInt(input.qty);
  const lockedQty = safeInt(input.lockedQty);
  const issuedQty = safeInt(input.issuedQty);

  const requestQty = lockedQty + issuedQty;
  const uncommitted = Math.max(0, qty - requestQty);
  const expiredQty = isExpired(input.expireDate, today) ? uncommitted : 0;
  const balanceQty = Math.max(0, uncommitted - expiredQty);

  return { qty, lockedQty, issuedQty, requestQty, expiredQty, balanceQty };
}

/**
 * May this reward be put on a new request today?
 *
 * The form uses it to filter the card list; the submit path does **not** — it
 * re-tests every one of these conditions inside its conditional UPDATE, because
 * a card list rendered thirty seconds ago is not a reservation.
 */
export function isRewardSelectable(
  input: RewardStockInput,
  today: string = todayYmd(),
): boolean {
  if (!input.isActive) return false;
  if (!hasStarted(input.startDate, today)) return false;
  if (isExpired(input.expireDate, today)) return false;
  return computeRewardStock(input, today).balanceQty > 0;
}

/**
 * How far a proposed `Qty` falls below what is already committed, or 0 when the
 * change is safe.
 *
 * `CK_AccReward_Stock` would reject the write anyway, but as a raw SQL 547 with
 * no indication of by how much. The settings service calls this first so the
 * admin gets "ลดจำนวนไม่ได้ — มีการล็อก/จ่ายไปแล้ว 12 ชิ้น" and a 409.
 */
export function qtyReductionShortfall(
  input: Pick<RewardStockInput, "lockedQty" | "issuedQty">,
  proposedQty: number,
): number {
  const committed = safeInt(input.lockedQty) + safeInt(input.issuedQty);
  return Math.max(0, committed - safeInt(proposedQty));
}

/**
 * Validate a requested quantity against live stock.
 *
 * Returns null when it is fine, or the Thai message to answer with. Shared by
 * the draft save (so the problem shows before submit) and the submit path (so
 * it is enforced even if the client skipped the first check).
 */
export function validateRequestedQty(
  input: RewardStockInput,
  requestedQty: number,
  today: string = todayYmd(),
): string | null {
  const qty = Number(requestedQty);
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
    return "จำนวนที่ขอเบิกต้องเป็นจำนวนเต็มมากกว่า 0";
  }
  if (!input.isActive) return "ของรางวัลนี้ถูกปิดการใช้งานแล้ว";
  if (!hasStarted(input.startDate, today)) return "ของรางวัลนี้ยังไม่เปิดให้เบิก";
  if (isExpired(input.expireDate, today)) return "ของรางวัลนี้หมดอายุแล้ว";

  const { balanceQty } = computeRewardStock(input, today);
  if (qty > balanceQty) return `ของรางวัลคงเหลือไม่พอ — คงเหลือ ${balanceQty} ชิ้น`;
  return null;
}
