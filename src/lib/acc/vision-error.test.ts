import { test } from "node:test";
import assert from "node:assert/strict";
import { statusForVisionError } from "./vision-error";

test("a bad or revoked key is a configuration fault, not a transient one", () => {
  // Retrying a 401 never works. It must not reach the requester as "try again".
  assert.equal(statusForVisionError({ status: 401 }), 503);
  assert.equal(statusForVisionError({ status: 403 }), 503);
});

test("upstream trouble the caller could retry stays 502", () => {
  assert.equal(statusForVisionError({ status: 500 }), 502);
  assert.equal(statusForVisionError({ status: 529 }), 502);
  assert.equal(statusForVisionError({ status: 429 }), 502);
});

test("a refused request is our fault to fix, not the requester's to retry", () => {
  // 400 from upstream means we sent something wrong — a person retrying cannot help.
  assert.equal(statusForVisionError({ status: 400 }), 503);
});

test("an error with no status — a timeout, a dropped socket — is retryable", () => {
  assert.equal(statusForVisionError(new Error("socket hang up")), 502);
  assert.equal(statusForVisionError(null), 502);
  assert.equal(statusForVisionError(undefined), 502);
  assert.equal(statusForVisionError("boom"), 502);
});

test("a non-numeric status is not read as one", () => {
  assert.equal(statusForVisionError({ status: "401" }), 502);
});
