import { test } from "node:test";
import assert from "node:assert/strict";
import { isUatModeCookieOn } from "./uat-mode";

test("only the exact string \"1\" turns the cookie on", () => {
  assert.equal(isUatModeCookieOn("1"), true);
});

test("anything else, including a falsy-looking string, is off", () => {
  assert.equal(isUatModeCookieOn("0"), false);
  assert.equal(isUatModeCookieOn(""), false);
  assert.equal(isUatModeCookieOn("true"), false);
});

test("missing values are off", () => {
  assert.equal(isUatModeCookieOn(null), false);
  assert.equal(isUatModeCookieOn(undefined), false);
});
