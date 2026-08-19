import { test } from "node:test";
import assert from "node:assert/strict";
import { isUsableUserId } from "./auth-identity";

test("a real TeamMember id is usable", () => {
  assert.equal(isUsableUserId("1"), true);
  assert.equal(isUsableUserId("2008"), true);
  // Form Portal's own ids start at 100001 (migration 066 reseeds to 100000).
  assert.equal(isUsableUserId("100001"), true);
});

test("the degraded session's blank id is refused", () => {
  // What `signIn`'s catch used to grant, and what the jwt callback writes for
  // a retired roster row.
  assert.equal(isUsableUserId(""), false);
  assert.equal(isUsableUserId("   "), false);
});

test("zero is refused — it is the blank id one coercion later", () => {
  // `Number("")` is 0, and an `AccRequest.CreatedBy` of 0 matches nothing.
  assert.equal(isUsableUserId("0"), false);
});

test("a non-numeric or negative id is refused", () => {
  assert.equal(isUsableUserId("abc"), false);
  assert.equal(isUsableUserId("NaN"), false);
  assert.equal(isUsableUserId("-1"), false);
  assert.equal(isUsableUserId("1.5"), false);
});

test("a missing id is refused rather than throwing", () => {
  assert.equal(isUsableUserId(undefined), false);
  assert.equal(isUsableUserId(null), false);
  // The session type says string, but a token is whatever was signed into it.
  assert.equal(isUsableUserId(42), false);
});
