import { test } from "node:test";
import assert from "node:assert/strict";
import { computePerDiem } from "./perdiem";

test("a trip that books no room is worth nothing, however long it is", () => {
  // The cut is the BOOKING, not the calendar (user, 2026-09-21). Three nights
  // staying with relatives pays zero — per diem here follows the company having
  // booked a room.
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const r = computePerDiem("2026-09-20", "2026-09-23", false, log, { roomBooked: false });
  assert.equal(r.days, 0);
  assert.equal(r.total, 0);
  assert.deepEqual(r.groups, []);
});

test("zero days is a real answer, not a missing one", () => {
  // `groups: []` with `days: 0` and `total: 0` — never null, never a throw.
  // perdiem-country.ts's docblock records why that distinction matters on a
  // path that writes AccRequest.TotalAmount.
  const r = computePerDiem("2026-09-20", "2026-09-20", false, [], { roomBooked: false });
  assert.equal(r.days, 0);
  assert.equal(r.total, 0);
  assert.ok(Array.isArray(r.groups));
});

test("a booked room pays exactly as before, and omitting the option means booked", () => {
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const withOpt = computePerDiem("2026-09-20", "2026-09-22", false, log, { roomBooked: true });
  const without = computePerDiem("2026-09-20", "2026-09-22", false, log);
  assert.equal(withOpt.days, 3);
  assert.deepEqual(without, withOpt);
});

test("no room plus a continuation still gives zero, not minus one", () => {
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const r = computePerDiem("2026-09-20", "2026-09-22", true, log, { roomBooked: false });
  assert.equal(r.days, 0);
  assert.equal(r.total, 0);
});
