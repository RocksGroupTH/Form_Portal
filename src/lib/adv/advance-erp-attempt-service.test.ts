import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAttemptNo } from "./advance-erp-attempt-service";

test("first attempt is 1 when there is no prior attempt", () => {
  assert.equal(nextAttemptNo(null), 1);
  assert.equal(nextAttemptNo(0), 1);
});

test("next attempt is max + 1", () => {
  assert.equal(nextAttemptNo(1), 2);
  assert.equal(nextAttemptNo(3), 4);
});
