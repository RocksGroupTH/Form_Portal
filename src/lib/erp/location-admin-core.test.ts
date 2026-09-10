import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeBuSpread } from "./location-admin-core";

test("counts the Locations on each BU, commonest first", () => {
  const s = summarizeBuSpread([
    { buCode: "COCO" }, { buCode: "DODO-M" }, { buCode: "COCO" }, { buCode: "COCO" }, { buCode: "DODO-M" },
    { buCode: "EXPR" },
  ]);
  assert.deepEqual(s, [
    { buCode: "COCO", count: 3 },
    { buCode: "DODO-M", count: 2 },
    { buCode: "EXPR", count: 1 },
  ]);
});

/* The spread is what an accountant reads to tell whether the sync brought back
 * what they expected, so a tie has to render the same way every time rather
 * than following the order rows happened to arrive in. */
test("an equal count breaks by code, not by row order", () => {
  const s = summarizeBuSpread([{ buCode: "DODO" }, { buCode: "CTPS" }, { buCode: "COCO" }]);
  assert.deepEqual(s.map((e) => e.buCode), ["COCO", "CTPS", "DODO"]);
});

/* A Location with no BU is the case worth seeing: its lines fall back to the
 * codeunit's COCO. Folding those into COCO would hide exactly that. */
test("Locations with no BU are counted apart, never folded into COCO", () => {
  const s = summarizeBuSpread([{ buCode: "COCO" }, { buCode: null }, { buCode: "  " }]);
  assert.deepEqual(s, [
    { buCode: "COCO", count: 1 },
    { buCode: null, count: 2 },
  ]);
});

/* Whatever their count, the missing ones sort last: the list is read left to
 * right as "the estate", and an absence is not the headline. */
test("the no-BU group sorts last even when it is the largest", () => {
  const s = summarizeBuSpread([{ buCode: null }, { buCode: null }, { buCode: null }, { buCode: "COCO" }]);
  assert.deepEqual(s.map((e) => e.buCode), ["COCO", null]);
});

test("no rows gives no entries", () => {
  assert.deepEqual(summarizeBuSpread([]), []);
});
