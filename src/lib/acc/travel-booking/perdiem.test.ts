import { test } from "node:test";
import assert from "node:assert/strict";
import { computePerDiem } from "./perdiem";
import { roomBookedOrShared } from "./perdiem-room";

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

/* ── package E: the room-share guest exception ──
 *
 * `roomBookedOrShared` (`perdiem-room.ts`) is the ONE predicate that decides
 * `computePerDiem`'s `roomBooked` argument, applied by the submit, the
 * recompute and the form's live estimate alike. These tests assert the money
 * that comes out of the composition, not the boolean in the middle — the
 * boolean is only interesting because of what it is worth.
 */

test("a room-share guest IS paid and a non-guest who booked no room is NOT — side by side", () => {
  // Asserted together, in ONE test, because each reads exactly like the
  // other's bug: both trips have `needsRoomBooking: false`, and the only
  // difference between ฿1,500 and ฿0 is the share. Split across two tests,
  // either could be "fixed" to match the other and only the far test would
  // notice. `payout-rule.test.ts` pairs the domestic/foreign payout asymmetry
  // this way for the same reason.
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];

  const guest = computePerDiem("2026-09-20", "2026-09-22", false, log, {
    // พักห้องเดียวกับ: books no room of their own, sleeps in the host's, and
    // still draws per diem — spec §1, the user's own
    // "(ถ้าเลือกอันนี้จะได้เบี้ยเลี้ยง)".
    roomBooked: roomBookedOrShared({ needsRoomBooking: false, isRoomShareGuest: true }),
  });
  const notGuest = computePerDiem("2026-09-20", "2026-09-22", false, log, {
    // Package B's ordinary rule: staying with relatives pays nothing.
    roomBooked: roomBookedOrShared({ needsRoomBooking: false, isRoomShareGuest: false }),
  });

  assert.equal(guest.days, 3);
  assert.equal(guest.total, 1500);
  assert.equal(notGuest.days, 0);
  assert.equal(notGuest.total, 0);
});

test("a guest is paid exactly what the same trip with its own room would be", () => {
  // The guest exception restores the ordinary figure; it does not invent a
  // different one. Sharing a room changes who booked it, not what a day of
  // travel is worth.
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const guest = computePerDiem("2026-09-20", "2026-09-23", false, log, {
    roomBooked: roomBookedOrShared({ needsRoomBooking: false, isRoomShareGuest: true }),
  });
  const ownRoom = computePerDiem("2026-09-20", "2026-09-23", false, log, {
    roomBooked: roomBookedOrShared({ needsRoomBooking: true, isRoomShareGuest: false }),
  });
  assert.deepEqual(guest, ownRoom);
});

test("a guest's dropped continuation day is still dropped — the exception is about the room, not the calendar", () => {
  // The two rules are independent, and the guest exception must not quietly
  // re-pay a boundary day the predecessor already owns.
  const log = [{ effectiveDate: "2026-01-01", amount: 500 }];
  const r = computePerDiem("2026-09-20", "2026-09-22", true, log, {
    roomBooked: roomBookedOrShared({ needsRoomBooking: false, isRoomShareGuest: true }),
  });
  assert.equal(r.days, 2);
  assert.equal(r.total, 1000);
});

test("roomBookedOrShared: every combination, so no arm is only ever reached by composition", () => {
  assert.equal(roomBookedOrShared({ needsRoomBooking: true, isRoomShareGuest: false }), true);
  assert.equal(roomBookedOrShared({ needsRoomBooking: false, isRoomShareGuest: true }), true);
  // Both at once is reachable: a guest who also picked an accommodation that
  // books a room. Paid, and paid once — there is no double arm to find.
  //
  // **It got much rarer on 2026-09-22 and is still not impossible**, which is
  // why this arm stays. Final review I1 closed the ordinary route to it:
  // `attachRoomShare` now clears the guest's own accommodation in the
  // transaction that inserts the binding (`room-share-guest-room.ts`), so a
  // guest cannot walk out of an attach still holding one. What remains is a
  // row written BEFORE that fix, which nothing backfills — this predicate has
  // to keep answering it, and it must keep answering `true`, because a guest
  // who has not yet been repaired is still sleeping somewhere.
  assert.equal(roomBookedOrShared({ needsRoomBooking: true, isRoomShareGuest: true }), true);
  // The only false, and the only one worth ฿0.
  assert.equal(roomBookedOrShared({ needsRoomBooking: false, isRoomShareGuest: false }), false);
});
