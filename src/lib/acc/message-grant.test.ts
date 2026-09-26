import test from "node:test";
import assert from "node:assert/strict";
import { decideMessageTabAccess } from "./message-grant";

test("an admin passes regardless of the roster column", () => {
  assert.equal(decideMessageTabAccess(true, false), true);
  assert.equal(decideMessageTabAccess(true, true), true);
});

test("a non-admin passes only when the column is set", () => {
  assert.equal(decideMessageTabAccess(false, true), true);
  assert.equal(decideMessageTabAccess(false, false), false);
});

test("a truthy-but-not-boolean column value is coerced, never trusted raw", () => {
  // A missing-column degrade or a raw SQL bit can hand this a 1/0 rather than a
  // real boolean; the decision must still answer a boolean either way.
  assert.equal(decideMessageTabAccess(false, 1 as unknown as boolean), true);
  assert.equal(decideMessageTabAccess(false, 0 as unknown as boolean), false);
});
