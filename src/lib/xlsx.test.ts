import { test } from "node:test";
import assert from "node:assert/strict";
// Relative, not "@/": tsx does not resolve the alias for a bare test run.
import { normalizeXlsx } from "./xlsx";

/**
 * The shape that broke: under a dynamic import of this CommonJS package the
 * namespace was `{ default, "module.exports" }` and the real API sat on
 * `default`, while the type declarations advertised the named exports — so
 * `XLSX.read(...)` type-checked, built, and threw at runtime.
 */
const fakeApi = { read: () => ({}), utils: {} };

test("the API is found when it sits directly on the namespace", () => {
  assert.equal(normalizeXlsx(fakeApi), fakeApi);
});

test("the API is found when the loader wrapped it in `default`", () => {
  assert.equal(normalizeXlsx({ default: fakeApi, "module.exports": fakeApi }), fakeApi);
});

test("a namespace whose own `read` is not callable falls through to default", () => {
  // Some interop shims put a non-function placeholder on the namespace. Testing
  // `typeof read === "function"` rather than `"read" in mod` is what makes this
  // resolve to the real module instead of the placeholder.
  assert.equal(normalizeXlsx({ read: undefined, default: fakeApi }), fakeApi);
});

test("a module with no read() anywhere raises rather than returning undefined", () => {
  // Loud, because the alternative is `Cannot read properties of undefined`
  // thrown from somewhere else entirely, long after the real cause.
  for (const bad of [null, undefined, {}, { default: {} }, "not a module"]) {
    assert.throws(() => normalizeXlsx(bad), /module shape changed/);
  }
});
