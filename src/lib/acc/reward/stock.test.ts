import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRewardStock,
  hasStarted,
  isExpired,
  isRewardSelectable,
  qtyReductionShortfall,
  todayYmd,
  validateRequestedQty,
  type RewardStockInput,
} from "./stock";

/* ── Fixtures ── */

const TODAY = "2026-08-20";

/** 100 received, 10 held by in-flight requests, 20 already handed over. */
function reward(over: Partial<RewardStockInput> = {}): RewardStockInput {
  return {
    qty: 100,
    lockedQty: 10,
    issuedQty: 20,
    startDate: null,
    expireDate: null,
    isActive: true,
    ...over,
  };
}

/* ── The three derived numbers (brief §4-6) ── */

test("requestQty is locked + issued, and balance is what is left of Qty", () => {
  const s = computeRewardStock(reward(), TODAY);
  assert.equal(s.requestQty, 30);
  assert.equal(s.expiredQty, 0);
  assert.equal(s.balanceQty, 70);
});

test("a fully committed reward has a zero balance, not a negative one", () => {
  const s = computeRewardStock(reward({ qty: 30, lockedQty: 10, issuedQty: 20 }), TODAY);
  assert.equal(s.requestQty, 30);
  assert.equal(s.balanceQty, 0);
});

test("Qty typed below what is already committed clamps rather than going negative", () => {
  // Reachable in the settings form mid-edit, before the service rejects the save.
  const s = computeRewardStock(reward({ qty: 5, lockedQty: 10, issuedQty: 20 }), TODAY);
  assert.equal(s.balanceQty, 0);
  assert.equal(s.expiredQty, 0);
});

/* ── Expiry ── */

test("expiry claims only the uncommitted remainder, never the locked stock", () => {
  // The owner's rule is that stock returns only on a Reject. Somebody who
  // submitted the day before expiry is still owed their goods, so LockedQty
  // survives and only the 70 nobody asked for expires.
  const s = computeRewardStock(reward({ expireDate: "2026-08-19" }), TODAY);
  assert.equal(s.expiredQty, 70);
  assert.equal(s.lockedQty, 10);
  assert.equal(s.balanceQty, 0);
});

test("a reward is live through the whole of its expire date and dead the day after", () => {
  assert.equal(isExpired("2026-08-20", TODAY), false, "expires today = still usable today");
  assert.equal(isExpired("2026-08-19", TODAY), true);
  assert.equal(isExpired(null, TODAY), false, "null = never expires");
});

test("a start date in the future withholds the reward until the day it arrives", () => {
  assert.equal(hasStarted("2026-08-21", TODAY), false);
  assert.equal(hasStarted("2026-08-20", TODAY), true, "starts today = usable today");
  assert.equal(hasStarted(null, TODAY), true);
});

/* ── Selectability ── */

test("a reward is selectable only when active, started, unexpired and non-empty", () => {
  assert.equal(isRewardSelectable(reward(), TODAY), true);
  assert.equal(isRewardSelectable(reward({ isActive: false }), TODAY), false);
  assert.equal(isRewardSelectable(reward({ startDate: "2026-09-01" }), TODAY), false);
  assert.equal(isRewardSelectable(reward({ expireDate: "2026-08-19" }), TODAY), false);
  assert.equal(
    isRewardSelectable(reward({ qty: 30, lockedQty: 10, issuedQty: 20 }), TODAY),
    false,
    "balance 0 — nothing left to ask for",
  );
});

/* ── Reducing Qty in settings ── */

test("qtyReductionShortfall reports how far below the committed stock a change falls", () => {
  const r = reward(); // 10 locked + 20 issued = 30 committed
  assert.equal(qtyReductionShortfall(r, 100), 0);
  assert.equal(qtyReductionShortfall(r, 30), 0, "exactly the committed amount is allowed");
  assert.equal(qtyReductionShortfall(r, 25), 5);
  assert.equal(qtyReductionShortfall(r, 0), 30);
});

/* ── Requested quantity validation ── */

test("a requested quantity must be a positive whole number", () => {
  assert.match(validateRequestedQty(reward(), 0, TODAY)!, /มากกว่า 0/);
  assert.match(validateRequestedQty(reward(), -3, TODAY)!, /มากกว่า 0/);
  assert.match(validateRequestedQty(reward(), 1.5, TODAY)!, /จำนวนเต็ม/);
  assert.match(validateRequestedQty(reward(), Number.NaN, TODAY)!, /มากกว่า 0/);
});

test("a requested quantity may not exceed the balance, and the message says the balance", () => {
  assert.equal(validateRequestedQty(reward(), 70, TODAY), null, "exactly the balance is allowed");
  const over = validateRequestedQty(reward(), 71, TODAY);
  assert.match(over!, /คงเหลือไม่พอ/);
  assert.match(over!, /70/);
});

test("a closed, unstarted or expired reward is refused whatever the quantity", () => {
  assert.match(validateRequestedQty(reward({ isActive: false }), 1, TODAY)!, /ปิดการใช้งาน/);
  assert.match(validateRequestedQty(reward({ startDate: "2026-09-01" }), 1, TODAY)!, /ยังไม่เปิด/);
  assert.match(validateRequestedQty(reward({ expireDate: "2026-08-19" }), 1, TODAY)!, /หมดอายุ/);
});

/* ── todayYmd ── */

test("todayYmd uses local getters, so a Thai-time morning is not yesterday", () => {
  // 02:00 on 20 Aug in the server's local zone. toISOString() would render this
  // as the 19th for any zone east of UTC, expiring a reward a day early.
  const earlyMorning = new Date(2026, 7, 20, 2, 0, 0);
  assert.equal(todayYmd(earlyMorning), "2026-08-20");
});
