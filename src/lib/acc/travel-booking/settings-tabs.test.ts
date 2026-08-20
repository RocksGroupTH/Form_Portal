import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRANTABLE_BOOKING_TABS,
  decideBookingTabAccess,
  filterGrantableBookingTabKeys,
  isGrantableBookingTabKey,
} from "./settings-tabs";

/* ── The list ────────────────────────────────────────────────────────────── */

test("exactly four booking tabs are grantable, in the page's order", () => {
  assert.equal(GRANTABLE_BOOKING_TABS.length, 4);
  assert.deepEqual(
    GRANTABLE_BOOKING_TABS.map((t) => t.key),
    ["reasons", "accommodations", "vehicles", "rent-vehicles"],
  );
});

// The labels come from travel-booking-settings/page.tsx, not from the keys.
// `vehicles` is labelled การเดินทาง there — pinning it stops a later hand
// "correcting" it to พาหนะ and desynchronising the checkbox list from the tabs.
test("the labels are the settings page's own", () => {
  assert.deepEqual(
    GRANTABLE_BOOKING_TABS.map((t) => t.label),
    ["เหตุผลการเดินทาง", "ที่พัก", "การเดินทาง", "เช่ายานพาหนะ"],
  );
});

/* ── `access` is never grantable ─────────────────────────────────────────── */

test("the access tab is never grantable", () => {
  assert.equal(isGrantableBookingTabKey("access"), false);
  assert.deepEqual(filterGrantableBookingTabKeys(["access"]), []);
  for (const t of GRANTABLE_BOOKING_TABS) assert.notEqual(t.key, "access");
});

test("the approvers route is not a grantable tab either", () => {
  assert.equal(isGrantableBookingTabKey("approvers"), false);
  assert.deepEqual(filterGrantableBookingTabKeys(["approvers"]), []);
});

// The grant table has no CHECK on TabKey and is dual-written from more than one
// place, so a row naming `access` can exist. It must stay inert.
test("a non-admin is refused access whatever the grant list says", () => {
  assert.equal(decideBookingTabAccess(false, ["access"], "access"), false);
  assert.equal(
    decideBookingTabAccess(
      false,
      ["reasons", "accommodations", "vehicles", "rent-vehicles", "access"],
      "access",
    ),
    false,
  );
  assert.equal(decideBookingTabAccess(false, ["access"], " access "), false);
});

test("an access row does not poison the real grants beside it", () => {
  assert.equal(decideBookingTabAccess(false, ["access", "vehicles"], "vehicles"), true);
  assert.equal(decideBookingTabAccess(false, ["access", "vehicles"], "access"), false);
});

test("an admin passes access", () => {
  assert.equal(decideBookingTabAccess(true, [], "access"), true);
});

/* ── filterGrantableBookingTabKeys ───────────────────────────────────────── */

test("filterGrantableBookingTabKeys trims, drops unknowns and de-duplicates", () => {
  assert.deepEqual(
    filterGrantableBookingTabKeys([" reasons ", "reasons", "nope", "rent-vehicles"]),
    ["reasons", "rent-vehicles"],
  );
});

test("filterGrantableBookingTabKeys preserves the caller's order", () => {
  assert.deepEqual(
    filterGrantableBookingTabKeys(["vehicles", "reasons"]),
    ["vehicles", "reasons"],
  );
});

test("an empty list stays empty", () => {
  assert.deepEqual(filterGrantableBookingTabKeys([]), []);
});

test("every grantable key survives its own filter", () => {
  const all = GRANTABLE_BOOKING_TABS.map((t) => t.key as string);
  assert.deepEqual(filterGrantableBookingTabKeys(all), all);
});

/* ── decideBookingTabAccess ──────────────────────────────────────────────── */

test("an admin passes every tab", () => {
  for (const t of GRANTABLE_BOOKING_TABS) {
    assert.equal(decideBookingTabAccess(true, [], t.key), true);
  }
});

test("a non-admin with no grants passes nothing", () => {
  for (const t of GRANTABLE_BOOKING_TABS) {
    assert.equal(decideBookingTabAccess(false, [], t.key), false);
  }
  assert.equal(decideBookingTabAccess(false, [], "access"), false);
});

test("a non-admin passes only the tabs they hold", () => {
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "vehicles"), true);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "reasons"), false);
});

test("an unknown tab is refused however it is spelled", () => {
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "nope"), false);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], ""), false);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "__proto__"), false);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "Vehicles"), false);
});

test("a padded tab name is still matched against a padded grant", () => {
  assert.equal(decideBookingTabAccess(false, [" vehicles "], " vehicles "), true);
});
