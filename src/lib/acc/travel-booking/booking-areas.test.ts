import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_AREAS,
  BOOKING_AREA_COLUMN,
  filterBookingAreaKeys,
  isBookingAreaKey,
} from "./booking-areas";
import { isGrantableBookingTabKey } from "./settings-tabs";

/**
 * AP-17's three menu grants — the vocabulary this application SHARES with ACC
 * Portal, which is the whole reason it exists in this shape.
 */

test("the three areas are the menu's own order, with the keys ACC Portal uses", () => {
  /* The keys and the column names are a contract with another application
     reading the same rows. Renaming one here renames nothing over there and
     silently splits the answer again, which is exactly what this module was
     created to end. */
  assert.deepEqual(
    BOOKING_AREAS.map((a) => a.key),
    ["queue", "account", "report"],
  );
  assert.deepEqual(BOOKING_AREA_COLUMN, {
    queue: "CanQueue",
    account: "CanAccount",
    report: "CanReport",
  });
});

test("every area has a column, so a fourth cannot be added with nowhere to store it", () => {
  for (const area of BOOKING_AREAS) {
    assert.equal(
      typeof BOOKING_AREA_COLUMN[area.key],
      "string",
      `${area.key} has no column`,
    );
    assert.ok(area.label.length > 0, `${area.key} has no label`);
    assert.ok(area.pageTitle.length > 0, `${area.key} has no page title`);
  }
  assert.equal(Object.keys(BOOKING_AREA_COLUMN).length, BOOKING_AREAS.length);
});

test("AP-17 calls the accounting menu HR, where ACC Portal calls it บัญชี", () => {
  /* Deliberate: the user renamed AP-17's ACCOUNT step on 2026-09-24. The key
     and the column are shared; the wording is this app's own. */
  const account = BOOKING_AREAS.filter((a) => a.key === "account")[0];
  assert.match(account.label, /HR/);
  assert.doesNotMatch(account.label, /บัญชี/);
});

test("an unknown key is refused however it is spelled", () => {
  assert.equal(isBookingAreaKey("nope"), false);
  assert.equal(isBookingAreaKey(""), false);
  assert.equal(isBookingAreaKey("__proto__"), false);
  assert.equal(isBookingAreaKey("Queue"), false);
  assert.equal(isBookingAreaKey(null), false);
  assert.equal(isBookingAreaKey(undefined), false);
  assert.equal(isBookingAreaKey(1), false);
  /* The old vocabulary. These strings were the menu keys until 2026-09-24 and a
     stale client may still post them; they must not be honoured, or a tick
     would appear to save and store nothing. */
  assert.equal(isBookingAreaKey("bookingQueue"), false);
  assert.equal(isBookingAreaKey("accountApproval"), false);
});

test("an area key is never a settings tab, and the reverse", () => {
  /* The two vocabularies used to share one column and had to be told apart in
     code. They no longer share storage at all — but a settings tab named
     `queue` would still be a grant that opens the wrong thing, so the
     disjointness is asserted rather than assumed. */
  for (const area of BOOKING_AREAS) {
    assert.equal(isGrantableBookingTabKey(area.key), false, `${area.key} is also a tab`);
  }
  for (const key of ["brands", "reasons", "accommodations", "vehicles", "rent-vehicles", "access"]) {
    assert.equal(isBookingAreaKey(key), false, `${key} is also an area`);
  }
});

test("a posted list is filtered to the known keys, in the module's own order", () => {
  /* Order comes from BOOKING_AREAS and not from the request, so what is written
     never depends on which box was ticked last. */
  assert.deepEqual(filterBookingAreaKeys(["report", "queue"]), ["queue", "report"]);
  assert.deepEqual(filterBookingAreaKeys(["queue", "queue"]), ["queue"]);
  assert.deepEqual(filterBookingAreaKeys(["queue", "nope", "bookingQueue"]), ["queue"]);
  assert.deepEqual(filterBookingAreaKeys([]), []);
});

test("anything that is not an array is an empty grant, never everything", () => {
  /* This feeds a write that replaces all three columns. A non-array reaching it
     as "grant all" would hand somebody every menu on a malformed body. */
  for (const bad of [null, undefined, "queue", 1, {}, { queue: true }]) {
    assert.deepEqual(filterBookingAreaKeys(bad), [], `${JSON.stringify(bad)} should filter to []`);
  }
});
