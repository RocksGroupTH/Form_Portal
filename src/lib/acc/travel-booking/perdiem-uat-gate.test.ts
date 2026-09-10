import { test } from "node:test";
import assert from "node:assert/strict";
import { uatByRecordId } from "./perdiem-uat-gate";

test("a UAT id prices in UAT", () => {
  assert.equal(uatByRecordId(900001), true);
  assert.equal(uatByRecordId(900000), true);
});

test("a production id does not", () => {
  assert.equal(uatByRecordId(1), false);
  assert.equal(uatByRecordId(899999), false);
});

test("an absent id is not UAT", () => {
  // The recompute's SELECT can lose a column without failing a typecheck, so
  // undefined must resolve to the production answer rather than throwing.
  assert.equal(uatByRecordId(undefined), false);
  assert.equal(uatByRecordId(null), false);
});
