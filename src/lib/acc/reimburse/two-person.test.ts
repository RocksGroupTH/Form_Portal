import { test } from "node:test";
import assert from "node:assert/strict";
import { canActFinalStep } from "./two-person";

test("the person who checked cannot also give the final approval", () => {
  assert.equal(canActFinalStep(10176, 10176), false);
});

test("anyone else in the pool can", () => {
  assert.equal(canActFinalStep(10177, 10176), true);
});

test("an unknown actor on either side is refused, not waved through", () => {
  // A missing StaffId must never be read as "different person".
  assert.equal(canActFinalStep(null, 10176), false);
  assert.equal(canActFinalStep(10177, null), false);
  assert.equal(canActFinalStep(undefined, undefined), false);
});
