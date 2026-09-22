import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roomSharePrefillPatch,
  type RoomSharePrefillHost,
  type RoomSharePrefillTab,
} from "./room-share-prefill";

/** A host with every copyable field answered. */
function host(over: Partial<RoomSharePrefillHost> = {}): RoomSharePrefillHost {
  return {
    brandCode: "PCTH",
    reasonId: 7,
    reasonCustomText: "ประชุมกับลูกค้า",
    workDetail: "ตรวจหน้างานสาขาใหม่",
    workLocations: ["โรงแรมเชียงใหม่", "สาขาเชียงใหม่"],
    ...over,
  };
}

/** The starting state of a brand-new tab: `emptyTab()`'s one blank location row. */
function emptyTab(over: Partial<RoomSharePrefillTab> = {}): RoomSharePrefillTab {
  return {
    brandCode: null,
    reasonId: null,
    reasonCustomText: null,
    workDetail: null,
    workLocations: [{ name: "", sortOrder: 0 }],
    ...over,
  };
}

/* ─────────────────────────── an untouched tab takes it all ─────────────────────────── */

test("an empty tab is filled from the host — all five fields", () => {
  const p = roomSharePrefillPatch(host(), emptyTab());
  assert.equal(p.brandCode, "PCTH");
  assert.equal(p.reasonId, 7);
  assert.equal(p.reasonCustomText, "ประชุมกับลูกค้า");
  assert.equal(p.workDetail, "ตรวจหน้างานสาขาใหม่");
  assert.deepEqual(p.workLocations, [
    { name: "โรงแรมเชียงใหม่", sortOrder: 0 },
    { name: "สาขาเชียงใหม่", sortOrder: 1 },
  ]);
});

/* ─────────────────────────── never overwrite ─────────────────────────── */

/**
 * The rule the user stated as "(ถ้ายังไม่เติม)". Each field asserted
 * separately, because the failure is per field: one of them losing its guard
 * looks exactly like the other four working.
 */
test("a field the requester already answered is left completely alone", () => {
  const filled: RoomSharePrefillTab = {
    brandCode: "KSI",
    reasonId: 3,
    reasonCustomText: "เหตุผลของฉันเอง",
    workDetail: "รายละเอียดของฉันเอง",
    workLocations: [{ name: "สถานที่ของฉันเอง", sortOrder: 0 }],
  };
  const p = roomSharePrefillPatch(host(), filled);
  assert.deepEqual(
    p,
    {},
    "picking a host silently replaced values the requester had typed — that is an edit to a " +
      "document they are about to sign, and afterwards it is indistinguishable from their own",
  );
});

test("each field guards itself — one answered field does not shield the others", () => {
  const p = roomSharePrefillPatch(host(), emptyTab({ brandCode: "KSI" }));
  assert.ok(!("brandCode" in p), "the answered brand must not be replaced");
  assert.equal(p.workDetail, "ตรวจหน้างานสาขาใหม่", "the unanswered fields must still be filled");
});

/**
 * Absent, not `undefined`. `updateTab` spreads this over the tab, so a key
 * present with an undefined value blanks the value it was protecting — which
 * is the *opposite* of the rule, reached by writing it almost correctly.
 */
test("a field that is not being filled is ABSENT from the patch, never undefined", () => {
  const p = roomSharePrefillPatch(host(), emptyTab({ workDetail: "ของฉัน" })) as Record<
    string,
    unknown
  >;
  assert.ok(
    !("workDetail" in p),
    "workDetail appears in the patch with no value — spread over the tab that blanks the text " +
      "the requester typed, which is exactly what the guard exists to prevent",
  );
});

/* ─────────────────────────── whitespace is empty ─────────────────────────── */

test("a whitespace-only value counts as not filled in", () => {
  const p = roomSharePrefillPatch(host(), emptyTab({ workDetail: "   ", brandCode: "  " }));
  assert.equal(p.workDetail, "ตรวจหน้างานสาขาใหม่");
  assert.equal(p.brandCode, "PCTH");
});

test("a host whose own value is blank fills nothing", () => {
  const p = roomSharePrefillPatch(
    host({ brandCode: "  ", workDetail: null, reasonCustomText: "" }),
    emptyTab(),
  ) as Record<string, unknown>;
  assert.ok(!("brandCode" in p), "a blank host brand must not blank the guest's field");
  assert.ok(!("workDetail" in p));
  assert.ok(!("reasonCustomText" in p));
  assert.equal(p.reasonId, 7, "the fields the host DOES answer are still filled");
});

/* ─────────────────────────── the reason and its free text ─────────────────────────── */

/**
 * The free text describes the reason it sits under. Filling it beside a
 * *different* reason the guest chose produces one field whose two halves
 * describe two trips.
 */
test("the extra reason text is not filled beside a reason the guest chose themselves", () => {
  const p = roomSharePrefillPatch(host({ reasonId: 7 }), emptyTab({ reasonId: 3 })) as Record<
    string,
    unknown
  >;
  assert.ok(!("reasonId" in p), "the guest's own reason stands");
  assert.ok(
    !("reasonCustomText" in p),
    "the host's free text was attached to the guest's own, different reason — the field would " +
      "then read as an explanation of a reason nobody chose",
  );
});

test("the extra reason text IS filled when the guest had already chosen the same reason", () => {
  const p = roomSharePrefillPatch(host({ reasonId: 7 }), emptyTab({ reasonId: 7 }));
  assert.ok(!("reasonId" in p), "nothing to change about the reason itself");
  assert.equal(
    p.reasonCustomText,
    "ประชุมกับลูกค้า",
    "same reason, empty text — this is the case the copy is genuinely useful for",
  );
});

test("the guest's own extra text is never replaced, even under the same reason", () => {
  const p = roomSharePrefillPatch(
    host({ reasonId: 7 }),
    emptyTab({ reasonId: 7, reasonCustomText: "ของฉันเอง" }),
  ) as Record<string, unknown>;
  assert.ok(!("reasonCustomText" in p));
});

test("reasonId 0 is a value, not an absence", () => {
  // `== null` rather than falsiness: an id of 0 is unlikely from an IDENTITY
  // column but a truthiness test here would silently overwrite it.
  const p = roomSharePrefillPatch(host({ reasonId: 7 }), emptyTab({ reasonId: 0 })) as Record<
    string,
    unknown
  >;
  assert.ok(!("reasonId" in p), "a reason of 0 is still the requester's answer");
});

/* ─────────────────────────── the work-location list ─────────────────────────── */

/**
 * **The decision this module had to make.** `emptyTab()` seeds one blank row
 * and `tabFromRequest` re-seeds it, so "no rows at all" is true of almost no
 * tab that has ever existed. Read that way the field would never be filled —
 * and it would look exactly like the other four working.
 */
test("a list of blank rows counts as empty, which is what makes this field fillable at all", () => {
  for (const workLocations of [
    [],
    [{ name: "", sortOrder: 0 }],
    [{ name: "  ", sortOrder: 0 }, { name: "", sortOrder: 1 }],
  ]) {
    const p = roomSharePrefillPatch(host(), emptyTab({ workLocations }));
    assert.deepEqual(
      p.workLocations,
      [
        { name: "โรงแรมเชียงใหม่", sortOrder: 0 },
        { name: "สาขาเชียงใหม่", sortOrder: 1 },
      ],
      `a tab holding ${JSON.stringify(workLocations)} has answered nothing and must be filled`,
    );
  }
});

test("one named row anywhere in the list means the requester has answered", () => {
  const p = roomSharePrefillPatch(
    host(),
    emptyTab({
      workLocations: [
        { name: "", sortOrder: 0 },
        { name: "สาขาของฉัน", sortOrder: 1 },
      ],
    }),
  ) as Record<string, unknown>;
  assert.ok(
    !("workLocations" in p),
    "a list with a named row in it is the requester's answer, however many blanks sit beside it",
  );
});

test("the host's own blank locations are dropped and the order is re-numbered", () => {
  const p = roomSharePrefillPatch(
    host({ workLocations: ["", "  ", "สาขาขอนแก่น"] }),
    emptyTab(),
  );
  assert.deepEqual(
    p.workLocations,
    [{ name: "สาขาขอนแก่น", sortOrder: 0 }],
    "a blank copied across is a row the requester has to delete before the form accepts the tab",
  );
});

test("a host with nothing named leaves the key absent rather than emptying the list", () => {
  const p = roomSharePrefillPatch(host({ workLocations: ["", " "] }), emptyTab()) as Record<
    string,
    unknown
  >;
  assert.ok(
    !("workLocations" in p),
    "an empty array here would spread over the tab and remove the blank row the form renders",
  );
  const none = roomSharePrefillPatch(host({ workLocations: [] }), emptyTab()) as Record<
    string,
    unknown
  >;
  assert.ok(!("workLocations" in none));
});

/**
 * The names are the only thing the endpoint carries. Asserted so a later
 * widening of `HostCandidateRow.workLocations` does not arrive here silently
 * as a pin copied off a colleague's trip.
 */
test("a copied location carries a name and a sort order and nothing else", () => {
  const p = roomSharePrefillPatch(host({ workLocations: ["สาขาภูเก็ต"] }), emptyTab());
  assert.deepEqual(Object.keys(p.workLocations![0]).sort(), ["name", "sortOrder"]);
});

/* ─────────────────────────── the patch never reaches further ─────────────────────────── */

/**
 * The dates belong to `roomShareChoicePatch`, under the **opposite** rule —
 * they are copied unconditionally, because the picker matches on overlap and
 * a guest that disagrees with its host has its whole span replaced by the
 * first cascade (final review I4). Two rules, two modules, and this one must
 * not acquire the other's fields.
 */
test("the prefill touches none of the choice patch's fields", () => {
  const p = roomSharePrefillPatch(host(), emptyTab()) as Record<string, unknown>;
  for (const key of [
    "departDate",
    "returnDate",
    "isRoomShareGuest",
    "roomShareHostRequestId",
    "accommodationId",
    "accommodationCustomText",
    "needsRoomBooking",
  ]) {
    assert.ok(
      !(key in p),
      `the prefill writes "${key}", which belongs to roomShareChoicePatch. Two writers of one ` +
        "field is the state room-share-choice.ts's own docblock exists to prevent",
    );
  }
});

test("the patch's keys are a subset of the five fields the user named", () => {
  const p = roomSharePrefillPatch(host(), emptyTab());
  assert.deepEqual(Object.keys(p).sort(), [
    "brandCode",
    "reasonCustomText",
    "reasonId",
    "workDetail",
    "workLocations",
  ]);
});
