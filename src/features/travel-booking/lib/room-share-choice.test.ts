import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roomShareChoicePatch,
  roomShareClearPatch,
  roomShareHostFieldFor,
} from "./room-share-choice";

/* ─────────────────────────── choosing ─────────────────────────── */

test("choosing a host records it and marks the tab a guest", () => {
  const p = roomShareChoicePatch({
    requestId: 4321,
    departDate: "2026-10-05",
    returnDate: "2026-10-08",
  });
  assert.equal(p.roomShareHostRequestId, 4321);
  assert.equal(p.isRoomShareGuest, true);
});

test("choosing a host withdraws the accommodation the grid had set", () => {
  const p = roomShareChoicePatch({ requestId: 1, departDate: null, returnDate: null });
  assert.equal(p.accommodationId, null);
  assert.equal(p.accommodationCustomText, null);
  assert.equal(
    p.needsRoomBooking,
    false,
    "a guest reaching the Admin desk with a room to book is the state this clears",
  );
});

test("the host's dates are copied into the tab — final review I4", () => {
  const p = roomShareChoicePatch({
    requestId: 7,
    departDate: "2026-10-05",
    returnDate: "2026-10-08",
  });
  assert.equal(p.departDate, "2026-10-05");
  assert.equal(p.returnDate, "2026-10-08");
});

test("a single-day host trip copies as a single day, not a range that spans nothing", () => {
  const p = roomShareChoicePatch({
    requestId: 7,
    departDate: "2026-10-05",
    returnDate: "2026-10-05",
  });
  assert.equal(p.departDate, "2026-10-05");
  assert.equal(p.returnDate, "2026-10-05");
});

/**
 * The key must be ABSENT, not `undefined`. `updateTab` spreads this patch over
 * the tab, and `{ ...tab, departDate: undefined }` overwrites a date the
 * requester had already chosen with nothing at all.
 */
test("a host with no dates leaves the tab's own dates untouched — absent, not undefined", () => {
  for (const host of [
    { requestId: 1, departDate: null, returnDate: null },
    { requestId: 1, departDate: "2026-10-05", returnDate: null },
    { requestId: 1, departDate: null, returnDate: "2026-10-08" },
  ]) {
    const p = roomShareChoicePatch(host);
    assert.ok(
      !("departDate" in p),
      `departDate must not appear at all for ${JSON.stringify(host)} — a present key with an ` +
        "undefined value blanks the requester's own date when the patch is spread",
    );
    assert.ok(!("returnDate" in p), "returnDate must not appear at all either");
  }
});

/* ─────────────────────────── clearing ─────────────────────────── */

test("clearing drops the host and the guest flag together", () => {
  const p = roomShareClearPatch();
  assert.equal(p.roomShareHostRequestId, null);
  assert.equal(p.isRoomShareGuest, false);
});

test("clearing restores nothing — not the accommodation, not the dates", () => {
  const p = roomShareClearPatch() as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(p).sort(),
    ["isRoomShareGuest", "roomShareHostRequestId"],
    "detaching must leave the required ที่พักค้างคืน unanswered rather than resurrecting the " +
      "choice the attach replaced — that would re-book a room the requester had decided against",
  );
});

/* ─────────────────────────── what the save posts ─────────────────────────── */

test("a chosen host is posted as its id", () => {
  assert.equal(
    roomShareHostFieldFor({ isRoomShareGuest: true, roomShareHostRequestId: 99 }),
    99,
  );
});

test("no host and not a guest posts null — the explicit clear", () => {
  assert.equal(
    roomShareHostFieldFor({ isRoomShareGuest: false, roomShareHostRequestId: null }),
    null,
  );
});

/**
 * The fail-safe case. A tab that says it is a guest but cannot name its host
 * must post NOTHING, so the save leaves the stored row alone. Posting `null`
 * would delete a binding the requester never touched.
 */
test("a guest with no host id posts undefined, never null", () => {
  const answer = roomShareHostFieldFor({ isRoomShareGuest: true, roomShareHostRequestId: null });
  assert.equal(answer, undefined);
  assert.notEqual(
    answer,
    null,
    "posting null here deletes a binding on an ordinary save, with nothing on screen to say so",
  );
});

test("the host id wins even if the guest flag has been lost", () => {
  // Belt and braces: the two fields are written together by the patches above,
  // but if anything ever desynchronised them the id is the thing that names a
  // real row, and dropping it would be the destructive reading.
  assert.equal(
    roomShareHostFieldFor({ isRoomShareGuest: false, roomShareHostRequestId: 12 }),
    12,
  );
});
