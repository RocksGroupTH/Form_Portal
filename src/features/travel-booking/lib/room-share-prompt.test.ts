import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAskRoomShare } from "./room-share-prompt";

/* ─────────────────────────── a genuinely new trip ─────────────────────────── */

test("a brand-new form is asked", () => {
  assert.equal(shouldAskRoomShare(null), true);
  assert.equal(shouldAskRoomShare(undefined), true);
});

/**
 * Nothing produces this today — the page renders the form only once the fetch
 * has settled — but `requests: []` must answer "new" rather than reach for
 * `.length` on nothing.
 */
test("a group carrying no request at all counts as new", () => {
  assert.equal(shouldAskRoomShare({ requests: [] }), true);
  assert.equal(shouldAskRoomShare({ requests: null }), true);
  assert.equal(shouldAskRoomShare({}), true);
});

/* ─────────────────────────── a resumed draft is not ─────────────────────────── */

/**
 * The property the user named explicitly: somebody who saved yesterday and
 * came back has answered this question by having filled the form, and must
 * not be asked again on every visit.
 */
test("a resumed draft is never asked", () => {
  assert.equal(
    shouldAskRoomShare({ requests: [{ id: 1 }] }),
    false,
    "a requester who saved yesterday is asked again every time they reopen their own draft",
  );
});

test("a resumed group of several tabs is not asked either", () => {
  assert.equal(shouldAskRoomShare({ requests: [{ id: 1 }, { id: 2 }, { id: 3 }] }), false);
});
