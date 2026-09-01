import { test } from "node:test";
import assert from "node:assert/strict";
import { isHqBranch } from "./clear-advance-gl-filter";

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
