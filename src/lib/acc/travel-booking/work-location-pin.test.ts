import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPinnedWorkLocation, hasUsablePin, workLocationIssue } from "./work-location-pin";

/**
 * ข้อ9 must be a place the booking desk can find on a map, not just a string.
 *
 * The rule is deliberately strict, and the cost is real: while Google is
 * unreachable nothing can be submitted. These cases pin the two halves that
 * matter — that a typed-only place is refused, and that (0,0) is refused rather
 * than accepted as "somewhere".
 */

const P = (name: string, lat: number | null, lng: number | null) => ({ name, lat, lng });

test("a named, pinned place satisfies it", () => {
  assert.equal(hasPinnedWorkLocation([P("เมญ่า เชียงใหม่", 18.8, 98.96)]), true);
});

test("THE POINT OF THIS RULE: a typed name with no pin does not", () => {
  assert.equal(hasPinnedWorkLocation([P("สาขาเชียงใหม่", null, null)]), false);
  assert.equal(workLocationIssue([P("สาขาเชียงใหม่", null, null)]), "unpinned");
});

test("nothing at all is a different problem from an unpinned name", () => {
  assert.equal(workLocationIssue([]), "none");
  assert.equal(workLocationIssue([P("   ", 18.8, 98.96)]), "none");
  assert.equal(workLocationIssue(null), "none");
  assert.equal(workLocationIssue(undefined), "none");
});

/**
 * (0,0) is a real point in the Gulf of Guinea. Treating it as "unset" is the
 * bug; refusing it is the rule, the same one the persist path and the map apply.
 */
test("null island is refused", () => {
  assert.equal(hasUsablePin({ lat: 0, lng: 0 }), false);
  assert.equal(hasPinnedWorkLocation([P("x", 0, 0)]), false);
  assert.equal(workLocationIssue([P("x", 0, 0)]), "unpinned");
});

test("a coordinate on one axis only is not a pin", () => {
  assert.equal(hasUsablePin({ lat: 18.8, lng: null }), false);
  assert.equal(hasUsablePin({ lat: null, lng: 98.9 }), false);
});

test("non-finite coordinates are refused", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(hasUsablePin({ lat: bad, lng: 98.9 }), false, `lat ${bad}`);
    assert.equal(hasUsablePin({ lat: 18.8, lng: bad }), false, `lng ${bad}`);
  }
});

/** A real coordinate of zero on ONE axis is legitimate — the equator, or Greenwich. */
test("zero on one axis alone is still a place", () => {
  assert.equal(hasUsablePin({ lat: 0, lng: 98.9 }), true);
  assert.equal(hasUsablePin({ lat: 51.48, lng: 0 }), true);
});

test("one pinned place among several unpinned ones is enough", () => {
  assert.equal(
    hasPinnedWorkLocation([P("a", null, null), P("b", 13.7, 100.5)]),
    true,
  );
  assert.equal(workLocationIssue([P("a", null, null), P("b", 13.7, 100.5)]), null);
});

/** The two functions must never disagree about the same list. */
test("workLocationIssue is null exactly when hasPinnedWorkLocation is true", () => {
  const lists = [
    [],
    [P("a", null, null)],
    [P("a", 0, 0)],
    [P("a", 13.7, 100.5)],
    [P("  ", 13.7, 100.5)],
    [P("a", null, null), P("b", 13.7, 100.5)],
  ];
  for (const l of lists) {
    assert.equal(workLocationIssue(l) === null, hasPinnedWorkLocation(l), JSON.stringify(l));
  }
});
