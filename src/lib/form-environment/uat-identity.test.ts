import { test } from "node:test";
import assert from "node:assert/strict";
import { isUatId, UAT_IDENTITY_SEED } from "./uat-identity";

test("the seed itself counts as UAT", () => {
  // DBCC CHECKIDENT RESEED on an empty table makes the first row 900000.
  assert.equal(UAT_IDENTITY_SEED, 900000);
  assert.equal(isUatId(900000), true);
  assert.equal(isUatId(900001), true);
  assert.equal(isUatId(899999), false);
});

test("production ids are not UAT", () => {
  assert.equal(isUatId(1), false);
  assert.equal(isUatId(12345), false);
});

test("missing or unusable ids are not UAT", () => {
  assert.equal(isUatId(null), false);
  assert.equal(isUatId(undefined), false);
  assert.equal(isUatId(Number.NaN), false);
});
