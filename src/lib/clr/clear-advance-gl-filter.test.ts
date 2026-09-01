import { test } from "node:test";
import assert from "node:assert/strict";
import { isHqBranch, allowedDimensionTypes } from "./clear-advance-gl-filter";

test("HQ codes are head office", () => {
  assert.equal(isHqBranch("HQ01"), true);
  assert.equal(isHqBranch("hq"), true);
});

test("PC codes are branches", () => {
  assert.equal(isHqBranch("PC1057"), false);
  assert.equal(isHqBranch("PC2001"), false);
});

test("no branch yet behaves as HQ", () => {
  assert.equal(isHqBranch(null), true);
  assert.equal(isHqBranch(""), true);
});

test("HQ charges the employee accounts", () => {
  assert.deepEqual(allowedDimensionTypes("HQ01"), ["Employee", "Both"]);
});

test("a branch charges the branch accounts", () => {
  assert.deepEqual(allowedDimensionTypes("PC1057"), ["Branch", "Both"]);
});

test("Both belongs to each side, so it is never stranded", () => {
  assert.ok(allowedDimensionTypes("HQ01").includes("Both"));
  assert.ok(allowedDimensionTypes("PC1057").includes("Both"));
});
